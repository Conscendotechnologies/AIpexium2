/*---------------------------------------------------------------------------------------------
 *  Losslessness + safety proof for the cross-REQUEST block cache.
 *
 *  The cache is the transform that pays on real agent traffic (history is re-sent verbatim every
 *  turn), so its round-trip guarantee is what lets us keep it on by default: expand(compress(x))
 *  must equal x exactly, and any content we cannot resolve must be left ALONE rather than dropped.
 *--------------------------------------------------------------------------------------------*/
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const sc = require(path.join(__dirname, '..', 'out', 'proxy', 'sessionCache.js'));
const compressor = require(path.join(__dirname, '..', 'out', 'proxy', 'compressor.js'));

let failures = 0;
function check(name, fn) {
	try {
		fn();
		console.log(`  PASS  ${name}`);
	} catch (err) {
		failures++;
		console.error(`  FAIL  ${name}: ${err.message}`);
	}
}

/** Real, structurally varied content — the kind an agent actually pastes. */
const realFile = fs.readFileSync(path.join(__dirname, '..', 'src', 'proxy', 'compressor.js'), 'utf8');

check('first sighting learns without changing bytes; second references and round-trips', () => {
	const cache = new sc.SessionCache();
	const first = sc.compressText(realFile, cache, {});
	assert.strictEqual(first.blocksReferenced, 0, 'nothing to reference on first sighting');
	assert.strictEqual(first.text, realFile, 'first pass must be byte-identical');

	const second = sc.compressText(realFile, cache, {});
	assert.ok(second.blocksReferenced > 0, 'repeat content must be referenced');
	assert.ok(second.text.length < realFile.length, 'repeat must be smaller');
	assert.strictEqual(sc.expandText(second.text, cache), realFile, 'ROUND-TRIP must restore exactly');
});

check('content containing a literal cache marker is left untouched (no nesting)', () => {
	const cache = new sc.SessionCache();
	const evil = 'x'.repeat(50) + '\n\n' + sc.makeCacheMarker('deadbeef', 999) + '\n\n' + 'y'.repeat(2000);
	const res = sc.compressText(evil, cache, {});
	assert.strictEqual(res.blocksReferenced, 0, 'must decline content already carrying a marker');
	assert.strictEqual(res.text, evil, 'must not rewrite it');
});

check('an unresolvable key preserves the marker rather than losing content', () => {
	const cache = new sc.SessionCache();
	const orphan = 'head\n\n' + sc.makeCacheMarker('nosuchkey', 123) + '\n\ntail';
	assert.strictEqual(sc.expandText(orphan, cache), orphan, 'unknown key must not become empty');
});

check('eviction stays within both caps', () => {
	const cache = new sc.SessionCache({ maxEntries: 3, minBlockChars: 100 });
	for (let i = 0; i < 10; i++) {
		cache.put(('block' + i + '\n').repeat(40));
	}
	assert.ok(cache.size <= 3, 'entry cap respected');
	assert.ok(cache.bytes >= 0, 'byte accounting never goes negative');

	const byBytes = new sc.SessionCache({ maxEntries: 1000, maxBytes: 5000, minBlockChars: 100 });
	for (let i = 0; i < 50; i++) {
		byBytes.put(('b' + i + '\n').repeat(200));
	}
	assert.ok(byBytes.bytes <= 5000 || byBytes.size === 1, 'byte cap respected');
});

check('hash distinguishes same-length content and is stable', () => {
	assert.notStrictEqual(sc.hashBlock('a'.repeat(500)), sc.hashBlock('b'.repeat(500)), 'same length must not collide');
	assert.strictEqual(sc.hashBlock(realFile), sc.hashBlock(realFile), 'hash must be deterministic');
});

check('never emits more than the original', () => {
	const cache = new sc.SessionCache({ minBlockChars: 10 });
	const tiny = 'ab\n\ncd\n\nef';
	sc.compressText(tiny, cache, {});
	const again = sc.compressText(tiny, cache, {});
	assert.ok(again.text.length <= tiny.length, 'marker must never exceed the block it replaces');
});

check('agent loop: a re-sent file body is referenced once it leaves the recency window', () => {
	// The measured real-traffic shape: each turn re-sends the entire prior history verbatim.
	// A body arrives inside the recency-protected tail, so it is LEARNED on the turn it appears and
	// REFERENCED on the turn it slides past keepRecent — never rewritten while still protected.
	const cache = new sc.SessionCache();
	const mk = (role, text) => ({ role, content: [{ type: 'text', text }] });
	const messages = [{ role: 'system', content: 'You are a coding assistant.' }, mk('user', '[read_file Result]\n\n' + realFile)];
	const run = () => compressor.compressRequest({ messages }, { blockCache: cache, forwarded: true, options: {} }).stats;

	const turn1 = run();
	assert.strictEqual(turn1.tokensSaved, 0, 'nothing to reference on the first sighting');
	assert.ok(cache.size > 0, 'the protected tail must still be LEARNED (else the cache lags a turn)');

	messages.push(mk('assistant', 'ok'), mk('user', 'Now explain it.'));
	run(); // body still within keepRecent — correctly untouched

	messages.push(mk('assistant', 'done'), mk('user', 'And summarise.'));
	const turn3 = run();
	assert.ok(
		turn3.transformsApplied.some((t) => t.startsWith('cache:')),
		'once editable, the re-sent body must be referenced',
	);
	assert.ok(turn3.tokensSaved > 1000, `re-sent history must save materially (saved ${turn3.tokensSaved})`);
});

check('a PREVIEW call must not teach the cache (only forwarded requests may learn)', () => {
	// Regression: compression running without the request being delivered (the `simulate` command,
	// diagnostics, a dry run) used to populate the cache. The next REAL request then referenced
	// content the model had never received — observed live as a 97% "saving" that destroyed the
	// answer. Learning is gated on ctx.forwarded, which only the proxy sets.
	const cache = new sc.SessionCache();
	const mk = (role, text) => ({ role, content: [{ type: 'text', text }] });
	const messages = [
		{ role: 'system', content: 'sys' },
		mk('user', '[read_file Result]\n\n' + realFile),
		{ role: 'assistant', content: 'ok' },
		{ role: 'user', content: 'question' },
	];

	compressor.compressRequest({ messages }, { blockCache: cache, options: {} }); // preview — no forwarded flag
	assert.strictEqual(cache.size, 0, 'a preview must leave the cache empty');

	const real = compressor.compressRequest({ messages }, { blockCache: cache, forwarded: true, options: {} });
	const forwarded = real.body.messages.map((m) => (typeof m.content === 'string' ? m.content : m.content.map((b) => b.text || '').join(''))).join('\n');
	assert.ok(
		forwarded.includes('LOSSLESS BY CONSTRUCTION') || forwarded.length > realFile.length / 2,
		'the first real request must still carry the content in full',
	);
});

check('compressRequest leaves the caller messages unmutated', () => {
	const cache = new sc.SessionCache();
	const original = '[read_file Result]\n\n' + realFile;
	const messages = [
		{ role: 'system', content: 'sys' },
		{ role: 'user', content: [{ type: 'text', text: original }] },
		{ role: 'assistant', content: 'ok' },
		{ role: 'user', content: 'go' },
	];
	compressor.compressRequest({ messages }, { blockCache: cache, forwarded: true, options: {} });
	compressor.compressRequest({ messages }, { blockCache: cache, forwarded: true, options: {} });
	assert.strictEqual(messages[1].content[0].text, original, 'caller message must be untouched');
});

if (failures) {
	console.error(`\n${failures} check(s) failed`);
	process.exit(1);
}
console.log('\nAll sessionCache checks passed.');

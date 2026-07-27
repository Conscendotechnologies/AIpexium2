/*---------------------------------------------------------------------------------------------
 *  Unit test for the compression STRATEGY (compressor.js). Plain Node, offline, no LLM.
 *
 *  Verifies each transform saves tokens AND the safety rails hold:
 *   - system / assistant messages are never touched,
 *   - the most recent keepRecent messages are never touched,
 *   - structured (non-string) content is never touched,
 *   - dedupe keeps the latest copy, whitespace is lossless-ish, truncation keeps head+tail.
 *--------------------------------------------------------------------------------------------*/
'use strict';
const assert = require('assert');
const path = require('path');
const c = require(path.join(__dirname, '..', 'out', 'proxy', 'compressor.js'));

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

const big = (label, n) => (label + ' ').repeat(n); // long-ish filler string

check('whitespace normalization is meaning-preserving and shrinks blank runs', () => {
	const input = 'line1   \n\n\n\n\nline2\t\t\n   ';
	const out = c.normalizeWhitespaceText(input);
	assert.ok(out.length < input.length, 'should be shorter');
	assert.ok(out.includes('line1'), 'keeps line1');
	assert.ok(out.includes('line2'), 'keeps line2');
	assert.ok(!/\n{3,}/.test(out), 'no 3+ newline runs remain');
});

check('truncateHeadTail keeps head + tail and marks the elision', () => {
	const text = 'HEAD_MARKER\n' + big('mid', 4000) + '\nTAIL_MARKER';
	const out = c.truncateHeadTail(text, { head: 200, tail: 200 });
	assert.ok(out.length < text.length, 'shorter');
	assert.ok(out.includes('HEAD_MARKER'), 'keeps head');
	assert.ok(out.includes('TAIL_MARKER'), 'keeps tail');
	assert.ok(out.includes('siid-compression: elided'), 'has elision marker');
});

check('compressRequest NEVER touches system or assistant, or recent messages', () => {
	const messages = [
		{ role: 'system', content: big('SYSTEM', 500) },
		{ role: 'user', content: big('OLDUSER', 500) },
		{ role: 'assistant', content: big('ASSISTANT', 500) },
		{ role: 'user', content: big('RECENT', 500) }, // within keepRecent=2 window
		{ role: 'user', content: 'most recent short' },
	];
	const { body } = c.compressRequest({ messages }, {});
	assert.strictEqual(body.messages[0].content, messages[0].content, 'system untouched');
	assert.strictEqual(body.messages[2].content, messages[2].content, 'assistant untouched');
	assert.strictEqual(body.messages[3].content, messages[3].content, 'recent user untouched');
	assert.strictEqual(body.messages[4].content, messages[4].content, 'most recent untouched');
});

check('dedupe replaces older identical blocks, keeps the latest', () => {
	const dump = big('ACCOUNT_ROW', 200); // > dedupeMinChars
	const messages = [
		{ role: 'user', content: dump }, // #1 older dupe -> should be replaced
		{ role: 'assistant', content: 'thinking...' },
		{ role: 'user', content: dump }, // #3 latest dupe -> should survive
		{ role: 'user', content: 'q1' },
		{ role: 'user', content: 'q2' },
	];
	const { body, stats } = c.compressRequest({ messages }, { options: { truncateOversized: false, normalizeWhitespace: false } });
	assert.ok(stats.transformsApplied.some((t) => t.startsWith('dedupe:')), 'dedupe ran');
	assert.ok(body.messages[0].content.includes('duplicate content omitted'), 'older copy replaced');
	assert.strictEqual(body.messages[2].content, dump, 'latest copy survives intact');
	assert.ok(stats.tokensAfter < stats.tokensBefore, 'saved tokens');
});

check('truncation fires on oversized content and reports savings', () => {
	const huge = big('LOGLINE', 3000); // well over truncateOverChars
	const messages = [
		{ role: 'user', content: huge },
		{ role: 'user', content: 'q1' },
		{ role: 'user', content: 'q2' },
	];
	const { body, stats } = c.compressRequest({ messages }, { options: { dedupeRepeatedContent: false } });
	assert.ok(stats.transformsApplied.some((t) => t.startsWith('truncate:')), 'truncate ran');
	assert.ok(body.messages[0].content.length < huge.length, 'content shrunk');
	assert.ok(body.messages[0].content.includes('elided'), 'elision marked');
	assert.ok(stats.compressionRatio > 0, 'positive ratio');
});

check('structured (non-string) content is left untouched', () => {
	const blocks = [{ type: 'text', text: big('BLOCK', 500) }];
	const messages = [
		{ role: 'user', content: blocks },
		{ role: 'user', content: 'q1' },
		{ role: 'user', content: 'q2' },
	];
	const { body } = c.compressRequest({ messages }, {});
	assert.strictEqual(body.messages[0].content, blocks, 'array content untouched');
});

check('short messages are left alone (below size floor)', () => {
	const messages = [
		{ role: 'user', content: 'tiny' },
		{ role: 'user', content: 'q1' },
		{ role: 'user', content: 'q2' },
	];
	const { body, stats } = c.compressRequest({ messages }, {});
	assert.strictEqual(body.messages[0].content, 'tiny');
	assert.strictEqual(stats.passthrough, true);
});

console.log('');
if (failures > 0) {
	console.error(`${failures} test(s) failed.`);
	process.exit(1);
}
console.log('All compressor strategy tests passed.');

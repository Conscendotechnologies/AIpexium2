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

check('system is never touched; recent messages are never touched', () => {
	const messages = [
		{ role: 'system', content: big('SYSTEM', 500) },
		{ role: 'user', content: big('OLDUSER', 500) }, // unique -> nothing to dedupe, no whitespace runs
		{ role: 'assistant', content: big('ASSISTANT', 500) }, // unique -> untouched
		{ role: 'user', content: big('RECENT', 500) }, // within keepRecent=2 window
		{ role: 'user', content: 'most recent short' },
	];
	const { body } = c.compressRequest({ messages }, {});
	assert.strictEqual(body.messages[0].content, messages[0].content, 'system untouched');
	assert.strictEqual(body.messages[3].content, messages[3].content, 'recent user untouched');
	assert.strictEqual(body.messages[4].content, messages[4].content, 'most recent untouched');
});

check('an assistant turn is NEVER dropped/collapsed by role (general-purpose)', () => {
	// Two DIFFERENT assistant versions (like a coding loop). Neither may be collapsed to a marker;
	// the framework must not assume an older assistant turn is disposable.
	const v1 = 'assistant version one, distinct content ' + big('X', 100);
	const v2 = 'assistant version two, distinct content ' + big('Y', 100);
	const messages = [
		{ role: 'user', content: 'do it' },
		{ role: 'assistant', content: v1 },
		{ role: 'user', content: 'that failed' },
		{ role: 'assistant', content: v2 },
		{ role: 'user', content: 'try again' },
	];
	const { body, stats } = c.compressRequest({ messages }, {});
	assert.ok(!stats.transformsApplied.some((t) => t.startsWith('collapse')), 'no collapse transform exists');
	assert.strictEqual(body.messages[1].content, v1, 'older assistant version kept intact');
	assert.strictEqual(body.messages[3].content, v2, 'latest assistant version kept intact');
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
	// Disable blockDedup here to isolate the whole-message dedupe pass (blockDedup would otherwise
	// catch the same large shared block first — that's tested separately).
	const { body, stats } = c.compressRequest(
		{ messages },
		{ options: { truncateOversized: false, normalizeWhitespace: false, blockDedup: false } },
	);
	assert.ok(stats.transformsApplied.some((t) => t.startsWith('dedupe:')), 'dedupe ran');
	assert.ok(body.messages[0].content.includes('duplicate content omitted'), 'older copy replaced');
	assert.strictEqual(body.messages[2].content, dump, 'latest copy survives intact');
	assert.ok(stats.tokensAfter < stats.tokensBefore, 'saved tokens');
});

check('truncation is OFF by default (lossy, opt-in only)', () => {
	// End without a trailing space so lossless whitespace-trim doesn't change it — this test
	// isolates truncation, which must NOT fire by default.
	const huge = big('LOGLINE', 3000).trimEnd();
	const messages = [
		{ role: 'user', content: huge },
		{ role: 'user', content: 'q1' },
		{ role: 'user', content: 'q2' },
	];
	const { body, stats } = c.compressRequest({ messages }, {}); // defaults: truncate off
	assert.ok(!stats.transformsApplied.some((t) => t.startsWith('truncate:')), 'truncate did NOT run by default');
	assert.strictEqual(body.messages[0].content, huge, 'oversized content left intact by default (not truncated)');
});

check('truncation fires when explicitly opted in', () => {
	const huge = big('LOGLINE', 3000); // well over truncateOverChars
	const messages = [
		{ role: 'user', content: huge },
		{ role: 'user', content: 'q1' },
		{ role: 'user', content: 'q2' },
	];
	const { body, stats } = c.compressRequest({ messages }, { options: { truncateOversized: true, dedupeRepeatedContent: false } });
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

check('table compaction fires on an embedded SF record array and stays lossless', () => {
	const records = Array.from({ length: 40 }, (_, i) => ({
		Id: `001${String(i).padStart(15, '0')}`,
		Name: `Account ${i}`,
		Industry: 'Technology',
		AnnualRevenue: 1000000 + i,
	}));
	const content = 'Here are the query results:\n' + JSON.stringify(records) + '\nWhat is the total revenue?';
	const messages = [
		{ role: 'user', content },
		{ role: 'user', content: 'q1' },
		{ role: 'user', content: 'q2' },
	];
	const { body, stats } = c.compressRequest({ messages }, {});
	assert.ok(stats.transformsApplied.some((t) => t.startsWith('table:')), 'table transform ran');
	assert.ok(stats.tokensAfter < stats.tokensBefore, 'saved tokens');
	// The surrounding prose survives.
	assert.ok(body.messages[0].content.includes('Here are the query results:'), 'prefix kept');
	assert.ok(body.messages[0].content.includes('What is the total revenue?'), 'suffix kept');
	// And the compacted table still contains every value (spot-check a few).
	assert.ok(body.messages[0].content.includes('Account 39'), 'a record value survived');
	assert.ok(body.messages[0].content.includes('_siidTable'), 'compacted to table form');
});

check('table compaction leaves prose without JSON arrays untouched', () => {
	const content = 'Just some explanatory text with a [bracket] but no JSON array of objects here. '.repeat(10);
	const messages = [
		{ role: 'user', content },
		{ role: 'user', content: 'q1' },
		{ role: 'user', content: 'q2' },
	];
	const { body } = c.compressRequest({ messages }, {});
	// whitespace may trim, but no table transform and the text is essentially intact.
	assert.ok(body.messages[0].content.includes('[bracket]'), 'literal bracket text preserved');
	assert.ok(!body.messages[0].content.includes('_siidTable'), 'no bogus compaction');
});

check('block dedup fires on a re-pasted file body under different wrappers', () => {
	const body =
		'public class Svc {\n' +
		Array.from({ length: 40 }, (_, i) => `  static Integer m${i}(){ return ${i}; }`).join('\n') +
		'\n}';
	const messages = [
		{ role: 'user', content: 'Here is Svc.cls:\n' + body },
		{ role: 'assistant', content: 'ok' },
		{ role: 'user', content: 'The current Svc.cls again:\n' + body },
		{ role: 'user', content: 'q1' },
		{ role: 'user', content: 'q2' },
	];
	const { body: out, stats } = c.compressRequest({ messages }, {});
	assert.ok(stats.transformsApplied.some((t) => t.startsWith('block-dedup:')), 'block dedup ran');
	assert.ok(stats.tokensAfter < stats.tokensBefore, 'saved tokens');
	assert.ok(out.messages[0].content.includes('siid-ref'), 'older copy became a reference');
});

console.log('');
if (failures > 0) {
	console.error(`${failures} test(s) failed.`);
	process.exit(1);
}
console.log('All compressor strategy tests passed.');

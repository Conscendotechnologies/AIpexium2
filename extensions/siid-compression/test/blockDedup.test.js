/*---------------------------------------------------------------------------------------------
 *  Losslessness proof for blockDedup: expand(dedup(x)) deep-equals x, for cross-message shared
 *  file bodies. Also checks the wrapper-agnostic case and safety fall-throughs.
 *--------------------------------------------------------------------------------------------*/
'use strict';
const assert = require('assert');
const path = require('path');
const bd = require(path.join(__dirname, '..', 'out', 'proxy', 'blockDedup.js'));

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

/** A realistic multi-line "file body" over minBlockChars (800). */
function fileBody() {
	return (
		'public with sharing class AccountService {\n' +
		Array.from({ length: 40 }, (_, i) => `    public static Integer method${i}() { return ${i}; }`).join('\n') +
		'\n}'
	);
}

function assertRoundTrip(messages, label) {
	const { messages: deduped } = bd.dedup(messages, { editableUntil: messages.length });
	const restored = bd.expand(deduped);
	assert.deepStrictEqual(restored, messages, `${label}: round-trip must equal original`);
	return deduped;
}

check('dedups the SAME file body under DIFFERENT wrappers, round-trips', () => {
	const body = fileBody();
	const messages = [
		{ role: 'user', content: 'Here is AccountService.cls:\n' + body },
		{ role: 'assistant', content: 'Read it.' },
		{ role: 'user', content: 'For reference, the current AccountService.cls again:\n' + body + '\nAdd a method.' },
	];
	const deduped = assertRoundTrip(messages, 'wrapper-agnostic');
	// The OLDER copy (msg 0) should now hold a ref; the NEWER copy (msg 2) stays intact.
	assert.ok(bd.REF_RE.test(deduped[0].content), 'older copy replaced with a ref');
	assert.ok(deduped[2].content.includes('public with sharing class AccountService'), 'newest copy intact');
	assert.ok(deduped[0].content.length < messages[0].content.length, 'older message shrank');
	// The differing prose around the shared body is preserved.
	assert.ok(deduped[0].content.startsWith('Here is AccountService.cls:'), 'older wrapper prose kept');
});

check('leaves messages with no large shared block untouched', () => {
	const messages = [
		{ role: 'user', content: 'small unique message one, nothing shared here.' },
		{ role: 'user', content: 'entirely different small message two.' },
	];
	const { messages: deduped, blocksDeduped } = bd.dedup(messages, { editableUntil: messages.length });
	assert.strictEqual(blocksDeduped, 0, 'nothing deduped');
	assert.deepStrictEqual(deduped, messages, 'unchanged');
});

check('does NOT dedup blocks below minBlockChars', () => {
	const small = 'line1\nline2\nline3'; // well under 800 chars
	const messages = [
		{ role: 'user', content: 'A: ' + small },
		{ role: 'user', content: 'B: ' + small },
	];
	const { blocksDeduped } = bd.dedup(messages, { editableUntil: messages.length });
	assert.strictEqual(blocksDeduped, 0, 'small shared block ignored');
});

check('round-trips when the body appears THREE times (older two ref the newest)', () => {
	const body = fileBody();
	const messages = [
		{ role: 'user', content: 'v1:\n' + body },
		{ role: 'user', content: 'v2 (same):\n' + body },
		{ role: 'user', content: 'v3 (same):\n' + body + '\nlast' },
	];
	const deduped = assertRoundTrip(messages, 'triple');
	assert.ok(bd.REF_RE.test(deduped[0].content), 'first copy referenced');
	assert.ok(bd.REF_RE.test(deduped[1].content), 'second copy referenced');
	assert.ok(deduped[2].content.includes('class AccountService'), 'newest copy intact');
});

check('recency-protected messages are used as source but not rewritten', () => {
	const body = fileBody();
	const messages = [
		{ role: 'user', content: 'old:\n' + body }, // editable
		{ role: 'user', content: 'q1' },
		{ role: 'user', content: 'newest:\n' + body }, // recency-protected (editableUntil=1)
	];
	const { messages: deduped } = bd.dedup(messages, { editableUntil: 1 });
	assert.ok(bd.REF_RE.test(deduped[0].content), 'old copy referenced the protected newest copy');
	assert.strictEqual(deduped[2].content, messages[2].content, 'protected message untouched');
	assert.deepStrictEqual(bd.expand(deduped), messages, 'still round-trips');
});

check('round-trips with exotic characters in the shared body', () => {
	const body = 'weird: "quotes" \\backslash\\ \t tabs\n' + '数据 emoji 🚀 ⟪not a real marker⟫\n'.repeat(40);
	const messages = [
		{ role: 'user', content: 'x:\n' + body },
		{ role: 'user', content: 'y:\n' + body + '\nend' },
	];
	assertRoundTrip(messages, 'exotic');
});

console.log('');
if (failures > 0) {
	console.error(`${failures} test(s) failed.`);
	process.exit(1);
}
console.log('All blockDedup tests passed.');

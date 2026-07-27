/*---------------------------------------------------------------------------------------------
 *  Losslessness proof for repeatedLines: expand(collapse(x)) === x, across realistic log shapes.
 *--------------------------------------------------------------------------------------------*/
'use strict';
const assert = require('assert');
const path = require('path');
const rl = require(path.join(__dirname, '..', 'out', 'proxy', 'repeatedLines.js'));

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

function assertRoundTrip(text, label) {
	const { text: collapsed } = rl.collapse(text);
	const restored = rl.expand(collapsed);
	assert.strictEqual(restored, text, `${label}: round-trip must equal original`);
}

check('collapses a long run of identical log lines and round-trips', () => {
	const text = 'start\n' + '2026-07-27 DEBUG deploy step ok\n'.repeat(400) + 'end';
	assertRoundTrip(text, 'identical-run');
	const { text: collapsed, runsCollapsed } = rl.collapse(text);
	assert.strictEqual(runsCollapsed, 1, 'one run collapsed');
	assert.ok(collapsed.length < text.length / 10, 'dramatically smaller');
	assert.ok(collapsed.includes('siid-repeat ×399'), 'marker records 399 repeats');
});

check('leaves runs shorter than minRun untouched', () => {
	const text = 'a\na\na\nb\nc'; // run of 3 < default minRun 4
	const { text: collapsed, runsCollapsed } = rl.collapse(text);
	assert.strictEqual(runsCollapsed, 0, 'no collapse');
	assert.strictEqual(collapsed, text, 'unchanged');
});

check('does NOT collapse near-identical (timestamped) lines', () => {
	// Same shape, different timestamp each line — must be left intact (varying part matters).
	const text = Array.from({ length: 50 }, (_, i) => `2026-07-27T10:00:${String(i).padStart(2, '0')} DEBUG ok`).join('\n');
	const { text: collapsed, runsCollapsed } = rl.collapse(text);
	assert.strictEqual(runsCollapsed, 0, 'nothing collapsed (all lines differ)');
	assert.strictEqual(collapsed, text, 'unchanged');
});

check('handles multiple separate runs and round-trips', () => {
	const text = 'x\n' + 'AAA\n'.repeat(10) + 'y\n' + 'BBB\n'.repeat(6) + 'z';
	assertRoundTrip(text, 'multi-run');
	const { runsCollapsed } = rl.collapse(text);
	assert.strictEqual(runsCollapsed, 2, 'two runs collapsed');
});

check('preserves trailing newline exactly', () => {
	const withNl = 'AAA\n'.repeat(10); // ends in \n
	assertRoundTrip(withNl, 'trailing-nl');
	const noNl = 'AAA\n'.repeat(9) + 'AAA'; // no trailing \n
	assertRoundTrip(noNl, 'no-trailing-nl');
});

check('text without newlines is untouched', () => {
	const { text, runsCollapsed } = rl.collapse('single line no newline');
	assert.strictEqual(runsCollapsed, 0);
	assert.strictEqual(text, 'single line no newline');
});

check('round-trips empty lines within a run', () => {
	const text = 'head\n' + '\n'.repeat(20) + 'tail'; // 20 blank lines in a row
	assertRoundTrip(text, 'blank-run');
});

console.log('');
if (failures > 0) {
	console.error(`${failures} test(s) failed.`);
	process.exit(1);
}
console.log('All repeatedLines tests passed.');

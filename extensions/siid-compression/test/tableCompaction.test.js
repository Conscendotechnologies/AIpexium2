/*---------------------------------------------------------------------------------------------
 *  Losslessness proof for tableCompaction: expand(compact(x)) deep-equals x, across many real
 *  SF-record shapes. Also checks the safety fall-throughs and that it actually saves bytes.
 *--------------------------------------------------------------------------------------------*/
'use strict';
const assert = require('assert');
const path = require('path');
const tc = require(path.join(__dirname, '..', 'out', 'proxy', 'tableCompaction.js'));

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

/**
 * Assert compact→expand restores the exact original (the losslessness guarantee). Uses
 * skipSizeGuard so even small shapes (which production would decline for lack of savings) still
 * prove round-trip correctness — losslessness must hold for EVERY shape, independent of size.
 */
function assertRoundTrip(arr, label) {
	const compacted = tc.compact(arr, { skipSizeGuard: true });
	assert.ok(compacted !== null, `${label}: expected compaction (got null)`);
	const restored = tc.expand(compacted);
	assert.deepStrictEqual(restored, arr, `${label}: round-trip must equal original`);
}

check('round-trips a uniform SF query result', () => {
	const records = Array.from({ length: 60 }, (_, i) => ({
		attributes: { type: 'Account', url: `/services/data/v59.0/sobjects/Account/001${i}` },
		Id: `001${String(i).padStart(15, '0')}`,
		Name: `Account ${i}`,
		Industry: i % 2 ? 'Technology' : 'Finance',
		AnnualRevenue: 1000000 + i,
	}));
	assertRoundTrip(records, 'uniform');
});

check('round-trips with ABSENT keys (sparse rows) — absence != null', () => {
	const records = [
		{ Id: '001', Name: 'A', Industry: 'Tech' },
		{ Id: '002', Name: 'B' }, // Industry ABSENT
		{ Id: '003', Name: 'C', Industry: null }, // Industry present but null
	];
	assertRoundTrip(records, 'sparse');
	// Prove absent vs null is preserved distinctly.
	const restored = tc.expand(tc.compact(records, { skipSizeGuard: true }));
	assert.ok(!('Industry' in restored[1]), 'absent key stays absent');
	assert.strictEqual(restored[2].Industry, null, 'explicit null stays null');
});

check('round-trips nested objects/arrays as opaque cell values', () => {
	const records = [
		{ Id: '1', Meta: { region: 'us', tier: 3 }, Tags: ['a', 'b'] },
		{ Id: '2', Meta: { region: 'eu', tier: 1 }, Tags: [] },
	];
	assertRoundTrip(records, 'nested');
});

check('round-trips varied value types (num/bool/null/string/empty)', () => {
	const records = [
		{ a: 1, b: true, c: null, d: 'x', e: '' },
		{ a: -0.5, b: false, c: null, d: 'y', e: 'z' },
	];
	assertRoundTrip(records, 'types');
});

check('actually saves bytes on a repetitive array', () => {
	const records = Array.from({ length: 50 }, (_, i) => ({
		Id: `001${i}`,
		Name: `Account number ${i}`,
		Industry: 'Technology',
		Rating: 'Hot',
	}));
	const before = JSON.stringify(records).length;
	const after = JSON.stringify(tc.compact(records)).length;
	assert.ok(after < before, `expected smaller: ${before} -> ${after}`);
	console.log(`        (${before} -> ${after} chars, ${(((before - after) / before) * 100).toFixed(1)}% smaller)`);
});

/* --- safety fall-throughs: compact() returns null (leave original untouched) --- */

check('does NOT compact fewer than 2 items', () => {
	assert.strictEqual(tc.compact([{ Id: '1', Name: 'A' }]), null);
	assert.strictEqual(tc.compact([]), null);
});

check('does NOT compact non-object elements', () => {
	assert.strictEqual(tc.compact([1, 2, 3]), null);
	assert.strictEqual(tc.compact([{ a: 1 }, 'string']), null);
	assert.strictEqual(tc.compact([{ a: 1 }, [1, 2]]), null);
});

check('does NOT compact a non-array', () => {
	assert.strictEqual(tc.compact({ a: 1 }), null);
	assert.strictEqual(tc.compact('not an array'), null);
});

check('does NOT compact wildly heterogeneous rows (uneven schema)', () => {
	// Each object has entirely different keys -> more cols than rows -> not tabular.
	const rows = [
		{ a1: 1, b1: 2, c1: 3, d1: 4, e1: 5 },
		{ f1: 1, g1: 2, h1: 3, i1: 4, j1: 5 },
	];
	assert.strictEqual(tc.compact(rows), null);
});

console.log('');
if (failures > 0) {
	console.error(`${failures} test(s) failed.`);
	process.exit(1);
}
console.log('All tableCompaction tests passed.');

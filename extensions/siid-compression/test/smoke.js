/*---------------------------------------------------------------------------------------------
 *  Headless smoke test for the compression manager (inline diagnostics path).
 *
 *  Runs on plain Node (no VS Code host). Verifies:
 *   1. Passthrough backend returns messages unchanged.
 *   2. 'auto' selects a healthy backend and never throws (falls back to passthrough).
 *   3. 'node-proxy' backend runs our own compressor in-process without throwing.
 *   4. Master switch off forces passthrough.
 *   5. simulate never throws.
 *
 *  Note: with the SCAFFOLD compressor (passthrough strategy), node-proxy leaves messages
 *  unchanged too — so we assert "no throw + message count preserved", not a specific ratio.
 *
 *  Exits non-zero on any failure so build-and-test.bat can gate on it.
 *--------------------------------------------------------------------------------------------*/
'use strict';
const assert = require('assert');
const path = require('path');

const { CompressionManager } = require(path.join(__dirname, '..', 'out', 'compressionManager.js'));

const log = () => {}; // silence manager logging in the test
const SAMPLE = [
	{ role: 'system', content: 'You are a Salesforce assistant.' },
	{ role: 'user', content: 'List my accounts.' },
];

function baseConfig(overrides) {
	return Object.assign(
		{
			enabled: true,
			backend: 'auto',
			healthCheckTtlMs: 30000,
		},
		overrides,
	);
}

async function run() {
	let failures = 0;
	const check = async (name, fn) => {
		try {
			await fn();
			console.log(`  PASS  ${name}`);
		} catch (err) {
			failures++;
			console.error(`  FAIL  ${name}: ${err.message}`);
		}
	};

	await check('passthrough returns messages unchanged', async () => {
		const mgr = new CompressionManager(baseConfig({ backend: 'passthrough' }), '0.0.0-test', log);
		const res = await mgr.compress(SAMPLE);
		assert.strictEqual(res.messages, SAMPLE, 'should return the same array reference');
		assert.strictEqual(res.stats.backend, 'passthrough');
		assert.strictEqual(res.stats.passthrough, true);
		assert.strictEqual(await mgr.activeBackend(), 'passthrough');
	});

	await check('auto selects a backend and never throws', async () => {
		const mgr = new CompressionManager(baseConfig({ backend: 'auto' }), '0.0.0-test', log);
		const backend = await mgr.activeBackend();
		assert.ok(backend === 'node-proxy' || backend === 'passthrough', `unexpected backend ${backend}`);
		const res = await mgr.compress(SAMPLE); // must not throw
		assert.strictEqual(res.messages.length, SAMPLE.length);
	});

	await check('node-proxy backend runs the compressor without throwing', async () => {
		const mgr = new CompressionManager(baseConfig({ backend: 'node-proxy' }), '0.0.0-test', log);
		const res = await mgr.compress(SAMPLE); // must not throw even if compressor missing
		assert.strictEqual(res.messages.length, SAMPLE.length);
		const backend = await mgr.activeBackend();
		assert.ok(backend === 'node-proxy' || backend === 'passthrough', `unexpected backend ${backend}`);
	});

	await check('disabled master switch forces passthrough', async () => {
		const mgr = new CompressionManager(baseConfig({ enabled: false, backend: 'node-proxy' }), '0.0.0-test', log);
		assert.strictEqual(await mgr.activeBackend(), 'passthrough');
	});

	await check('simulate never throws', async () => {
		const mgr = new CompressionManager(baseConfig({ backend: 'auto' }), '0.0.0-test', log);
		const sim = await mgr.simulate(SAMPLE);
		assert.ok(sim.backend === 'node-proxy' || sim.backend === 'passthrough');
		assert.strictEqual(typeof sim.tokensBefore, 'number');
	});

	console.log('');
	if (failures > 0) {
		console.error(`${failures} test(s) failed.`);
		process.exit(1);
	}
	console.log('All smoke tests passed.');
}

run().catch((err) => {
	console.error('Smoke test crashed:', err);
	process.exit(1);
});

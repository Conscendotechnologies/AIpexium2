/*---------------------------------------------------------------------------------------------
 *  Headless test for ProxyManager — spawns OUR OWN Node proxy and checks the lifecycle.
 *
 *  Fully offline: /health answers without contacting OpenRouter, so no API key is needed.
 *    node extensions/siid-compression/test/proxy-manager.test.js
 *--------------------------------------------------------------------------------------------*/
'use strict';
const path = require('path');
const { ProxyManager } = require(path.join(__dirname, '..', 'out', 'proxyManager.js'));

const log = (m) => console.log(`  ${m}`);

const config = {
	serverPath: '', // auto-resolve bundled out/proxy/server.js
	nodePath: '', // use this process's Node
	port: 0, // auto free port
	host: '127.0.0.1',
	upstreamUrl: '',
	extraArgs: [],
	env: {}, // no OPENROUTER_API_KEY needed for /health
	maxRestarts: 1,
	healthTimeoutMs: 15000,
};

async function main() {
	const mgr = new ProxyManager(config, log);
	console.log('Starting managed Node proxy...');
	const ok = await mgr.start();

	console.log(`\nstate:   ${mgr.state}`);
	console.log(`baseUrl: ${mgr.baseUrl()}`);

	if (!ok || mgr.state !== 'healthy') {
		console.error('\nFAIL: proxy did not become healthy.');
		mgr.stop();
		process.exit(1);
	}

	// Confirm the base URL actually answers and reports our backend.
	const health = mgr.baseUrl().replace(/\/v1$/, '') + '/health';
	const res = await fetch(health);
	const body = await res.json();
	console.log(`health status: ${body.status}, backend: ${body.backend}, uptimeMs: ${body.uptimeMs}`);
	if (body.status !== 'healthy' || body.backend !== 'openrouter') {
		console.error('\nFAIL: unexpected /health payload.');
		mgr.stop();
		process.exit(1);
	}

	const healthy = await mgr.isHealthy();
	console.log(`isHealthy(): ${healthy}`);

	mgr.stop();
	console.log(`\nstate after stop: ${mgr.state}`);
	const pass = mgr.state === 'stopped' && healthy;
	console.log(pass ? '\nPASS: proxy lifecycle OK.' : '\nFAIL: unexpected end state.');
	process.exit(pass ? 0 : 1);
}

main().catch((err) => {
	console.error('crashed:', err);
	process.exit(1);
});

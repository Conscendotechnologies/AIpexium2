/*---------------------------------------------------------------------------------------------
 *  End-to-end test for the Node proxy — no OpenRouter needed.
 *
 *  Stands up a FAKE upstream (an OpenAI-compatible echo server), points our proxy at it via
 *  --openai-api-url, and sends a /v1/chat/completions request through the proxy. Verifies:
 *   - the request reaches the upstream at the right path with the Authorization header,
 *   - the compressor request hook ran (messages relayed intact under the scaffold),
 *   - the response comes back through the proxy unchanged.
 *--------------------------------------------------------------------------------------------*/
'use strict';
const assert = require('assert');
const http = require('http');
const path = require('path');
const { start } = require(path.join(__dirname, '..', 'out', 'proxy', 'server.js'));

function listen(server) {
	return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

async function main() {
	// --- fake upstream: records what it received, echoes a completion ---
	let received = null;
	const upstream = http.createServer((req, res) => {
		const chunks = [];
		req.on('data', (c) => chunks.push(c));
		req.on('end', () => {
			received = {
				method: req.method,
				url: req.url,
				auth: req.headers['authorization'] || '',
				body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'),
			};
			res.writeHead(200, { 'content-type': 'application/json' });
			res.end(JSON.stringify({ id: 'cmpl-1', choices: [{ message: { role: 'assistant', content: 'ok' } }] }));
		});
	});
	const upstreamPort = await listen(upstream);

	// --- our proxy, pointed at the fake upstream ---
	process.env.OPENROUTER_API_KEY = 'test-key';
	const { server: proxy, port } = await start({
		host: '127.0.0.1',
		port: 0,
		upstream: `http://127.0.0.1:${upstreamPort}/api/v1`,
	});

	let failures = 0;
	try {
		const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				model: 'openai/gpt-4o',
				messages: [
					{ role: 'system', content: 'You are a Salesforce assistant.' },
					{ role: 'user', content: 'List my accounts.' },
				],
			}),
		});
		const body = await res.json();

		const check = (name, cond) => {
			if (cond) {
				console.log(`  PASS  ${name}`);
			} else {
				failures++;
				console.error(`  FAIL  ${name}`);
			}
		};

		check('response relayed from upstream', body && body.id === 'cmpl-1');
		check('upstream received the request', received !== null);
		check('rebased path is /api/v1/chat/completions', received && received.url === '/api/v1/chat/completions');
		check('OPENROUTER_API_KEY injected as Bearer', received && received.auth === 'Bearer test-key');
		check('messages relayed intact (scaffold passthrough)', received && received.body.messages.length === 2);
		check('model forwarded', received && received.body.model === 'openai/gpt-4o');
	} finally {
		proxy.close();
		upstream.close();
	}

	console.log('');
	if (failures > 0) {
		console.error(`${failures} test(s) failed.`);
		process.exit(1);
	}
	console.log('All proxy e2e tests passed.');
	process.exit(0);
}

main().catch((err) => {
	console.error('crashed:', err);
	process.exit(1);
});

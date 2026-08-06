/*---------------------------------------------------------------------------------------------
 *  LIVE test: block dedup replaces an OLDER copy of a file body with a reference marker, keeping
 *  the NEWEST copy intact. This checks the model can still answer a question about the file — it
 *  should use the intact newest copy. Probes whether the reference marker confuses the model.
 *
 *  Needs an OpenRouter key. No key ⇒ skip, exit 0.
 *    node test/live-blockdedup.test.js
 *--------------------------------------------------------------------------------------------*/
'use strict';
const fs = require('fs');
const path = require('path');
const { start } = require(path.join(__dirname, '..', 'out', 'proxy', 'server.js'));
const compressor = require(path.join(__dirname, '..', 'out', 'proxy', 'compressor.js'));

function loadApiKey() {
	if (process.env.OPENROUTER_API_KEY) {
		return process.env.OPENROUTER_API_KEY.trim();
	}
	const f = path.join(__dirname, '..', '.env.local');
	if (fs.existsSync(f)) {
		for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
			const m = /^\s*OPENROUTER_API_KEY\s*=\s*(.+?)\s*$/.exec(line);
			if (m) {
				return m[1].replace(/^["']|["']$/g, '').trim();
			}
		}
	}
	return '';
}

async function main() {
	const apiKey = loadApiKey();
	if (!apiKey) {
		console.log('No OPENROUTER_API_KEY — skipping live block-dedup test.');
		process.exit(0);
	}
	const model = process.env.OPENROUTER_MODEL || 'google/gemma-4-26b-a4b-it:free';

	// A file with a DISTINCTIVE method the question targets.
	const body =
		'public with sharing class OrderService {\n' +
		Array.from({ length: 30 }, (_, i) => `    public static Integer helper${i}() { return ${i}; }`).join('\n') +
		'\n    public static String SECRET_METHOD() { return \'MAGIC-4291\'; }\n' +
		'}';
	const messages = [
		{ role: 'user', content: 'Here is OrderService.cls:\n' + body },
		{ role: 'assistant', content: 'I have read OrderService.cls.' },
		{ role: 'user', content: 'For reference, the current OrderService.cls again:\n' + body },
		{ role: 'assistant', content: 'Noted, still the same file.' },
		{ role: 'user', content: 'What string does SECRET_METHOD() return? Answer with just the value.' },
	];

	const { stats } = compressor.compressRequest({ messages }, {});
	console.log('--- compression preview ---');
	console.log(
		`  ${stats.tokensBefore} -> ${stats.tokensAfter} tok (${(stats.compressionRatio * 100).toFixed(1)}%)  transforms: ${stats.transformsApplied.join(', ')}`,
	);
	let failures = 0;
	if (!stats.transformsApplied.some((t) => t.startsWith('block-dedup:'))) {
		failures++;
		console.error('  FAIL  block dedup did not fire');
	} else {
		console.log('  PASS  block dedup fired (older copy referenced)');
	}

	process.env.OPENROUTER_API_KEY = apiKey;
	const { server, port } = await start({ host: '127.0.0.1', port: 0, upstream: 'https://openrouter.ai/api/v1' });
	console.log(`\n--- routing through proxy (:${port}) to ${model} ---`);
	try {
		const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'x-siid-source': 'live-blockdedup-test' },
			body: JSON.stringify({ model, messages, max_tokens: 30 }),
		});
		const text = await res.text();
		if (!res.ok) {
			failures++;
			console.error(`  FAIL  OpenRouter HTTP ${res.status}: ${text.slice(0, 300)}`);
		} else {
			const answer = String(JSON.parse(text).choices?.[0]?.message?.content ?? '').trim();
			console.log(`  model answer: ${answer}`);
			if (answer.includes('MAGIC-4291')) {
				console.log('  PASS  model read SECRET_METHOD value from the INTACT newest copy (dedup did not hide it)');
			} else {
				failures++;
				console.error('  FAIL  model could not find MAGIC-4291 — dedup may have hidden needed content');
			}
		}
	} catch (err) {
		failures++;
		console.error(`  FAIL  request threw: ${err.message}`);
	} finally {
		server.close();
	}

	console.log('');
	if (failures > 0) {
		console.error(`${failures} check(s) failed.`);
		process.exit(1);
	}
	console.log('LIVE block-dedup test passed.');
	process.exit(0);
}

main().catch((err) => {
	console.error('crashed:', err);
	process.exit(1);
});

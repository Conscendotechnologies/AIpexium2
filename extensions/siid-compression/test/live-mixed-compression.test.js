/*---------------------------------------------------------------------------------------------
 *  LIVE test: route a MIXED agent payload (SF record array + a repetitive deploy log) through the
 *  proxy and confirm the model answers correctly from BOTH compressed forms — proving that table
 *  compaction AND repeated-line collapse are lossless through a real LLM, not just mechanically.
 *
 *  Needs an OpenRouter key (env OPENROUTER_API_KEY or .env.local). No key ⇒ skip, exit 0.
 *    node test/live-mixed-compression.test.js
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
	for (const envFile of [path.join(__dirname, '..', '.env.local')]) {
		if (fs.existsSync(envFile)) {
			for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
				const m = /^\s*OPENROUTER_API_KEY\s*=\s*(.+?)\s*$/.exec(line);
				if (m) {
					return m[1].replace(/^["']|["']$/g, '').trim();
				}
			}
		}
	}
	return '';
}

function buildMixed() {
	const records = Array.from({ length: 60 }, (_, i) => ({
		attributes: { type: 'Account', url: `/services/data/v59.0/sobjects/Account/001${i}` },
		Id: `001${String(i).padStart(15, '0')}`,
		Name: `Account ${i}`,
		Industry: i % 3 === 0 ? 'Finance' : 'Technology',
		AnnualRevenue: 1000000 + i * 25000,
		Rating: i % 2 ? 'Hot' : 'Warm',
	}));
	const target = records[42];
	const queryMsg =
		'Result of `sf data query ... --json`:\n' + JSON.stringify({ status: 0, result: { totalSize: 60, records } });
	// A deploy log with a long IDENTICAL run + one distinctive final line the model must read.
	const deployLog =
		'Deploy log:\n' + 'DEBUG deploy step ok\n'.repeat(300) + 'RESULT: deploy finished with code SUCCESS-7788';
	const messages = [
		{ role: 'system', content: 'You are a Salesforce assistant. Answer tersely and exactly.' },
		{ role: 'user', content: queryMsg },
		{ role: 'assistant', content: 'I have the 60 Account records.' },
		{ role: 'user', content: deployLog },
		{ role: 'assistant', content: 'Deploy log received.' },
		{
			role: 'user',
			content:
				`Two things, each on its own line:\n` +
				`1) The AnnualRevenue of "${target.Name}" (number only).\n` +
				`2) The deploy result code from the log (the SUCCESS-#### token).`,
		},
	];
	return { messages, expectedRevenue: String(target.AnnualRevenue), expectedCode: 'SUCCESS-7788', targetName: target.Name };
}

async function main() {
	const apiKey = loadApiKey();
	if (!apiKey) {
		console.log('No OPENROUTER_API_KEY — skipping live mixed-compression test.');
		process.exit(0);
	}
	const model = process.env.OPENROUTER_MODEL || 'google/gemma-4-26b-a4b-it:free';
	const { messages, expectedRevenue, expectedCode, targetName } = buildMixed();

	const { stats } = compressor.compressRequest({ messages }, {});
	console.log('--- compression preview ---');
	console.log(
		`  ${stats.tokensBefore} -> ${stats.tokensAfter} tok (${(stats.compressionRatio * 100).toFixed(1)}%)  transforms: ${stats.transformsApplied.join(', ')}`,
	);
	let failures = 0;
	const need = (t) => stats.transformsApplied.some((x) => x.startsWith(t));
	if (!need('table:')) {
		failures++;
		console.error('  FAIL  table compaction did not fire');
	} else {
		console.log('  PASS  table compaction fired');
	}
	if (!need('lines:')) {
		failures++;
		console.error('  FAIL  line collapse did not fire');
	} else {
		console.log('  PASS  line collapse fired');
	}

	process.env.OPENROUTER_API_KEY = apiKey;
	const { server, port } = await start({ host: '127.0.0.1', port: 0, upstream: 'https://openrouter.ai/api/v1' });
	console.log(`\n--- routing through proxy (:${port}) to ${model} ---`);
	try {
		const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'x-siid-source': 'live-mixed-test' },
			body: JSON.stringify({ model, messages, max_tokens: 60 }),
		});
		const text = await res.text();
		if (!res.ok) {
			failures++;
			console.error(`  FAIL  OpenRouter HTTP ${res.status}: ${text.slice(0, 300)}`);
		} else {
			const answer = String(JSON.parse(text).choices?.[0]?.message?.content ?? '').trim();
			console.log(`  model answer: ${answer.replace(/\n/g, ' | ')}`);
			const flat = answer.replace(/[,$\s]/g, '');
			if (flat.includes(expectedRevenue)) {
				console.log(`  PASS  revenue ${expectedRevenue} (${targetName}) read from COMPACTED table`);
			} else {
				failures++;
				console.error(`  FAIL  expected revenue ${expectedRevenue}; not found in answer`);
			}
			if (answer.includes(expectedCode)) {
				console.log(`  PASS  deploy code ${expectedCode} read from COLLAPSED log (survived the run)`);
			} else {
				failures++;
				console.error(`  FAIL  expected code ${expectedCode}; not found in answer`);
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
	console.log('LIVE mixed-compression test passed — both transforms lossless through a real model.');
	process.exit(0);
}

main().catch((err) => {
	console.error('crashed:', err);
	process.exit(1);
});

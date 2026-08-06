/*---------------------------------------------------------------------------------------------
 *  LIVE test: prove table compaction fires end-to-end through the proxy on a realistic
 *  `sf data query` record array, and that the model still answers correctly from the compacted
 *  table. Needs an OpenRouter key (env OPENROUTER_API_KEY or .env.local). No key ⇒ skip, exit 0.
 *
 *    node test/live-table-compaction.test.js
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
	const envFile = path.join(__dirname, '..', '.env.local');
	if (fs.existsSync(envFile)) {
		for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
			const m = /^\s*OPENROUTER_API_KEY\s*=\s*(.+?)\s*$/.exec(line);
			if (m) {
				return m[1].replace(/^["']|["']$/g, '').trim();
			}
		}
	}
	return '';
}

/** A realistic `sf data query --json` result: 60 Account records with the usual attributes. */
function buildSfQueryMessages() {
	const records = Array.from({ length: 60 }, (_, i) => ({
		attributes: { type: 'Account', url: `/services/data/v59.0/sobjects/Account/001${i}` },
		Id: `001${String(i).padStart(15, '0')}`,
		Name: `Account ${i}`,
		Industry: i % 3 === 0 ? 'Finance' : 'Technology',
		AnnualRevenue: 1000000 + i * 25000,
		Rating: i % 2 ? 'Hot' : 'Warm',
	}));
	// The find-the-answer probe targets a specific record so we can verify the value survived.
	const target = records[42];
	const toolMsg =
		'Result of `sf data query -q "SELECT Id,Name,Industry,AnnualRevenue,Rating FROM Account" --json`:\n' +
		JSON.stringify({ status: 0, result: { totalSize: 60, done: true, records } });
	return {
		messages: [
			{ role: 'system', content: 'You are a Salesforce data assistant. Answer with just the value asked for.' },
			{ role: 'user', content: toolMsg },
			{ role: 'assistant', content: 'I have the 60 Account records.' },
			{ role: 'user', content: `What is the AnnualRevenue of "${target.Name}"? Answer with the number only.` },
		],
		expected: String(target.AnnualRevenue),
		targetName: target.Name,
	};
}

async function main() {
	const apiKey = loadApiKey();
	if (!apiKey) {
		console.log('No OPENROUTER_API_KEY — skipping live table-compaction test.');
		process.exit(0);
	}
	const model = process.env.OPENROUTER_MODEL || 'google/gemma-4-26b-a4b-it:free';
	const { messages, expected, targetName } = buildSfQueryMessages();

	// Preview: confirm table compaction fires on this payload (same code path the proxy runs).
	const { stats } = compressor.compressRequest({ messages }, {});
	const pct = (stats.compressionRatio * 100).toFixed(1);
	console.log(`--- compression preview ---`);
	console.log(`  ${stats.tokensBefore} -> ${stats.tokensAfter} tok (${pct}%)  transforms: ${stats.transformsApplied.join(', ') || '(none)'}`);
	let failures = 0;
	if (!stats.transformsApplied.some((t) => t.startsWith('table:'))) {
		failures++;
		console.error('  FAIL  table compaction did NOT fire on the SF query payload');
	} else {
		console.log('  PASS  table compaction fired (table:N present)');
	}

	// Live: route through the proxy to OpenRouter and confirm the model answers from the table.
	process.env.OPENROUTER_API_KEY = apiKey;
	const { server, port } = await start({ host: '127.0.0.1', port: 0, upstream: 'https://openrouter.ai/api/v1' });
	console.log(`\n--- routing through proxy (:${port}) to ${model} ---`);
	try {
		const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'x-siid-source': 'live-table-test' },
			body: JSON.stringify({ model, messages, max_tokens: 40 }),
		});
		const text = await res.text();
		if (!res.ok) {
			failures++;
			console.error(`  FAIL  OpenRouter HTTP ${res.status}: ${text.slice(0, 300)}`);
		} else {
			const body = JSON.parse(text);
			const answer = String(body.choices?.[0]?.message?.content ?? '').trim();
			console.log(`  model answer: ${answer.slice(0, 120)}`);
			if (answer.replace(/[,$\s]/g, '').includes(expected)) {
				console.log(`  PASS  model read the correct value (${expected}) for ${targetName} from the COMPACTED table`);
			} else {
				failures++;
				console.error(`  FAIL  expected ${expected} for ${targetName}; model said "${answer}"`);
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
	console.log('LIVE table-compaction test passed.');
	process.exit(0);
}

main().catch((err) => {
	console.error('crashed:', err);
	process.exit(1);
});

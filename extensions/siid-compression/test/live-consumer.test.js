/*---------------------------------------------------------------------------------------------
 *  LIVE test consumer — exercises the whole pipe against REAL OpenRouter.
 *
 *  This is the "test consumer" for the extension: it plays the role siid-forge / SIID-Code will
 *  play in production — it points an OpenAI-style client's base URL at OUR proxy and sends a
 *  realistic, deliberately-bloated SIID payload through it. It then reports the token savings the
 *  compressor achieved and confirms OpenRouter returned a valid completion.
 *
 *  NEEDS AN OPENROUTER API KEY. Provide it any of these ways (first found wins):
 *    1. env:            OPENROUTER_API_KEY=sk-or-... node test/live-consumer.test.js
 *    2. .env.local:     put  OPENROUTER_API_KEY=sk-or-...  in extensions/siid-compression/.env.local
 *                       (that file is gitignored — safe to drop a key in).
 *
 *  Optional:
 *    OPENROUTER_MODEL   model id to use (default: openai/gpt-4o-mini — cheap).
 *
 *  Without a key it prints how to add one and exits 0 (so CI / build-and-test never fails on it).
 *--------------------------------------------------------------------------------------------*/
'use strict';
const fs = require('fs');
const path = require('path');
const { start } = require(path.join(__dirname, '..', 'out', 'proxy', 'server.js'));
const compressor = require(path.join(__dirname, '..', 'out', 'proxy', 'compressor.js'));

/** Load OPENROUTER_API_KEY from env or a gitignored .env.local next to the extension. */
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

/** A realistic, bloated SIID conversation: a file dumped 3x + an oversized log + trailing chat. */
function buildBloatedPayload() {
	const apexClass = [
		'public with sharing class AccountService {',
		'    @AuraEnabled(cacheable=true)',
		'    public static List<Account> getTopAccounts(Integer howMany) {',
		'        return [SELECT Id, Name, Industry, AnnualRevenue, Tier__c',
		'                FROM Account WHERE AnnualRevenue != null',
		'                ORDER BY AnnualRevenue DESC LIMIT :howMany];',
		'    }',
		'}',
	].join('\n');
	// Pad it so it clears the compressor size floors and shows meaningful savings.
	const bigFile = (apexClass + '\n\n// ---- padding ----\n' + '// filler line to simulate a large file\n'.repeat(200));
	const bigLog = ('2026-07-27T12:00:00Z DEBUG deploy step ok\n'.repeat(400));

	return [
		{ role: 'system', content: 'You are a Salesforce coding assistant. Answer concisely.' },
		{ role: 'user', content: 'Here is AccountService.cls:\n' + bigFile },
		{ role: 'assistant', content: 'Got it — I have read AccountService.cls.' },
		{ role: 'user', content: 'Here is the SAME file again for reference:\n' + bigFile }, // exact dupe -> dedupe
		{ role: 'user', content: 'And here is the deploy log:\n' + bigLog }, // oversized -> truncate
		{ role: 'user', content: 'In one sentence: what does getTopAccounts return, and what is its LIMIT bound by?' },
	];
}

async function main() {
	const apiKey = loadApiKey();
	if (!apiKey) {
		console.log('No OPENROUTER_API_KEY found — skipping the LIVE test.');
		console.log('To run it, either:');
		console.log('  set OPENROUTER_API_KEY=sk-or-...   (env), or');
		console.log(`  create ${path.join('extensions', 'siid-compression', '.env.local')} with:`);
		console.log('      OPENROUTER_API_KEY=sk-or-...');
		process.exit(0);
	}

	// Default to a free instruction model (verified working via OpenRouter's free tier).
	// Override with OPENROUTER_MODEL. Note: free models are rate-limited (HTTP 429) and some
	// are reasoning-only models that return empty `content` under a low max_tokens.
	const model = process.env.OPENROUTER_MODEL || 'google/gemma-4-26b-a4b-it:free';
	const messages = buildBloatedPayload();

	// Preview the savings the compressor WILL apply (same code path the proxy runs).
	const { stats } = compressor.compressRequest({ model, messages }, {});
	const pct = (stats.compressionRatio * 100).toFixed(1);
	console.log('--- compression preview (what the proxy will send) ---');
	console.log(`  tokens: ${stats.tokensBefore} -> ${stats.tokensAfter}  (saved ${stats.tokensSaved}, ${pct}%)`);
	console.log(`  transforms: ${stats.transformsApplied.join(', ') || '(none)'}`);

	// Start our proxy pointed at real OpenRouter, key injected the same way the extension does it.
	process.env.OPENROUTER_API_KEY = apiKey;
	const { server, port } = await start({ host: '127.0.0.1', port: 0, upstream: 'https://openrouter.ai/api/v1' });
	const baseUrl = `http://127.0.0.1:${port}/v1`;
	console.log(`\n--- routing a REAL request through the proxy (${baseUrl}) to model ${model} ---`);

	let failures = 0;
	try {
		const res = await fetch(`${baseUrl}/chat/completions`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'x-siid-source': 'live-consumer-test' },
			body: JSON.stringify({ model, messages, max_tokens: 120 }),
		});
		const text = await res.text();
		let body;
		try {
			body = JSON.parse(text);
		} catch {
			body = null;
		}

		if (!res.ok) {
			failures++;
			console.error(`  FAIL  OpenRouter returned HTTP ${res.status}: ${text.slice(0, 400)}`);
		} else if (!body || !body.choices || !body.choices[0]) {
			failures++;
			console.error(`  FAIL  no choices in response: ${text.slice(0, 400)}`);
		} else {
			const answer = body.choices[0].message && body.choices[0].message.content;
			console.log('  PASS  valid completion returned through the compressing proxy.');
			console.log(`  model answer: ${String(answer).replace(/\s+/g, ' ').trim().slice(0, 300)}`);
			if (body.usage) {
				console.log(`  OpenRouter usage: prompt=${body.usage.prompt_tokens} completion=${body.usage.completion_tokens} total=${body.usage.total_tokens}`);
			}
		}
	} catch (err) {
		failures++;
		console.error(`  FAIL  request through proxy threw: ${err.message}`);
	} finally {
		server.close();
	}

	console.log('');
	if (failures > 0) {
		console.error(`${failures} live check(s) failed.`);
		process.exit(1);
	}
	console.log('LIVE consumer test passed.');
	process.exit(0);
}

main().catch((err) => {
	console.error('crashed:', err);
	process.exit(1);
});

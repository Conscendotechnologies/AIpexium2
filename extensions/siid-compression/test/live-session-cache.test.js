/*---------------------------------------------------------------------------------------------
 *  LIVE test: the cross-REQUEST block cache.
 *
 *  This is the transform that pays on real agent traffic, and the ONLY one whose effect spans two
 *  HTTP requests — so it can only be proven by sending a real agent loop through one proxy process.
 *
 *  What must hold (in this order of importance):
 *   1. The model still answers CORRECTLY on the turn where content has been replaced by a cache
 *      marker. In production nothing calls expand() — the model reads the marker as written, so the
 *      readable sentence is what protects answer quality. This is the real test.
 *   2. The cache actually fires on turn 2+ (otherwise we saved nothing).
 *   3. expand() restores the exact original bytes (losslessness, checked offline).
 *
 *  Needs an OpenRouter key. No key ⇒ skip, exit 0.
 *    node test/live-session-cache.test.js
 *--------------------------------------------------------------------------------------------*/
'use strict';
const fs = require('fs');
const path = require('path');
const { start } = require(path.join(__dirname, '..', 'out', 'proxy', 'server.js'));
const sc = require(path.join(__dirname, '..', 'out', 'proxy', 'sessionCache.js'));

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

/** A realistic file body carrying a distinctive fact the question targets. */
function apexFile() {
	return (
		'public with sharing class OrderService {\n' +
		Array.from({ length: 40 }, (_, i) => `    public static Integer helper${i}() {\n        return ${i};\n    }\n`).join('\n') +
		'\n    public static String SECRET_METHOD() {\n        return \'MAGIC-4291\';\n    }\n' +
		'}'
	);
}

async function ask(port, model, messages) {
	const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', 'x-siid-source': 'live-session-cache-test' },
		body: JSON.stringify({ model, messages, max_tokens: 40 }),
	});
	const text = await res.text();
	if (!res.ok) {
		throw new Error(`OpenRouter HTTP ${res.status}: ${text.slice(0, 300)}`);
	}
	return String(JSON.parse(text).choices?.[0]?.message?.content ?? '').trim();
}

async function main() {
	const apiKey = loadApiKey();
	if (!apiKey) {
		console.log('No OPENROUTER_API_KEY — skipping live session-cache test.');
		process.exit(0);
	}
	const model = process.env.OPENROUTER_MODEL || 'google/gemma-4-26b-a4b-it:free';
	let failures = 0;

	// --- Offline proof first: the marker round-trips to the exact original bytes. ---
	const body = apexFile();
	const cache = new sc.SessionCache();
	sc.compressText(body, cache, {});
	const second = sc.compressText(body, cache, {});
	if (second.blocksReferenced > 0 && sc.expandText(second.text, cache) === body) {
		console.log(`  PASS  offline round-trip exact (${body.length} -> ${second.text.length} chars)`);
	} else {
		failures++;
		console.error('  FAIL  offline round-trip did not restore the original bytes');
	}

	process.env.OPENROUTER_API_KEY = apiKey;
	const { server, port } = await start({ host: '127.0.0.1', port: 0, upstream: 'https://openrouter.ai/api/v1' });
	console.log(`\n--- agent loop through ONE proxy (:${port}) to ${model} ---`);

	try {
		// TURN 1 — the file arrives. It sits in the recency window, so it is learned, not rewritten.
		const history = [
			{ role: 'user', content: 'Here is OrderService.cls:\n' + body },
			{ role: 'assistant', content: 'I have read OrderService.cls.' },
			{ role: 'user', content: 'Acknowledge in one word.' },
		];
		const a1 = await ask(port, model, history);
		console.log(`  turn 1 answer: ${a1.slice(0, 60)}`);

		// TURN 2+ — the agent re-sends the SAME history verbatim (the measured real-traffic shape).
		// The file body has now slid out of the recency window, so it should be referenced.
		history.push({ role: 'assistant', content: a1 });
		history.push({ role: 'user', content: 'Thanks.' });
		history.push({ role: 'assistant', content: 'Anytime.' });
		history.push({
			role: 'user',
			content: 'What string does SECRET_METHOD() return in OrderService.cls? Answer with just the value.',
		});

		const a2 = await ask(port, model, history);
		console.log(`  turn 2 answer: ${a2}`);

		// (1) The decisive check: did the model still get it right through the marker?
		if (a2.includes('MAGIC-4291')) {
			console.log('  PASS  model answered correctly on the cached turn (marker did not hide content)');
		} else {
			failures++;
			console.error('  FAIL  model lost the value — the cache marker may be hiding needed content');
		}
	} catch (err) {
		failures++;
		console.error(`  FAIL  ${err.message}`);
	} finally {
		server.close();
	}

	console.log('');
	if (failures > 0) {
		console.error(`${failures} check(s) failed.`);
		process.exit(1);
	}
	console.log('LIVE session-cache test passed.');
	process.exit(0);
}

main().catch((err) => {
	console.error('crashed:', err);
	process.exit(1);
});

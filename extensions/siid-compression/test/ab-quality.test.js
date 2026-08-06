/*---------------------------------------------------------------------------------------------
 *  A/B QUALITY TEST — does compression change what the model answers?
 *
 *  Everything else in this suite proves compression is byte-lossless or that a single answer
 *  survived. Neither settles the real question: across several realistic multi-turn tasks, does the
 *  model answer WORSE when its context has been compressed?
 *
 *  Method: run the SAME conversation twice through the SAME model — once with every transform ON,
 *  once with compression fully OFF (passthrough) — and grade both against facts checked out of the
 *  real source files. Same prompts, same order, same model; the only variable is compression.
 *
 *  Structure mirrors real agent traffic (the shape measured in traffic.jsonl): file bodies are read
 *  once, then the whole history is re-sent verbatim on every subsequent turn. That is what makes the
 *  cross-request cache fire from turn ~3 onward.
 *
 *  Grading is deliberately mechanical — substring/regex checks against ground truth, no LLM judge —
 *  so a run is reproducible and a regression is unambiguous. Each check is also marked as either a
 *  RECALL check (did the model still see the content?) or a HALLUCINATION check (did it invent
 *  something that does not exist?). Compression damage shows up as recall loss; a model that starts
 *  inventing API surface is the more dangerous failure.
 *
 *  Needs an OpenRouter key. No key => skip, exit 0.
 *    node test/ab-quality.test.js
 *    node test/ab-quality.test.js --runs 3        (median over N runs per side)
 *    node test/ab-quality.test.js --model openai/gpt-5.4-mini
 *--------------------------------------------------------------------------------------------*/
'use strict';
const fs = require('fs');
const path = require('path');
const { start } = require(path.join(__dirname, '..', 'out', 'proxy', 'server.js'));

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

function arg(name, fallback) {
	const i = process.argv.indexOf(name);
	return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/* ------------------------------------------------------------------------------------------- *
 *  Corpus. Real project files if present, otherwise generated stand-ins of similar size/shape so
 *  the test still runs anywhere. Ground-truth facts are derived FROM the text we actually send, so
 *  grading can never drift from the corpus.
 * ------------------------------------------------------------------------------------------- */

const REAL_CLASSES = 'C:/Users/Aman/Downloads/testV3/force-app/main/default/classes';

function loadCorpus() {
	const want = ['AccountService.cls', 'Hello.cls', 'HTMLBuilder.cls'];
	const files = {};
	let usingReal = true;
	for (const name of want) {
		const p = path.join(REAL_CLASSES, name);
		if (fs.existsSync(p)) {
			files[name] = fs.readFileSync(p, 'utf8');
		} else {
			usingReal = false;
		}
	}
	if (usingReal && Object.keys(files).length === want.length) {
		return { files, usingReal };
	}
	// Fallback corpus — same shape (a service with distinctive method names, a tiny util, a big
	// builder), so the test is meaningful without the testV3 project on disk.
	return {
		usingReal: false,
		files: {
			'AccountService.cls':
				'public with sharing class AccountService {\n' +
				'    public static Map<Integer, Account> queryAccounts(Map<Integer, AccountInput> inputs) {\n' +
				'        return new Map<Integer, Account>([SELECT Id, Name FROM Account]);\n    }\n' +
				'    public static Map<Integer, Account> upsertAccounts(Map<Integer, AccountInput> inputs) { return null; }\n' +
				'    public static Map<Integer, Account> createAccounts(Map<Integer, AccountInput> inputs) { return null; }\n' +
				'    public static Map<Integer, Contact> createContacts(Map<Integer, AccountInput> inputs) { return null; }\n' +
				'}\n',
			'Hello.cls':
				'public with sharing class Hello {\n' +
				'    public static void sayHello() { System.debug(\'hello\'); }\n' +
				'    public static String greetUser(String strUserName) { return \'Hello, \' + strUserName; }\n}\n',
			'HTMLBuilder.cls':
				'public class HTMLBuilder {\n' +
				Array.from({ length: 120 }, (_, i) => `    public HTMLBuilder filler${i}(String v) { this.buf += v; return this; }`).join('\n') +
				'\n    public HTMLBuilder addImageFromStaticResource(String resourceName, String width) {\n' +
				'        List<StaticResource> resources = [SELECT Body, ContentType FROM StaticResource WHERE Name = :resourceName LIMIT 1];\n' +
				'        return this;\n    }\n}\n',
		},
	};
}

/**
 * Ground truth, derived from the corpus text itself so it cannot drift.
 * Each check: { id, kind, weight, test(answer) -> boolean }.
 *   kind 'recall'        — the fact IS in the context; failing means content was lost.
 *   kind 'hallucination' — the claim is NOT true of the context; passing means it stayed grounded.
 */
function buildChecks(files) {
	const account = files['AccountService.cls'];
	const hello = files['Hello.cls'];
	const html = files['HTMLBuilder.cls'];

	const has = (re) => (ans) => re.test(ans);
	const lacks = (re) => (ans) => !re.test(ans);

	const checks = [];

	// --- Recall: method names that genuinely exist. ---
	for (const m of ['queryAccounts', 'upsertAccounts', 'createAccounts', 'createContacts']) {
		if (account.includes(m)) {
			checks.push({ id: `recall:${m}`, kind: 'recall', weight: 1, test: has(new RegExp(m)) });
		}
	}
	if (hello.includes('greetUser')) {
		checks.push({ id: 'recall:greetUser', kind: 'recall', weight: 1, test: has(/greetUser/) });
	}
	if (hello.includes('sayHello')) {
		checks.push({ id: 'recall:sayHello', kind: 'recall', weight: 1, test: has(/sayHello/) });
	}
	if (html.includes('addImageFromStaticResource')) {
		checks.push({
			id: 'recall:addImageFromStaticResource',
			kind: 'recall',
			weight: 1,
			test: has(/addImageFromStaticResource/),
		});
	}
	if (/FROM\s+StaticResource/i.test(html)) {
		checks.push({ id: 'recall:StaticResource-query', kind: 'recall', weight: 2, test: has(/StaticResource/i) });
	}
	if (/FROM\s+Account/i.test(account)) {
		checks.push({ id: 'recall:Account-query', kind: 'recall', weight: 2, test: has(/\bAccount\b/) });
	}

	// --- Hallucination traps: methods that do NOT exist in the corpus. ---
	// These were the exact fabrications seen in a real session, so they are worth pinning.
	for (const ghost of ['countAccounts', 'getAccountCount']) {
		if (!account.includes(ghost)) {
			checks.push({
				id: `nohallu:${ghost}`,
				kind: 'hallucination',
				weight: 3,
				test: lacks(new RegExp(ghost)),
			});
		}
	}
	// `AccountService.greet(` specifically — Hello.greetUser is real, AccountService.greet is not.
	if (!/\bgreet\s*\(/.test(account)) {
		checks.push({
			id: 'nohallu:AccountService.greet',
			kind: 'hallucination',
			weight: 3,
			test: lacks(/AccountService\s*\.\s*greet\s*\(/),
		});
	}
	// Correctly reporting that no count method exists.
	checks.push({
		id: 'grounded:admits-no-count-method',
		kind: 'hallucination',
		weight: 3,
		test: (ans) => /\bno\b[^.]{0,60}(existing|count|method)|does not (exist|have)|there is (no|not)/i.test(ans),
	});

	return checks;
}

/** The conversation. Turn 1 loads the files; later turns re-send history verbatim (agent-loop shape). */
function buildTurns(files) {
	const dump = Object.entries(files)
		.map(([name, body]) => `[read_file Result] force-app/main/default/classes/${name}\n\n${body}`)
		.join('\n\n');
	return [
		{
			id: 'T1-load',
			user: `Here are three Apex classes from the project:\n\n${dump}\n\nReply with just "loaded".`,
			grade: false,
		},
		{
			id: 'T2-methods',
			user: 'List every public method in each of the three classes, exactly as named in the files. Do not invent any.',
			grade: true,
		},
		{
			id: 'T3-queries',
			user: 'Which of the three classes query the database, and which sObjects do they query?',
			grade: true,
		},
		{
			id: 'T4-count',
			user:
				'I want to count Accounts from a new LWC. Is there an existing method in these classes I should reuse? ' +
				'If there is not, say so plainly — do not invent one.',
			grade: true,
		},
		{
			id: 'T5-summary',
			user: 'Summarize what each class does and name the specific method that performs the StaticResource query.',
			grade: true,
		},
	];
}

async function chat(port, model, messages) {
	const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', 'x-siid-source': 'ab-quality-test' },
		body: JSON.stringify({ model, messages, max_tokens: 900, temperature: 0 }),
	});
	const text = await res.text();
	if (!res.ok) {
		throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
	}
	const json = JSON.parse(text);
	return {
		answer: String(json.choices?.[0]?.message?.content ?? '').trim(),
		completionTokens: json.usage?.completion_tokens ?? 0,
		promptTokens: json.usage?.prompt_tokens ?? 0,
	};
}

/**
 * Run the full conversation once. `compression` selects the proxy port (ON vs OFF instance).
 * Returns per-turn answers + the graded score.
 */
async function runConversation(port, model, turns, checks) {
	const messages = [{ role: 'system', content: 'You are a Salesforce engineering assistant. Answer precisely and only from the provided files.' }];
	const results = [];
	let promptTokensTotal = 0;
	let completionTokensTotal = 0;

	for (const turn of turns) {
		messages.push({ role: 'user', content: turn.user });
		const { answer, completionTokens, promptTokens } = await chat(port, model, messages);
		messages.push({ role: 'assistant', content: answer });
		promptTokensTotal += promptTokens;
		completionTokensTotal += completionTokens;
		results.push({ id: turn.id, grade: turn.grade, answer });
	}

	// Grade over the concatenation of the GRADED turns — a fact may surface in any of them.
	const graded = results.filter((r) => r.grade).map((r) => r.answer).join('\n\n');
	let earned = 0;
	let possible = 0;
	const failed = [];
	for (const c of checks) {
		possible += c.weight;
		if (c.test(graded)) {
			earned += c.weight;
		} else {
			failed.push(c.id);
		}
	}
	return { results, earned, possible, failed, promptTokensTotal, completionTokensTotal };
}

function median(nums) {
	const s = [...nums].sort((a, b) => a - b);
	const mid = Math.floor(s.length / 2);
	return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

async function main() {
	const apiKey = loadApiKey();
	if (!apiKey) {
		console.log('No OPENROUTER_API_KEY — skipping A/B quality test.');
		process.exit(0);
	}
	const model = arg('--model', process.env.OPENROUTER_MODEL || 'openai/gpt-5.4-mini');
	const runs = parseInt(arg('--runs', '1'), 10) || 1;

	const { files, usingReal } = loadCorpus();
	const checks = buildChecks(files);
	const turns = buildTurns(files);
	const corpusChars = Object.values(files).reduce((n, s) => n + s.length, 0);

	console.log('='.repeat(78));
	console.log('A/B QUALITY TEST — compression ON vs OFF, same model, same prompts');
	console.log('='.repeat(78));
	console.log(`model:   ${model}`);
	console.log(`corpus:  ${Object.keys(files).length} files, ${corpusChars} chars ${usingReal ? '(REAL testV3 files)' : '(generated stand-ins)'}`);
	console.log(`checks:  ${checks.length} (${checks.filter((c) => c.kind === 'recall').length} recall, ${checks.filter((c) => c.kind === 'hallucination').length} hallucination)`);
	console.log(`runs:    ${runs} per side\n`);

	process.env.OPENROUTER_API_KEY = apiKey;

	// ONE proxy, toggled between runs via SIID_COMPRESSION_OFF. Using a single server keeps every
	// other variable identical (same process, same upstream, same code path) so the only difference
	// between the two sides is whether the transforms execute.
	const proxy = await start({ host: '127.0.0.1', port: 0, upstream: 'https://openrouter.ai/api/v1' });

	const sides = [
		{ label: 'ON  (compressed)', port: proxy.port, off: false },
		{ label: 'OFF (passthrough)', port: proxy.port, off: true },
	];

	const summary = {};
	try {
		for (const side of sides) {
			const scores = [];
			const prompts = [];
			const completions = [];
			let lastFailed = [];
			let lastResults = [];

			for (let r = 0; r < runs; r++) {
				// The OFF side disables transforms process-wide for the duration of its requests.
				if (side.off) {
					process.env.SIID_COMPRESSION_OFF = '1';
				} else {
					delete process.env.SIID_COMPRESSION_OFF;
				}
				const res = await runConversation(side.port, model, turns, checks);
				scores.push(res.possible ? res.earned / res.possible : 0);
				prompts.push(res.promptTokensTotal);
				completions.push(res.completionTokensTotal);
				lastFailed = res.failed;
				lastResults = res.results;
			}
			delete process.env.SIID_COMPRESSION_OFF;

			summary[side.label] = {
				score: median(scores),
				promptTokens: median(prompts),
				completionTokens: median(completions),
				failed: lastFailed,
				results: lastResults,
			};
			console.log(
				`${side.label}  score ${(median(scores) * 100).toFixed(1)}%  prompt ${median(prompts)} tok  completion ${median(completions)} tok` +
					(lastFailed.length ? `  MISSED: ${lastFailed.join(', ')}` : '  (all checks passed)'),
			);
		}
	} finally {
		proxy.server.close();
	}

	const a = summary['ON  (compressed)'];
	const b = summary['OFF (passthrough)'];

	console.log('\n' + '-'.repeat(78));
	console.log('RESULT');
	console.log('-'.repeat(78));
	const delta = (a.score - b.score) * 100;
	const saved = b.promptTokens - a.promptTokens;
	const savedPct = b.promptTokens ? (saved / b.promptTokens) * 100 : 0;
	console.log(`quality:  ON ${(a.score * 100).toFixed(1)}%  vs  OFF ${(b.score * 100).toFixed(1)}%   (delta ${delta >= 0 ? '+' : ''}${delta.toFixed(1)} pts)`);
	console.log(`prompt:   ON ${a.promptTokens} tok  vs  OFF ${b.promptTokens} tok   (saved ${saved}, ${savedPct.toFixed(1)}%)`);

	// Compression is only acceptable if it does not cost accuracy. A small negative delta on a
	// single run is noise, so the gate is: no check that OFF passes may fail under ON.
	const regressions = a.failed.filter((id) => !b.failed.includes(id));
	if (regressions.length) {
		console.error(`\nFAIL  compression broke checks that pass without it: ${regressions.join(', ')}`);
		console.error('      (rerun with --runs 3 to rule out model non-determinism)');
		process.exit(1);
	}
	console.log('\nPASS  compression cost no checks that pass without it.');
	process.exit(0);
}

main().catch((err) => {
	console.error('crashed:', err);
	process.exit(1);
});

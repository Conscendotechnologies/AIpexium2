/*---------------------------------------------------------------------------------------------
 *  Grade a REAL SIID task run for effectiveness — did the agent actually do the job?
 *
 *  This is not a losslessness test. Compression can be perfectly reversible and still make the
 *  agent worse: wrong tool calls, invented file paths, giving up early, looping, or answering
 *  something other than what was asked. Byte-level tests cannot see any of that, and neither can a
 *  fact-recall test. What matters is whether the TASK COMPLETED.
 *
 *  Usage — run the same task in SIID twice (compression ON, then OFF), then:
 *    node test/grade-task-run.js --label "ON"  --since "2026-08-06T06:00:00Z"
 *    node test/grade-task-run.js --label "OFF" --since "2026-08-06T06:30:00Z"
 *    node test/grade-task-run.js --compare            (diffs the two saved reports)
 *
 *  It reads traffic.jsonl (the proxy's own record of every request/response) and scores signals
 *  that indicate the agent struggling. These are counted from the model's ACTUAL responses, so the
 *  grade does not depend on anyone's reading of a transcript.
 *
 *  Signals counted (all are failure/friction indicators — LOWER IS BETTER, except completion):
 *    toolErrors      tool results carrying an error/not-found/ENOENT
 *    retries         the same tool invoked with the same args twice in a row
 *    apologies       "sorry / my mistake / let me try again" — the model recovering from itself
 *    refusals        "I can only help with / I cannot" — scope or capability bail-outs
 *    emptyTurns      assistant turns with no text and no tool call
 *    completion      did the run reach attempt_completion (the agent declaring the task done)
 *
 *  Report is written to test/.task-grades/<label>.json so ON and OFF runs can be compared later.
 *--------------------------------------------------------------------------------------------*/
'use strict';
const fs = require('fs');
const path = require('path');

const DEFAULT_LOG =
	process.env.SIID_TRAFFIC_LOG ||
	'C:/Users/Aman/AppData/Local/Programs/Siid/resources/app/extensions/siid-compression/logs/traffic.jsonl';
const OUT_DIR = path.join(__dirname, '.task-grades');

function arg(name, fallback) {
	const i = process.argv.indexOf(name);
	return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const has = (name) => process.argv.includes(name);

/**
 * Pull the assistant response text out of a logged record.
 *
 * IMPORTANT: SIID streams, and the proxy logs a streamed response as `{streamed:true}` only — the
 * completion text is piped to the client without being buffered, so it is NOT in the log. Returns
 * null (not '') for such records so the caller can distinguish "no text produced" from "text not
 * recorded" and avoid scoring signals it cannot actually see.
 */
function responseText(rec) {
	const r = rec.response;
	if (!r) {
		return null;
	}
	if (r.body && r.body.choices) {
		return r.body.choices.map((c) => String((c.message && c.message.content) || '')).join('\n');
	}
	if (typeof r.body === 'string') {
		return r.body;
	}
	return null; // streamed: text was never recorded
}

/**
 * The assistant's PREVIOUS turn is replayed verbatim in the NEXT request's message array. So even
 * when a streamed response body is not logged, we can recover what the model said by reading the
 * last assistant message of the following request. This is what makes response-side grading work
 * against streamed traffic.
 */
function assistantTurnsFromRequests(records) {
	const turns = [];
	for (const rec of records) {
		const msgs = (rec.request && rec.request.original && rec.request.original.messages) || [];
		for (let i = msgs.length - 1; i >= 0; i--) {
			if (msgs[i].role !== 'assistant') {
				continue;
			}
			const c = msgs[i].content;
			const text = typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => (b && b.text) || '').join('\n') : '';
			if (text.trim()) {
				turns.push(text);
			}
			break;
		}
	}
	return turns;
}

/** The user-side content of the LAST message — where tool results arrive. */
function lastUserText(rec) {
	const msgs = (rec.request && rec.request.original && rec.request.original.messages) || [];
	for (let i = msgs.length - 1; i >= 0; i--) {
		const m = msgs[i];
		if (m.role !== 'user') {
			continue;
		}
		const c = m.content;
		return typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => (b && b.text) || '').join('\n') : '';
	}
	return '';
}

/** Extract <tool_name>...</tool_name> invocations from an assistant response. */
function toolCalls(text) {
	const calls = [];
	const re = /<([a-z_]+)>([\s\S]*?)<\/\1>/g;
	let m;
	while ((m = re.exec(text))) {
		// Skip the inner param tags; only count known top-level tool shapes.
		if (/^(path|content|task_type|todos|result|command|question|args|line_count|mode|message)$/.test(m[1])) {
			continue;
		}
		calls.push({ tool: m[1], body: m[2].trim() });
	}
	return calls;
}

function grade(records) {
	const signals = {
		requests: records.length,
		toolErrors: 0,
		retries: 0,
		apologies: 0,
		refusals: 0,
		emptyTurns: 0,
		completed: false,
		compressionRatios: [],
		transformsSeen: new Set(),
		promptTokens: 0,
		completionTokens: 0,
		errorSamples: [],
		streamedResponses: 0,
	};

	for (const rec of records) {
		const s = rec.stats || {};
		if (typeof s.compressionRatio === 'number') {
			signals.compressionRatios.push(s.compressionRatio);
		}
		for (const t of s.transformsApplied || []) {
			signals.transformsSeen.add(String(t).split(':')[0]);
		}
		const usage = (rec.response && rec.response.usage) || {};
		signals.promptTokens += usage.prompt_tokens || 0;
		signals.completionTokens += usage.completion_tokens || 0;
		if (responseText(rec) === null) {
			signals.streamedResponses++;
		}

		// Tool results arrive as the newest user message on the FOLLOWING request.
		const incoming = lastUserText(rec);
		if (/\[ERROR\]|Error reading file|File not found|ENOENT|no such file|did not use a tool/i.test(incoming)) {
			signals.toolErrors++;
			if (signals.errorSamples.length < 6) {
				const line = (incoming.match(/.*(Error reading file|File not found|ENOENT|\[ERROR\]).*/i) || [''])[0];
				signals.errorSamples.push(line.trim().slice(0, 160));
			}
		}
	}

	// Response-side signals: read the assistant turns replayed inside later requests, since streamed
	// completion bodies are never written to the log.
	const turns = assistantTurnsFromRequests(records);
	signals.assistantTurnsSeen = turns.length;
	let prevCallSig = null;
	for (const out of turns) {
		if (!out.trim()) {
			signals.emptyTurns++;
		}
		if (/\b(sorry|my mistake|apolog|let me try again|i made an error)\b/i.test(out)) {
			signals.apologies++;
		}
		if (/I can only help with|I cannot help|I'm unable to|outside (my|the) scope/i.test(out)) {
			signals.refusals++;
		}
		if (/<attempt_completion>/.test(out)) {
			signals.completed = true;
		}
		const calls = toolCalls(out);
		const sig = calls.length ? calls.map((c) => c.tool + '|' + c.body.slice(0, 120)).join(';') : null;
		if (sig && sig === prevCallSig) {
			signals.retries++;
		}
		if (sig) {
			prevCallSig = sig;
		}
	}

	const ratios = signals.compressionRatios;
	signals.medianCompression = ratios.length
		? [...ratios].sort((a, b) => a - b)[Math.floor(ratios.length / 2)]
		: 0;
	signals.transformsSeen = [...signals.transformsSeen];
	// Friction score: every failure signal counts against the run. Lower is better.
	signals.frictionScore =
		signals.toolErrors * 2 + signals.retries * 2 + signals.apologies + signals.refusals * 3 + signals.emptyTurns;
	return signals;
}

function loadRecords(logFile, since, until) {
	if (!fs.existsSync(logFile)) {
		console.error(`traffic log not found: ${logFile}`);
		console.error('Enable it: settings -> siidCompression.logging.enabled = true, then restart SIID.');
		process.exit(1);
	}
	const out = [];
	for (const line of fs.readFileSync(logFile, 'utf8').split('\n')) {
		if (!line.trim()) {
			continue;
		}
		let rec;
		try {
			rec = JSON.parse(line);
		} catch {
			continue;
		}
		const ts = rec.ts || '';
		if (since && ts < since) {
			continue;
		}
		if (until && ts > until) {
			continue;
		}
		out.push(rec);
	}
	return out;
}

function printReport(label, g) {
	const pct = (n) => (n * 100).toFixed(1) + '%';
	console.log('='.repeat(70));
	console.log(`TASK RUN: ${label}`);
	console.log('='.repeat(70));
	console.log(`requests            ${g.requests}`);
	console.log(`compression median  ${pct(g.medianCompression)}   transforms: ${g.transformsSeen.join(', ') || 'none'}`);
	console.log(`tokens              prompt ${g.promptTokens}  completion ${g.completionTokens}`);
	console.log(`assistant turns     ${g.assistantTurnsSeen} graded${g.streamedResponses ? `  (${g.streamedResponses} streamed responses not logged; recovered from replayed history)` : ''}`);
	console.log('');
	console.log('--- friction signals (lower is better) ---');
	console.log(`tool errors         ${g.toolErrors}`);
	console.log(`repeated calls      ${g.retries}`);
	console.log(`apologies           ${g.apologies}`);
	console.log(`refusals            ${g.refusals}`);
	console.log(`empty turns         ${g.emptyTurns}`);
	console.log(`FRICTION SCORE      ${g.frictionScore}`);
	console.log('');
	console.log(`task completed      ${g.completed ? 'YES (attempt_completion reached)' : 'NO'}`);
	if (g.errorSamples.length) {
		console.log('\n--- error samples ---');
		g.errorSamples.forEach((e) => console.log('  ' + e));
	}
}

function main() {
	fs.mkdirSync(OUT_DIR, { recursive: true });

	if (has('--compare')) {
		const files = fs.readdirSync(OUT_DIR).filter((f) => f.endsWith('.json'));
		const reports = {};
		for (const f of files) {
			reports[path.basename(f, '.json')] = JSON.parse(fs.readFileSync(path.join(OUT_DIR, f), 'utf8'));
		}
		const on = reports['ON'];
		const off = reports['OFF'];
		if (!on || !off) {
			console.error(`need both ON.json and OFF.json in ${OUT_DIR} (have: ${Object.keys(reports).join(', ') || 'none'})`);
			process.exit(1);
		}
		console.log('='.repeat(70));
		console.log('COMPRESSION ON vs OFF — task effectiveness');
		console.log('='.repeat(70));
		const row = (name, a, b, lowerBetter = true) => {
			const delta = a - b;
			const verdict = delta === 0 ? 'same' : (lowerBetter ? delta < 0 : delta > 0) ? 'ON better' : 'ON WORSE';
			console.log(`${name.padEnd(20)} ON ${String(a).padStart(6)}   OFF ${String(b).padStart(6)}   ${verdict}`);
		};
		row('tool errors', on.toolErrors, off.toolErrors);
		row('repeated calls', on.retries, off.retries);
		row('apologies', on.apologies, off.apologies);
		row('refusals', on.refusals, off.refusals);
		row('empty turns', on.emptyTurns, off.emptyTurns);
		row('FRICTION SCORE', on.frictionScore, off.frictionScore);
		console.log(
			`${'completed'.padEnd(20)} ON ${String(on.completed).padStart(6)}   OFF ${String(off.completed).padStart(6)}   ${
				on.completed === off.completed ? 'same' : on.completed ? 'ON better' : 'ON WORSE'
			}`,
		);
		console.log(
			`${'prompt tokens'.padEnd(20)} ON ${String(on.promptTokens).padStart(6)}   OFF ${String(off.promptTokens).padStart(6)}   saved ${
				off.promptTokens - on.promptTokens
			}`,
		);
		console.log('');
		const worse = on.frictionScore > off.frictionScore || (off.completed && !on.completed);
		console.log(
			worse
				? 'VERDICT: compression made the run WORSE. Do not ship this config.'
				: 'VERDICT: no effectiveness regression detected in this pair.',
		);
		console.log('(one pair is weak evidence — run 3 pairs before trusting it)');
		process.exit(worse ? 1 : 0);
	}

	const label = arg('--label', 'ON');
	const logFile = arg('--log', DEFAULT_LOG);
	const since = arg('--since', '');
	const until = arg('--until', '');

	const records = loadRecords(logFile, since, until);
	if (!records.length) {
		console.error('no records matched. Check --since/--until (ISO UTC, e.g. 2026-08-06T06:00:00Z).');
		process.exit(1);
	}
	const g = grade(records);
	printReport(label, g);
	const outFile = path.join(OUT_DIR, `${label}.json`);
	fs.writeFileSync(outFile, JSON.stringify(g, null, 2));
	console.log(`\nsaved -> ${outFile}`);
}

main();

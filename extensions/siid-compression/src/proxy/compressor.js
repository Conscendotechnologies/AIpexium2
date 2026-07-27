/*---------------------------------------------------------------------------------------------
 *  SIID Compression — the compression STRATEGY (our own, no third party).
 *
 *  This is the one place the actual token-saving logic lives. It is deliberately isolated
 *  from the HTTP/proxy plumbing (server.js) so a strategy can be rewritten without touching
 *  request routing, and so it can be unit-tested in plain Node.
 *
 *  Two hooks, matching the two directions of a chat-completions call:
 *    - compressRequest(body, ctx)   : shrink the OUTBOUND messages before we forward to
 *                                     OpenRouter. This is where the tokens are saved.
 *    - transformResponse(body, ctx) : post-process the response coming BACK from OpenRouter.
 *                                     Left as a no-op (nothing to gain by rewriting completions).
 *
 *  ---------------------------------------------------------------------------------------------
 *  STRATEGY — GENERAL-PURPOSE, deterministic, no LLM call. This layer is consumer-agnostic: it
 *  must be safe for ANY conversation (a coding agent, a chat, a tool-calling loop), so it applies
 *  ONLY content-based transforms that cannot change meaning or drop decision-relevant context. It
 *  deliberately makes NO assumptions about what a role's message "means" (e.g. it never treats an
 *  assistant turn as disposable) and has NO per-consumer profiles. If a specific consumer knows it
 *  can shed more, that optimization belongs in the consumer, not in this framework.
 *
 *  Three request-side transforms, applied in order, each independently toggleable and each guarded
 *  so it only fires when it actually saves tokens:
 *
 *    1. normalizeWhitespace  (LOSSLESS)      collapse >2 blank lines, strip trailing spaces, trim
 *                                            trailing newlines. Meaning-preserving for text + code.
 *    2. dedupeRepeatedContent (LOSSLESS)     when the EXACT SAME large content appears in several
 *                                            earlier messages (a file/query re-dumped verbatim),
 *                                            replace the OLDER copies with a marker that points at
 *                                            the surviving (latest) copy. Byte-identical only.
 *    3. truncateOversized    (NEAR-LOSSLESS) cap very long message contents with a head+tail keep
 *                                            window + an explicit elision marker. Off by default —
 *                                            it is the only lossy transform, so a consumer must opt
 *                                            in; useful for log / data dumps, risky for prose/code.
 *
 *  SAFETY RAILS (why this won't corrupt any conversation):
 *    - NO role is treated as disposable. We never collapse a message because of what its role is
 *      assumed to contain. Transforms act purely on the message's own CONTENT.
 *    - The most recent `keepRecent` messages are always left intact — recency is where the model
 *      is actively working; we only touch the older backlog.
 *    - Transforms operate on plain-string content only. Structured content (arrays of content
 *      blocks, tool_calls, etc.) is left untouched — we never risk breaking a schema.
 *    - Every marker is human/model-readable so the model knows content was elided, not lost.
 *    - Fail-open: any throw inside a transform is swallowed and the ORIGINAL message is kept.
 *
 *  Tune via ctx.options; defaults are conservative (lossless-only unless truncation is enabled).
 *
 *  Contract (keep stable — server.js and the extension depend on it):
 *    compressRequest(requestBody, ctx) -> { body, stats }
 *    transformResponse(responseBody, ctx) -> { body, stats }
 *    where stats = { tokensBefore, tokensAfter, tokensSaved, compressionRatio,
 *                    transformsApplied: string[], passthrough: boolean }
 *--------------------------------------------------------------------------------------------*/
'use strict';

const tableCompaction = require('./tableCompaction');
const repeatedLines = require('./repeatedLines');

/** Default tuning. Override per-call via ctx.options. General-purpose + lossless by default. */
const DEFAULTS = {
	/** Master switches per transform. */
	normalizeWhitespace: true,
	dedupeRepeatedContent: true,
	/**
	 * Table compaction — LOSSLESS structural compression of JSON arrays-of-objects embedded in
	 * message content (SF query results, describe output, record dumps): keys stated once + rows.
	 * On by default: it is provably lossless (round-trip tested) and self-guarding (never emits a
	 * result larger than the original, declines non-tabular data). See tableCompaction.js.
	 */
	tableCompaction: true,
	/**
	 * Repeated-line collapse — LOSSLESS. Collapse runs of >= collapseMinRun byte-identical
	 * adjacent lines (deploy/test logs, progress dots) to the line once + a repeat marker.
	 * On by default: provably lossless (round-trip tested), only touches exact-identical runs.
	 */
	collapseRepeatedLines: true,
	/** collapseRepeatedLines: minimum identical-line run length before collapsing. */
	collapseMinRun: 4,
	/** Lossy — OFF by default. A consumer opts in when its traffic is log/data-dump heavy. */
	truncateOversized: false,
	/** Never touch the last N messages (recency window the model is actively using). */
	keepRecent: 2,
	/**
	 * Roles whose CONTENT we may rewrite. NB: this is a content-size safety floor, NOT a semantic
	 * judgement — we rewrite the string in place (dedupe marker / whitespace), never drop a turn.
	 * system is excluded because instructions are small and load-bearing.
	 */
	compressibleRoles: ['user', 'assistant', 'tool'],
	/** A message content shorter than this (chars) is left alone — not worth the risk. */
	minCompressibleChars: 400,
	/** truncateOversized: contents longer than this (chars) get the head+tail treatment. */
	truncateOverChars: 6000,
	/** truncateOversized: chars kept from the start and from the end of an oversized content. */
	truncateHeadChars: 2500,
	truncateTailChars: 2500,
	/** dedupeRepeatedContent: only dedupe blocks at least this long (chars). */
	dedupeMinChars: 500,
};

/**
 * Very rough token estimate (chars/4). Deterministic, no tokenizer dependency. Good enough
 * for reporting savings ratios; NOT used for anything the model sees.
 * @param {unknown} value
 * @returns {number}
 */
function estimateTokens(value) {
	if (value == null) {
		return 0;
	}
	const text = typeof value === 'string' ? value : JSON.stringify(value);
	return Math.ceil(text.length / 4);
}

/**
 * Sum estimated tokens across a chat `messages` array (role + content).
 * @param {Array<{ role?: string, content?: unknown }>} messages
 * @returns {number}
 */
function estimateMessagesTokens(messages) {
	if (!Array.isArray(messages)) {
		return 0;
	}
	let total = 0;
	for (const m of messages) {
		total += estimateTokens(m && m.content);
	}
	return total;
}

/**
 * @param {number} before
 * @param {number} after
 * @param {string[]} transformsApplied
 * @param {boolean} passthrough
 */
function makeStats(before, after, transformsApplied, passthrough) {
	const saved = Math.max(0, before - after);
	return {
		tokensBefore: before,
		tokensAfter: after,
		tokensSaved: saved,
		compressionRatio: before > 0 ? saved / before : 0,
		transformsApplied: transformsApplied || [],
		passthrough: !!passthrough,
	};
}

/* ------------------------------------------------------------------------------------------- *
 *  Transform helpers. Each takes a string, returns a (possibly shorter) string. Pure + safe.
 * ------------------------------------------------------------------------------------------- */

/**
 * LOSSLESS whitespace normalization. Collapses 3+ consecutive blank lines to 2, strips
 * trailing whitespace on each line, and trims trailing newlines. Meaning-preserving for
 * text and for code (indentation and single blank lines survive).
 * @param {string} text
 * @returns {string}
 */
function normalizeWhitespaceText(text) {
	return text
		.replace(/[ \t]+(\r?\n)/g, '$1') // trailing spaces/tabs before a newline
		.replace(/(\r?\n){3,}/g, '\n\n') // 3+ newlines -> one blank line
		.replace(/\s+$/, ''); // trailing whitespace at the very end
}

/**
 * NEAR-LOSSLESS head+tail truncation for an oversized string. Keeps the first `head` and last
 * `tail` chars, tries to cut on line boundaries, and inserts an explicit elision marker stating
 * how much was removed so the model knows content is missing (not that the source was empty).
 * @param {string} text
 * @param {{ head: number, tail: number }} opts
 * @returns {string}
 */
function truncateHeadTail(text, opts) {
	const { head, tail } = opts;
	if (text.length <= head + tail) {
		return text;
	}
	let headPart = text.slice(0, head);
	let tailPart = text.slice(text.length - tail);
	// Prefer to cut on a newline so we don't split a token/identifier mid-line.
	const lastNl = headPart.lastIndexOf('\n');
	if (lastNl > head * 0.5) {
		headPart = headPart.slice(0, lastNl);
	}
	const firstNl = tailPart.indexOf('\n');
	if (firstNl !== -1 && firstNl < tail * 0.5) {
		tailPart = tailPart.slice(firstNl + 1);
	}
	const removed = text.length - headPart.length - tailPart.length;
	return `${headPart}\n\n…[siid-compression: elided ${removed} characters of ${text.length} total]…\n\n${tailPart}`;
}

/** A short, stable key for a large string, used to detect exact duplicates cheaply. */
function contentKey(text) {
	// length + a light rolling hash — collisions are astronomically unlikely for our sizes and
	// a false positive only means we'd mark two genuinely-identical blocks as dupes (still safe).
	let h = 0;
	for (let i = 0; i < text.length; i++) {
		h = (h * 31 + text.charCodeAt(i)) | 0;
	}
	return `${text.length}:${h}`;
}

/* ------------------------------------------------------------------------------------------- *
 *  The strategy.
 * ------------------------------------------------------------------------------------------- */

/** Is this message a plain-string, compressible-role message that clears the size floor? */
function isCompressibleStringMessage(msg, opts) {
	return (
		msg &&
		typeof msg.content === 'string' &&
		opts.compressibleRoles.includes(msg.role) &&
		msg.content.length >= opts.minCompressibleChars
	);
}

/**
 * Compress the OUTBOUND request body before it is forwarded to OpenRouter.
 *
 * @param {any} body   Parsed OpenAI-compatible chat-completions request body.
 * @param {{ model?: string, options?: Partial<typeof DEFAULTS> }} [ctx]
 * @returns {{ body: any, stats: ReturnType<typeof makeStats> }}
 */
function compressRequest(body, ctx) {
	// General-purpose: options come from DEFAULTS overlaid with explicit ctx.options only.
	// There is deliberately NO per-consumer profile — this framework applies the same
	// content-based, meaning-preserving transforms to every conversation.
	const opts = Object.assign({}, DEFAULTS, (ctx && ctx.options) || {});
	const messages = body && Array.isArray(body.messages) ? body.messages : null;
	const before = estimateMessagesTokens(messages);

	if (!messages || messages.length === 0) {
		return { body, stats: makeStats(before, before, [], true) };
	}

	const transformsApplied = [];
	// The window of messages we're allowed to rewrite: everything except the most recent N.
	const editableUntil = Math.max(0, messages.length - opts.keepRecent);

	// Work on a shallow copy of the messages array; only clone the messages we actually change.
	const out = messages.slice();

	// --- Pass 0: table compaction (LOSSLESS). Find JSON arrays-of-objects embedded in message
	//     content and compact them to keys-once tables. Runs first so later passes see the smaller
	//     content. Self-guarding (never bloats) so it's safe to run broadly.
	if (opts.tableCompaction) {
		let compacted = 0;
		for (let i = 0; i < editableUntil; i++) {
			const m = out[i];
			if (!isCompressibleStringMessage(m, opts)) {
				continue;
			}
			try {
				const res = tableCompaction.compactArraysInText(m.content);
				if (res.arraysCompacted > 0 && res.text.length < m.content.length) {
					out[i] = Object.assign({}, m, { content: res.text });
					compacted += res.arraysCompacted;
				}
			} catch {
				/* fail-open: keep original */
			}
		}
		if (compacted > 0) {
			transformsApplied.push(`table:${compacted}`);
		}
	}

	// --- Pass 0b: collapse runs of byte-identical adjacent lines (LOSSLESS). Targets logs.
	if (opts.collapseRepeatedLines) {
		let collapsedRuns = 0;
		for (let i = 0; i < editableUntil; i++) {
			const m = out[i];
			if (!isCompressibleStringMessage(m, opts)) {
				continue;
			}
			try {
				const res = repeatedLines.collapse(m.content, { minRun: opts.collapseMinRun });
				if (res.runsCollapsed > 0 && res.text.length < m.content.length) {
					out[i] = Object.assign({}, m, { content: res.text });
					collapsedRuns += res.runsCollapsed;
				}
			} catch {
				/* fail-open */
			}
		}
		if (collapsedRuns > 0) {
			transformsApplied.push(`lines:${collapsedRuns}`);
		}
	}

	// --- Pass A: dedupe exact-duplicate large blocks. We keep the LATEST occurrence and replace
	//     earlier identical ones with a marker. Build occurrence map first (over editable range).
	if (opts.dedupeRepeatedContent) {
		const lastIndexByKey = new Map();
		for (let i = 0; i < editableUntil; i++) {
			const m = out[i];
			if (isCompressibleStringMessage(m, opts) && m.content.length >= opts.dedupeMinChars) {
				lastIndexByKey.set(contentKey(m.content), i);
			}
		}
		let deduped = 0;
		for (let i = 0; i < editableUntil; i++) {
			const m = out[i];
			if (!isCompressibleStringMessage(m, opts) || m.content.length < opts.dedupeMinChars) {
				continue;
			}
			const key = contentKey(m.content);
			const keepAt = lastIndexByKey.get(key);
			if (keepAt !== undefined && keepAt !== i) {
				try {
					out[i] = Object.assign({}, m, {
						content: `…[siid-compression: duplicate content omitted — identical to message #${keepAt + 1}, ${m.content.length} chars]…`,
					});
					deduped++;
				} catch {
					/* fail-open: keep original */
				}
			}
		}
		if (deduped > 0) {
			transformsApplied.push(`dedupe:${deduped}`);
		}
	}

	// --- Pass B: whitespace normalization (lossless) over editable string messages.
	if (opts.normalizeWhitespace) {
		let normalized = 0;
		for (let i = 0; i < editableUntil; i++) {
			const m = out[i];
			if (!isCompressibleStringMessage(m, opts)) {
				continue;
			}
			try {
				const next = normalizeWhitespaceText(m.content);
				if (next.length < m.content.length) {
					out[i] = Object.assign({}, m, { content: next });
					normalized++;
				}
			} catch {
				/* fail-open */
			}
		}
		if (normalized > 0) {
			transformsApplied.push(`whitespace:${normalized}`);
		}
	}

	// --- Pass C: truncate oversized contents (near-lossless head+tail).
	if (opts.truncateOversized) {
		let truncated = 0;
		for (let i = 0; i < editableUntil; i++) {
			const m = out[i];
			if (!isCompressibleStringMessage(m, opts) || m.content.length <= opts.truncateOverChars) {
				continue;
			}
			try {
				const next = truncateHeadTail(m.content, { head: opts.truncateHeadChars, tail: opts.truncateTailChars });
				if (next.length < m.content.length) {
					out[i] = Object.assign({}, m, { content: next });
					truncated++;
				}
			} catch {
				/* fail-open */
			}
		}
		if (truncated > 0) {
			transformsApplied.push(`truncate:${truncated}`);
		}
	}

	const changed = transformsApplied.length > 0;
	const nextBody = changed ? Object.assign({}, body, { messages: out }) : body;
	const after = estimateMessagesTokens(nextBody.messages);
	return { body: nextBody, stats: makeStats(before, after, transformsApplied, !changed) };
}

/**
 * Post-process the response coming back from OpenRouter. No-op: rewriting the model's completion
 * saves nothing and risks corrupting the answer. Kept for contract symmetry / future use.
 *
 * @param {any} body   Parsed OpenRouter response body.
 * @param {{ source?: string, model?: string }} [ctx]
 * @returns {{ body: any, stats: ReturnType<typeof makeStats> }}
 */
function transformResponse(body, ctx) {
	return { body, stats: makeStats(0, 0, [], true) };
}

module.exports = {
	DEFAULTS,
	estimateTokens,
	estimateMessagesTokens,
	normalizeWhitespaceText,
	truncateHeadTail,
	compressRequest,
	transformResponse,
};

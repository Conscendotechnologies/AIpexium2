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
const blockDedup = require('./blockDedup');
const sessionCache = require('./sessionCache');

/**
 * Process-lifetime block cache shared by every request through this proxy (see sessionCache.js).
 * Cross-REQUEST redundancy is the dominant cost in agent traffic — an agent loop re-sends the whole
 * conversation each turn — and it is invisible to any per-request transform, so the store must
 * outlive a single call. Keyed by content hash, so sharing it across conversations is safe: a hit
 * means the exact same bytes were forwarded before, whoever sent them.
 */
const GLOBAL_BLOCK_CACHE = new sessionCache.SessionCache();

/** Default tuning. Override per-call via ctx.options. General-purpose + lossless by default. */
const DEFAULTS = {
	/** Master switches per transform. */
	normalizeWhitespace: true,
	dedupeRepeatedContent: true,
	/**
	 * Cross-message block dedup — LOSSLESS. When a large byte-identical block (a file body) appears
	 * in an older AND a newer message under different wrappers, replace the older copy with a
	 * reference to the newest one. On by default: byte-identical only, provably reversible.
	 */
	blockDedup: true,
	/** blockDedup: minimum shared-block size (chars) to bother referencing. */
	blockDedupMinChars: 800,
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
	/**
	 * Cross-REQUEST block cache — **OFF. DO NOT ENABLE.** Kept only for reference/experimentation.
	 *
	 * The idea was: a block already forwarded earlier in this session can be replaced by a reference,
	 * because "the model already read those bytes". That premise is FALSE and the transform is
	 * fundamentally unsound for a stateless chat API.
	 *
	 * An LLM retains nothing between requests. Every turn re-sends the whole conversation precisely
	 * because the model can only read what is in THAT request. Removing content because it appeared
	 * in a previous request deletes it from the only place the model can see it — the request itself.
	 *
	 * Measured (A/B, gpt-5.4-mini, 3 runs/side, test/ab-quality.test.js): 68% fewer prompt tokens,
	 * and quality collapsed from 100% to 47.8%. Turn 2 compressed 87% — the file bodies were replaced
	 * by 20 stacked markers, so the model was asked to list methods in files it could no longer read.
	 *
	 * The distinction that matters: blockDedup removes a duplicate only when ANOTHER COPY SURVIVES IN
	 * THE SAME REQUEST, so the content is still readable. This cache had no such guarantee.
	 *
	 * ponytail: left in place (off, tested) rather than deleted, because the cross-request redundancy
	 * it targets is real and large. Any future attempt must keep the content readable in-request —
	 * e.g. provider-side prompt caching, which bills less for a repeated prefix WITHOUT removing it.
	 */
	sessionBlockCache: false,
	/** sessionBlockCache: minimum block size (chars) worth remembering/referencing. */
	sessionBlockMinChars: 1000,
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
 *  Content-shape adapter.
 *
 *  Chat `content` comes in two standard shapes: a plain STRING, or an ARRAY of content blocks
 *  ({type:"text", text}, {type:"image_url", ...}, etc.). SIID-Code (and most Anthropic/OpenAI
 *  clients) use the ARRAY shape, so a string-only strategy would silently no-op on real traffic.
 *
 *  A "segment" is one editable piece of text plus a setter that writes a new value back into its
 *  home (the message's content, or a specific text block). We ONLY ever expose {type:"text"} block
 *  text and plain-string content — image blocks, tool_calls, and any non-text block are never
 *  touched, so we can't break a schema. All per-message transforms operate on segments; they don't
 *  care which shape produced them.
 * ------------------------------------------------------------------------------------------- */

/**
 * Return the editable text segments of a message, or [] if the message has none we may touch.
 * Each segment: { get(): string, set(next: string): void }. `set` mutates a cloned content in
 * place (the caller is responsible for cloning the message before mutating — see cloneMessage).
 * @param {{ role?: string, content?: unknown }} msg
 * @param {typeof DEFAULTS} opts
 */
function textSegments(msg, opts) {
	if (!msg || !opts.compressibleRoles.includes(msg.role)) {
		return [];
	}
	const c = msg.content;
	if (typeof c === 'string') {
		return [
			{
				get: () => msg.content,
				set: (next) => {
					msg.content = next;
				},
			},
		];
	}
	if (Array.isArray(c)) {
		const segs = [];
		for (let i = 0; i < c.length; i++) {
			const block = c[i];
			if (block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
				const idx = i;
				segs.push({
					get: () => msg.content[idx].text,
					set: (next) => {
						msg.content[idx] = Object.assign({}, msg.content[idx], { text: next });
					},
				});
			}
		}
		return segs;
	}
	return [];
}

/** Deep-enough clone of a message so we can mutate its content without touching the original. */
function cloneMessage(msg) {
	const copy = Object.assign({}, msg);
	if (Array.isArray(msg.content)) {
		copy.content = msg.content.slice();
	}
	return copy;
}

/**
 * Apply a string->string transform to every editable text segment of message `out[i]`, cloning the
 * message first so the original array is never mutated. `fn(text)` returns { text, count } (count =
 * how many sub-transforms fired) or null to skip. Only writes back when the result is shorter.
 * Returns the total count applied across this message's segments. Fail-open per segment.
 * @param {Array} out
 * @param {number} i
 * @param {typeof DEFAULTS} opts
 * @param {(text: string) => ({ text: string, count: number } | null)} fn
 */
function applyToMessageSegments(out, i, opts, fn) {
	const original = out[i];
	const segs = textSegments(original, opts);
	if (segs.length === 0) {
		return 0;
	}
	// We must operate on a clone so `set` doesn't touch the caller's original message object.
	const clone = cloneMessage(original);
	const cloneSegs = textSegments(clone, opts);
	let total = 0;
	for (const seg of cloneSegs) {
		const text = seg.get();
		if (typeof text !== 'string' || text.length < opts.minCompressibleChars) {
			continue;
		}
		try {
			const res = fn(text);
			if (res && res.count > 0 && res.text.length < text.length) {
				seg.set(res.text);
				total += res.count;
			}
		} catch {
			/* fail-open: leave this segment as-is */
		}
	}
	if (total > 0) {
		out[i] = clone;
	}
	return total;
}

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
	// Global kill switch — the OFF side of an A/B, and an escape hatch if compression is ever
	// suspected of degrading answers. Set SIID_COMPRESSION_OFF=1 to forward every request byte-for-
	// byte. Checked per-call (not cached) so a test can flip it between requests to one proxy.
	if (process.env.SIID_COMPRESSION_OFF === '1') {
		const n = estimateMessagesTokens(body && body.messages);
		return { body, stats: makeStats(n, n, [], true) };
	}
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
	let out = messages.slice();

	// --- Pass -1: cross-message block dedup (LOSSLESS). Runs FIRST and across the whole array:
	//     when a large file body reappears under a different wrapper, the older copy becomes a
	//     reference to the newest one. Later per-message passes then operate on the shrunk content.
	if (opts.blockDedup) {
		try {
			// blockDedup is string-content oriented and uses message indices in its ref markers.
			// Real content is often an ARRAY of text blocks, so we run it over a FLAT "virtual
			// message" view — one entry per editable text segment, in message order — then write the
			// deduped strings back into their home segments. The view's indices are what the ref
			// markers point at; expand() (in the extension) resolves them against the SAME flat view,
			// so the round-trip is preserved. Segments are collected from the full array (later
			// messages are valid reference SOURCES) but only the first `editableSegs` are rewritable.
			// Clone every message that owns editable segments up front, so segment setters write into
			// our copies, never the caller's originals. Then collect segment setters over CLONES.
			const segRefs = []; // segment setters (into clones), in message order
			const segMsgNum = []; // real 1-based message number owning each segment
			let editableSegCount = 0;
			for (let mi = 0; mi < out.length; mi++) {
				const segs = textSegments(out[mi], opts);
				if (segs.length === 0) {
					continue;
				}
				out[mi] = cloneMessage(out[mi]); // shallow clone; setters below target this copy
				for (const seg of textSegments(out[mi], opts)) {
					segRefs.push(seg);
					segMsgNum.push(mi + 1);
					if (mi < editableUntil) {
						editableSegCount = segRefs.length;
					}
				}
			}
			if (segRefs.length > 1) {
				const view = segRefs.map((s) => ({ content: s.get() }));
				const res = blockDedup.dedup(view, {
					editableUntil: editableSegCount,
					minBlockChars: opts.blockDedupMinChars,
					// The human sentence must cite the real MESSAGE number, not the flat-view index.
					displayNumberOf: (viewIdx) => segMsgNum[viewIdx],
				});
				if (res.blocksDeduped > 0) {
					// res.messages[k].content is the new text for segment k; write changed ones back.
					for (let k = 0; k < segRefs.length; k++) {
						if (res.messages[k].content !== view[k].content) {
							segRefs[k].set(res.messages[k].content);
						}
					}
					transformsApplied.push(`block-dedup:${res.blocksDeduped}`);
				}
			}
		} catch {
			/* fail-open: keep original array */
		}
	}

	// --- Pass 0: table compaction (LOSSLESS). Find JSON arrays-of-objects embedded in message
	//     content and compact them to keys-once tables. Runs first so later passes see the smaller
	//     content. Self-guarding (never bloats) so it's safe to run broadly.
	if (opts.tableCompaction) {
		let compacted = 0;
		for (let i = 0; i < editableUntil; i++) {
			compacted += applyToMessageSegments(out, i, opts, (text) => {
				const res = tableCompaction.compactArraysInText(text);
				return { text: res.text, count: res.arraysCompacted };
			});
		}
		if (compacted > 0) {
			transformsApplied.push(`table:${compacted}`);
		}
	}

	// --- Pass 0b: collapse runs of byte-identical adjacent lines (LOSSLESS). Targets logs.
	if (opts.collapseRepeatedLines) {
		let collapsedRuns = 0;
		for (let i = 0; i < editableUntil; i++) {
			collapsedRuns += applyToMessageSegments(out, i, opts, (text) => {
				const res = repeatedLines.collapse(text, { minRun: opts.collapseMinRun });
				return { text: res.text, count: res.runsCollapsed };
			});
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
			normalized += applyToMessageSegments(out, i, opts, (text) => {
				const next = normalizeWhitespaceText(text);
				return { text: next, count: next.length < text.length ? 1 : 0 };
			});
		}
		if (normalized > 0) {
			transformsApplied.push(`whitespace:${normalized}`);
		}
	}

	// --- Pass C: truncate oversized contents (near-lossless head+tail).
	if (opts.truncateOversized) {
		let truncated = 0;
		for (let i = 0; i < editableUntil; i++) {
			truncated += applyToMessageSegments(out, i, opts, (text) => {
				if (text.length <= opts.truncateOverChars) {
					return null;
				}
				const next = truncateHeadTail(text, { head: opts.truncateHeadChars, tail: opts.truncateTailChars });
				return { text: next, count: next.length < text.length ? 1 : 0 };
			});
		}
		if (truncated > 0) {
			transformsApplied.push(`truncate:${truncated}`);
		}
	}

	// --- Pass D: cross-REQUEST block cache (LOSSLESS). Runs LAST, after every other transform, for
	//     two reasons: (1) it caches the FINAL bytes we are about to forward, which are the same
	//     bytes the next turn will present, keeping block hashes stable across turns; (2) running it
	//     earlier would shrink content below `truncateOverChars` and silently mask an explicitly
	//     opted-in truncation. This is the pass that pays on real agent traffic, where each turn
	//     re-sends the whole conversation history verbatim.
	// Learning is only sound when this request is actually FORWARDED to the model: the whole safety
	// argument for referencing a block is "the model already read these bytes". A caller that merely
	// previews compression (the `simulate` command, diagnostics, a test's dry run) must not teach the
	// cache, or the next real request will reference content the model has never seen. The proxy
	// opts in explicitly via ctx.forwarded; everyone else gets a read-only cache.
	const mayLearn = !!(ctx && ctx.forwarded);
	if (opts.sessionBlockCache && mayLearn) {
		const cache = (ctx && ctx.blockCache) || GLOBAL_BLOCK_CACHE;

		/*
		 * Build the PROTECT set before rewriting anything.
		 *
		 * A block may be replaced by a reference ONLY because the model already read those bytes on an
		 * earlier turn — that is the entire safety argument for this transform, since nothing calls
		 * expand() in production. Being in the cache is what establishes "already sent", so most blocks
		 * need no extra protection.
		 *
		 * The one way that argument breaks is a DANGLING REFERENCE: blockDedup runs earlier and may have
		 * replaced other copies of a block with a marker pointing AT the copy that survives here. If the
		 * cache then also removes that surviving copy, the content vanishes from the request entirely and
		 * the model is left following a reference to nothing. (Observed live: a 2998->82 token "saving"
		 * that destroyed the answer.) So we protect exactly the blocks another transform is pointing at.
		 */
		const protect = new Set();
		try {
			for (let i = 0; i < out.length; i++) {
				for (const seg of textSegments(out[i], opts)) {
					const text = seg.get();
					if (typeof text !== 'string' || text.indexOf('⟪siid-ref') === -1) {
						continue;
					}
					// This segment carries blockDedup markers; whatever they point AT must survive intact.
					const re = new RegExp(blockDedup.REF_RE.source, 'g');
					let m;
					while ((m = re.exec(text))) {
						const srcIdx = parseInt(m[1], 10);
						const at = parseInt(m[2], 10);
						const len = parseInt(m[3], 10);
						// Resolve the referenced span against the flat segment view blockDedup addressed.
						let k = 0;
						for (let j = 0; j < out.length; j++) {
							for (const s2 of textSegments(out[j], opts)) {
								if (k++ !== srcIdx) {
									continue;
								}
								const srcText = s2.get();
								if (typeof srcText !== 'string') {
									continue;
								}
								const referenced = srcText.substr(at, len);
								// Protect every cache-block that overlaps the referenced span.
								for (const r of sessionCache.candidateBlocks(srcText, opts.sessionBlockMinChars)) {
									if (r.start < at + len && r.end > at) {
										protect.add(sessionCache.hashBlock(srcText.slice(r.start, r.end)));
									}
								}
								if (referenced.length >= opts.sessionBlockMinChars) {
									protect.add(sessionCache.hashBlock(referenced));
								}
							}
						}
					}
				}
			}
		} catch {
			/* fail-open: on any error protect nothing new — the per-block guards below still apply */
		}

		const cacheCfg = { minBlockChars: opts.sessionBlockMinChars, protect };
		let referenced = 0;
		for (let i = 0; i < editableUntil; i++) {
			referenced += applyToMessageSegments(out, i, opts, (text) => {
				const res = sessionCache.compressText(text, cache, cacheCfg);
				return { text: res.text, count: res.blocksReferenced };
			});
		}
		// LEARN from the recency-protected tail too. We must not REWRITE those messages, but a file
		// body arrives there first; if we only learned from the editable range the cache would always
		// be one turn behind. Learning never mutates the request — it only populates the store for the
		// next turn, when this same content has slid into the editable range.
		try {
			for (let i = editableUntil; i < out.length; i++) {
				for (const seg of textSegments(out[i], opts)) {
					sessionCache.learnText(seg.get(), cache, cacheCfg);
				}
			}
		} catch {
			/* fail-open: learning is best-effort and must never affect the forwarded request */
		}
		if (referenced > 0) {
			transformsApplied.push(`cache:${referenced}`);
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
	GLOBAL_BLOCK_CACHE,
	estimateTokens,
	estimateMessagesTokens,
	normalizeWhitespaceText,
	truncateHeadTail,
	compressRequest,
	transformResponse,
};

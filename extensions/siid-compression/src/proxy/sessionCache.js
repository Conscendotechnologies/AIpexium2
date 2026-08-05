/*---------------------------------------------------------------------------------------------
 *  Cross-REQUEST block cache — LOSSLESS. The single biggest win on real agent traffic.
 *
 *  WHY THIS EXISTS (measured, not assumed): every other transform in this proxy looks for
 *  redundancy WITHIN one request. Real agent traffic rarely has any — each file body is pasted
 *  once, so table/lines/block-dedup never fire and savings land at ~0%.
 *
 *  But an agent LOOP re-sends the entire conversation history on every turn. Measured on real
 *  siid-code traffic (traffic.jsonl): consecutive requests re-sent ~31k, ~49k, ~49k tokens of
 *  byte-identical history — on one 51.5k-token request, ~97% had already been forwarded on the
 *  previous turn. That redundancy is invisible to a per-request compressor and is what this
 *  module captures.
 *
 *  HOW: we remember large blocks (>= minBlockChars) we have already forwarded in this proxy
 *  session, keyed by content hash. When a later request contains a block we have seen before, the
 *  block is replaced with a model-readable reference. Because the cache holds the exact bytes,
 *  expand() can restore the original request verbatim — LOSSLESS BY CONSTRUCTION.
 *
 *  MARKER (same convention as blockDedup.js — readable first, reversible second):
 *      …⟪siid-cache: unchanged content you were already shown earlier in this conversation \
 *         (<L> chars); omitted to save space | key=<hash> len=<L>⟫…
 *  The sentence is what the upstream MODEL reads (nothing calls expand() in production), so it
 *  must state plainly that the content is unchanged rather than missing. The `| key=… len=…` tail
 *  is only for expand().
 *
 *  SAFETY:
 *   - Byte-identical matching only. Never fuzzy, never a diff — we do not guess.
 *   - Blocks are matched on LINE boundaries so we never split an identifier mid-token.
 *   - The most recent messages are protected by the caller (keepRecent), as with every transform.
 *   - Bounded memory: an LRU cap on both entry count and total bytes, so a long session cannot
 *     grow the proxy's heap without limit.
 *   - Fail-open: the caller wraps this; any throw leaves the request untouched.
 *
 *  ponytail: process-local Map, so the cache dies with the proxy and is not shared across
 *  windows. That is the correct scope for a session cache — persist to disk only if cross-restart
 *  reuse is ever shown to matter.
 *--------------------------------------------------------------------------------------------*/
'use strict';

/** Readable sentence + machine-reversible tail. `[\s\S]*?` tolerates the prose without breaking parsing. */
const CACHE_RE = /…⟪siid-cache:[\s\S]*?\| key=([0-9a-z]+) len=(\d+)⟫…/;
const CACHE_RE_G = new RegExp(CACHE_RE.source, 'g');

/** Defaults chosen so we only ever reference blocks big enough to pay for the marker. */
const DEFAULTS = {
	/** Only cache/reference blocks at least this large (chars). */
	minBlockChars: 1000,
	/** Max distinct blocks retained. */
	maxEntries: 256,
	/** Max total bytes retained across all entries (~8 MB). */
	maxBytes: 8 * 1024 * 1024,
};

/**
 * Stable content hash. FNV-1a (32-bit) combined with the length, base36-encoded.
 * Length-qualified so a collision would need identical length AND hash.
 * @param {string} text
 * @returns {string}
 */
function hashBlock(text) {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		// FNV prime 16777619, via shifts to stay in 32-bit int math.
		h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
	}
	return `${text.length.toString(36)}${h.toString(36)}`;
}

/** Build the model-readable + reversible cache marker. */
function makeCacheMarker(key, len) {
	const human = `unchanged content you were already shown earlier in this conversation (${len} chars); omitted to save space`;
	return `…⟪siid-cache: ${human} | key=${key} len=${len}⟫…`;
}

/**
 * A bounded, session-scoped store of blocks we have already forwarded.
 * LRU by insertion/most-recent-use order (Map preserves insertion order).
 */
class SessionCache {
	/** @param {Partial<typeof DEFAULTS>} [opts] */
	constructor(opts) {
		const cfg = Object.assign({}, DEFAULTS, opts || {});
		this.minBlockChars = cfg.minBlockChars;
		this.maxEntries = cfg.maxEntries;
		this.maxBytes = cfg.maxBytes;
		/** @type {Map<string, string>} key -> exact block bytes */
		this.blocks = new Map();
		this.bytes = 0;
	}

	/** Number of retained blocks. */
	get size() {
		return this.blocks.size;
	}

	/**
	 * Look up a block's exact bytes.
	 * @param {string} key
	 * @returns {string | undefined}
	 */
	get(key) {
		const val = this.blocks.get(key);
		if (val !== undefined) {
			// Refresh recency: delete + re-set moves it to the end of the Map's order.
			this.blocks.delete(key);
			this.blocks.set(key, val);
		}
		return val;
	}

	/**
	 * Remember a block. Returns its key. Evicts oldest entries past either cap.
	 * @param {string} text
	 * @returns {string}
	 */
	put(text) {
		const key = hashBlock(text);
		if (this.blocks.has(key)) {
			this.get(key); // refresh recency only
			return key;
		}
		this.blocks.set(key, text);
		this.bytes += text.length;
		while ((this.blocks.size > this.maxEntries || this.bytes > this.maxBytes) && this.blocks.size > 1) {
			const oldest = this.blocks.keys().next().value;
			const evicted = this.blocks.get(oldest);
			this.blocks.delete(oldest);
			this.bytes -= evicted ? evicted.length : 0;
		}
		return key;
	}
}

/**
 * Split text into line-aligned candidate blocks of at least `minBlockChars`.
 *
 * We treat a BLANK-LINE-separated paragraph/section as the unit, then greedily merge consecutive
 * sections until each candidate clears the size floor. Line alignment guarantees we never cut an
 * identifier in half, and section alignment makes a re-sent file body hash identically across
 * requests (its internal structure is unchanged).
 *
 * @param {string} text
 * @param {number} minBlockChars
 * @returns {Array<{ start: number, end: number }>} char ranges, in order, non-overlapping
 */
function candidateBlocks(text, minBlockChars) {
	const ranges = [];
	// Section boundaries: a blank line (\n\n). Keep offsets so we can slice exactly.
	const bounds = [];
	let idx = 0;
	const re = /\n[ \t]*\n/g;
	let m;
	while ((m = re.exec(text))) {
		bounds.push({ start: idx, end: m.index + m[0].length });
		idx = m.index + m[0].length;
	}
	bounds.push({ start: idx, end: text.length });

	// Greedily merge consecutive sections until each block clears the floor.
	let cur = null;
	for (const b of bounds) {
		if (!cur) {
			cur = { start: b.start, end: b.end };
		} else {
			cur.end = b.end;
		}
		if (cur.end - cur.start >= minBlockChars) {
			ranges.push(cur);
			cur = null;
		}
	}
	// A trailing remainder below the floor is not worth referencing — drop it.
	return ranges;
}

/**
 * Remember every candidate block in `text` WITHOUT rewriting anything.
 *
 * Learning must not be confined to the rewritable window. The newest messages are recency-protected
 * (we never rewrite them), but they are exactly where a freshly-read file body arrives — and on the
 * NEXT turn that same body has slid into the editable range. If we only learned from editable
 * messages, the cache would always be a turn behind and content that stays near the end of the
 * conversation would never be learned at all.
 *
 * @param {string} text
 * @param {SessionCache} cache
 * @param {{ minBlockChars?: number }} [cfg]
 * @returns {number} blocks remembered
 */
function learnText(text, cache, cfg) {
	const minBlockChars = (cfg && cfg.minBlockChars) || cache.minBlockChars;
	if (typeof text !== 'string' || text.length < minBlockChars || CACHE_RE.test(text)) {
		return 0;
	}
	let learned = 0;
	for (const r of candidateBlocks(text, minBlockChars)) {
		cache.put(text.slice(r.start, r.end));
		learned++;
	}
	return learned;
}

/**
 * Replace blocks already seen in this session with cache references, and remember unseen ones.
 *
 * `cfg.protect` is a Set of block hashes that MUST NOT be referenced in this request. It is how the
 * caller guarantees we never remove the last surviving copy of something the model still needs —
 * see the `keep`-set construction in compressor.js. Without it, this transform can legitimately
 * reference a block that another transform (e.g. blockDedup) is already pointing AT, leaving a
 * dangling reference and losing the content entirely.
 *
 * @param {string} text
 * @param {SessionCache} cache
 * @param {{ minBlockChars?: number, protect?: Set<string> }} [cfg]
 * @returns {{ text: string, blocksReferenced: number }}
 */
function compressText(text, cache, cfg) {
	const minBlockChars = (cfg && cfg.minBlockChars) || cache.minBlockChars;
	const protect = cfg && cfg.protect instanceof Set ? cfg.protect : null;
	if (typeof text !== 'string' || text.length < minBlockChars) {
		return { text, blocksReferenced: 0 };
	}
	// Never re-process a marker we already emitted (no nesting).
	if (CACHE_RE.test(text)) {
		return { text, blocksReferenced: 0 };
	}

	const ranges = candidateBlocks(text, minBlockChars);
	if (ranges.length === 0) {
		return { text, blocksReferenced: 0 };
	}

	let out = '';
	let cursor = 0;
	let blocksReferenced = 0;
	for (const r of ranges) {
		const block = text.slice(r.start, r.end);
		const key = hashBlock(block);
		const seen = cache.get(key);
		if (protect && protect.has(key)) {
			// The caller has pledged this block must survive intact in THIS request (it is the last
			// copy, or another transform references it). Keep it, and keep it cached for later turns.
			cache.put(block);
			continue;
		}
		if (seen !== undefined && seen === block) {
			const marker = makeCacheMarker(key, block.length);
			// Only reference when it actually shrinks the payload.
			if (marker.length < block.length) {
				out += text.slice(cursor, r.start) + marker;
				cursor = r.end;
				blocksReferenced++;
				continue;
			}
		}
		// Unseen (or not worth referencing): remember it for the NEXT request.
		cache.put(block);
	}
	if (blocksReferenced === 0) {
		return { text, blocksReferenced: 0 };
	}
	out += text.slice(cursor);
	return { text: out, blocksReferenced };
}

/**
 * Inverse of compressText(): splice cached blocks back in. Restores the exact original bytes,
 * provided the cache still holds the referenced entries.
 *
 * @param {string} text
 * @param {SessionCache} cache
 * @returns {string}
 */
function expandText(text, cache) {
	if (typeof text !== 'string' || text.indexOf('⟪siid-cache') === -1) {
		return text;
	}
	return text.replace(CACHE_RE_G, (whole, key) => {
		const block = cache.get(key);
		return block !== undefined ? block : whole; // unknown key: leave the marker rather than lose data
	});
}

module.exports = {
	DEFAULTS,
	SessionCache,
	hashBlock,
	makeCacheMarker,
	candidateBlocks,
	learnText,
	compressText,
	expandText,
	CACHE_RE,
};

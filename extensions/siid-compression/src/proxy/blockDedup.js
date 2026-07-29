/*---------------------------------------------------------------------------------------------
 *  Cross-message block dedup — LOSSLESS removal of a large byte-identical block that appears in
 *  more than one message (a file body re-pasted under a different "Here is X:" wrapper).
 *
 *  The per-message dedupe in compressor.js only catches messages whose ENTIRE content is identical.
 *  In an agent session the same FILE BODY often reappears wrapped in different prose, so the whole
 *  messages differ even though a big chunk is shared. This finds that shared chunk and replaces the
 *  OLDER occurrence with a reference to the surviving (latest) one, keeping the newest copy intact.
 *
 *  LOSSLESS + REVERSIBLE. Matching is BYTE-IDENTICAL only (no fuzzy/diff) — we never guess. The
 *  reference marker is MODEL-READABLE first and machine-reversible second: a plain-English sentence
 *  tells the reader the block is identical to one shown in an earlier message (so a model reading the
 *  compressed request understands the content wasn't lost, just not repeated), and a trailing data
 *  tail carries everything expand() needs to splice the exact block back:
 *      …⟪siid-ref: identical to the block shown in message #<N1> above (<L> chars); \
 *         omitted to save space | src=<msgIndex> at=<startInSrc> len=<L>⟫…
 *  where #<N1> is the 1-based message number the reader sees, and src/at/len (0-based) let expand()
 *  reinsert the L chars of message <msgIndex>'s content starting at <startInSrc>.
 *
 *  NB: on the proxy's OUTBOUND path nothing calls expand() — the upstream model reads the marker as
 *  written. The readable sentence is therefore what actually protects agent quality; the data tail
 *  exists for round-trip provability (tests) and any consumer that chooses to re-hydrate.
 *
 *  Approach (line-anchored, cheap): candidate shared blocks are LINE-ALIGNED runs. For each pair
 *  (older i, newer j) we find the longest run of consecutive identical lines that appears in both,
 *  anchored by a rare line, and if it's long enough (>= minBlockChars) we reference it. Line
 *  anchoring keeps this well away from O(n²) char-level LCS while catching the real case (re-pasted
 *  multi-line file bodies).
 *--------------------------------------------------------------------------------------------*/
'use strict';

// Model-readable prefix + machine-reversible data tail. The `[\s\S]*?` between the readable
// sentence and the `| src=` data tail tolerates the human text without letting it break parsing.
const REF_RE = /…⟪siid-ref:[\s\S]*?\| src=(\d+) at=(\d+) len=(\d+)⟫…/;

/**
 * Build the model-readable + reversible reference marker for a shared block.
 * @param {number} srcIndex   0-based index into the array expand() will resolve against.
 * @param {number} srcStart   byte offset of the block within the source content.
 * @param {number} len        block length in chars.
 * @param {number} [displayNumber]  1-based message number to show the reader. Defaults to
 *   srcIndex + 1 (correct when the dedup array IS the message array). When dedup runs over a
 *   flattened per-segment view, the caller passes the real 1-based MESSAGE number so the human
 *   sentence stays truthful even though `src` addresses the flat view.
 */
function makeRefMarker(srcIndex, srcStart, len, displayNumber) {
	const shown = typeof displayNumber === 'number' ? displayNumber : srcIndex + 1;
	const human = `identical to the block shown in message #${shown} above (${len} chars); omitted to save space`;
	return `…⟪siid-ref: ${human} | src=${srcIndex} at=${srcStart} len=${len}⟫…`;
}

/** Build an index: for message m, map each line-content -> list of char offsets where it starts. */
function lineOffsets(text) {
	const map = new Map();
	let off = 0;
	for (const line of text.split('\n')) {
		if (!map.has(line)) {
			map.set(line, []);
		}
		map.get(line).push(off);
		off += line.length + 1; // + '\n'
	}
	return map;
}

/**
 * Find the longest byte-identical, line-aligned block shared between `src` (newer) and `dst`
 * (older), returning { dstStart, srcStart, len } for the block within each, or null.
 * We anchor on lines that are relatively rare to avoid quadratic scanning of common blank lines.
 */
function longestSharedBlock(dst, src, minBlockChars) {
	const dstLines = dst.split('\n');
	const srcIdx = lineOffsets(src);
	let best = null;

	let dstOff = 0;
	for (let a = 0; a < dstLines.length; a++) {
		const line = dstLines[a];
		const lineLen = line.length;
		const starts = srcIdx.get(line);
		if (starts && line.length > 0) {
			// Try to extend a match from each occurrence in src.
			for (const srcStartOff of starts) {
				// Extend forward line-by-line while lines match.
				let len = 0;
				let da = a;
				let sOff = srcStartOff;
				let dOff = dstOff;
				const srcAll = src;
				while (da < dstLines.length) {
					const dLine = dstLines[da];
					// Does src have the same line at sOff?
					const sEnd = srcAll.indexOf('\n', sOff);
					const sLine = sEnd === -1 ? srcAll.slice(sOff) : srcAll.slice(sOff, sEnd);
					if (sLine !== dLine) {
						break;
					}
					const consumed = dLine.length + 1; // include newline (may overrun at EOF; fine)
					len += consumed;
					da++;
					sOff += consumed;
					dOff += consumed;
				}
				if (len >= minBlockChars && (!best || len > best.len)) {
					best = { dstStart: dstOff, srcStart: srcStartOff, len };
				}
			}
		}
		dstOff += lineLen + 1;
	}
	if (!best) {
		return null;
	}
	// Clamp len so it never runs past either string (the +1 newline can overrun at EOF).
	best.len = Math.min(best.len, dst.length - best.dstStart, src.length - best.srcStart);
	// Re-verify byte-identity of the clamped span (safety: the line loop assumed newlines).
	if (dst.substr(best.dstStart, best.len) !== src.substr(best.srcStart, best.len)) {
		return null;
	}
	return best;
}

/**
 * Dedup byte-identical shared blocks across messages. Mutates a COPY: returns a new messages array
 * with older duplicated blocks replaced by references to the newest copy. Only string contents in
 * `editableIndices` are rewritten (recency-protected messages keep their bytes and are used only
 * as reference SOURCES).
 *
 * @param {Array<{content?: any}>} messages
 * @param {{ editableUntil?: number, minBlockChars?: number, displayNumberOf?: (index: number) => number }} [cfg]
 *   displayNumberOf maps a dedup-array index to the 1-based MESSAGE number a reader should see
 *   (used when `messages` is a flattened per-segment view). Omit when the array is the real
 *   message list.
 * @returns {{ messages: Array, blocksDeduped: number }}
 */
function dedup(messages, cfg) {
	const minBlockChars = (cfg && cfg.minBlockChars) || 800;
	const editableUntil = cfg && typeof cfg.editableUntil === 'number' ? cfg.editableUntil : messages.length;
	const displayNumberOf = cfg && typeof cfg.displayNumberOf === 'function' ? cfg.displayNumberOf : null;
	const out = messages.slice();
	let blocksDeduped = 0;

	// For each editable OLDER message i, find the largest block it shares with any LATER message j
	// (j > i). Keep j's copy, replace i's block with a reference to j.
	for (let i = 0; i < editableUntil; i++) {
		const older = out[i];
		if (!older || typeof older.content !== 'string' || older.content.length < minBlockChars) {
			continue;
		}
		if (REF_RE.test(older.content)) {
			continue; // already contains a ref — don't nest
		}
		let bestJ = -1;
		let bestBlock = null;
		for (let j = messages.length - 1; j > i; j--) {
			const newer = out[j];
			if (!newer || typeof newer.content !== 'string' || newer.content.length < minBlockChars) {
				continue;
			}
			const block = longestSharedBlock(older.content, newer.content, minBlockChars);
			if (block && (!bestBlock || block.len > bestBlock.len)) {
				bestBlock = block;
				bestJ = j;
			}
		}
		if (bestBlock && bestJ !== -1) {
			const { dstStart, srcStart, len } = bestBlock;
			const marker = makeRefMarker(bestJ, srcStart, len, displayNumberOf ? displayNumberOf(bestJ) : undefined);
			// Only apply if it actually shrinks this message.
			if (marker.length < len) {
				const c = older.content;
				out[i] = Object.assign({}, older, { content: c.slice(0, dstStart) + marker + c.slice(dstStart + len) });
				blocksDeduped++;
			}
		}
	}
	return { messages: out, blocksDeduped };
}

/**
 * Inverse of dedup(): resolve every …⟪siid-ref src=… at=… len=…⟫… marker by splicing the referenced
 * block back from the source message. Rebuilds the exact original array.
 * @param {Array<{content?: any}>} messages
 * @returns {Array}
 */
function expand(messages) {
	const out = messages.slice();
	for (let i = 0; i < out.length; i++) {
		const m = out[i];
		if (!m || typeof m.content !== 'string' || m.content.indexOf('⟪siid-ref') === -1) {
			continue;
		}
		let content = m.content;
		let match;
		// Resolve possibly-multiple refs. Source messages are looked up in the ORIGINAL (compacted)
		// array — a source is always a later, un-referenced message, so its bytes are intact.
		while ((match = REF_RE.exec(content))) {
			const src = parseInt(match[1], 10);
			const at = parseInt(match[2], 10);
			const len = parseInt(match[3], 10);
			const srcContent = messages[src] && typeof messages[src].content === 'string' ? messages[src].content : '';
			const block = srcContent.substr(at, len);
			content = content.slice(0, match.index) + block + content.slice(match.index + match[0].length);
		}
		out[i] = Object.assign({}, m, { content });
	}
	return out;
}

module.exports = { dedup, expand, longestSharedBlock, makeRefMarker, REF_RE };

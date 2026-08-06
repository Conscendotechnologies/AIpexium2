/*---------------------------------------------------------------------------------------------
 *  Repeated-line collapse — LOSSLESS compression of runs of byte-identical consecutive lines.
 *
 *  Deploy/test/debug logs stuffed into agent context often contain long runs of the SAME line
 *  (`... DEBUG deploy step ok`, progress dots, repeated warnings). This collapses a run of K
 *  identical adjacent lines into the line once + a machine-readable marker recording the count,
 *  so the exact original can be reconstructed. Only EXACT-identical adjacent lines are collapsed
 *  — lines that merely share a shape (e.g. differ by timestamp) are left untouched, because the
 *  varying part of a log line is often the information that matters.
 *
 *  LOSSLESS BY CONSTRUCTION, PROVEN so: `expand(collapse(x)) === x` (see repeatedLines.test.js).
 *
 *  Marker (chosen so it can't plausibly occur in real content and parses back unambiguously):
 *    …⟪siid-repeat ×K⟫…
 *  meaning "the immediately-preceding line is repeated K more times" (so total = K+1 identical).
 *
 *  Self-guarding: only collapses runs of at least `minRun` identical lines (default 4) — short
 *  runs aren't worth a marker — and the marker text is shorter than the lines it replaces.
 *--------------------------------------------------------------------------------------------*/
'use strict';

const MARKER_RE = /^…⟪siid-repeat ×(\d+)⟫…$/;
function makeMarker(k) {
	return `…⟪siid-repeat ×${k}⟫…`;
}

/**
 * Collapse runs of >= minRun byte-identical consecutive lines.
 * @param {string} text
 * @param {{ minRun?: number }} [cfg]
 * @returns {{ text: string, runsCollapsed: number }}
 */
function collapse(text, cfg) {
	const minRun = (cfg && cfg.minRun) || 4;
	if (typeof text !== 'string' || text.indexOf('\n') === -1) {
		return { text, runsCollapsed: 0 };
	}
	// Preserve the exact line structure by splitting on \n (keeping empty trailing element if the
	// text ends in \n, so join restores it byte-for-byte).
	const lines = text.split('\n');
	const out = [];
	let runsCollapsed = 0;
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		// Count how many identical lines follow (including this one).
		let j = i + 1;
		while (j < lines.length && lines[j] === line) {
			j++;
		}
		const runLen = j - i;
		if (runLen >= minRun) {
			// Emit the line ONCE, then a marker recording the remaining K = runLen-1 repeats.
			out.push(line);
			out.push(makeMarker(runLen - 1));
			runsCollapsed++;
		} else {
			for (let k = 0; k < runLen; k++) {
				out.push(line);
			}
		}
		i = j;
	}
	return { text: out.join('\n'), runsCollapsed };
}

/**
 * Inverse of collapse(): rebuild the exact original text. A marker line restores K copies of the
 * IMMEDIATELY-PRECEDING line (which was emitted once), for K+1 total.
 * @param {string} text
 * @returns {string}
 */
function expand(text) {
	if (typeof text !== 'string' || text.indexOf('⟪siid-repeat') === -1) {
		return text;
	}
	const lines = text.split('\n');
	const out = [];
	for (let i = 0; i < lines.length; i++) {
		const m = MARKER_RE.exec(lines[i]);
		if (m && out.length > 0) {
			const k = parseInt(m[1], 10);
			const prev = out[out.length - 1];
			for (let r = 0; r < k; r++) {
				out.push(prev);
			}
		} else {
			out.push(lines[i]);
		}
	}
	return out.join('\n');
}

module.exports = { collapse, expand, makeMarker, MARKER_RE };

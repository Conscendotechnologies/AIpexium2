/*---------------------------------------------------------------------------------------------
 *  Table compaction — LOSSLESS structural compression of JSON arrays-of-objects.
 *
 *  Reimplements the reusable core of Headroom's SmartCrusher "Table" compaction (Apache-2.0;
 *  algorithm only, our own code). Target: the record arrays that dominate a Salesforce coding
 *  agent's context — `sf data query --json` → result.records, `sf sobject describe` fields, etc.
 *  In `[{"Id":..,"Name":..,"Industry":..}, {…×N}]` the keys repeat N times; we state them ONCE
 *  as a schema and list each object as a row of values. Every VALUE is preserved byte-for-byte —
 *  only the repeated keys + JSON punctuation are removed.
 *
 *  LOSSLESS BY CONSTRUCTION, and PROVEN so: `expand(compact(x))` deep-equals `x` (see
 *  test/tableCompaction.test.js). The inverse exists only to prove correctness — the proxy sends
 *  the compacted form; the model reads a clearly-labeled table.
 *
 *  Output shape (JSON, so it round-trips and every model parses it):
 *    { "_siidTable": { "cols": ["Id","Name","Industry"], "rows": [[...],[...]], "n": N } }
 *  A cell equal to the HOLE sentinel string means the key was ABSENT in that object (distinct from
 *  an explicit null) — expand() omits absent keys, restoring the exact original object. A genuine
 *  cell value that happens to equal the sentinel is ESCAPED on compact and unescaped on expand, so
 *  the sentinel can never be confused with real data (collision-safe, not just collision-unlikely).
 *
 *  SAFETY FALL-THROUGHS (return null = "leave the original untouched"):
 *    - not an array, or fewer than `minItems` (2) elements
 *    - any element is not a plain object (array/scalar/null) — mixed arrays are not compacted
 *    - the union of keys is too large relative to rows (uneven/sparse) — not tabular, skip
 *  These mirror SmartCrusher's "Untouched" decision: only compact when it clearly pays off and is
 *  clearly safe.
 *--------------------------------------------------------------------------------------------*/
'use strict';

const MARKER = '_siidTable';

// Absent-cell sentinel: a string value (reads far cleaner to the model than an object, and matches
// the ⟪siid-…⟫ marker convention used by blockDedup). A genuine cell equal to this — or to its
// escaped form — is escaped by prefixing an extra '⟪siid-lit:', and unescaped on expand. That makes
// the sentinel collision-SAFE, not merely collision-unlikely, so losslessness holds by construction.
const HOLE = '⟪siid-absent⟫';
const LIT_PREFIX = '⟪siid-lit:'; // wraps a real value that would otherwise be read as a control token

// A value that would be ambiguous with a control token if emitted raw: the HOLE itself, or any
// string already starting with LIT_PREFIX (which unescape would strip).
function needsEscape(v) {
	return typeof v === 'string' && (v === HOLE || v.startsWith(LIT_PREFIX));
}
function escapeCell(v) {
	return needsEscape(v) ? LIT_PREFIX + v : v;
}
function unescapeCell(v) {
	return typeof v === 'string' && v.startsWith(LIT_PREFIX) ? v.slice(LIT_PREFIX.length) : v;
}

/** A plain (non-array, non-null) object? */
function isPlainObject(v) {
	return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Decide whether an array is a good tabular candidate and, if so, produce the compacted form.
 * Returns the compacted object, or null to signal "do not touch the original".
 * @param {unknown} arr
 * @param {{ minItems?: number, minFill?: number, skipSizeGuard?: boolean }} [cfg]
 *        skipSizeGuard is for tests only — it proves losslessness on shapes too small to save.
 */
function compact(arr, cfg) {
	const minItems = (cfg && cfg.minItems) || 2;
	const minFill = (cfg && typeof cfg.minFill === 'number') ? cfg.minFill : 0.5;
	const skipSizeGuard = !!(cfg && cfg.skipSizeGuard);

	if (!Array.isArray(arr) || arr.length < minItems) {
		return null;
	}
	// Every element must be a plain object — we do not compact mixed/scalar arrays.
	for (const el of arr) {
		if (!isPlainObject(el)) {
			return null;
		}
	}

	// Schema = union of keys, ordered by descending frequency then first-seen (stable, so the
	// output is deterministic). We DON'T reorder within a row arbitrarily — cells map to `cols`.
	const freq = new Map();
	const firstSeen = new Map();
	let order = 0;
	for (const obj of arr) {
		for (const k of Object.keys(obj)) {
			freq.set(k, (freq.get(k) || 0) + 1);
			if (!firstSeen.has(k)) {
				firstSeen.set(k, order++);
			}
		}
	}
	const cols = [...freq.keys()].sort((a, b) => {
		const df = freq.get(b) - freq.get(a);
		return df !== 0 ? df : firstSeen.get(a) - firstSeen.get(b);
	});

	if (cols.length === 0) {
		return null; // array of empty objects — nothing to gain
	}
	// Sparsity guard: reject arrays whose objects don't share a common shape (each row brings
	// mostly-new keys), because those aren't really tabular and the table form wouldn't help.
	// We measure ACTUAL fill (cells present / total cells), not raw column count — a uniform
	// wide-but-short table (few rows, same keys) has high fill and must NOT be rejected.
	let presentCells = 0;
	for (const obj of arr) {
		presentCells += Object.keys(obj).length;
	}
	const fill = presentCells / (arr.length * cols.length); // 1.0 = every object has every key
	if (fill <= minFill && cols.length > 4) {
		return null; // sparse / non-tabular — the table form wouldn't help
	}

	// Build rows. Absent keys (present in some objects, missing here) are encoded with the reserved
	// HOLE sentinel so expand() can distinguish "key absent" from "key present but null" (JSON has no
	// `undefined`). A genuine value that collides with the sentinel is escaped so it stays distinct.
	const rows = arr.map((obj) =>
		cols.map((c) => (Object.prototype.hasOwnProperty.call(obj, c) ? escapeCell(obj[c]) : HOLE)),
	);

	const table = { [MARKER]: { cols, rows, n: arr.length } };

	// Definitive value guard: NEVER emit a compaction that isn't actually smaller than the
	// original. This makes the transform self-correcting — any heuristic miss above just means we
	// fall through to "untouched" instead of bloating the payload. (Tests skip it to prove that
	// losslessness holds regardless of size.)
	if (!skipSizeGuard && JSON.stringify(table).length >= JSON.stringify(arr).length) {
		return null;
	}
	return table;
}

/** True if `v` is a compacted table produced by compact(). */
function isCompacted(v) {
	return isPlainObject(v) && isPlainObject(v[MARKER]) && Array.isArray(v[MARKER].cols) && Array.isArray(v[MARKER].rows);
}

/** Absent-cell sentinel test (must match the HOLE encoding in compact()). */
function isHole(cell) {
	return cell === HOLE;
}

/**
 * Inverse of compact(): rebuild the exact original array of objects. Used to PROVE losslessness.
 * @param {any} table  A value produced by compact().
 * @returns {Array<object>}
 */
function expand(table) {
	if (!isCompacted(table)) {
		throw new Error('expand(): not a compacted table');
	}
	const { cols, rows } = table[MARKER];
	return rows.map((row) => {
		const obj = {};
		for (let i = 0; i < cols.length; i++) {
			const cell = row[i];
			if (isHole(cell)) {
				continue; // key was absent in the original object
			}
			obj[cols[i]] = unescapeCell(cell);
		}
		return obj;
	});
}

/**
 * Scan a STRING for embedded top-level JSON arrays and compact any that qualify, in place.
 *
 * SIID's tool output usually arrives as a string like `"Here are the records:\n[{...},{...}]"`,
 * so we can't just call compact() on the message — we must FIND the array inside the prose. This
 * scans for balanced `[...]` spans (respecting strings/escapes so brackets inside string values
 * don't fool it), tries `JSON.parse` on each, and if it parses to an array that compact() accepts,
 * replaces that exact span with the compacted JSON. Everything else in the string is untouched.
 *
 * Conservative by design: a span that doesn't cleanly parse, or doesn't compact to something
 * smaller, is left exactly as-is. Returns { text, arraysCompacted }.
 *
 * @param {string} text
 * @param {object} [cfg]  forwarded to compact()
 * @returns {{ text: string, arraysCompacted: number }}
 */
function compactArraysInText(text, cfg) {
	if (typeof text !== 'string' || text.indexOf('[') === -1) {
		return { text, arraysCompacted: 0 };
	}
	let out = '';
	let i = 0;
	let compactedCount = 0;
	const n = text.length;

	while (i < n) {
		const ch = text[i];
		if (ch !== '[') {
			out += ch;
			i++;
			continue;
		}
		// Found a '['; scan for the matching ']' with string/escape awareness.
		const end = findBalancedArrayEnd(text, i);
		if (end === -1) {
			out += ch;
			i++;
			continue;
		}
		const span = text.slice(i, end + 1);
		let parsed;
		try {
			parsed = JSON.parse(span);
		} catch {
			parsed = undefined;
		}
		if (Array.isArray(parsed)) {
			const table = compact(parsed, cfg);
			if (table !== null) {
				out += JSON.stringify(table);
				compactedCount++;
				i = end + 1;
				continue;
			}
		}
		// Not a compactable array — emit the '[' and continue scanning AFTER it (nested arrays
		// inside get their own chance).
		out += ch;
		i++;
	}
	return { text: out, arraysCompacted: compactedCount };
}

/**
 * Given text and the index of a '[', return the index of the matching ']' (respecting nested
 * brackets and JSON string literals), or -1 if unbalanced.
 * @param {string} s
 * @param {number} start  index of the opening '['
 */
function findBalancedArrayEnd(s, start) {
	let depth = 0;
	let inStr = false;
	for (let i = start; i < s.length; i++) {
		const c = s[i];
		if (inStr) {
			if (c === '\\') {
				i++; // skip escaped char
			} else if (c === '"') {
				inStr = false;
			}
			continue;
		}
		if (c === '"') {
			inStr = true;
		} else if (c === '[') {
			depth++;
		} else if (c === ']') {
			depth--;
			if (depth === 0) {
				return i;
			}
		}
	}
	return -1;
}

module.exports = { compact, expand, isCompacted, compactArraysInText, MARKER };

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { SfExecutor } from './sfExecutor';
import { runAnonymousApex } from './anonRunner';

/**
 * Headless Salesforce **formula evaluation** service (§14 — every feature is a
 * headless service the human UI, the AI agent, and the SDK all call).
 *
 * There is NO `sf` CLI command for evaluating a formula. The platform mechanism
 * is the standard Apex `FormulaEval` library (`Formula.builder()` →
 * `FormulaEval.FormulaInstance`): you build a formula instance for an SObject and
 * a return type, then `evaluate()` it against a record. We generate that tiny
 * Apex snippet and run it through Forge's existing anonymous-Apex runner
 * (`runAnonymousApex` → Tooling `executeAnonymous`), then read the result the
 * snippet `System.debug`s out. This reuses the ONE hardened CLI chokepoint
 * (`SfExecutor`) instead of the old standalone extension's hand-rolled
 * `spawn('sf apex run')` + temp file + stdout scraping.
 *
 * The service takes explicit args and returns structured data — no editor,
 * selection, or toast — so the agent/SDK can call it directly and the UI wrapper
 * (`features/formulaEval.ts`) just supplies args from context.
 */

/**
 * The formula return type, matching `FormulaEval.FormulaReturnType`. These are the
 * enum values the platform accepts for a formula's output type.
 */
export type FormulaReturnType =
  | 'STRING'
  | 'BOOLEAN'
  | 'INTEGER'
  | 'LONG'
  | 'DECIMAL'
  | 'DOUBLE'
  | 'DATE'
  | 'DATETIME'
  | 'TIME';

/** All supported return types, for pickers/validation. */
export const FORMULA_RETURN_TYPES: readonly FormulaReturnType[] = [
  'STRING', 'BOOLEAN', 'INTEGER', 'LONG', 'DECIMAL', 'DOUBLE', 'DATE', 'DATETIME', 'TIME'
] as const;

/** Inputs for a formula evaluation. */
export interface FormulaEvalOptions {
  /** The formula expression, in Apex-formula syntax (Flow `{!…}`/`$Record.` are stripped for you). */
  formula: string;
  /** The SObject API name the formula is defined against (e.g. `Account`). */
  objectName: string;
  /** The formula's return type. */
  returnType: FormulaReturnType;
  /**
   * A specific record Id to evaluate against. When omitted, the snippet queries
   * the first available record of the object that has the referenced fields.
   */
  recordId?: string;
  /** Target org alias/username; defaults to the project's default org. */
  targetOrg?: string;
}

/** Structured result of a formula evaluation. */
export interface FormulaEvalResult {
  success: boolean;
  /** The evaluated value (JSON-parsed when possible), when `success`. */
  value?: unknown;
  /** Field API names the formula referenced (from `getReferencedFields`). */
  referencedFields: string[];
  /** A non-fatal note (e.g. "no records found, syntax is valid but not evaluated"). */
  warning?: string;
  /** The failure reason when `!success`. */
  error?: string;
  /** Wall-clock duration of the evaluation. */
  executionTimeMs: number;
}

/**
 * Transforms a Flow-style formula into `FormulaEval` (Apex-formula) syntax:
 * strips the Flow merge-field wrapper `{!…}` and the `$Record.` trigger-record
 * prefix, so a formula copied straight from a Flow evaluates unchanged.
 */
export function transformFlowFormula(formula: string): string {
  return formula
    .replace(/\{!([^}]+)\}/g, '$1')   // {!Amount} → Amount
    .replace(/\$Record\./g, '');       // $Record.Amount → Amount
}

/** Sentinels the generated Apex uses so we can parse the result out of the log. */
const FIELDS_TAG = 'SIID_FORMULA_FIELDS:';
const RESULT_TAG = 'SIID_FORMULA_RESULT:';
const ERROR_TAG = 'SIID_FORMULA_ERROR:';
const WARN_TAG = 'SIID_FORMULA_WARN:';

/**
 * Max formula length we accept. The formula is sent inside the Tooling
 * `executeAnonymous` **GET** URL; a very long formula overflows the endpoint's
 * URI limit and returns HTTP 414 (verified live: ~12k-char formula works, ~18k
 * fails). Salesforce formulas themselves cap at 3,900 compiled / 5,000 source
 * chars, so this ceiling clears every legitimate formula with margin while
 * turning the opaque 414 into a clear, early error.
 */
export const MAX_FORMULA_LENGTH = 5000;

/** Escapes a formula so it can be embedded in an Apex single-quoted string literal. */
function escapeApexString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, ' ');
}

/** Tag for a per-record result line in a multi-record run: `<recordId>\t<json>`. */
const ROW_TAG = 'SIID_FORMULA_ROW:';

/** Common `Formula.builder()...build()` prelude shared by the single/multi snippets. */
function builderPrelude(opts: Pick<FormulaEvalOptions, 'formula' | 'objectName' | 'returnType'>): string {
  const formula = escapeApexString(transformFlowFormula(opts.formula));
  return `
    FormulaEval.FormulaInstance ff = Formula.builder()
        .withType(Schema.${opts.objectName}.class)
        .withReturnType(FormulaEval.FormulaReturnType.${opts.returnType})
        .withFormula('${formula}')
        .withGlobalVariables(new List<FormulaEval.FormulaGlobal>{
            FormulaEval.FormulaGlobal.LABEL, FormulaEval.FormulaGlobal.CUSTOM_METADATA,
            FormulaEval.FormulaGlobal.ORGANIZATION, FormulaEval.FormulaGlobal.PERMISSION,
            FormulaEval.FormulaGlobal.PROFILE, FormulaEval.FormulaGlobal.SETUP,
            FormulaEval.FormulaGlobal.SYSTEM, FormulaEval.FormulaGlobal.USER,
            FormulaEval.FormulaGlobal.USER_ROLE
        })
        .build();

    Set<String> referenced = ff.getReferencedFields();
    Set<String> fields = new Set<String>();
    for (String f : referenced) { if (!f.startsWith('$')) fields.add(f); }
    System.debug('${FIELDS_TAG} ' + JSON.serialize(new List<String>(referenced)));`;
}

/**
 * Builds an anon-Apex snippet that evaluates the formula against MANY records in a
 * SINGLE run (one CLI call regardless of N), emitting one `SIID_FORMULA_ROW:`
 * line per record as `<Id>\t<json>`. `recordIds` empty ⇒ the first `limit`
 * records of the object (varied data → real behavior coverage).
 */
function buildApexMulti(
  opts: Pick<FormulaEvalOptions, 'formula' | 'objectName' | 'returnType'>,
  recordIds: string[],
  limit: number
): string {
  // The IN-list Ids sit INSIDE the Apex string literal passed to Database.query,
  // so their quotes must be escaped for Apex (\\') — a raw ' would close the
  // literal and break compilation ("Expecting ')' but was '001'").
  const idList = recordIds.length
    ? recordIds.map((id) => `\\'${escapeApexString(id)}\\'`).join(', ')
    : '';
  const whereClause = idList ? ` WHERE Id IN (${idList})` : '';
  const soql =
    `'SELECT Id, ' + String.join(new List<String>(fields), ', ') + ' FROM ${opts.objectName}${whereClause} LIMIT ${limit}'`;

  return `
try {
${builderPrelude(opts)}

    if (fields.isEmpty()) {
        // No field references — one context-free evaluation.
        System.debug('${ROW_TAG} ' + '\\t' + JSON.serialize(ff.evaluate(null)));
    } else {
        List<SObject> recs = Database.query(${soql});
        if (recs.isEmpty()) { System.debug('${WARN_TAG} No ${opts.objectName} records found; formula compiles but was not evaluated.'); }
        for (SObject r : recs) {
            String v;
            try { v = JSON.serialize(ff.evaluate(r)); } catch (Exception ex) { v = '"ERR: ' + String.valueOf(ex.getMessage()).replace('"', '\\'') + '"'; }
            System.debug('${ROW_TAG} ' + String.valueOf(r.get('Id')) + '\\t' + v);
        }
    }
} catch (Exception e) {
    System.debug('${ERROR_TAG} ' + e.getMessage());
}
`.trim();
}

/**
 * Builds the anonymous-Apex snippet that evaluates the formula and `System.debug`s
 * a tagged result line the caller can parse back out of the execution response.
 */
function buildApex(opts: FormulaEvalOptions): string {
  const formula = escapeApexString(transformFlowFormula(opts.formula));
  const schemaType = `Schema.${opts.objectName}.class`;
  const returnTypeEnum = `FormulaEval.FormulaReturnType.${opts.returnType}`;

  // Evaluate against a specific record id, or the first record carrying the fields.
  const evalBlock = opts.recordId
    ? `
    List<SObject> recs = Database.query('SELECT Id, ' + String.join(new List<String>(fields), ', ') + ' FROM ${opts.objectName} WHERE Id = \\'${escapeApexString(opts.recordId)}\\' LIMIT 1');
    if (recs.isEmpty()) { System.debug('${ERROR_TAG} Record not found: ${escapeApexString(opts.recordId)}'); }
    else { System.debug('${RESULT_TAG} ' + JSON.serialize(ff.evaluate(recs[0]))); }`
    : `
    if (fields.isEmpty()) {
        System.debug('${RESULT_TAG} ' + JSON.serialize(ff.evaluate(null)));
    } else {
        List<SObject> recs = Database.query('SELECT Id, ' + String.join(new List<String>(fields), ', ') + ' FROM ${opts.objectName} LIMIT 1');
        if (recs.isEmpty()) { System.debug('${WARN_TAG} No ${opts.objectName} records found; formula compiles but was not evaluated.'); }
        else { System.debug('${RESULT_TAG} ' + JSON.serialize(ff.evaluate(recs[0]))); }
    }`;

  return `
try {
    FormulaEval.FormulaInstance ff = Formula.builder()
        .withType(${schemaType})
        .withReturnType(${returnTypeEnum})
        .withFormula('${formula}')
        .withGlobalVariables(new List<FormulaEval.FormulaGlobal>{
            FormulaEval.FormulaGlobal.LABEL, FormulaEval.FormulaGlobal.CUSTOM_METADATA,
            FormulaEval.FormulaGlobal.ORGANIZATION, FormulaEval.FormulaGlobal.PERMISSION,
            FormulaEval.FormulaGlobal.PROFILE, FormulaEval.FormulaGlobal.SETUP,
            FormulaEval.FormulaGlobal.SYSTEM, FormulaEval.FormulaGlobal.USER,
            FormulaEval.FormulaGlobal.USER_ROLE
        })
        .build();

    Set<String> referenced = ff.getReferencedFields();
    Set<String> fields = new Set<String>();
    for (String f : referenced) { if (!f.startsWith('$')) fields.add(f); }
    System.debug('${FIELDS_TAG} ' + JSON.serialize(new List<String>(referenced)));
${evalBlock}
} catch (Exception e) {
    System.debug('${ERROR_TAG} ' + e.getMessage());
}
`.trim();
}

/**
 * A tagged line's value can be JSON (result/fields) or plain text (error/warn).
 * The Tooling `executeAnonymous` response does NOT carry `System.debug` output,
 * so we get the debug lines from the FINEST log body when available; when it is
 * not, we still surface compile/exception problems from the anon result.
 */
function parseTag(logText: string, tag: string): string | undefined {
  // Match ONLY real debug output, e.g. `…|USER_DEBUG|[N]|DEBUG|SIID_FORMULA_RESULT: …`.
  // The log ALSO echoes our Apex source (the `Execute Anonymous:` block), which
  // contains every tag as literal text — a naive `indexOf(tag)` would match that
  // echo (`System.debug('SIID_FORMULA_ERROR: ' + e.getMessage());`) and report
  // source code as the result. Requiring the `|USER_DEBUG|…|DEBUG|` prefix skips
  // the echo and keeps only what the code actually printed.
  for (const line of logText.split('\n')) {
    const m = line.match(/\|USER_DEBUG\|[^|]*\|DEBUG\|(.*)$/);
    if (m && m[1].startsWith(tag)) {
      return m[1].slice(tag.length).trim();
    }
  }
  return undefined;
}

function jsonOrRaw(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * Evaluates a Salesforce formula against an org and returns the structured result.
 *
 * Headless + agent/SDK-consumable: takes explicit args, no UI. The caller passes
 * a `getLog` that returns the FINEST debug-log text for the run (the UI wraps
 * `saveApexLogs`); when omitted, only compile/exception failures are surfaced.
 */
export async function evaluateFormula(
  sf: SfExecutor,
  projectRoot: string,
  opts: FormulaEvalOptions,
  getLog: (runStart: Date) => Promise<string | undefined>,
  token?: vscode.CancellationToken
): Promise<FormulaEvalResult> {
  const started = Date.now();
  const fail = (error: string): FormulaEvalResult => ({
    success: false, error, referencedFields: [], executionTimeMs: Date.now() - started
  });

  if (!opts.formula?.trim()) {
    return fail('Formula is empty.');
  }
  if (opts.formula.length > MAX_FORMULA_LENGTH) {
    return fail(`Formula is too long (${opts.formula.length} chars; max ${MAX_FORMULA_LENGTH}).`);
  }
  if (!opts.objectName?.trim()) {
    return fail('Object name is required.');
  }

  const apex = buildApex(opts);
  const runStart = new Date();

  const run = await runAnonymousApex(sf, projectRoot, apex, token);
  if (run.compiled === false) {
    return fail(`Apex did not compile: ${run.compileProblem ?? 'unknown error'}`);
  }

  // Pull the debug lines from the FINEST log the run produced.
  const logText = (await getLog(runStart)) ?? '';

  const errorLine = parseTag(logText, ERROR_TAG);
  if (errorLine) {
    return fail(errorLine);
  }
  // A runtime exception thrown outside our try/catch (rare) still surfaces here.
  if (run.success === false && run.exceptionMessage) {
    return fail(run.exceptionMessage);
  }

  const fieldsLine = parseTag(logText, FIELDS_TAG);
  const referencedFields = fieldsLine
    ? (Array.isArray(jsonOrRaw(fieldsLine)) ? (jsonOrRaw(fieldsLine) as string[]) : [])
    : [];

  const warnLine = parseTag(logText, WARN_TAG);
  if (warnLine) {
    return {
      success: true, warning: warnLine, referencedFields, executionTimeMs: Date.now() - started
    };
  }

  const resultLine = parseTag(logText, RESULT_TAG);
  if (resultLine === undefined) {
    // No tag found — either the log wasn't captured (trace not FINEST) or the run
    // failed silently. Report what we know.
    return fail(
      run.success
        ? 'Formula ran but no result was captured (is the FINEST debug trace active?).'
        : (run.exceptionMessage ?? 'Formula evaluation produced no result.')
    );
  }

  return {
    success: true,
    value: jsonOrRaw(resultLine),
    referencedFields,
    executionTimeMs: Date.now() - started
  };
}

/** Returns EVERY `USER_DEBUG` line's payload that starts with `tag` (for multi-row runs). */
function parseTags(logText: string, tag: string): string[] {
  const out: string[] = [];
  for (const line of logText.split('\n')) {
    const m = line.match(/\|USER_DEBUG\|[^|]*\|DEBUG\|(.*)$/);
    if (m && m[1].startsWith(tag)) {
      out.push(m[1].slice(tag.length).trim());
    }
  }
  return out;
}

/** One record's outcome in a multi-record evaluation. */
export interface FormulaRowResult {
  recordId?: string;
  /** The evaluated value (JSON-parsed), or a per-record error string. */
  value?: unknown;
  /** Set when this specific record's evaluation threw. */
  error?: string;
}

/** Result of evaluating a formula against several records in one run. */
export interface FormulaMultiResult {
  success: boolean;
  rows: FormulaRowResult[];
  referencedFields: string[];
  warning?: string;
  error?: string;
  /** How many records were actually evaluated (after the safety cap). */
  evaluated?: number;
  /** Set when the request exceeded `MAX_EVAL_RECORDS` and was truncated. */
  truncated?: boolean;
  executionTimeMs: number;
}

/**
 * Hard ceiling on how many records one "evaluate all" run touches. All records
 * are evaluated inside a SINGLE Apex transaction, so this protects org governor
 * limits (SOQL rows, CPU time) in large orgs — enforced in the CORE so it also
 * caps SDK/agent callers, not just the panel. The picker samples fewer than this.
 */
export const MAX_EVAL_RECORDS = 50;

/**
 * Evaluates a formula against MANY records in a single anon-Apex run (one CLI
 * call). Pass explicit `recordIds`, or leave empty to use the first `limit`
 * records of the object. Returns a per-record result table — the way to see a
 * formula's behavior across varied data (blank vs. populated fields, etc.),
 * which a single-record check misses. Headless + SDK/agent-consumable.
 */
export async function evaluateFormulaMulti(
  sf: SfExecutor,
  projectRoot: string,
  opts: Pick<FormulaEvalOptions, 'formula' | 'objectName' | 'returnType'>,
  recordIds: string[],
  getLog: (runStart: Date) => Promise<string | undefined>,
  limit = 5,
  token?: vscode.CancellationToken
): Promise<FormulaMultiResult> {
  const started = Date.now();
  const fail = (error: string): FormulaMultiResult => ({
    success: false, error, rows: [], referencedFields: [], executionTimeMs: Date.now() - started
  });

  if (!opts.formula?.trim()) {
    return fail('Formula is empty.');
  }
  if (opts.formula.length > MAX_FORMULA_LENGTH) {
    return fail(`Formula is too long (${opts.formula.length} chars; max ${MAX_FORMULA_LENGTH}).`);
  }
  if (!opts.objectName?.trim()) {
    return fail('Object name is required.');
  }

  // Enforce the hard cap HERE (core), so SDK/agent callers can't exceed it either.
  // All records evaluate in one Apex transaction, so an unbounded list risks org
  // governor limits in a large org.
  const truncated = recordIds.length > MAX_EVAL_RECORDS || limit > MAX_EVAL_RECORDS;
  const cappedIds = recordIds.slice(0, MAX_EVAL_RECORDS);
  const cappedLimit = Math.min(Math.max(limit, cappedIds.length || 1), MAX_EVAL_RECORDS);

  const apex = buildApexMulti(opts, cappedIds, cappedLimit);
  const run = await runAnonymousApex(sf, projectRoot, apex, token);
  if (run.compiled === false) {
    return fail(`Apex did not compile: ${run.compileProblem ?? 'unknown error'}`);
  }

  const logText = (await getLog(new Date())) ?? '';

  const errorLine = parseTag(logText, ERROR_TAG);
  if (errorLine) {
    return fail(errorLine);
  }

  const fieldsLine = parseTag(logText, FIELDS_TAG);
  const referencedFields = fieldsLine && Array.isArray(jsonOrRaw(fieldsLine))
    ? (jsonOrRaw(fieldsLine) as string[]) : [];

  const warnLine = parseTag(logText, WARN_TAG);
  const rowLines = parseTags(logText, ROW_TAG);
  if (!rowLines.length) {
    if (warnLine) {
      return { success: true, warning: warnLine, rows: [], referencedFields, executionTimeMs: Date.now() - started };
    }
    return fail(
      run.success
        ? 'Formula ran but no results were captured (is the FINEST debug trace active?).'
        : (run.exceptionMessage ?? 'Formula evaluation produced no result.')
    );
  }

  const rows: FormulaRowResult[] = rowLines.map((line) => {
    const tab = line.indexOf('\t');
    const id = tab >= 0 ? line.slice(0, tab).trim() : undefined;
    const json = tab >= 0 ? line.slice(tab + 1) : line;
    const parsed = jsonOrRaw(json);
    // A per-record failure was serialized as "ERR: <msg>".
    if (typeof parsed === 'string' && parsed.startsWith('ERR: ')) {
      return { recordId: id || undefined, error: parsed.slice(5) };
    }
    return { recordId: id || undefined, value: parsed };
  });

  return {
    success: true,
    rows,
    referencedFields,
    warning: warnLine,
    evaluated: rows.length,
    truncated,
    executionTimeMs: Date.now() - started
  };
}

/** A sample record for the record picker: its Id plus a human label. */
export interface SampleRecord {
  id: string;
  /** A readable label (Name if the object has one, else the Id). */
  label: string;
}

/**
 * Fetches a few records of an object so the caller can pick one to evaluate a
 * formula against (instead of hand-typing a record Id). Headless + SDK/agent-
 * consumable. Uses `Name` for the label when the object has it, falling back to
 * the Id — so it works for objects without a Name field too.
 */
export async function fetchSampleRecords(
  sf: SfExecutor,
  projectRoot: string,
  objectName: string,
  limit = 20,
  targetOrg?: string,
  token?: vscode.CancellationToken
): Promise<SampleRecord[]> {
  const obj = objectName.trim();
  if (!obj) {
    return [];
  }
  const args = (soql: string): string[] => {
    const a = ['data', 'query', '--query', soql];
    if (targetOrg) {
      a.push('--target-org', targetOrg);
    }
    return a;
  };
  const run = async (soql: string): Promise<Array<Record<string, any>>> => {
    const { result } = await sf.run<{ records?: Array<Record<string, any>> }>(args(soql), { cwd: projectRoot, token });
    return result?.records ?? [];
  };

  // Prefer Name (+ recency ordering). If that query is rejected because the object
  // lacks Name/LastModifiedDate (a schema difference, NOT an outage), retry Id-only.
  // Any OTHER failure — bad object name, auth, transient CLI error — is a real error
  // and PROPAGATES, so the caller can say "couldn't load" instead of the misleading
  // "no records found" (which must mean a genuinely empty object).
  let records: Array<Record<string, any>>;
  try {
    records = await run(`SELECT Id, Name FROM ${obj} ORDER BY LastModifiedDate DESC LIMIT ${limit}`);
  } catch (e: any) {
    if (!isMissingFieldError(e)) {
      throw e;
    }
    records = await run(`SELECT Id FROM ${obj} LIMIT ${limit}`);
  }
  return records
    .filter((r) => r?.Id)
    .map((r) => ({ id: String(r.Id), label: r.Name ? `${r.Name}` : String(r.Id) }));
}

/** True when a SOQL error is "no such field" (e.g. object without Name/LastModifiedDate). */
function isMissingFieldError(e: any): boolean {
  const msg = String(e?.message ?? e ?? '');
  return /INVALID_FIELD|No such column|INVALID_TYPE|Didn't understand relationship/i.test(msg);
}

/**
 * Validates a formula's syntax and returns its referenced fields WITHOUT
 * evaluating it against a record. Convenience wrapper over `evaluateFormula`
 * (a compile/build failure ⇒ invalid; success ⇒ valid, even if no record exists).
 */
export async function validateFormula(
  sf: SfExecutor,
  projectRoot: string,
  opts: Omit<FormulaEvalOptions, 'recordId'>,
  getLog: (runStart: Date) => Promise<string | undefined>,
  token?: vscode.CancellationToken
): Promise<{ isValid: boolean; referencedFields: string[]; error?: string }> {
  const r = await evaluateFormula(sf, projectRoot, opts, getLog, token);
  return { isValid: r.success, referencedFields: r.referencedFields, error: r.error };
}

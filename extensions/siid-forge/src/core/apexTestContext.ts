/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { SfExecutor } from './sfExecutor';
import { SchemaManager, ApexSchema, ObjectSchema, ObjectField } from './schemaManager';
import { parseApexLog } from './replay/logParser';
import { analyzeApexTestNeeds } from './apexTestPatterns';

/**
 * Apex test CONTEXT collector (plan §18.X) — the load-bearing input to the AI
 * generator (§18.C/E). Combines two layers we already produce:
 *  - `findDependencies` = the "what is referenced" pass (classified hits), and
 *  - the persisted schema cache = the "what does it look like" pass (O(1) reads).
 * Plus org-side Flows (Tooling API) and, post-failure, the parsed test log.
 *
 * Headless + agent-consumable (§14): all inputs are explicit; returns a plain
 * data object. The prompt builder (§18.C) and the fix loop (§18.E) both read it.
 */

/** A related Apex class the test may need to construct/stub — public surface only. */
export interface RelatedClass {
  name: string;
  filePath?: string;
  /** Public/global method + constructor signatures (compact, no bodies). */
  signatures: string[];
}

/** A required/relevant field on a touched SObject the `@TestSetup` must satisfy. */
export interface RelevantField {
  name: string;
  type?: string;
  required?: boolean;
  referenceTo?: string[];
  picklistValues?: string[];
}

/** A touched SObject + the fields a factory must set. */
export interface TouchedObject {
  name: string;
  label?: string;
  custom?: boolean;
  /**
   * How the object is created in a test:
   *  - 'sobject'        — normal DML insert (set required fields);
   *  - 'customMetadata' — `__mdt`: NOT insertable in a test (deployed via
   *    Metadata API). Tests must mock the query or rely on existing rows;
   *  - 'platformEvent'  — `__e`: published via EventBus.publish, not inserted.
   */
  kind: 'sobject' | 'customMetadata' | 'platformEvent';
  /** Required fields first, then referenced ones. */
  fields: RelevantField[];
}

/** An active Flow that fires on one of the touched objects. */
export interface RelatedFlow {
  label: string;
  apiName?: string;
  /** e.g. "RecordBeforeSave", "RecordAfterSave", "Autolaunched". */
  processType?: string;
  triggerType?: string;
  /** The SObject the record-triggered flow runs on. */
  triggerObject?: string;
}

/** The static context needed to WRITE a compiling, passing test. */
export interface ApexStaticContext {
  className: string;
  classFilePath?: string;
  relatedClasses: RelatedClass[];
  objects: TouchedObject[];
  flows: RelatedFlow[];
  /** Trigger files that fire on the touched objects. */
  triggers: string[];
}

/** A compact, high-signal view of a failing test's log, fed into the fix loop. */
export interface FailureContext {
  /** The exception line(s) / assertion messages found in the log. */
  exception?: string;
  /** Call stack, outermost first (from METHOD_ENTRY frames at the failure). */
  stack: string[];
  /** Nearby FLOW_/DML/SOQL/limit events that explain the failure. */
  events: string[];
  /** The user source line the failure occurred on, if resolvable. */
  failingLine?: number;
}

/** Everything the collector returns. Runtime `failure` is filled only on retry. */
export interface ApexTestContext {
  static: ApexStaticContext;
  failure?: FailureContext;
}

/** Apex primitive / built-in types that are never project classes or SObjects. */
const BUILTIN_TYPES = new Set([
  'void', 'boolean', 'integer', 'long', 'double', 'decimal', 'string', 'id',
  'date', 'datetime', 'time', 'blob', 'object', 'sobject', 'list', 'set', 'map',
  'exception', 'type'
]);

/**
 * Collects the STATIC context for `className`. Reads the class from the schema
 * cache (falls back to a describe/parse on miss), walks its references, and
 * resolves each against the cache to pull related-class signatures + object
 * field schemas; then queries active Flows on the touched objects.
 */
export async function collectApexTestContext(
  sf: SfExecutor,
  schema: SchemaManager,
  projectRoot: string,
  className: string,
  token?: vscode.CancellationToken
): Promise<ApexStaticContext> {
  const cls = schema.readApex(projectRoot, className);
  const classFilePath = cls?.filePath ?? findClassFile(projectRoot, className);
  const source = classFilePath ? safeRead(classFilePath) : '';

  // 1. What does the class reference? `findDependencies` searches for one NAME;
  // here we want everything the class BODY references, so scan the source for
  // candidate type names + SOQL objects. (findDependencies stays the primitive
  // for the reverse direction — "who references X" — used elsewhere.)
  const referencedNames = collectReferencedNames(source);

  // 2. Resolve names against the cache indexes.
  const localClasses = new Set(schema.apexClassNames(projectRoot));
  const localObjects = new Set(schema.listObjects(projectRoot).map((o) => o.toLowerCase()));

  const relatedClasses: RelatedClass[] = [];
  const objectNames: string[] = [];

  for (const name of referencedNames) {
    if (name === className || BUILTIN_TYPES.has(name.toLowerCase())) {
      continue;
    }
    if (localClasses.has(name)) {
      const rc = schema.readApex(projectRoot, name);
      if (rc) {
        relatedClasses.push({ name, filePath: rc.filePath, signatures: publicSignatures(rc) });
      }
    } else if (localObjects.has(name.toLowerCase()) || /__c$|__mdt$|__e$/i.test(name)) {
      objectNames.push(name);
    }
  }

  // Also pull SObjects named in SOQL FROM clauses (the reference finder classifies
  // these as soql-from when we search for each, but scanning the source is enough).
  for (const obj of collectSoqlObjects(source)) {
    if (!objectNames.some((o) => o.toLowerCase() === obj.toLowerCase())) {
      objectNames.push(obj);
    }
  }

  // 3. Object field schemas (required fields the factory must set). Only accept
  //    names that (a) are already a known org object, or (b) are a custom
  //    object/mdt/event by suffix — this rejects prose junk ("the", "browser")
  //    that a loose SOQL/type scan can pick up.
  const objects: TouchedObject[] = [];
  for (const name of objectNames) {
    if (token?.isCancellationRequested) {
      break;
    }
    const known = localObjects.has(name.toLowerCase());
    const looksCustom = /__(c|mdt|e)$/i.test(name);
    if (!known && !looksCustom) {
      continue; // not a real object — skip (don't even describe it)
    }
    let obj = schema.readObject(projectRoot, name);
    // A cached entry with no fields is a stub (indexed but never described) —
    // treat it as a miss and describe on demand.
    if (!obj || !(obj.fields?.length)) {
      try {
        await schema.describeObject(projectRoot, name, token);
        obj = schema.readObject(projectRoot, name) ?? obj;
      } catch {
        /* org unavailable — keep whatever we had */
      }
    }
    // Only include objects that actually resolved to real fields — a phantom
    // name that describe couldn't find contributes nothing but noise.
    if (obj && obj.fields?.length) {
      objects.push(toTouchedObject(obj));
    }
  }

  // 4. Active Flows on the touched objects (Tooling API).
  const flows = objects.length ? await queryActiveFlows(sf, projectRoot, objects.map((o) => o.name), token) : [];

  // 5. Triggers on the touched objects (local).
  const triggers = findTriggersFor(projectRoot, objects.map((o) => o.name));

  return { className, classFilePath, relatedClasses, objects, flows, triggers };
}

/**
 * Parses a saved test log into a compact failure view (§18.X runtime). Call this
 * on retry with the `.siid/logs/*.log` produced by the failing debug run.
 */
export function collectFailureContext(logPath: string): FailureContext | undefined {
  const raw = safeRead(logPath);
  if (!raw) {
    return undefined;
  }
  const steps = parseApexLog(raw);
  if (!steps.length) {
    return undefined;
  }

  // Find the step whose debug event carries an exception, else the last step.
  const exStepIdx = lastIndexWhere(steps, (s) => !!s.debug && /exception|FATAL_ERROR|System\.\w+Exception/i.test(s.debug));
  const failStep = exStepIdx >= 0 ? steps[exStepIdx] : steps[steps.length - 1];

  const stack = (failStep.frames ?? [])
    .filter((f) => !f.external)
    .map((f) => `${f.name}${f.line ? `:${f.line}` : ''}`);

  // Nearby high-signal events: exceptions, DML, SOQL, flow, limits — from a
  // window around the failure step.
  const from = Math.max(0, (exStepIdx >= 0 ? exStepIdx : steps.length - 1) - 12);
  const to = Math.min(steps.length, from + 24);
  const events = steps
    .slice(from, to)
    .map((s) => s.debug)
    .filter((d): d is string => !!d && /exception|FATAL_ERROR|DML|SOQL|FLOW_|LIMIT|REQUIRED_FIELD|INSUFFICIENT_ACCESS|assert/i.test(d));

  return {
    exception: failStep.debug,
    stack,
    events: [...new Set(events)],
    failingLine: failStep.line
  };
}

/* ----------------------------- prompt (18.C) ---------------------------- */

export interface ApexTestPrompt {
  /** Test class name, e.g. `AccountServiceTest`. */
  testName: string;
  /** The assembled prompt text for the LLM. */
  text: string;
}

/**
 * Builds the LLM prompt to write a real, passing Apex test class (plan §18.C).
 * Mirrors `buildLwcTestPrompt`: a TASK-TYPE banner, the deterministic static
 * context (class + related signatures + object required-fields + flows/triggers),
 * the detected patterns (§18.D), and rigid rules learned from real Apex failures.
 * Pass `failure` (from `collectFailureContext`) on a retry to steer the fix.
 */
export function buildApexTestPrompt(
  ctx: ApexStaticContext,
  coverageTarget = 75,
  failure?: FailureContext
): ApexTestPrompt {
  const source = ctx.classFilePath ? safeRead(ctx.classFilePath) : '';
  // Only insertable SObjects drive the "@TestSetup required fields" guidance —
  // __mdt/__e can't be inserted (see SPECIAL OBJECTS below).
  const needs = analyzeApexTestNeeds(source, ctx.objects.filter((o) => o.kind === 'sobject').map((o) => o.name));
  const testName = `${ctx.className}Test`;

  const lines: string[] = [];
  lines.push(`TASK TYPE: write an Apex UNIT TEST class for an EXISTING Apex class. This is NOT class creation and NOT a deploy request.`);
  lines.push(`- Do NOT modify \`${ctx.className}\` or any other production class — the ONLY file you write is \`${testName}.cls\`.`);
  lines.push(`- Do NOT change data model, permissions, or flows.`);
  lines.push('');
  lines.push(`Write meaningful, PASSING tests for \`${ctx.className}\`, targeting >= ${coverageTarget}% code coverage of that class with EVERY test passing.`);
  lines.push('');

  // --- Class under test ----------------------------------------------------
  if (ctx.classFilePath) {
    lines.push(`CLASS UNDER TEST — read it in full: \`${ctx.classFilePath}\``);
  }
  if (source) {
    lines.push('```apex');
    lines.push(source.length > 6000 ? source.slice(0, 6000) + '\n// … (truncated — read the file for the rest)' : source);
    lines.push('```');
  }
  lines.push('');

  // --- Related classes -----------------------------------------------------
  if (ctx.relatedClasses.length) {
    lines.push(`RELATED CLASSES it uses (construct/stub as needed — public surface only):`);
    for (const rc of ctx.relatedClasses) {
      lines.push(`- ${rc.name}: ${rc.signatures.slice(0, 12).join('; ') || '(no public methods)'}`);
    }
    lines.push('');
  }

  // --- SObjects + required fields ------------------------------------------
  const insertable = ctx.objects.filter((o) => o.kind === 'sobject');
  const special = ctx.objects.filter((o) => o.kind !== 'sobject');
  if (insertable.length) {
    lines.push(`SOBJECTS it touches — your @TestSetup MUST set every REQUIRED field (use ONLY the field names listed; do NOT invent fields):`);
    for (const o of insertable) {
      const req = o.fields.filter((f) => f.required).map((f) => fieldNote(f));
      const refs = o.fields.filter((f) => !f.required && f.referenceTo?.length).map((f) => `${f.name}->${f.referenceTo!.join('/')}`);
      lines.push(`- ${o.name}${o.label ? ` (${o.label})` : ''}:`);
      lines.push(`    required: ${req.length ? req.join(', ') : '(none beyond system)'}`);
      if (refs.length) {
        lines.push(`    lookups: ${refs.slice(0, 12).join(', ')}`);
      }
    }
    lines.push('');
  }
  if (special.length) {
    lines.push(`SPECIAL OBJECTS — these CANNOT be created with plain \`insert\` in a test:`);
    for (const o of special) {
      if (o.kind === 'customMetadata') {
        lines.push(`- ${o.name} (Custom Metadata Type / __mdt): NOT insertable — CMT rows are deployed via the Metadata API, not DML. Do NOT \`insert\` it and do NOT invent fields. In the test, either rely on existing org rows for it, or refactor is out of scope — instead assert the code path that handles an EMPTY result (the SOQL returns no rows in a test). If the class must see rows, note that CMT test data needs Test.loadData or is queried live.`);
      } else {
        lines.push(`- ${o.name} (Platform Event / __e): publish with EventBus.publish(new ${o.name}(...)) inside Test.startTest()/stopTest(); do NOT \`insert\` it.`);
      }
    }
    lines.push('');
  }

  // --- Flows + triggers (side effects) -------------------------------------
  if (ctx.flows.length) {
    lines.push(`ACTIVE FLOWS on those objects — they fire on DML and may add validation / required fields / extra records. Account for their side effects:`);
    for (const f of ctx.flows) {
      lines.push(`- "${f.label}"${f.triggerObject ? ` on ${f.triggerObject}` : ''}${f.processType ? ` [${f.processType}${f.triggerType ? `/${f.triggerType}` : ''}]` : ''}`);
    }
    lines.push('');
  }
  if (ctx.triggers.length) {
    lines.push(`TRIGGERS that fire on those objects: ${ctx.triggers.join(', ')} — expect their side effects in your assertions.`);
    lines.push('');
  }

  // --- Patterns (18.D) -----------------------------------------------------
  lines.push(`REQUIRED TEST PATTERNS (detected for this class):`);
  for (const p of needs.patterns) {
    lines.push(`- ${p.title}: ${p.guidance}`);
  }
  lines.push('');

  // --- Rigid rules ---------------------------------------------------------
  lines.push(`RULES (learned from real Apex test failures — follow exactly):`);
  lines.push(`1. Create ALL data in @TestSetup / the test; set every required field (see above). Never hard-code Ids; never seeAllData=true.`);
  lines.push(`2. Wrap the exercised code in Test.startTest()/Test.stopTest().`);
  lines.push(`3. Assert real behaviour with Assert.* (areEqual/isTrue/isNotNull) — not just that it ran. Query the records the class changed and assert their state.`);
  lines.push(`4. Cover positive, negative (exception), and — for triggers/handlers — BULK (200 records) paths.`);
  lines.push(`5. Callouts MUST use Test.setMock; async work must run inside start/stopTest.`);
  lines.push(`6. Reference the class's inner types as \`${ctx.className}.<Inner>\`.`);
  lines.push(`7. Final step: the class must compile and ALL tests must pass, reaching >= ${coverageTarget}% coverage of \`${ctx.className}\`.`);

  // --- Failure feedback (retry only) ---------------------------------------
  if (failure) {
    lines.push('');
    lines.push(`PREVIOUS ATTEMPT FAILED — fix it. From the debug log:`);
    if (failure.exception) {
      lines.push(`- Exception: ${failure.exception}`);
    }
    if (failure.failingLine != null) {
      lines.push(`- Failing line: ${failure.failingLine}`);
    }
    if (failure.stack.length) {
      lines.push(`- Stack: ${failure.stack.join(' -> ')}`);
    }
    if (failure.events.length) {
      lines.push(`- Relevant events: ${failure.events.slice(0, 8).join(' | ')}`);
    }
    lines.push(`Diagnose the root cause (often a missing required field, an unmocked callout, or a flow/trigger side effect) and correct the test.`);
  }

  return { testName, text: lines.join('\n') };
}

/** A compact "Name (Type[, picklist])" note for a required field. */
function fieldNote(f: RelevantField): string {
  const bits = [f.name];
  if (f.type) {
    bits.push(`:${f.type}`);
  }
  if (f.picklistValues?.length) {
    bits.push(`{${f.picklistValues.slice(0, 5).join('|')}}`);
  }
  if (f.referenceTo?.length) {
    bits.push(`->${f.referenceTo.join('/')}`);
  }
  return bits.join('');
}

/* --------------------------- static helpers ----------------------------- */

/** Public/global method + constructor signatures of a class (compact). */
function publicSignatures(cls: ApexSchema): string[] {
  return cls.members
    .filter((m) => m.kind === 'method' && (m.modifiers ?? []).some((x) => /^(public|global)$/i.test(x)))
    .map((m) => m.signature ?? renderSignature(cls.name, m.name, m));
}

function renderSignature(className: string, methodName: string, m: { returnType?: string; params?: { type: string; name: string }[] }): string {
  const params = (m.params ?? []).map((p) => `${p.type} ${p.name}`).join(', ');
  const ret = m.returnType && methodName !== className ? `${m.returnType} ` : '';
  return `${ret}${methodName}(${params})`;
}

/** Cap on fields listed per object — keeps the prompt focused (Profile/User have
 *  hundreds of non-nillable permission booleans that must NOT be set manually). */
const MAX_FIELDS_PER_OBJECT = 20;

function toTouchedObject(obj: ObjectSchema): TouchedObject {
  const relevant = (obj.fields ?? [])
    .filter((f) => f.required || (f.referenceTo && f.referenceTo.length) || (f.picklistValues && f.picklistValues.length))
    .filter((f) => !isNoiseRequiredField(f))
    .map(toRelevantField)
    // Required first, then references, then picklists.
    .sort((a, b) => rank(a) - rank(b));
  // Keep required fields (the ones a factory MUST satisfy) even past the cap;
  // truncate only the non-required extras.
  const required = relevant.filter((f) => f.required);
  const extras = relevant.filter((f) => !f.required).slice(0, Math.max(0, MAX_FIELDS_PER_OBJECT - required.length));
  return { name: obj.name, label: obj.label, custom: obj.custom, kind: objectKind(obj.name), fields: [...required, ...extras] };
}

/**
 * Standard objects (Profile/User/…) mark hundreds of boolean permission/preference
 * fields as non-nillable "required", but they all have platform defaults and must
 * NOT be set by a test. Drop that deluge so the real required fields stand out.
 */
function isNoiseRequiredField(f: ObjectField): boolean {
  if (!f.required) {
    return false;
  }
  if ((f.type ?? '').toLowerCase() === 'boolean') {
    return true; // required booleans always default; setting them is noise
  }
  return /^(Permissions|UserPreferences|UserPermissions)/.test(f.name);
}

/** Classifies an object by its API-name suffix. */
function objectKind(name: string): TouchedObject['kind'] {
  if (/__mdt$/i.test(name)) {
    return 'customMetadata';
  }
  if (/__e$/i.test(name)) {
    return 'platformEvent';
  }
  return 'sobject';
}

function rank(f: RelevantField): number {
  if (f.required) {
    return 0;
  }
  if (f.referenceTo?.length) {
    return 1;
  }
  return 2;
}

function toRelevantField(f: ObjectField): RelevantField {
  return { name: f.name, type: f.type, required: f.required, referenceTo: f.referenceTo, picklistValues: f.picklistValues };
}

/**
 * Collects candidate referenced type names from Apex source: `new X(`, `X.method`,
 * `X var`, `(X)`, generics `<X>`. Heuristic — resolution against the cache filters
 * out non-project names. Comments/strings are ignored crudely (line-level).
 */
function collectReferencedNames(src: string): string[] {
  const names = new Set<string>();
  const code = stripApex(src);

  const patterns = [
    /\bnew\s+([A-Z]\w*)/g,        // constructor
    /\b([A-Z]\w*)\s*\.\s*\w/g,    // static access X.member
    /\b([A-Z]\w*)\s+[a-z_]\w*\s*[=;,)]/g, // typed local/field: X foo;
    /[<(]\s*([A-Z]\w*)\s*[>)]/g   // generic / cast
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(code)) !== null) {
      names.add(m[1]);
    }
  }
  return [...names];
}

/**
 * SObject API names in SOQL `FROM` clauses. Only scans inside inline SOQL
 * (`[ SELECT … FROM X ]`) — a bare `from` in prose/comments ("read it from the
 * client") would otherwise be mistaken for a query. Strips comments/strings first.
 */
function collectSoqlObjects(src: string): string[] {
  const code = stripApex(src);
  const out = new Set<string>();
  // Match each bracketed SOQL, then the object after its FROM.
  const soqlRe = /\[\s*select\b[\s\S]*?\bfrom\s+([A-Za-z_]\w*(?:__(?:c|mdt|e))?)/gi;
  let m: RegExpExecArray | null;
  while ((m = soqlRe.exec(code)) !== null) {
    out.add(m[1]);
  }
  return [...out];
}

/** Blanks block+line comments and single-quoted strings (SOQL/Apex safe). */
function stripApex(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
}

interface FlowRecord {
  Label?: string;
  ApiName?: string;
  ProcessType?: string;
  TriggerType?: string;
  TriggerObjectOrEventLabel?: string;
  TriggerObjectOrEventId?: string;
}

/**
 * Queries active Flows whose trigger object is one of `objectNames`. Uses the
 * Tooling API `FlowDefinitionView` (has TriggerObjectOrEvent + IsActive). Best-
 * effort: returns [] if the org is unavailable.
 */
async function queryActiveFlows(
  sf: SfExecutor,
  projectRoot: string,
  objectNames: string[],
  token?: vscode.CancellationToken
): Promise<RelatedFlow[]> {
  if (!objectNames.length) {
    return [];
  }
  const inList = objectNames.map((n) => `'${n.replace(/'/g, "\\'")}'`).join(', ');
  const soql =
    `SELECT Label, ApiName, ProcessType, TriggerType, TriggerObjectOrEventLabel ` +
    `FROM FlowDefinitionView ` +
    `WHERE IsActive = true AND TriggerObjectOrEventLabel != null ` +
    `AND TriggerObjectOrEventLabel IN (${inList})`;
  try {
    const res = await sf.run<{ records: FlowRecord[] }>(
      ['data', 'query', '--use-tooling-api', '--query', soql],
      { cwd: projectRoot, token, acceptNonZeroStatus: true }
    );
    return (res.result?.records ?? []).map((r) => ({
      label: r.Label ?? r.ApiName ?? '(flow)',
      apiName: r.ApiName,
      processType: r.ProcessType,
      triggerType: r.TriggerType,
      triggerObject: r.TriggerObjectOrEventLabel
    }));
  } catch {
    return [];
  }
}

/** Finds `.trigger` files whose `on <Object>` matches a touched object. */
function findTriggersFor(projectRoot: string, objectNames: string[]): string[] {
  if (!objectNames.length) {
    return [];
  }
  const wanted = new Set(objectNames.map((n) => n.toLowerCase()));
  const out: string[] = [];
  for (const file of walkFiles(projectRoot, '.trigger')) {
    const src = safeRead(file);
    const m = src.match(/\btrigger\s+\w+\s+on\s+([A-Za-z_]\w*)/i);
    if (m && wanted.has(m[1].toLowerCase())) {
      out.push(path.basename(file, '.trigger'));
    }
  }
  return out;
}

/* ------------------------------ utilities ------------------------------- */

function safeRead(file: string): string {
  try {
    return fs.readFileSync(file, 'utf-8');
  } catch {
    return '';
  }
}

function lastIndexWhere<T>(arr: T[], pred: (t: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (pred(arr[i])) {
      return i;
    }
  }
  return -1;
}

/** Recursively finds `<name>.cls` under the project. */
function findClassFile(root: string, name: string): string | undefined {
  const target = `${name}.cls`;
  for (const file of walkFiles(root, '.cls')) {
    if (path.basename(file) === target) {
      return file;
    }
  }
  return undefined;
}

/** Walks the project for files with the given extension, skipping noise dirs. */
function walkFiles(root: string, ext: string): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.siid' || e.name === '.git' || e.name === '.sfdx') {
        continue;
      }
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(full);
      } else if (e.name.endsWith(ext)) {
        out.push(full);
      }
    }
  }
  return out;
}

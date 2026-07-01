/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as fs from 'fs';
import * as path from 'path';
import { ApexSchema, ApexMember, ApexParam, SchemaManager } from './schemaManager';

/**
 * Headless, class-aware Apex test scaffolder (agent-consumable, per §14) — the
 * "smart" upgrade of the fixed `createTestClass` template (plan §18.B). Given a
 * class's parsed `ApexSchema` it emits a real `<Class>Test` skeleton: one
 * `@isTest` method per public/global method, a `@TestSetup`, the right harness
 * for Batchable/Queueable/Schedulable, and per-method `// TODO` inputs derived
 * from each method's parameters. The UI command and the AI agent both call this;
 * the AI test generator (§18.E) starts from a richer scaffold than the old stub.
 *
 * Heuristic only (no Apex parser) — it reads the schema cache, which is itself a
 * heuristic parse. Produces a COMPILING, runnable skeleton with placeholder
 * assertions; meaningful assertions are the human's / AI's job.
 */

/** A method we will generate a test for. */
export interface TestableMethod {
  name: string;
  returnType?: string;
  params: ApexParam[];
  isStatic: boolean;
  isAuraEnabled: boolean;
}

/** What kind of Apex type the class under test is — drives the harness shape. */
export type ApexClassKind = 'plain' | 'batchable' | 'queueable' | 'schedulable';

/** The facts the scaffold is built from. */
export interface ApexTestFacts {
  /** Class under test, e.g. `AccountService`. */
  className: string;
  /** Generated test class name, e.g. `AccountServiceTest`. */
  testName: string;
  kind: ApexClassKind;
  /** Public/global methods we emit a test for. */
  methods: TestableMethod[];
  /**
   * Parameters of the constructor a test must call to instantiate the class
   * (for non-static method tests + async harnesses). Empty = a no-arg / implicit
   * constructor. `undefined` = couldn't determine (treat as no-arg).
   */
  ctorParams: ApexParam[];
  /**
   * Names of inner classes/enums/interfaces declared in the class under test.
   * Bare references to these in a test must be qualified `<ClassName>.<Inner>`
   * (they are not visible at the test's top level).
   */
  innerTypes: string[];
  /** True if the class itself is `@isTest` (we should not scaffold a test for a test). */
  isTestClass: boolean;
}

export interface ApexScaffoldResult {
  /** Absolute path the test file should be written to. */
  testPath: string;
  /** Absolute path of the `-meta.xml`. */
  metaPath: string;
  /** The generated test source. */
  content: string;
  /** The generated `-meta.xml` source. */
  meta: string;
  facts: ApexTestFacts;
  /** True if a test file already exists at testPath. */
  exists: boolean;
}

/**
 * Derives the test facts from a class's parsed schema. Pass the schema directly
 * (the caller reads it from the cache or parses on demand).
 */
export function analyzeApexClass(schema: ApexSchema): ApexTestFacts {
  const className = schema.name;
  const isTestClass = hasAnnotation(schema.annotations, 'istest');

  // A constructor is a member whose name == the class name (no return type, or
  // a return type that's just the class name). Pick the simplest one to call.
  const ctors = schema.members.filter(
    (m) => m.kind === 'method' && m.name === className && (!m.returnType || m.returnType === className)
  );
  const ctorParams = pickConstructor(ctors);

  const methods: TestableMethod[] = schema.members
    .filter((m) => m.kind === 'method' && m.name !== className && isPublicOrGlobal(m))
    .map((m) => ({
      name: m.name,
      returnType: m.returnType,
      params: m.params ?? [],
      isStatic: (m.modifiers ?? []).some((mod) => mod.toLowerCase() === 'static'),
      isAuraEnabled: hasAnnotation(m.annotations, 'auraenabled')
    }));

  return {
    className,
    testName: `${className}Test`,
    kind: classifyKind(schema),
    methods,
    ctorParams,
    innerTypes: findInnerTypes(schema),
    isTestClass
  };
}

/**
 * Inner class/enum/interface names declared inside the class under test. Read
 * from the source file (the schema doesn't model nested types). Best-effort.
 */
function findInnerTypes(schema: ApexSchema): string[] {
  if (!schema.filePath) {
    return [];
  }
  let src: string;
  try {
    src = fs.readFileSync(schema.filePath, 'utf-8');
  } catch {
    return [];
  }
  return innerTypeNames(src, schema.name);
}

/** Extracts nested type names, excluding the top-level class itself. */
function innerTypeNames(src: string, outerName: string): string[] {
  const out: string[] = [];
  const re = /\b(?:class|enum|interface)\s+(\w+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (m[1] !== outerName && !out.includes(m[1])) {
      out.push(m[1]);
    }
  }
  return out;
}

/**
 * Builds the scaffold for the class whose schema is given. Does NOT write
 * anything — the caller decides (and can check `exists`). `classesDir` is where
 * the test `.cls` should live (defaults to the class-under-test's folder).
 */
export function scaffoldApexTest(
  schema: ApexSchema,
  classesDir: string,
  apiVersion: string
): ApexScaffoldResult {
  const facts = analyzeApexClass(schema);
  const testPath = path.join(classesDir, `${facts.testName}.cls`);
  return {
    testPath,
    metaPath: `${testPath}-meta.xml`,
    content: renderTest(facts),
    meta: renderMeta(apiVersion),
    facts,
    exists: fs.existsSync(testPath)
  };
}

/**
 * Convenience wrapper that resolves the class schema from the cache (or parses
 * the `.cls` on the fly) and returns a ready scaffold. Returns `undefined` when
 * the class can't be found/parsed.
 */
export function scaffoldApexTestFromFile(
  schemaMgr: SchemaManager,
  projectRoot: string,
  clsPath: string,
  apiVersion: string
): ApexScaffoldResult | undefined {
  const className = path.basename(clsPath, '.cls');
  const schema = schemaMgr.readApex(projectRoot, className) ?? parseClassFile(clsPath);
  if (!schema) {
    return undefined;
  }
  return scaffoldApexTest(schema, path.dirname(clsPath), apiVersion);
}

/* ----------------------------- analysis --------------------------------- */

function classifyKind(schema: ApexSchema): ApexClassKind {
  // The schema's class signature carries the `implements …` clause.
  const sig = (schema.signature ?? '').toLowerCase();
  if (/\bdatabase\.batchable\b/.test(sig)) {
    return 'batchable';
  }
  if (/\bqueueable\b/.test(sig)) {
    return 'queueable';
  }
  if (/\bschedulable\b/.test(sig)) {
    return 'schedulable';
  }
  return 'plain';
}

/** Picks the constructor a test should call — prefers the no-arg one, else the
 *  one with the fewest params. Returns [] when there's no explicit constructor. */
function pickConstructor(ctors: ApexMember[]): ApexParam[] {
  if (!ctors.length) {
    return [];
  }
  const sorted = [...ctors].sort((a, b) => (a.params?.length ?? 0) - (b.params?.length ?? 0));
  return sorted[0].params ?? [];
}

function isPublicOrGlobal(m: ApexMember): boolean {
  const mods = (m.modifiers ?? []).map((x) => x.toLowerCase());
  // Skip the implementation methods of the async interfaces — they're exercised
  // through the harness, not called directly.
  const name = m.name.toLowerCase();
  if (['execute', 'start', 'finish'].includes(name)) {
    return false;
  }
  return mods.includes('public') || mods.includes('global');
}

function hasAnnotation(annotations: string[] | undefined, name: string): boolean {
  return (annotations ?? []).some((a) => a.toLowerCase() === name.toLowerCase());
}

/* ----------------------------- rendering -------------------------------- */

function renderTest(f: ApexTestFacts): string {
  const body =
    f.kind === 'plain'
      ? f.methods.map((m) => renderMethodTest(f, m)).join('\n')
      : renderAsyncHarness(f);

  const methodNote = f.methods.length
    ? ''
    : '    // (no public/global methods detected — add tests for the entry points you need)\n';

  return `/**
 * Tests for ${f.className}.
 *
 * Scaffolded by SIID Forge. Replace each \`Assert.*\` placeholder with a real
 * assertion, and seed \`makeData()\` with the records the class needs (set every
 * REQUIRED field — see the object schema). Aim for >= 75% coverage with all
 * methods asserting real behaviour, not just running.
 */
@isTest
private class ${f.testName} {

    @TestSetup
    static void makeData() {
        // TODO: insert the common test data ${f.className} operates on.
        // Set every required field; respect validation rules, triggers and
        // active flows that fire on insert/update.
    }

${methodNote}${body}}
`;
}

/** One `@isTest` method per public method of a plain class. */
function renderMethodTest(f: ApexTestFacts, m: TestableMethod): string {
  const className = f.className;
  const owner = m.isStatic ? className : 'instance';
  const inputs = m.params.length
    ? m.params.map((p) => `        ${qualifyType(p.type, f)} ${p.name} = ${placeholderFor(p)}; // TODO`).join('\n') + '\n'
    : '';

  const instanceLine = m.isStatic
    ? ''
    : `        ${className} instance = new ${className}(${renderCtorArgs(f.ctorParams)});\n`;

  const callArgs = m.params.map((p) => p.name).join(', ');
  const returns = m.returnType && m.returnType.toLowerCase() !== 'void';
  const retType = returns ? qualifyType(m.returnType!, f) : '';
  const callLine = returns
    ? `        ${retType} result = ${owner}.${m.name}(${callArgs});`
    : `        ${owner}.${m.name}(${callArgs});`;
  const assertLine = returns
    ? `        Assert.areEqual(null /* expected */, result, 'TODO: assert ${m.name} result');`
    : `        Assert.isTrue(true, 'TODO: assert ${m.name} side effects (query the records it changed)');`;

  return `    @isTest
    static void test_${m.name}() {
        // Arrange
${inputs}${instanceLine}        // Act
        Test.startTest();
${callLine}
        Test.stopTest();

        // Assert
${assertLine}
    }
`;
}

/** Batchable/Queueable/Schedulable get the correct execution harness. */
function renderAsyncHarness(f: ApexTestFacts): string {
  switch (f.kind) {
    case 'batchable':
      return `    @isTest
    static void test_batch() {
        // Arrange — insert the records the batch will process in makeData().

        // Act
        Test.startTest();
        Database.executeBatch(new ${f.className}(${renderCtorArgs(f.ctorParams)}) /* , scopeSize */);
        Test.stopTest(); // forces the batch to run synchronously here

        // Assert
        Assert.isTrue(true, 'TODO: assert the records the batch processed');
    }
`;
    case 'queueable':
      return `    @isTest
    static void test_queueable() {
        // Act
        Test.startTest();
        System.enqueueJob(new ${f.className}(${renderCtorArgs(f.ctorParams)}));
        Test.stopTest(); // forces the queued job to run

        // Assert
        Assert.isTrue(true, 'TODO: assert the queued work completed');
    }
`;
    case 'schedulable':
      return `    @isTest
    static void test_schedulable() {
        // Act
        Test.startTest();
        String cron = '0 0 0 15 3 ? 2099';
        System.schedule('${f.className}Test', cron, new ${f.className}(${renderCtorArgs(f.ctorParams)}));
        Test.stopTest();

        // Assert
        Assert.isTrue(true, 'TODO: assert the scheduled work');
    }
`;
    default:
      return '';
  }
}

/**
 * Qualifies bare references to the class-under-test's inner types with the outer
 * class name, since they aren't visible at the test's top level. Handles bare
 * names (`AccountSummary` → `AccountCardController.AccountSummary`) and inner
 * types inside generics (`List<AccountSummary>` → `List<...AccountSummary>`).
 * Leaves primitives, SObjects and already-qualified names untouched.
 */
function qualifyType(type: string, f: ApexTestFacts): string {
  if (!f.innerTypes.length) {
    return type;
  }
  return type.replace(/\b(\w+)\b/g, (tok) =>
    f.innerTypes.includes(tok) ? `${f.className}.${tok}` : tok
  );
}

/** Renders constructor arguments inline, e.g. `null /* MyType ctx *​/`. */
function renderCtorArgs(params: ApexParam[]): string {
  return params.map((p) => `${placeholderFor(p)} /* TODO: ${p.type} ${p.name} */`).join(', ');
}

/** A compiling literal for a parameter type, for the TODO arrange block. */
function placeholderFor(p: ApexParam): string {
  const t = p.type.toLowerCase();
  if (/^(integer|long|double|decimal)$/.test(t)) {
    return '0';
  }
  if (t === 'boolean') {
    return 'false';
  }
  if (t === 'string') {
    return "''";
  }
  // Id cannot be assigned a blank string literal in Apex — use null.
  if (t === 'id') {
    return 'null';
  }
  if (t.startsWith('list<') || t.startsWith('set<')) {
    return `new ${p.type}()`;
  }
  if (t.startsWith('map<')) {
    return `new ${p.type}()`;
  }
  // SObject / custom type — null, with a TODO note carried by the caller.
  return 'null';
}

function renderMeta(apiVersion: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ApexClass xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>${apiVersion}</apiVersion>
    <status>Active</status>
</ApexClass>
`;
}

/* ----------------------- on-demand class parse -------------------------- */

/**
 * Minimal fallback parse when the class isn't in the schema cache — just enough
 * to drive the scaffold (class name, annotations, public methods + params).
 * Mirrors the heuristic style of `schemaManager`'s Apex parser.
 */
function parseClassFile(clsPath: string): ApexSchema | undefined {
  let src: string;
  try {
    src = fs.readFileSync(clsPath, 'utf-8');
  } catch {
    return undefined;
  }
  const name = path.basename(clsPath, '.cls');
  const classDecl = src.match(/(?:@\w+\s+)*\b(?:public|global|private)\b[^\n{]*\bclass\s+\w+[^\n{]*/i)?.[0] ?? '';
  const classAnnotations = [...src.matchAll(/@(\w+)/g)]
    .map((m) => m[1])
    .filter((a) => a.toLowerCase() === 'istest');

  const members: ApexMember[] = [];

  // Constructors: `public|global|private <ClassName>(...)` — no return type.
  const ctorRe = new RegExp(
    `\\b(public|global|private|protected)\\s+(${escapeRegExp(name)})\\s*\\(([^)]*)\\)`,
    'gi'
  );
  let c: RegExpExecArray | null;
  while ((c = ctorRe.exec(src)) !== null) {
    members.push({
      name,
      kind: 'method',
      modifiers: [c[1]],
      annotations: [],
      params: parseParams(c[3])
    });
  }

  const methodRe =
    /(?:@(\w+)(?:\([^)]*\))?\s+)*\b((?:public|global|private|protected)\b(?:\s+(?:static|override|virtual|final))*)\s+([\w.<>\[\]]+)\s+(\w+)\s*\(([^)]*)\)/gi;
  let m: RegExpExecArray | null;
  while ((m = methodRe.exec(src)) !== null) {
    const annotation = m[1];
    const modifiers = m[2].trim().split(/\s+/);
    const returnType = m[3];
    const methodName = m[4];
    const params = parseParams(m[5]);
    members.push({
      name: methodName,
      kind: 'method',
      returnType,
      modifiers,
      annotations: annotation ? [annotation] : [],
      params
    });
  }

  return { name, annotations: classAnnotations, members, signature: classDecl, filePath: clsPath };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseParams(raw: string): ApexParam[] {
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }
  // Split on commas that are not inside generics (<...>).
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of trimmed) {
    if (ch === '<') {
      depth++;
    } else if (ch === '>') {
      depth--;
    }
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) {
    parts.push(cur);
  }
  return parts
    .map((p) => p.trim().split(/\s+/))
    .filter((toks) => toks.length >= 2)
    .map((toks) => ({ type: toks.slice(0, -1).join(' '), name: toks[toks.length - 1] }));
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as fs from 'fs';
import * as path from 'path';
import { SfExecutor } from './sfExecutor';
import { OrgManager } from './orgManager';
import { TraceManager } from './traceManager';
import { SchemaManager } from './schemaManager';
import { Logger } from './logger';
import { openRouterChatWithUsage, stripCodeFence, ChatMessage } from './openRouterClient';
import { collectApexTestContext, buildApexTestPrompt, collectFailureContext, FailureContext, ApexStaticContext } from './apexTestContext';
import { runApexTestClass } from './apexTestRunner';
import { getCoverage } from './coverageStore';

/**
 * Independent, coverage-driven Apex test generation (plan §18.E) — the Apex
 * analogue of `lwcTestGenerator`, with the extra org round-trip: build the
 * hardened prompt (§18.C from §18.X context) → call OpenRouter → write
 * `<Class>Test.cls` → DEPLOY only that test class → run it → feed back concrete
 * failures + uncovered lines + parsed log for bounded self-correction. Keeps the
 * BEST attempt (all pass AND highest coverage) so a worse retry never regresses.
 *
 * GUARDRAILS (locked constraints):
 *  - deploy to a SANDBOX or DEVELOPER/scratch org only — never production;
 *  - only the test class is deployed; the class under test is NEVER modified;
 *  - success = all written tests pass AND class coverage >= the threshold (75).
 */

const DEFAULT_COVERAGE_TARGET = 75;

export type ApexGenerateEvent =
  | { type: 'phase'; attempt: number; phase: 'generating' | 'deploying' | 'running' | 'fixing'; message: string }
  | { type: 'attempt-result'; attempt: number; passed: number; total: number; failed: number; coverage?: number; failures: string[] }
  | { type: 'usage'; attempt: number; promptTokens: number; completionTokens: number; totalTokens: number; cost?: number; cumulativeTokens: number; cumulativeCost: number }
  | { type: 'blocked'; reason: string }
  | { type: 'done'; success: boolean; attempts: number; passed: number; total: number; coverage?: number; totalTokens: number; totalCost: number };

export interface ApexGenerateOptions {
  sf: SfExecutor;
  orgs: OrgManager;
  trace: TraceManager;
  schema: SchemaManager;
  logger: Logger;
  projectRoot: string;
  /** Absolute path of the class-under-test `.cls`. */
  clsPath: string;
  apiKey: string;
  model: string;
  /** Coverage % the class under test must reach. Default 75. */
  coverageTarget?: number;
  /** Max self-correction attempts after the first generation. Default 3. */
  maxRetries?: number;
  signal?: AbortSignal;
  onEvent?: (e: ApexGenerateEvent) => void;
  /** Continue a prior conversation (feedback / "cover more"). */
  conversation?: ChatMessage[];
  feedback?: string;
}

export interface ApexGenerateResult {
  testPath: string;
  attempts: number;
  success: boolean;
  passed: number;
  total: number;
  failed: number;
  coverage?: number;
  /** Total tokens used across all attempts in this run. */
  totalTokens: number;
  /** Total cost in USD credits across all attempts (0 if the account hides cost). */
  totalCost: number;
  conversation: ChatMessage[];
  /** Set when the run was blocked (e.g. production org) — success is false. */
  blockedReason?: string;
}

const SYSTEM_PROMPT =
  'You are an expert Salesforce Apex engineer writing Apex unit tests. ' +
  'Output ONLY the complete contents of the test .cls file — no prose, no markdown, no explanation. ' +
  'The tests MUST compile and pass, and cover the class under test. Follow every rule in the user message exactly.';

export async function generateApexTest(opts: ApexGenerateOptions): Promise<ApexGenerateResult> {
  const { sf, orgs, trace, schema, logger, projectRoot, clsPath, apiKey, model } = opts;
  const coverageTarget = opts.coverageTarget ?? DEFAULT_COVERAGE_TARGET;
  const maxRetries = opts.maxRetries ?? 3;
  const className = path.basename(clsPath, '.cls');
  const testName = `${className}Test`;
  const testPath = path.join(path.dirname(clsPath), `${testName}.cls`);
  const metaPath = `${testPath}-meta.xml`;

  // --- GUARDRAIL: never deploy to production ------------------------------
  const orgKind = await getOrgKind(sf, projectRoot);
  if (orgKind === 'production') {
    const reason = 'The default org looks like PRODUCTION. Generated tests are deployed to run, so a sandbox/developer/scratch org is required. Switch the default org and retry.';
    opts.onEvent?.({ type: 'blocked', reason });
    return emptyResult(testPath, reason, opts.conversation ?? []);
  }

  // --- Build the conversation (fresh or continued) ------------------------
  const ctx = await collectApexTestContext(sf, schema, projectRoot, className);
  logContext(logger, className, ctx);
  let messages: ChatMessage[];
  if (opts.conversation?.length) {
    messages = [...opts.conversation];
    const fb = opts.feedback?.trim()
      ? `${opts.feedback.trim()}\n\nOutput the COMPLETE updated ${testName}.cls (only Apex, no prose). Keep all currently-passing tests; ensure everything still compiles and passes.`
      : `Add more tests to raise coverage of ${className} above ${coverageTarget}% — cover branches/paths not yet exercised. Keep existing passing tests. Output the COMPLETE ${testName}.cls (only Apex).`;
    messages.push({ role: 'user', content: fb });
  } else {
    const prompt = buildApexTestPrompt(ctx, coverageTarget).text;
    logger.info(`[apex-test-ai] ${className}: prompt (${prompt.length} chars):\n${prompt}`);
    messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt }
    ];
  }

  const apiVersion = readSourceApiVersion(projectRoot);
  ensureMeta(metaPath, apiVersion);

  let attempts = 0;
  let totalTokens = 0;
  let totalCost = 0;
  let best: { code: string; passed: number; total: number; failed: number; coverage: number; score: number; passingNames: string[] } | undefined;

  for (let i = 0; i <= maxRetries; i++) {
    attempts++;
    if (opts.signal?.aborted) {
      break;
    }

    // 1. Generate.
    opts.onEvent?.({ type: 'phase', attempt: attempts, phase: i === 0 ? 'generating' : 'fixing', message: i === 0 ? 'generating tests…' : 'fixing failures…' });
    const reply = await openRouterChatWithUsage({ apiKey, model, messages, signal: opts.signal });
    const code = stripCodeFence(reply.content);
    if (reply.usage) {
      totalTokens += reply.usage.totalTokens;
      if (typeof reply.usage.cost === 'number') {
        totalCost += reply.usage.cost;
      }
      opts.onEvent?.({
        type: 'usage', attempt: attempts,
        promptTokens: reply.usage.promptTokens, completionTokens: reply.usage.completionTokens,
        totalTokens: reply.usage.totalTokens, cost: reply.usage.cost,
        cumulativeTokens: totalTokens, cumulativeCost: totalCost
      });
      logger.info(`[apex-test-ai] ${className}: attempt ${attempts} tokens=${reply.usage.totalTokens} (prompt ${reply.usage.promptTokens} + completion ${reply.usage.completionTokens})${reply.usage.cost != null ? ` cost=$${reply.usage.cost.toFixed(5)}` : ''} · cumulative ${totalTokens} tok${totalCost ? ` / $${totalCost.toFixed(5)}` : ''}`);
    }
    logger.info(`[apex-test-ai] ${className}: attempt ${attempts} generated ${code.length} chars`);
    fs.writeFileSync(testPath, code, 'utf-8');

    // 2. Deploy ONLY the test class (guardrail: main class untouched).
    opts.onEvent?.({ type: 'phase', attempt: attempts, phase: 'deploying', message: 'deploying test class…' });
    const deploy = await deployTestClass(sf, projectRoot, testPath, metaPath, opts.signal);
    if (!deploy.ok) {
      // Compile/deploy error — feed it back as a failure to fix.
      opts.onEvent?.({ type: 'attempt-result', attempt: attempts, passed: 0, total: 0, failed: 1, failures: [deploy.error] });
      if (i === maxRetries) {
        break;
      }
      messages.push({ role: 'assistant', content: code });
      messages.push({ role: 'user', content: buildDeployErrorMessage(testName, deploy.error) });
      continue;
    }

    // 3. Run the tests + read coverage.
    opts.onEvent?.({ type: 'phase', attempt: attempts, phase: 'running', message: 'running tests…' });
    let passed = 0, total = 0, failed = 0, coverage = 0;
    let failure: FailureContext | undefined;
    const failureSummaries: string[] = [];
    const passingNames: string[] = [];
    try {
      const run = await runApexTestClass(sf, orgs, trace, logger, projectRoot, testName, {
        debug: true, // FINEST log → failure context
        token: undefined
      });
      passed = run.passing;
      total = run.testsRan;
      failed = run.failing;
      coverage = coverageOf(run.classCoverage, className) ?? classCoverageFromResult(run.result, className);
      for (const t of run.result.tests ?? []) {
        if (t.Outcome === 'Fail') {
          failureSummaries.push(`- ${t.MethodName || t.FullName}: ${(t.Message ?? '').toString().split('\n')[0]}`);
        } else if (t.Outcome === 'Pass' && t.MethodName) {
          passingNames.push(t.MethodName);
        }
      }
      if (failed > 0 && run.logFiles[0]) {
        failure = collectFailureContext(run.logFiles[0]);
      }
    } catch (err: any) {
      failureSummaries.push(`Run error: ${err.message}`);
      failed = Math.max(failed, 1);
    }

    opts.onEvent?.({ type: 'attempt-result', attempt: attempts, passed, total, failed, coverage, failures: failureSummaries });

    // Track best: all-passing + higher coverage wins; else more passing.
    const allPass = failed === 0 && total > 0;
    const score = (allPass ? 1_000_000 : 0) + coverage * 1000 + passed - failed;
    // A regression = this attempt passes fewer tests than our best so far. When
    // that happens the model broke previously-working code (often @TestSetup) —
    // steer it back to the best version instead of iterating on the broken one.
    const regressed = !!best && passed < best.passed && best.passed > 0;
    if (!best || score > best.score) {
      best = { code, passed, total, failed, coverage, score, passingNames: [...passingNames] };
    }

    // Success = all pass AND coverage target met.
    if (allPass && coverage >= coverageTarget) {
      opts.onEvent?.({ type: 'done', success: true, attempts, passed, total, coverage, totalTokens, totalCost });
      return { testPath, attempts, success: true, passed, total, failed, coverage, totalTokens, totalCost, conversation: messages };
    }
    if (i === maxRetries) {
      break;
    }

    // 4. Feed failures + uncovered lines + parsed log back. On a regression,
    //    hand back the best code and its passing set so the model resumes from
    //    the good version rather than compounding the broken one.
    if (regressed && best) {
      messages.push({ role: 'assistant', content: best.code });
      messages.push({ role: 'user', content: buildRegressionMessage(testName, best.passingNames, failureSummaries) });
    } else {
      messages.push({ role: 'assistant', content: code });
      const uncovered = coverageUncovered(projectRoot, className);
      messages.push({ role: 'user', content: buildRetryMessage(className, testName, coverageTarget, coverage, failureSummaries, passingNames, failure, uncovered) });
    }
  }

  // Restore the best attempt if the last one was worse.
  if (best && best.code !== safeRead(testPath)) {
    fs.writeFileSync(testPath, best.code, 'utf-8');
  }
  const b = best ?? { passed: 0, total: 0, failed: 0, coverage: 0 };
  const success = b.failed === 0 && b.total > 0 && b.coverage >= coverageTarget;
  opts.onEvent?.({ type: 'done', success, attempts, passed: b.passed, total: b.total, coverage: b.coverage, totalTokens, totalCost });
  return { testPath, attempts, success, passed: b.passed, total: b.total, failed: b.failed, coverage: b.coverage, totalTokens, totalCost, conversation: messages };
}

/** Logs a compact summary of the context the collector resolved for the class. */
function logContext(logger: Logger, className: string, ctx: ApexStaticContext): void {
  const objs = ctx.objects.map((o) => {
    const req = o.fields.filter((f) => f.required).map((f) => f.name);
    return `${o.name}${o.custom ? '(custom)' : ''}[req: ${req.join(',') || 'none'}]`;
  });
  logger.info(
    `[apex-test-ai] ${className}: CONTEXT — ` +
    `related=[${ctx.relatedClasses.map((c) => c.name).join(', ') || 'none'}] ` +
    `objects=[${objs.join(' | ') || 'none'}] ` +
    `flows=[${ctx.flows.map((f) => f.label).join(', ') || 'none'}] ` +
    `triggers=[${ctx.triggers.join(', ') || 'none'}]`
  );
}

/* ----------------------------- org guardrail ---------------------------- */

type OrgKind = 'sandbox' | 'developer' | 'scratch' | 'production' | 'unknown';

interface OrganizationRow {
  OrganizationType?: string;
  IsSandbox?: boolean;
  TrialExpirationDate?: string | null;
}

/**
 * Classifies the default org from the authoritative `Organization` object
 * (`sf org display` returns nulls for these on many editions). A sandbox,
 * Developer Edition, trial, or scratch org is safe to deploy generated tests to;
 * a real production edition (Enterprise/Professional/Unlimited, not sandbox, no
 * trial) is treated as production and BLOCKED. On any doubt we FAIL CLOSED to
 * 'unknown' — the caller still warns before deploying.
 */
async function getOrgKind(sf: SfExecutor, projectRoot: string): Promise<OrgKind> {
  try {
    const res = await sf.run<{ records?: OrganizationRow[] }>(
      ['data', 'query', '--query', 'SELECT OrganizationType, IsSandbox, TrialExpirationDate FROM Organization LIMIT 1'],
      { cwd: projectRoot, acceptNonZeroStatus: true }
    );
    const row = res.result?.records?.[0];
    if (!row) {
      return 'unknown';
    }
    if (row.IsSandbox) {
      return 'sandbox';
    }
    const type = (row.OrganizationType ?? '').toLowerCase();
    if (type.includes('developer')) {
      return 'developer';
    }
    if (row.TrialExpirationDate) {
      return 'scratch'; // trial/scratch orgs carry an expiration date
    }
    if (type) {
      return 'production'; // a real edition, not sandbox, no trial
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/* ------------------------------- deploy --------------------------------- */

interface DeployOutcome {
  ok: boolean;
  error: string;
}

/** Deploys ONLY the test class + its meta. Returns compile/deploy errors as text. */
async function deployTestClass(
  sf: SfExecutor,
  projectRoot: string,
  testPath: string,
  metaPath: string,
  signal?: AbortSignal
): Promise<DeployOutcome> {
  void metaPath; // deployed implicitly as the .cls's sidecar
  try {
    const res = await sf.run<any>(
      ['project', 'deploy', 'start', '--source-dir', testPath, '--ignore-conflicts'],
      { cwd: projectRoot, acceptNonZeroStatus: true }
    );
    void signal;
    const failures = extractDeployFailures(res.result);
    if (failures) {
      return { ok: false, error: failures };
    }
    // Non-success status with no parsed failures — surface the message.
    if (res.status !== 0) {
      return { ok: false, error: res.message || 'Deploy failed.' };
    }
    return { ok: true, error: '' };
  } catch (err: any) {
    return { ok: false, error: extractDeployFailures(err?.raw) || err.message || 'Deploy failed.' };
  }
}

/** Pulls component failure messages out of a deploy result JSON. */
function extractDeployFailures(result: any): string {
  const failures = result?.details?.componentFailures ?? result?.deployResult?.details?.componentFailures ?? result?.files;
  if (!failures) {
    return '';
  }
  const arr = Array.isArray(failures) ? failures : [failures];
  const problems = arr
    .filter((f: any) => (f.problem || f.error || f.state === 'Failed'))
    .map((f: any) => `${f.fullName || f.filePath || ''} (${f.lineNumber ?? '?'}:${f.columnNumber ?? '?'}): ${f.problem || f.error}`);
  return problems.join('\n');
}

/* ------------------------------ messages -------------------------------- */

function buildDeployErrorMessage(testName: string, error: string): string {
  return [
    `${testName}.cls FAILED TO COMPILE / DEPLOY. Fix these errors and output the COMPLETE corrected file (only Apex):`,
    '```',
    error.slice(0, 2000),
    '```',
    `Common causes: referencing a class/inner type without qualifying it, a wrong method signature, or a missing type. Reference inner types of the class under test as \`ClassName.Inner\`.`
  ].join('\n');
}

/**
 * Sent when an attempt REGRESSED (broke previously-passing tests). We hand back
 * the best-known-good file as the assistant turn, then ask for a minimal fix so
 * the model resumes from the good version instead of the broken one.
 */
function buildRegressionMessage(testName: string, bestPassing: string[], nowFailing: string[]): string {
  return [
    `Your last change REGRESSED — it broke tests that were passing before. I have reverted ${testName}.cls to the last version where these passed:`,
    bestPassing.map((n) => `  ✓ ${n}`).join('\n'),
    ``,
    `Start from THIS reverted file. Change as little as possible. Do NOT rewrite @TestSetup or any helper these passing tests use.`,
    nowFailing.length ? `Fix only the still-failing behaviour:\n${nowFailing.slice(0, 20).join('\n')}` : '',
    `Output the COMPLETE corrected ${testName}.cls (only Apex, no prose).`
  ].filter(Boolean).join('\n');
}

function buildRetryMessage(
  className: string,
  testName: string,
  target: number,
  coverage: number,
  failures: string[],
  passingNames: string[],
  failure: FailureContext | undefined,
  uncovered: string
): string {
  const parts: string[] = [];
  if (passingNames.length) {
    parts.push(
      `THESE TESTS ALREADY PASS — DO NOT change them and DO NOT change any shared @TestSetup / helper they rely on:\n` +
      passingNames.map((n) => `  ✓ ${n}`).join('\n') +
      `\nOnly fix the FAILING tests below. Make the smallest change that fixes them; if a fix would touch @TestSetup or a helper used by a passing test, adjust the failing test itself instead.`
    );
  }
  if (failures.length) {
    parts.push(`FAILING TESTS (fix ONLY these):\n${failures.slice(0, 20).join('\n')}`);
  }
  if (failure) {
    if (failure.exception) {
      parts.push(`EXCEPTION: ${failure.exception}`);
    }
    if (failure.stack.length) {
      parts.push(`STACK: ${failure.stack.join(' -> ')}`);
    }
    if (failure.events.length) {
      parts.push(`LOG EVENTS: ${failure.events.slice(0, 8).join(' | ')}`);
    }
  }
  if (coverage < target) {
    parts.push(`COVERAGE is ${coverage}% but must reach ${target}% of ${className}.${uncovered ? ` Uncovered lines: ${uncovered}. Add tests that exercise them.` : ''}`);
  }

  // Targeted hints for common Apex failures seen in the failures/log text.
  const blob = [...failures, failure?.exception ?? '', ...(failure?.events ?? [])].join('\n');
  const hints = apexFailureHints(blob);
  if (hints.length) {
    parts.push(`HINTS:\n${hints.map((h) => `- ${h}`).join('\n')}`);
  }

  parts.push(`Output the COMPLETE corrected ${testName}.cls (only Apex, no prose). Keep passing tests; fix failures; raise coverage.`);
  return parts.join('\n\n');
}

/** Maps well-known Apex failure signatures to concrete corrective hints. */
function apexFailureHints(text: string): string[] {
  const hints: string[] = [];
  if (/List has no rows for assignment to SObject/i.test(text)) {
    hints.push('"List has no rows for assignment to SObject": a `SObject x = [SELECT … LIMIT 1]` found nothing. Insert a matching record and query back its REAL Id before calling the method. If the code runs under System.runAs, insert that data INSIDE the runAs block (sharing may hide outside-inserted rows).');
  }
  if (/Script-thrown exception/i.test(text) && /AuraHandledException/i.test(text)) {
    hints.push('AuraHandledException surfaces as "Script-thrown exception" and its message is often masked. Assert the TYPE (Assert.isInstanceOfType(e, AuraHandledException.class)) rather than the exact getMessage() text.');
  }
  if (/Assertion Failed: Exception message should/i.test(text)) {
    hints.push('Do not assert on AuraHandledException.getMessage() — Salesforce replaces it with "Script-thrown exception" in tests. Assert the exception TYPE instead.');
  }
  if (/Invalid id:/i.test(text)) {
    hints.push('"Invalid id": do NOT fabricate an Id literal like \'001000000000000000\'. To get a valid-but-nonexistent Id of a type, insert a record, capture its Id, then delete the record — the Id stays syntactically valid but the query finds no rows. Or use fflib_IDGenerator.generate(Account.SObjectType) if available.');
  }
  if (/STRING_TOO_LONG/i.test(text)) {
    hints.push('STRING_TOO_LONG: a field value exceeds its max length (e.g. User.Alias max 8 chars). Keep Alias <= 8 chars (e.g. \'t\' + a short suffix) and check other field lengths.');
  }
  if (/REQUIRED_FIELD_MISSING/i.test(text)) {
    hints.push('REQUIRED_FIELD_MISSING: set every required field listed in the SOBJECTS section on each inserted record.');
  }
  if (/DUPLICATE_USERNAME|UNABLE_TO_LOCK_ROW/i.test(text)) {
    hints.push('Creating a User: use a unique Username (e.g. append System.now().getTime()) and a standard Profile; wrap the User insert in System.runAs(new User(Id=UserInfo.getUserId())) to avoid MIXED_DML_OPERATION with sObject data.');
  }
  if (/MIXED_DML_OPERATION/i.test(text)) {
    hints.push('MIXED_DML_OPERATION: setup (User/Profile) and regular sObject DML cannot share a transaction. Insert the User inside System.runAs(...) OR isolate setup data with Test.startTest()/stopTest().');
  }
  return hints;
}

/* ------------------------------ helpers --------------------------------- */

function coverageOf(entry: { name: string; coveredPercent: number } | undefined, className: string): number | undefined {
  return entry && entry.name === className ? entry.coveredPercent : undefined;
}

/** Falls back to scanning the raw run result's coverage array for the class. */
function classCoverageFromResult(result: any, className: string): number {
  const c = (result?.coverage?.coverage ?? []).find((x: any) => x.name === className);
  return c ? Math.round(c.coveredPercent ?? 0) : 0;
}

/** Reads uncovered line ranges for a class from the persisted coverage store. */
function coverageUncovered(projectRoot: string, className: string): string {
  const uncovered = getCoverage(projectRoot, className)?.uncovered;
  return uncovered?.length ? compressRanges(uncovered) : '';
}

function compressRanges(nums: number[]): string {
  const sorted = [...nums].sort((a, b) => a - b);
  const ranges: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === prev + 1) {
      prev = sorted[i];
      continue;
    }
    ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = prev = sorted[i];
  }
  ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
  return ranges.slice(0, 15).join(', ');
}

function readSourceApiVersion(root: string): string {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(root, 'sfdx-project.json'), 'utf-8'));
    if (cfg.sourceApiVersion) {
      return String(cfg.sourceApiVersion);
    }
  } catch { /* ignore */ }
  return '62.0';
}

function ensureMeta(metaPath: string, apiVersion: string): void {
  if (fs.existsSync(metaPath)) {
    return;
  }
  fs.writeFileSync(
    metaPath,
    `<?xml version="1.0" encoding="UTF-8"?>\n<ApexClass xmlns="http://soap.sforce.com/2006/04/metadata">\n    <apiVersion>${apiVersion}</apiVersion>\n    <status>Active</status>\n</ApexClass>\n`,
    'utf-8'
  );
}

function safeRead(file: string): string {
  try {
    return fs.readFileSync(file, 'utf-8');
  } catch {
    return '';
  }
}

function emptyResult(testPath: string, blockedReason: string, conversation: ChatMessage[]): ApexGenerateResult {
  return { testPath, attempts: 0, success: false, passed: 0, total: 0, failed: 0, totalTokens: 0, totalCost: 0, conversation, blockedReason };
}

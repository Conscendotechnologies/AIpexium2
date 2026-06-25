/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as fs from 'fs';
import * as path from 'path';
import { buildLwcTestPrompt } from './lwcTestContext';
import { scaffoldLwcTest } from './lwcTestScaffold';
import { openRouterChat, stripCodeFence, ChatMessage } from './openRouterClient';
import { runJest, JestRunResult } from './lwcTestRunner';

/**
 * Independent, deterministic LWC test generation: build the hardened prompt,
 * call OpenRouter DIRECTLY (no agent), write the test, run it, and on failure
 * feed the errors back for a bounded number of retries. This is the reliable
 * alternative to delegating to the interactive SIID-Code agent. Headless +
 * agent-consumable (§14).
 */

/** A structured event streamed during generation (for the live webview). */
export type GenerateEvent =
  | { type: 'phase'; attempt: number; phase: 'generating' | 'running' | 'fixing'; message: string }
  | { type: 'attempt-result'; attempt: number; passed: number; total: number; failed: number; failures: Array<{ title: string; message: string }> }
  | { type: 'done'; success: boolean; attempts: number; passed: number; total: number };

export interface GenerateOptions {
  projectRoot: string;
  jsFilePath: string;
  apiKey: string;
  model: string;
  /** Max self-correction attempts after the first generation. Default 2. */
  maxRetries?: number;
  signal?: AbortSignal;
  onProgress?: (msg: string) => void;
  /** Structured event stream for a live UI. */
  onEvent?: (e: GenerateEvent) => void;
  /**
   * Existing conversation to CONTINUE (from a previous result). Lets the user
   * add feedback / request more tests on the same thread instead of restarting.
   */
  conversation?: ChatMessage[];
  /**
   * User instruction for this pass (e.g. "also test the delete error path").
   * Steers the next generation; appended to the conversation.
   */
  feedback?: string;
}

export interface GenerateResult {
  testPath: string;
  attempts: number;
  finalRun: JestRunResult;
  success: boolean;
  /** The full conversation so far — pass back as `conversation` to continue. */
  conversation: ChatMessage[];
}

const SYSTEM_PROMPT =
  'You are an expert Salesforce LWC engineer writing Jest unit tests with @salesforce/sfdx-lwc-jest. ' +
  'Output ONLY the complete contents of the test .js file — no prose, no markdown, no explanation. ' +
  'The tests MUST pass. Follow every rule in the user message exactly.';

export async function generateLwcTest(opts: GenerateOptions): Promise<GenerateResult> {
  const { projectRoot, jsFilePath, apiKey, model } = opts;
  const maxRetries = opts.maxRetries ?? 2;

  // Ensure a scaffold exists (gives the model the path + project style + mocks).
  const scaffold = scaffoldLwcTest(jsFilePath);
  if (!scaffold.exists) {
    fs.mkdirSync(path.dirname(scaffold.testPath), { recursive: true });
    fs.writeFileSync(scaffold.testPath, scaffold.content, 'utf-8');
  }
  const testPath = scaffold.testPath;
  const name = scaffold.facts.name;

  // Continue an existing conversation (feedback / "add more tests") or start fresh.
  let messages: ChatMessage[];
  if (opts.conversation?.length) {
    messages = [...opts.conversation];
    const fb = opts.feedback?.trim()
      ? `${opts.feedback.trim()}\n\nOutput the COMPLETE updated test file (only the .js, no prose). Keep all currently-passing tests; add/adjust as requested; ensure everything still passes.`
      : `Add more tests to cover additional scenarios you haven't tested yet (more buttons, inputs, events, branches, error paths). Keep existing passing tests. Output the COMPLETE test file (only the .js).`;
    messages.push({ role: 'user', content: fb });
  } else {
    const basePrompt = buildLwcTestPrompt(jsFilePath, fs.readFileSync(testPath, 'utf-8')).text;
    messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: basePrompt }
    ];
  }

  let attempts = 0;
  let finalRun: JestRunResult = { success: false, numTotal: 0, numPassed: 0, numFailed: 0, files: [], depsMissing: false };

  // Keep the BEST attempt (most passing, fewest failing) so a worse retry never
  // overwrites working tests. We also track which tests passed last round to
  // detect regressions (a previously-passing test the new attempt broke).
  let best: { code: string; run: JestRunResult; score: number } | undefined;
  let prevPassing = new Set<string>();

  for (let i = 0; i <= maxRetries; i++) {
    attempts++;
    const phase = i === 0 ? 'generating' : 'fixing';
    opts.onProgress?.(i === 0 ? 'generating tests…' : `fixing failures (attempt ${i + 1})…`);
    opts.onEvent?.({ type: 'phase', attempt: attempts, phase, message: i === 0 ? 'generating tests…' : 'fixing failures…' });

    const reply = await openRouterChat({ apiKey, model, messages, signal: opts.signal });
    const code = stripCodeFence(reply);
    fs.writeFileSync(testPath, code, 'utf-8');

    opts.onProgress?.('running tests…');
    opts.onEvent?.({ type: 'phase', attempt: attempts, phase: 'running', message: 'running tests…' });
    finalRun = await runJest(projectRoot, { testFile: testPath });

    opts.onEvent?.({
      type: 'attempt-result',
      attempt: attempts,
      passed: finalRun.numPassed,
      total: finalRun.numTotal,
      failed: finalRun.numFailed,
      failures: collectFailures(finalRun)
    });

    // Track best-so-far (more passing wins; tie-break on fewer total failing).
    const score = finalRun.numPassed * 1000 - finalRun.numFailed;
    if (!best || score > best.score) {
      best = { code, run: finalRun, score };
    }

    if (finalRun.success && finalRun.numFailed === 0 && finalRun.numTotal > 0) {
      opts.onEvent?.({ type: 'done', success: true, attempts, passed: finalRun.numPassed, total: finalRun.numTotal });
      return { testPath, attempts, finalRun, success: true, conversation: messages };
    }
    if (i === maxRetries) {
      break;
    }

    // Regressions: tests that passed last attempt but fail now.
    const nowPassing = passingTitles(finalRun);
    const regressions = [...prevPassing].filter((t) => !nowPassing.has(t));
    prevPassing = nowPassing;

    // Feed the failures (+ any regressions) back for a self-correction pass.
    messages.push({ role: 'assistant', content: code });
    messages.push({ role: 'user', content: buildRetryMessage(name, finalRun, regressions) });
  }

  // Restore the best attempt if the final one regressed below it.
  if (best && best.code !== fs.readFileSync(testPath, 'utf-8')) {
    fs.writeFileSync(testPath, best.code, 'utf-8');
    finalRun = best.run;
  }

  opts.onEvent?.({ type: 'done', success: false, attempts, passed: finalRun.numPassed, total: finalRun.numTotal });
  return { testPath, attempts, finalRun, success: !!finalRun.success && finalRun.numFailed === 0 && finalRun.numTotal > 0, conversation: messages };
}

/** Titles of currently-passing tests. */
function passingTitles(run: JestRunResult): Set<string> {
  const out = new Set<string>();
  for (const f of run.files) {
    for (const a of f.assertions) {
      if (a.status === 'passed') {
        out.add(a.title);
      }
    }
  }
  return out;
}

/** Extracts failing test titles + first-line messages for the UI. */
function collectFailures(run: JestRunResult): Array<{ title: string; message: string }> {
  const out: Array<{ title: string; message: string }> = [];
  for (const f of run.files) {
    for (const a of f.assertions) {
      if (a.status === 'failed') {
        out.push({ title: a.title, message: firstLines(a.failureMessage, 2) });
      }
    }
  }
  if (!out.length && (run.error || run.stderr)) {
    out.push({ title: '(suite error)', message: (run.error || run.stderr || '').slice(0, 300) });
  }
  return out;
}

/** Builds a corrective message listing the concrete Jest failures. */
function buildRetryMessage(name: string, run: JestRunResult, regressions: string[] = []): string {
  const failures: string[] = [];
  const passing: string[] = [];
  for (const f of run.files) {
    for (const a of f.assertions) {
      if (a.status === 'failed') {
        failures.push(`- "${a.title}": ${firstLines(a.failureMessage, 4)}`);
      } else if (a.status === 'passed') {
        passing.push(a.title);
      }
    }
  }
  const detail = failures.length
    ? failures.join('\n')
    : (run.error || run.stderr || 'Tests did not pass (no parsed assertions).').slice(0, 1500);

  const thenCrash = /Cannot read propert.*of undefined.*reading 'then'|\.then is not a function/i.test(detail);
  const hints: string[] = [];
  if (thenCrash) {
    hints.push(`CRITICAL: the "reading 'then' of undefined" crash means a mocked function the component awaits/chains returned undefined. Make EVERY awaited import (imported Apex methods, empApi subscribe/unsubscribe/isEmpEnabled) a jest.fn that RETURNS A PROMISE (mockResolvedValue/Promise.resolve) — set defaults in beforeEach so connectedCallback completes.`);
  }
  if (regressions.length) {
    hints.push(`YOU BROKE TESTS THAT WERE PASSING: ${regressions.map((t) => `"${t}"`).join(', ')}. Restore them to their previous working form — do not change tests that already pass.`);
  }
  hints.push(`Remember the hard rules: do NOT call non-@api methods or set non-@api fields; only query selectors that exist AFTER the relevant lwc:if branch renders (resolve load mocks + await flushPromises() before asserting); trigger events via real child DOM events; relax over-specific assertions rather than asserting things the source doesn't support.`);

  const keepLine = passing.length
    ? `These tests ALREADY PASS — keep them EXACTLY as-is, only change the failing ones: ${passing.map((t) => `"${t}"`).join(', ')}.`
    : '';

  return [
    `The test you wrote for ${name} has FAILING tests under sfdx-lwc-jest. Fix ONLY the failing ones and output the COMPLETE file (only the .js, no prose).`,
    keepLine,
    ``,
    `Failures:`,
    detail,
    ``,
    ...hints
  ].filter(Boolean).join('\n');
}

function firstLines(s: string | undefined, n: number): string {
  if (!s) {
    return 'failed';
  }
  return s.split('\n').slice(0, n).join(' ').replace(/\s+/g, ' ').slice(0, 400);
}

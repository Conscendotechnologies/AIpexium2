/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Headless LWC Jest test runner (agent-consumable, per §14). Runs
 * `sfdx-lwc-jest` with Jest's `--json` reporter and parses structured results.
 * Runs via npm/node (NOT the `sf` CLI). The UI and the AI agent both call this.
 */

export interface RunJestOptions {
  /** Restrict to one test file (absolute path). */
  testFile?: string;
  /** Restrict to tests whose name matches (Jest -t / testNamePattern). */
  testNamePattern?: string;
  /** Collect coverage. */
  coverage?: boolean;
  /**
   * Live elapsed callback while Jest runs (npx buffers output, so this is a
   * heartbeat with elapsed seconds — the LWC analogue of sf's onStatus). Called
   * ~every second with elapsed ms until the run settles. Optional.
   */
  onElapsed?: (elapsedMs: number) => void;
}

export interface JestAssertion {
  title: string;
  fullName: string;
  status: 'passed' | 'failed' | 'pending' | 'skipped' | 'todo' | string;
  /** First failure message, if failed. */
  failureMessage?: string;
  /** 0-based line in the test file, when resolvable. */
  line?: number;
}

export interface JestFileResult {
  testFilePath: string;
  status: 'passed' | 'failed' | string;
  assertions: JestAssertion[];
  message?: string;
}

export interface JestRunResult {
  success: boolean;
  numTotal: number;
  numPassed: number;
  numFailed: number;
  files: JestFileResult[];
  /** True when the project's node_modules / jest binary isn't installed. */
  depsMissing: boolean;
  /** Raw stderr (for diagnostics when parsing fails). */
  stderr?: string;
  /** A human-readable error when the run couldn't produce results at all. */
  error?: string;
}

/** True if the project has its npm dependencies installed (jest available). */
export function depsInstalled(projectRoot: string): boolean {
  return fs.existsSync(path.join(projectRoot, 'node_modules', '.bin')) &&
    (fs.existsSync(path.join(projectRoot, 'node_modules', '@salesforce', 'sfdx-lwc-jest')) ||
      fs.existsSync(path.join(projectRoot, 'node_modules', '.bin', 'sfdx-lwc-jest')) ||
      fs.existsSync(path.join(projectRoot, 'node_modules', '.bin', 'sfdx-lwc-jest.cmd')));
}

/** Runs the LWC Jest suite (optionally one file / test) and parses the results. */
export function runJest(projectRoot: string, opts: RunJestOptions = {}): Promise<JestRunResult> {
  if (!depsInstalled(projectRoot)) {
    return Promise.resolve(emptyResult({ depsMissing: true, error: 'LWC test dependencies are not installed (run `npm install`).' }));
  }

  // Pass-through args to Jest after `--`. `--json` makes Jest emit a machine
  // result; we point coverage off unless asked (it's slow).
  const jestArgs = ['--json', '--silent', '--testLocationInResults'];
  if (opts.testNamePattern) {
    jestArgs.push('--testNamePattern', shellArg(opts.testNamePattern));
  }
  if (opts.coverage) {
    jestArgs.push('--coverage');
  }
  // A specific file becomes a positional path regex.
  if (opts.testFile) {
    jestArgs.push(shellArg(opts.testFile.replace(/\\/g, '/')));
  }

  const bin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const command = `${bin} sfdx-lwc-jest -- ${jestArgs.join(' ')}`;

  return new Promise((resolve) => {
    // Heartbeat for a live "running… (Ns)" indicator (npx buffers, so we tick
    // elapsed rather than stream output). Cleared when the run settles.
    const startedAt = Date.now();
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    if (opts.onElapsed) {
      heartbeat = setInterval(() => opts.onElapsed?.(Date.now() - startedAt), 1000);
      if (typeof heartbeat.unref === 'function') {
        heartbeat.unref();
      }
    }
    const done = (r: JestRunResult) => { if (heartbeat) { clearInterval(heartbeat); } resolve(r); };

    exec(command, { cwd: projectRoot, maxBuffer: 50 * 1024 * 1024, env: { ...process.env, CI: 'true' } }, (_err, stdout, stderr) => {
      const raw = stdout?.toString() ?? '';
      const json = extractJson(raw);
      if (!json) {
        done(emptyResult({
          stderr: stderr?.toString(),
          error: stderr?.toString().trim() || 'Jest did not produce JSON output.'
        }));
        return;
      }
      try {
        done(parseJest(JSON.parse(json), stderr?.toString()));
      } catch (e: any) {
        done(emptyResult({ stderr: stderr?.toString(), error: e?.message ?? 'Failed to parse Jest output.' }));
      }
    });
  });
}

/** Parses Jest's `--json` output into our structured shape. */
function parseJest(j: any, stderr?: string): JestRunResult {
  const files: JestFileResult[] = (j.testResults ?? []).map((tr: any): JestFileResult => ({
    testFilePath: tr.testFilePath ?? tr.name ?? '',
    status: tr.status ?? (tr.numFailingTests ? 'failed' : 'passed'),
    message: tr.message || undefined,
    assertions: (tr.assertionResults ?? tr.testResults ?? []).map((a: any): JestAssertion => ({
      title: a.title ?? a.fullName ?? '(test)',
      fullName: a.fullName ?? a.title ?? '',
      status: a.status,
      failureMessage: (a.failureMessages && a.failureMessages[0]) || undefined,
      line: typeof a.location?.line === 'number' ? a.location.line - 1 : undefined
    }))
  }));

  return {
    success: !!j.success,
    numTotal: j.numTotalTests ?? 0,
    numPassed: j.numPassedTests ?? 0,
    numFailed: j.numFailedTests ?? 0,
    files,
    depsMissing: false,
    stderr
  };
}

function emptyResult(over: Partial<JestRunResult>): JestRunResult {
  return { success: false, numTotal: 0, numPassed: 0, numFailed: 0, files: [], depsMissing: false, ...over };
}

/** Extracts the JSON object from possibly noisy stdout (Jest can prepend logs). */
function extractJson(raw: string): string | undefined {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return undefined;
  }
  return raw.slice(start, end + 1);
}

/** Minimal shell-quoting for a single argument. */
function shellArg(s: string): string {
  return /["\s'$`\\]/.test(s) ? `"${s.replace(/(["\\$`])/g, '\\$1')}"` : s;
}

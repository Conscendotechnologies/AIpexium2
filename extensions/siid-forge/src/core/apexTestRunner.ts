/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { SfExecutor } from './sfExecutor';
import { OrgManager } from './orgManager';
import { TraceManager } from './traceManager';
import { Logger } from './logger';
import { ensureSiidSubdir } from './forgeConfig';
import { saveApexLogs } from './apexLogs';
import { saveCoverage, ClassCoverageEntry } from './coverageStore';

/**
 * Headless Apex test runner (plan §18.A / §14). The org-facing work — resolve
 * the org, optionally arm a FINEST trace, run `sf apex run test --code-coverage`,
 * persist a Markdown report + coverage + (in debug) FINEST logs — lives here as a
 * function that RETURNS structured results. The editor command
 * (`features/apexTest.ts`) is a thin adapter over it; the AI test generator
 * (§18.E) calls it directly to read pass/fail + coverage for its self-correction
 * loop. No editor/selection dependency: all inputs are explicit args.
 */

export interface ApexTestResult {
  FullName?: string;
  Outcome?: string;
  Message?: string | null;
  StackTrace?: string | null;
  RunTime?: number;
  MethodName?: string;
}

export interface ClassCoverage {
  id?: string;
  name?: string;
  totalLines?: number;
  totalCovered?: number;
  coveredPercent?: number;
  /** Map of source line number -> 1 (covered) | 0 (not covered). */
  lines?: Record<string, number>;
}

export interface ApexRunResult {
  summary?: Record<string, any>;
  tests?: ApexTestResult[];
  coverage?: { coverage?: ClassCoverage[]; summary?: Record<string, any> };
}

/** Options for a headless test run. */
export interface RunApexTestClassOptions {
  /** Specific test(s), e.g. "MyClass.myMethod". Omit to run the whole class. */
  tests?: string;
  /** Arm a FINEST trace + save the run's logs (for replay). */
  debug?: boolean;
  /** Progress sink (the UI supplies one; the agent can omit it). */
  progress?: (message: string) => void;
  token?: vscode.CancellationToken;
}

/** Everything a caller needs after a run — structured, no toast parsing. */
export interface ApexTestRunOutcome {
  /** The parsed `sf apex run test` result (tests + coverage + summary). */
  result: ApexRunResult;
  /** Absolute path of the Markdown report written under `.siid/test-results/`. */
  reportPath: string;
  /** FINEST log files saved (debug runs only). */
  logFiles: string[];
  /** Coverage for the named class, if present in the run (convenience). */
  classCoverage?: ClassCoverageEntry;
  passing: number;
  failing: number;
  testsRan: number;
}

/**
 * Runs the Apex tests for `className` (or the specific `opts.tests`) against the
 * given org, persists the report/coverage/logs, and returns structured results.
 * Throws on a run-level error (compile failure, no org); a run whose *tests*
 * fail resolves normally with the failures in `result`.
 */
export async function runApexTestClass(
  sf: SfExecutor,
  orgs: OrgManager,
  trace: TraceManager,
  logger: Logger,
  projectRoot: string,
  className: string,
  opts: RunApexTestClassOptions = {}
): Promise<ApexTestRunOutcome> {
  const report = opts.progress ?? (() => { /* no-op */ });
  const label = opts.tests ?? className;

  const username = await orgs.getUsername();
  if (!username) {
    throw new Error('No default org / connected user. Set a default org first.');
  }

  // Only a Debug run needs a FINEST trace flag (for the replay log). A plain run
  // doesn't — skip it so we don't touch the org needlessly.
  if (opts.debug) {
    report('preparing debug trace…');
    const userId = await orgs.getUserId();
    await trace.ensureTraceFlag(projectRoot, username, userId);
  }

  report('executing tests…');
  const runStart = new Date();
  const args = ['apex', 'run', 'test', '--code-coverage', '--wait', '10'];
  if (opts.tests) {
    args.push('--tests', opts.tests);
  } else {
    args.push('--class-names', className);
  }
  // Tests that FAIL make the CLI exit non-zero; still read the results.
  // Surface live elapsed time on the caller's progress while the org runs them.
  const run = await sf.run<ApexRunResult>(args, {
    cwd: projectRoot,
    token: opts.token,
    acceptNonZeroStatus: true,
    onStatus: (s) => {
      if (s.phase === 'running') {
        report(`executing tests… ${Math.round(s.elapsedMs / 1000)}s`);
      }
    }
  });
  const result = run.result;

  // No summary means the run itself errored (compile/not found) — surface it.
  if (!result?.summary) {
    throw new Error(run.message || 'Test run failed.');
  }

  const reportPath = saveReport(projectRoot, sanitize(label), username, result);

  let logFiles: string[] = [];
  if (opts.debug) {
    report('saving log…');
    logFiles = await saveApexLogs(sf, projectRoot, sanitize(label), runStart, 1, logger);
  }

  const summary = result.summary ?? {};
  const failing = Number(summary.failing ?? 0);
  const passing = Number(summary.passing ?? 0);
  const testsRan = Number(summary.testsRan ?? (result.tests?.length ?? 0));
  const classCoverage = coverageForClass(result, className);

  return { result, reportPath, logFiles, classCoverage, passing, failing, testsRan };
}

/** Returns the persisted coverage entry for a class from a run result, if any. */
function coverageForClass(result: ApexRunResult, className: string): ClassCoverageEntry | undefined {
  const c = (result.coverage?.coverage ?? []).find((x) => x.name === className);
  if (!c) {
    return undefined;
  }
  return toCoverageEntry(c);
}

function toCoverageEntry(c: ClassCoverage): ClassCoverageEntry {
  return {
    name: c.name ?? '(unknown)',
    totalLines: c.totalLines ?? 0,
    totalCovered: c.totalCovered ?? 0,
    coveredPercent: Math.round(c.coveredPercent ?? 0),
    covered: Object.entries(c.lines ?? {}).filter(([, h]) => h === 1).map(([l]) => parseInt(l, 10)).filter((n) => !isNaN(n)).sort((a, b) => a - b),
    uncovered: Object.entries(c.lines ?? {}).filter(([, h]) => h === 0).map(([l]) => parseInt(l, 10)).filter((n) => !isNaN(n)).sort((a, b) => a - b),
    capturedAt: new Date().toISOString()
  };
}

export function sanitize(name: string): string {
  return name.replace(/[^A-Za-z0-9_.-]/g, '_');
}

/** Writes a Markdown report to `.siid/test-results/` and returns its path. */
export function saveReport(projectRoot: string, className: string, username: string, result: ApexRunResult): string {
  const dir = ensureSiidSubdir(projectRoot, 'test-results');
  const stamp = timestamp();
  const file = path.join(dir, `${className}-${stamp}.md`);

  const summary = result.summary ?? {};
  const tests = result.tests ?? [];
  const lines: string[] = [];

  const failing = Number(summary.failing ?? 0);
  const passing = Number(summary.passing ?? 0);
  const ran = Number(summary.testsRan ?? tests.length);

  // --- Header / summary ----------------------------------------------------
  lines.push(`# Apex Test Results — ${className}`);
  lines.push('');
  lines.push(`> ${failing > 0 ? '❌' : '✅'} **${summary.outcome ?? (failing ? 'Failed' : 'Passed')}** — ${passing}/${ran} passing, ${failing} failing`);
  lines.push('');
  lines.push(`- **Org user:** ${username}`);
  lines.push(`- **Run at:** ${new Date().toLocaleString()}`);
  if (summary.testTotalTime) {
    lines.push(`- **Total time:** ${summary.testTotalTime}`);
  }
  if (summary.testRunCoverage) {
    lines.push(`- **Run coverage:** ${summary.testRunCoverage}`);
  }
  if (summary.orgWideCoverage) {
    lines.push(`- **Org-wide coverage:** ${summary.orgWideCoverage}`);
  }
  if (summary.testRunId) {
    lines.push(`- **Test run id:** ${summary.testRunId}`);
  }

  // --- Failures first (most important) -------------------------------------
  const failures = tests.filter((t) => t.Outcome === 'Fail');
  if (failures.length) {
    lines.push('');
    lines.push(`## ❌ Failures (${failures.length})`);
    for (const f of failures) {
      lines.push('');
      lines.push(`### ${f.FullName || f.MethodName}`);
      if (f.Message) {
        lines.push('');
        lines.push('**Message**');
        lines.push('```');
        lines.push(f.Message.toString().trim());
        lines.push('```');
      }
      if (f.StackTrace) {
        lines.push('');
        lines.push('**Stack trace**');
        lines.push('```');
        lines.push(f.StackTrace.toString().trim());
        lines.push('```');
      }
    }
  }

  // --- Per-test table ------------------------------------------------------
  lines.push('');
  lines.push('## Tests');
  lines.push('');
  lines.push('| Method | Outcome | Time (ms) | Message |');
  lines.push('| --- | --- | --- | --- |');
  for (const t of [...tests].sort((a, b) => outcomeRank(a.Outcome) - outcomeRank(b.Outcome))) {
    const method = t.MethodName || t.FullName || '';
    const icon = t.Outcome === 'Fail' ? '❌' : t.Outcome === 'Pass' ? '✅' : '⏭️';
    const msg = (t.Message ?? '').toString().replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
    lines.push(`| ${method} | ${icon} ${t.Outcome ?? ''} | ${t.RunTime ?? ''} | ${msg} |`);
  }

  // --- Code coverage -------------------------------------------------------
  const coverage = result.coverage?.coverage ?? [];
  // Persist coverage for the inline CodeLens (latest run per class wins).
  saveCoverage(projectRoot, coverage.map(toCoverageEntry));
  if (coverage.length) {
    lines.push('');
    lines.push('## Code Coverage');
    lines.push('');
    lines.push('| Class | Coverage | Covered / Total | Uncovered lines |');
    lines.push('| --- | --- | --- | --- |');
    const sorted = [...coverage].sort((a, b) => (a.coveredPercent ?? 0) - (b.coveredPercent ?? 0)); // worst first
    for (const c of sorted) {
      const pct = Math.round(c.coveredPercent ?? 0);
      const covered = c.totalCovered ?? 0;
      const total = c.totalLines ?? 0;
      const uncovered = uncoveredRanges(c.lines);
      lines.push(`| ${c.name ?? '(unknown)'} | ${coverageBar(pct)} ${pct}% | ${covered} / ${total} | ${uncovered || '—'} |`);
    }
    lines.push('');
    lines.push('> Classes below 75% will block production deployments. Uncovered lines are listed so you know what to test next.');
  }

  fs.writeFileSync(file, lines.join('\n'), 'utf-8');
  return file;
}

/** Failures sort to the top of the per-test table, then passes, then skipped. */
function outcomeRank(outcome?: string): number {
  if (outcome === 'Fail') {
    return 0;
  }
  if (outcome === 'Pass') {
    return 1;
  }
  return 2;
}

/** A compact 10-cell bar, e.g. 63% -> ██████▒▒▒▒. */
function coverageBar(pct: number): string {
  const filled = Math.round(Math.max(0, Math.min(100, pct)) / 10);
  return '█'.repeat(filled) + '▒'.repeat(10 - filled);
}

/**
 * Collapses the uncovered (value 0) line numbers into readable ranges, e.g.
 * "131-138, 143-147, 150". Truncates if there are very many.
 */
export function uncoveredRanges(linesMap?: Record<string, number>): string {
  if (!linesMap) {
    return '';
  }
  const uncovered = Object.entries(linesMap)
    .filter(([, hit]) => hit === 0)
    .map(([ln]) => parseInt(ln, 10))
    .filter((n) => !isNaN(n))
    .sort((a, b) => a - b);
  if (!uncovered.length) {
    return '';
  }

  const ranges: string[] = [];
  let start = uncovered[0];
  let prev = uncovered[0];
  for (let i = 1; i < uncovered.length; i++) {
    const n = uncovered[i];
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = prev = n;
  }
  ranges.push(start === prev ? `${start}` : `${start}-${prev}`);

  const MAX = 15;
  if (ranges.length > MAX) {
    return ranges.slice(0, MAX).join(', ') + `, … (+${ranges.length - MAX} more)`;
  }
  return ranges.join(', ');
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

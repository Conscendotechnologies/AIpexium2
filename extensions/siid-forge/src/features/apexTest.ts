/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Commands } from '../commands';
import { ensureSiidSubdir } from '../core/forgeConfig';
import { CancellationError } from '../core/sfExecutor';
import { saveApexLogs } from '../core/apexLogs';
import { saveCoverage, getCoverage, ClassCoverageEntry } from '../core/coverageStore';
import { findProjectRoot, resolveResourceUri } from '../core/workspace';
import { Feature } from './types';

interface ApexTestResult {
  FullName?: string;
  Outcome?: string;
  Message?: string | null;
  StackTrace?: string | null;
  RunTime?: number;
  MethodName?: string;
}

interface ClassCoverage {
  id?: string;
  name?: string;
  totalLines?: number;
  totalCovered?: number;
  coveredPercent?: number;
  /** Map of source line number -> 1 (covered) | 0 (not covered). */
  lines?: Record<string, number>;
}

interface ApexRunResult {
  summary?: Record<string, any>;
  tests?: ApexTestResult[];
  coverage?: { coverage?: ClassCoverage[]; summary?: Record<string, any> };
}

/**
 * Runs the Apex tests in the selected class. Before running, it ensures a debug
 * trace flag is active, then saves the generated logs and a Markdown result
 * report under `.siid/`.
 */
/** Options carried by the CodeLens actions. */
export interface RunApexTestsOptions {
  /** Specific test(s), e.g. "MyClass.myMethod". Omit to run the whole class. */
  tests?: string;
  /** Open the generated debug log after the run. */
  debug?: boolean;
}

export const registerApexTest: Feature = ({ context, sf, logger, orgs, trace }) => {
  // CodeLenses above the class and each test method.
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ language: 'apex', scheme: 'file' }, new ApexTestCodeLensProvider())
  );

  // Inline coverage CodeLens on non-test classes, refreshed after each run.
  const coverageLens = new CoverageCodeLensProvider();
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ language: 'apex', scheme: 'file' }, coverageLens)
  );

  let invocationCounter = 0;

  context.subscriptions.push(
    vscode.commands.registerCommand(Commands.runApexTests, async (uri?: vscode.Uri, opts?: RunApexTestsOptions) => {
      const runId = ++invocationCounter;
      const t0 = Date.now();
      const tlog = (msg: string) => logger.info(`[apexTest #${runId} +${Date.now() - t0}ms] ${msg}`);
      tlog(`invoked: uri=${uri?.fsPath} opts=${JSON.stringify(opts)}`);

      const resource = resolveResourceUri(uri);
      if (!resource) {
        tlog('no resource — abort');
        return;
      }
      if (!resource.fsPath.endsWith('.cls')) {
        vscode.window.showErrorMessage('SIID Forge: select an Apex class (.cls) to run its tests.');
        return;
      }

      const className = path.basename(resource.fsPath, '.cls');
      const projectRoot = findProjectRoot(resource.fsPath);
      const label = opts?.tests ?? className;

      // Log to replay once the progress scope below closes — startDebugging()
      // doesn't resolve until the session ends, so awaiting it would keep the
      // progress notification open for the whole debug session.
      let logToReplay: string | undefined;
      let outcome: { result: ApexRunResult; reportPath: string; logCount: number } | undefined;

      try {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `SIID Forge: running tests "${label}"…`, cancellable: true },
          async (progress, token) => {
            const username = await orgs.getUsername();
            if (!username) {
              throw new Error('No default org / connected user. Set a default org first.');
            }
            // Only a Debug run needs a FINEST trace flag (for the replay log).
            // A plain run doesn't — skip it so we don't touch the org needlessly.
            if (opts?.debug) {
              progress.report({ message: 'preparing debug trace…' });
              tlog('ensureTraceFlag start');
              const userId = await orgs.getUserId(); // cached from org display
              await trace.ensureTraceFlag(projectRoot, username, userId);
              tlog('ensureTraceFlag done');
              if (token.isCancellationRequested) {
                throw new CancellationError();
              }
            }

            // 2. Run the tests (specific method or whole class).
            progress.report({ message: 'executing tests…' });
            tlog('apex run test start');
            const runStart = new Date();
            const args = ['apex', 'run', 'test', '--code-coverage', '--wait', '10'];
            if (opts?.tests) {
              args.push('--tests', opts.tests);
            } else {
              args.push('--class-names', className);
            }
            // Tests that FAIL make the CLI exit non-zero; still read the results.
            const run = await sf.run<ApexRunResult>(args, { cwd: projectRoot, token, acceptNonZeroStatus: true });
            tlog(`apex run test done (status=${run.status})`);
            const result = run.result;

            // No summary means the run itself errored (compile/not found) — surface it.
            if (!result?.summary) {
              throw new Error(run.message || 'Test run failed.');
            }

            // 3. Persist the Markdown report.
            const reportPath = saveReport(projectRoot, sanitize(label), username, result);

            // 4. In debug mode only: pull the FINEST logs; queue one to replay
            //    after this progress scope closes.
            let logFiles: string[] = [];
            if (opts?.debug) {
              progress.report({ message: 'saving log…' });
              tlog('saveApexLogs start');
              logFiles = await saveApexLogs(sf, projectRoot, sanitize(label), runStart, 1, logger);
              tlog(`saveApexLogs done (${logFiles.length} file(s))`);
              logToReplay = logFiles[0];
            }

            outcome = { result, reportPath, logCount: logFiles.length };
            tlog('progress scope ending');
          }
        );
        tlog('progress scope closed');
        coverageLens.refresh(); // new coverage was just written
        void vscode.commands.executeCommand(Commands.refreshCoverage); // repaint highlights

        // Progress notification is now closed. Show the result toast WITHOUT
        // awaiting — it waits for the user to click "Open Report", which must
        // not hold the progress notification open.
        if (outcome) {
          void showOutcome(outcome.result, label, outcome.reportPath, outcome.logCount);
        }

        // Start the debug session (replay), if any.
        if (logToReplay) {
          tlog('startDebugging (replayLog)');
          await vscode.commands.executeCommand(Commands.replayLog, logToReplay);
          tlog('debug session ended');
        }
      } catch (err: any) {
        if (err instanceof CancellationError) {
          vscode.window.showInformationMessage('Test run cancelled.');
          return;
        }
        logger.error(err.message);
        vscode.window.showErrorMessage(`❌ Test run failed: ${err.message}`);
      }
    })
  );
};

function sanitize(name: string): string {
  return name.replace(/[^A-Za-z0-9_.-]/g, '_');
}

/** Writes a Markdown report to `.siid/test-results/` and returns its path. */
function saveReport(projectRoot: string, className: string, username: string, result: ApexRunResult): string {
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
  saveCoverage(projectRoot, coverage.map((c): ClassCoverageEntry => ({
    name: c.name ?? '(unknown)',
    totalLines: c.totalLines ?? 0,
    totalCovered: c.totalCovered ?? 0,
    coveredPercent: Math.round(c.coveredPercent ?? 0),
    covered: Object.entries(c.lines ?? {}).filter(([, h]) => h === 1).map(([l]) => parseInt(l, 10)).filter((n) => !isNaN(n)).sort((a, b) => a - b),
    uncovered: Object.entries(c.lines ?? {}).filter(([, h]) => h === 0).map(([l]) => parseInt(l, 10)).filter((n) => !isNaN(n)).sort((a, b) => a - b),
    capturedAt: new Date().toISOString()
  })));
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
function uncoveredRanges(linesMap?: Record<string, number>): string {
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

/** Shows a toast with the outcome and an action to open the report. */
async function showOutcome(result: ApexRunResult, className: string, reportPath: string, logCount: number): Promise<void> {
  const summary = result.summary ?? {};
  const failing = Number(summary.failing ?? 0);
  const passing = summary.passing ?? 0;
  const ran = summary.testsRan ?? (result.tests?.length ?? 0);
  const logNote = logCount ? ` · ${logCount} log(s) saved` : '';

  const action = 'Open Report';
  const choice = failing > 0
    ? await vscode.window.showErrorMessage(`❌ ${className}: ${failing} failing, ${passing}/${ran} passing${logNote}`, action)
    : await vscode.window.showInformationMessage(`✅ ${className}: ${passing}/${ran} passing${logNote}`, action);

  if (choice === action) {
    await vscode.window.showTextDocument(vscode.Uri.file(reportPath));
  }
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/**
 * Adds "Run All Tests / Debug All Tests" above a test class and
 * "Run Test / Debug Test" above each test method.
 *
 * Uses lightweight regex heuristics (no Apex parser): a file is treated as a
 * test class if it contains `@isTest` or the `testMethod` keyword; a method is
 * a test if it follows an `@isTest` annotation or has the `testMethod` modifier.
 */
class ApexTestCodeLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const text = document.getText();
    if (!/@istest/i.test(text) && /\btestmethod\b/i.test(text) === false) {
      return [];
    }

    const lenses: vscode.CodeLens[] = [];
    const lines = text.split(/\r?\n/);

    // Class-level lenses on the first class declaration.
    let className: string | undefined;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/\bclass\s+(\w+)/i);
      if (m) {
        className = m[1];
        const range = new vscode.Range(i, 0, i, 0);
        // Only "Run" at the class level — replay debugging is single-transaction,
        // and a whole class is many independent transactions/logs. Debug lives
        // on individual test methods.
        lenses.push(this.lens(range, '$(run-all) Run All Tests', document.uri, {}));
        break;
      }
    }
    if (!className) {
      return lenses;
    }

    // Method-level lenses on each test method (void return type).
    let pendingIsTest = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // The class declaration consumes any class-level @isTest; it must not
      // leak onto the first method (which may be a non-test helper).
      if (/\bclass\b/i.test(line)) {
        pendingIsTest = false;
        continue;
      }
      if (/@istest/i.test(line)) {
        pendingIsTest = true;
      }
      // A method declaration: leading annotations, one or more modifiers,
      // an optional return type, then `name(`. Skips the class line (no `(`).
      const mm = line.match(
        /^\s*(?:@\w+\s*(?:\([^)]*\))?\s*)*(?:(?:global|public|private|protected|static|override|virtual|testmethod|final|abstract)\s+)+(?:[\w.<>\[\]]+\s+)?(\w+)\s*\(/i
      );
      if (mm) {
        const isTestMethod = pendingIsTest || /\btestmethod\b/i.test(line);
        if (isTestMethod) {
          const method = mm[1];
          const tests = `${className}.${method}`;
          const range = new vscode.Range(i, 0, i, 0);
          lenses.push(this.lens(range, '$(run) Run Test', document.uri, { tests }));
          lenses.push(this.lens(range, '$(debug-alt-small) Debug Test', document.uri, { tests, debug: true }));
        }
        pendingIsTest = false;
      }
    }

    return lenses;
  }

  private lens(range: vscode.Range, title: string, uri: vscode.Uri, opts: RunApexTestsOptions): vscode.CodeLens {
    return new vscode.CodeLens(range, { title, command: Commands.runApexTests, arguments: [uri, opts] });
  }
}

/**
 * Shows the last recorded code coverage above a non-test class declaration,
 * e.g. "$(shield) 63% covered · 98 lines uncovered". Reads from the coverage
 * store written after each test run; refresh() re-renders after a new run.
 */
class CoverageCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChange.event;

  refresh(): void {
    this._onDidChange.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const text = document.getText();
    // Skip test classes — coverage applies to the code under test.
    if (/@istest/i.test(text) || /\btestmethod\b/i.test(text)) {
      return [];
    }

    const className = path.basename(document.uri.fsPath, '.cls');
    const root = findProjectRoot(document.uri.fsPath);
    const cov = getCoverage(root, className);
    if (!cov) {
      return [];
    }

    // Place the lens on the first class/interface/enum declaration.
    const lines = text.split(/\r?\n/);
    let declLine = 0;
    for (let i = 0; i < lines.length; i++) {
      if (/\b(?:class|interface|enum)\s+\w+/i.test(lines[i])) {
        declLine = i;
        break;
      }
    }

    const uncovered = cov.totalLines - cov.totalCovered;
    const icon = cov.coveredPercent >= 75 ? '$(pass)' : '$(warning)';
    const title = `${icon} ${cov.coveredPercent}% covered · ${cov.totalCovered}/${cov.totalLines} lines${uncovered ? ` · ${uncovered} uncovered` : ''}`;
    const range = new vscode.Range(declLine, 0, declLine, 0);
    // Clicking opens the latest report for context.
    return [new vscode.CodeLens(range, { title, command: '', arguments: [] })];
  }
}

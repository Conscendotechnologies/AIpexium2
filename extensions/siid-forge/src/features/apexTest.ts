/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as path from 'path';
import { Commands } from '../commands';
import { CancellationError } from '../core/sfExecutor';
import { getCoverage } from '../core/coverageStore';
import { findProjectRoot, resolveResourceUri } from '../core/workspace';
import { runApexTestClass, ApexRunResult } from '../core/apexTestRunner';
import { Feature } from './types';

/**
 * Editor UI for running/debugging Apex tests. The org-facing work (run + report +
 * coverage + logs) is headless in `core/apexTestRunner`; this file is the thin
 * adapter: CodeLenses, progress, result toasts, and launching the replay debug
 * session. See plan §18.A.
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

  // Keep the coverage CodeLens in sync whenever coverage is repainted — the AI
  // test panels (and any other producer) fire refreshCoverage after writing new
  // coverage, so this gives them the same "% covered" update the run button gets.
  context.subscriptions.push(
    vscode.commands.registerCommand(Commands.refreshCoverageLens, () => coverageLens.refresh())
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
            // The org-facing work is headless (core/apexTestRunner) — this just
            // adapts progress + collects the structured outcome for the UI below.
            tlog('runApexTestClass start');
            const res = await runApexTestClass(sf, orgs, trace, logger, projectRoot, className, {
              tests: opts?.tests,
              debug: opts?.debug,
              token,
              progress: (message) => progress.report({ message })
            });
            tlog(`runApexTestClass done (${res.passing}/${res.testsRan} passing, ${res.failing} failing)`);
            logToReplay = res.logFiles[0];
            outcome = { result: res.result, reportPath: res.reportPath, logCount: res.logFiles.length };
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

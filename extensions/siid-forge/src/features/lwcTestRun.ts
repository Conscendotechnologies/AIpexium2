/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as path from 'path';
import * as vscode from 'vscode';
import { Commands } from '../commands';
import { findProjectRoot } from '../core/workspace';
import { runJest, depsInstalled, JestRunResult } from '../core/lwcTestRunner';
import { Feature } from './types';

/**
 * Run/report LWC Jest tests in the IDE (layer A of LWC test automation). A
 * CodeLens "Run Test" / "Run All" sits above each `it`/`test`/`describe` in an
 * LWC `*.test.js`; running executes `sfdx-lwc-jest` (headless runner in
 * `core/lwcTestRunner`) and reports pass/fail inline via diagnostics + a toast.
 * Mirrors the Apex test feature. Guards for a missing `node_modules`.
 */
export const registerLwcTestRun: Feature = ({ context, logger }) => {
  const diagnostics = vscode.languages.createDiagnosticCollection('siid-forge-lwc-jest');
  const lens = new JestCodeLensProvider();
  context.subscriptions.push(
    diagnostics,
    vscode.languages.registerCodeLensProvider({ language: 'javascript', scheme: 'file' }, lens)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(Commands.runLwcTests, async (uri?: vscode.Uri, opts?: { testNamePattern?: string }) => {
      const resource = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!resource || !isLwcTestFile(resource.fsPath)) {
        vscode.window.showErrorMessage('SIID Forge: open an LWC test file (…/lwc/<cmp>/__tests__/*.test.js).');
        return;
      }
      const projectRoot = findProjectRoot(resource.fsPath);

      // Guard: dependencies must be installed for Jest to run.
      if (!depsInstalled(projectRoot)) {
        const choice = await vscode.window.showWarningMessage(
          'LWC test dependencies are not installed. Run `npm install` now?',
          'Run npm install'
        );
        if (choice === 'Run npm install') {
          runNpmInstall(projectRoot);
        }
        return;
      }

      const label = opts?.testNamePattern ?? path.basename(resource.fsPath);
      try {
        const result = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `SIID Forge: running LWC tests "${label}"…`, cancellable: false },
          () => runJest(projectRoot, { testFile: resource.fsPath, testNamePattern: opts?.testNamePattern })
        );
        reportResult(result, resource, diagnostics, logger);
      } catch (err: any) {
        logger.error(err.message);
        vscode.window.showErrorMessage(`❌ LWC test run failed: ${err.message}`);
      }
    })
  );
};

/** Publishes failures as diagnostics on the test file and shows a result toast. */
function reportResult(
  result: JestRunResult,
  resource: vscode.Uri,
  diagnostics: vscode.DiagnosticCollection,
  logger: { info(m: string): void; error(m: string): void }
): void {
  diagnostics.delete(resource);

  if (result.error) {
    logger.error(`[lwc-jest] ${result.error}`);
    vscode.window.showErrorMessage(`❌ LWC tests: ${result.error}`);
    return;
  }

  const diags: vscode.Diagnostic[] = [];
  for (const file of result.files) {
    for (const a of file.assertions) {
      if (a.status === 'failed') {
        const line = a.line ?? 0;
        const range = new vscode.Range(line, 0, line, 200);
        const msg = `${a.title}: ${firstLine(a.failureMessage) ?? 'failed'}`;
        const d = new vscode.Diagnostic(range, msg, vscode.DiagnosticSeverity.Error);
        d.source = 'LWC Jest';
        diags.push(d);
      }
    }
  }
  diagnostics.set(resource, diags);

  logger.info(`[lwc-jest] ${result.numPassed}/${result.numTotal} passed, ${result.numFailed} failed`);
  if (result.success && result.numFailed === 0) {
    vscode.window.showInformationMessage(`✅ LWC tests passed (${result.numPassed}/${result.numTotal}).`);
  } else {
    vscode.window.showErrorMessage(`❌ LWC tests: ${result.numFailed} failed, ${result.numPassed} passed.`);
  }
}

/** Runs `npm install` in a terminal so the user can watch progress. */
function runNpmInstall(projectRoot: string): void {
  const term = vscode.window.createTerminal({ name: 'SIID Forge: npm install', cwd: projectRoot });
  term.show();
  term.sendText('npm install');
}

function firstLine(s?: string): string | undefined {
  return s?.split('\n').find((l) => l.trim().length > 0)?.trim();
}

function isLwcTestFile(fsPath: string): boolean {
  const n = fsPath.replace(/\\/g, '/');
  return /\/lwc\//.test(n) && /\.test\.js$/.test(n);
}

/** A "Run Test" / "Run All" CodeLens above each Jest test in an LWC test file. */
class JestCodeLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!isLwcTestFile(document.uri.fsPath)) {
      return [];
    }
    const lenses: vscode.CodeLens[] = [];
    const lines = document.getText().split(/\r?\n/);

    // File-level "Run All" on the first `describe(` (or line 0).
    let placedRunAll = false;
    for (let i = 0; i < lines.length; i++) {
      const desc = lines[i].match(/\bdescribe\s*\(\s*['"`]/);
      if (desc) {
        lenses.push(this.lens(i, '$(run-all) Run All', document.uri, {}));
        placedRunAll = true;
        break;
      }
    }
    if (!placedRunAll) {
      lenses.push(this.lens(0, '$(run-all) Run All', document.uri, {}));
    }

    // Per-test "Run Test" on each `it(`/`test(`.
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/\b(?:it|test)\s*(?:\.\w+)?\s*\(\s*(['"`])([^'"`]+)\1/);
      if (m) {
        lenses.push(this.lens(i, '$(run) Run Test', document.uri, { testNamePattern: m[2] }));
      }
    }
    return lenses;
  }

  private lens(line: number, title: string, uri: vscode.Uri, opts: { testNamePattern?: string }): vscode.CodeLens {
    return new vscode.CodeLens(new vscode.Range(line, 0, line, 0), {
      title, command: Commands.runLwcTests, arguments: [uri, opts]
    });
  }
}

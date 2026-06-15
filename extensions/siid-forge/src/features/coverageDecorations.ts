/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as path from 'path';
import { Commands } from '../commands';
import { getCoverage } from '../core/coverageStore';
import { findProjectRoot } from '../core/workspace';
import { Feature } from './types';

/**
 * Paints per-line code-coverage highlights in Apex editors: green for covered
 * lines, red for uncovered ones, using the coverage recorded by the last test
 * run. Toggleable, and re-applied as editors/coverage change.
 */
export const registerCoverageDecorations: Feature = ({ context }) => {
  const covered = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(45, 185, 90, 0.12)',
    overviewRulerColor: 'rgba(45, 185, 90, 0.6)',
    overviewRulerLane: vscode.OverviewRulerLane.Left,
    isWholeLine: true,
    gutterIconPath: undefined
  });
  const uncovered = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(220, 60, 60, 0.14)',
    overviewRulerColor: 'rgba(220, 60, 60, 0.7)',
    overviewRulerLane: vscode.OverviewRulerLane.Left,
    isWholeLine: true
  });
  context.subscriptions.push(covered, uncovered);

  // On by default; toggled via command / status bar.
  let enabled = true;

  const isApex = (doc?: vscode.TextDocument) =>
    !!doc && doc.languageId === 'apex' && doc.uri.scheme === 'file';

  /** Test classes have no coverage of their own — they cover OTHER classes. */
  const isTestClass = (doc: vscode.TextDocument) => {
    const text = doc.getText();
    return /@istest/i.test(text) || /\btestmethod\b/i.test(text);
  };

  // Status bar toggle (left side). High priority so it isn't pushed off the
  // edge by built-in items. Shown for any Apex .cls; clicking flips highlighting.
  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1000);
  statusItem.command = Commands.toggleCoverage;
  context.subscriptions.push(statusItem);

  const updateStatusItem = () => {
    const editor = vscode.window.activeTextEditor;
    // Only on main (non-test) Apex classes — coverage applies to code under test.
    if (!editor || !isApex(editor.document) || isTestClass(editor.document)) {
      statusItem.hide();
      return;
    }
    const className = path.basename(editor.document.uri.fsPath, '.cls');
    const cov = getCoverage(findProjectRoot(editor.document.uri.fsPath), className);
    if (!cov) {
      // No coverage yet — still show a hint so the control is discoverable.
      statusItem.text = '$(shield) Coverage: run tests';
      statusItem.tooltip = `${className}: no coverage recorded yet — run this class's tests`;
      statusItem.show();
      return;
    }
    statusItem.text = enabled
      ? `$(eye) Coverage ${cov.coveredPercent}%`
      : `$(eye-closed) Coverage ${cov.coveredPercent}%`;
    statusItem.tooltip = enabled
      ? `${className}: ${cov.totalCovered}/${cov.totalLines} lines covered — click to hide highlighting`
      : `${className}: coverage highlighting hidden — click to show`;
    statusItem.show();
  };

  const apply = (editor?: vscode.TextEditor) => {
    if (!editor || !isApex(editor.document)) {
      return;
    }
    if (!enabled || isTestClass(editor.document)) {
      editor.setDecorations(covered, []);
      editor.setDecorations(uncovered, []);
      return;
    }
    const className = path.basename(editor.document.uri.fsPath, '.cls');
    const root = findProjectRoot(editor.document.uri.fsPath);
    const cov = getCoverage(root, className);
    if (!cov) {
      editor.setDecorations(covered, []);
      editor.setDecorations(uncovered, []);
      return;
    }
    const lineCount = editor.document.lineCount;
    const toRanges = (nums?: number[]) =>
      (nums ?? []) // tolerate older coverage files missing a field
        .filter((n) => n >= 1 && n <= lineCount) // log lines are 1-based; clamp to file
        .map((n) => new vscode.Range(n - 1, 0, n - 1, 0));
    editor.setDecorations(covered, toRanges(cov.covered));
    editor.setDecorations(uncovered, toRanges(cov.uncovered));
  };

  const applyAll = () => {
    vscode.window.visibleTextEditors.forEach(apply);
    updateStatusItem();
  };

  // Re-apply on editor focus/visibility and document edits.
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((e) => { apply(e); updateStatusItem(); }),
    vscode.window.onDidChangeVisibleTextEditors(applyAll),
    vscode.workspace.onDidChangeTextDocument((e) => {
      const editor = vscode.window.activeTextEditor;
      if (editor && e.document === editor.document) {
        apply(editor);
      }
    })
  );

  // Toggle command.
  context.subscriptions.push(
    vscode.commands.registerCommand(Commands.toggleCoverage, () => {
      enabled = !enabled;
      applyAll();
      vscode.window.setStatusBarMessage(`SIID Forge: coverage highlighting ${enabled ? 'on' : 'off'}`, 2000);
    })
  );

  // Refresh hook for after a test run writes new coverage.
  context.subscriptions.push(
    vscode.commands.registerCommand(Commands.refreshCoverage, () => applyAll())
  );

  applyAll();
};

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as path from 'path';
import * as vscode from 'vscode';
import { DiffEntry } from '../core/deployDiff';
import { openEntryDiff } from './diffReview';
import { escapeHtml, FORGE_STYLES } from '../ui/webview';

/**
 * Conflict-list panel (§19 phase 3). Shows every selected component's status
 * versus the chosen target org — ⬤ differs / ◯ identical / + new — with each
 * differing row opening the native diff editor on click. The user then chooses to
 * deploy everything, only the differing components, or cancel.
 *
 * The panel is presentation only: it renders the `DiffEntry[]` computed by the
 * phase-1 engine and calls back with the local paths to deploy. Running the
 * actual `sf project deploy start --target-org …` stays in the caller
 * (`deployToOrg`), so this panel never touches the CLI.
 */

/** What the user chose in the panel. */
export type ConflictChoice =
  | { action: 'deploy'; paths: string[] } // deploy these local paths
  | { action: 'cancel' };

export class ConflictPanel {
  private panel: vscode.WebviewPanel | undefined;
  private resolve: ((choice: ConflictChoice) => void) | undefined;

  /**
   * Opens the panel for a set of diff entries against `targetOrg` and resolves
   * with the user's choice (deploy a set of paths, or cancel). Resolves 'cancel'
   * if the panel is closed without a decision.
   */
  open(entries: DiffEntry[], targetOrg: string): Promise<ConflictChoice> {
    this.panel = vscode.window.createWebviewPanel(
      'siidForgeConflictList',
      `Deploy to ${targetOrg}: ${entries.length} component${entries.length === 1 ? '' : 's'}`,
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    this.panel.webview.html = this.html(entries, targetOrg);
    this.panel.webview.onDidReceiveMessage((m) => this.onMessage(m, entries));

    return new Promise<ConflictChoice>((resolve) => {
      this.resolve = resolve;
      this.panel!.onDidDispose(() => {
        // Closing the panel without a button press == cancel.
        this.finish({ action: 'cancel' });
      });
    });
  }

  private async onMessage(m: any, entries: DiffEntry[]): Promise<void> {
    switch (m?.command) {
      case 'openDiff': {
        const entry = entries[m.index];
        if (entry && entry.differs && entry.orgPath) {
          await openEntryDiff(entry);
        }
        return;
      }
      case 'deployAll':
        this.finish({ action: 'deploy', paths: entries.map((e) => e.localPath) });
        return;
      case 'deployDiffering':
        this.finish({ action: 'deploy', paths: entries.filter((e) => e.differs).map((e) => e.localPath) });
        return;
      case 'cancel':
        this.finish({ action: 'cancel' });
        return;
    }
  }

  /** Resolves the open() promise once, then disposes the panel. */
  private finish(choice: ConflictChoice): void {
    const r = this.resolve;
    this.resolve = undefined; // guard against double-resolve (button + dispose)
    if (r) {
      r(choice);
    }
    // Dispose after resolving; the dispose handler is now a no-op (resolve cleared).
    const p = this.panel;
    this.panel = undefined;
    p?.dispose();
  }

  private html(entries: DiffEntry[], targetOrg: string): string {
    const differingCount = entries.filter((e) => e.differs).length;
    const newCount = entries.filter((e) => e.isNew).length;
    const identicalCount = entries.length - differingCount - newCount;

    const rows = entries
      .map((e, i) => {
        const name = escapeHtml(e.fullName);
        const type = escapeHtml(e.type);
        const rel = e.localPath ? escapeHtml(path.basename(e.localPath)) : '';
        // Status: differ (clickable, opens diff) / new / identical.
        const status = e.differs
          ? `<span class="s-diff">⬤ differs</span>`
          : e.isNew
            ? `<span class="s-new">+ new to org</span>`
            : `<span class="s-same">◯ identical</span>`;
        const cls = e.differs ? 'clickable' : '';
        const openCell = e.differs
          ? `<button class="link" data-index="${i}">open diff</button>`
          : '';
        return `<tr class="${cls}" data-index="${i}">
          <td class="st">${status}</td>
          <td class="ty kind">${type}</td>
          <td class="nm">${name}<div class="muted">${rel}</div></td>
          <td class="op">${openCell}</td>
        </tr>`;
      })
      .join('');

    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${FORGE_STYLES}
      .summary { margin: 4px 0 14px; font-size: 13px; }
      .summary .s-diff { color: var(--forge-orange); font-weight: 600; }
      .summary .s-new { color: var(--forge-link); }
      .summary .s-same { color: var(--forge-muted); }
      table { width: 100%; border-collapse: collapse; font-size: 13px; }
      th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--forge-border); vertical-align: top; }
      th { color: var(--forge-muted); font-weight: 600; font-size: 11px; text-transform: uppercase; }
      .nm { font-family: var(--vscode-editor-font-family, monospace); }
      .nm .muted { font-family: var(--vscode-font-family); margin-top: 2px; }
      .st { white-space: nowrap; }
      .s-diff { color: var(--forge-orange); font-weight: 600; }
      .s-new { color: var(--forge-link); }
      .s-same { color: var(--forge-muted); }
      tr.clickable { cursor: pointer; }
      tr.clickable:hover td { background: var(--forge-sel); }
      .link { background: none; border: none; color: var(--vscode-textLink-foreground); cursor: pointer; padding: 0; font-size: 12px; }
      .link:hover { text-decoration: underline; }
      .bar { position: sticky; bottom: 0; background: var(--forge-bg); padding: 12px 0 4px; margin-top: 14px; border-top: 1px solid var(--forge-border); }
    </style></head><body>
      <h1>Deploy to "${escapeHtml(targetOrg)}"</h1>
      <div class="summary">
        <span class="s-diff">${differingCount} differ</span> ·
        <span class="s-new">${newCount} new</span> ·
        <span class="s-same">${identicalCount} identical</span>
        &nbsp;— click a differing row to open its diff.
      </div>
      <table>
        <thead><tr><th>Status</th><th>Type</th><th>Component</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="bar row">
        <span class="grow"></span>
        <button class="secondary" id="cancel">Cancel</button>
        <button class="secondary" id="deployDiffering" ${differingCount ? '' : 'disabled'}>Deploy differing (${differingCount})</button>
        <button class="accent" id="deployAll">Deploy all (${entries.length})</button>
      </div>
      <script>
        const vscode = acquireVsCodeApi();
        const $ = (id) => document.getElementById(id);
        $('cancel').onclick = () => vscode.postMessage({ command: 'cancel' });
        $('deployAll').onclick = () => vscode.postMessage({ command: 'deployAll' });
        $('deployDiffering').onclick = () => vscode.postMessage({ command: 'deployDiffering' });
        // Row / "open diff" click → open that entry's diff (differing rows only).
        document.querySelectorAll('tr.clickable').forEach((tr) => {
          tr.onclick = () => vscode.postMessage({ command: 'openDiff', index: Number(tr.dataset.index) });
        });
        document.querySelectorAll('.link').forEach((b) => {
          b.onclick = (e) => { e.stopPropagation(); vscode.postMessage({ command: 'openDiff', index: Number(b.dataset.index) }); };
        });
      </script>
    </body></html>`;
  }
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { Commands } from '../commands';
import { CancellationError } from '../core/sfExecutor';
import { Feature } from './types';
import { escapeHtml, FORGE_STYLES } from '../ui/webview';

interface QueryResult {
  totalSize?: number;
  done?: boolean;
  records?: Array<Record<string, any>>;
}

let panel: vscode.WebviewPanel | undefined;

/**
 * Runs a SOQL query (from the editor selection, a .soql file, or a prompt)
 * and shows the records in a results table.
 */
export const registerSoql: Feature = ({ context, sf, logger }) => {
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ language: 'soql', scheme: 'file' }, new SoqlCodeLensProvider())
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(Commands.runSoql, async () => {
      const query = await resolveQuery();
      if (!query) {
        return;
      }

      const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      try {
        const { result } = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'SIID Forge: running SOQL…', cancellable: true },
          (_progress, token) => sf.run<QueryResult>(['data', 'query', '--query', query], { cwd, token })
        );
        showResults(context, query, result);
      } catch (err: any) {
        if (err instanceof CancellationError) {
          vscode.window.showInformationMessage('SOQL cancelled.');
          return;
        }
        logger.error(err.message);
        vscode.window.showErrorMessage(`❌ SOQL failed: ${err.message}`);
      }
    })
  );
};

/** Query from editor selection, a .soql file, or an input prompt. */
async function resolveQuery(): Promise<string | undefined> {
  const editor = vscode.window.activeTextEditor;
  if (editor && !editor.selection.isEmpty) {
    const sel = editor.document.getText(editor.selection).trim();
    if (sel) {
      return sel;
    }
  }
  if (editor && (editor.document.fileName.endsWith('.soql') || editor.document.languageId === 'soql')) {
    const text = stripComments(editor.document.getText());
    if (text) {
      return text;
    }
  }
  return vscode.window.showInputBox({
    prompt: 'SOQL query',
    placeHolder: 'SELECT Id, Name FROM Account LIMIT 50',
    value: 'SELECT Id, Name FROM Account LIMIT 50'
  });
}

/** Removes // line comments and blank lines, returning the query text. */
function stripComments(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .filter((line) => line.length > 0)
    .join(' ')
    .trim();
}

/** Renders the query records into a reusable webview table. */
function showResults(context: vscode.ExtensionContext, query: string, result: QueryResult): void {
  if (!panel) {
    panel = vscode.window.createWebviewPanel('siidForgeSoql', 'SOQL Results', vscode.ViewColumn.Active, { enableScripts: false });
    panel.onDidDispose(() => (panel = undefined), null, context.subscriptions);
  }
  panel.title = 'SOQL Results';
  panel.webview.html = renderHtml(query, result);
  panel.reveal();
}

function renderHtml(query: string, result: QueryResult): string {
  const records = result.records ?? [];
  const columns = deriveColumns(records);

  const header = columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('');
  const rows = records
    .map((rec) => `<tr>${columns.map((c) => `<td>${escapeHtml(flatten(rec[c]))}</td>`).join('')}</tr>`)
    .join('');

  const body = records.length
    ? `<table><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table>`
    : '<p class="muted">No records returned.</p>';

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${FORGE_STYLES}</style></head>
  <body>
    <h1>SOQL Results</h1>
    <div class="muted">${escapeHtml(query)} &middot; ${result.totalSize ?? records.length} record(s)</div>
    ${body}
  </body></html>`;
}

/** Column keys across records, excluding Salesforce's `attributes` metadata. */
function deriveColumns(records: Array<Record<string, any>>): string[] {
  const cols = new Set<string>();
  for (const rec of records) {
    for (const key of Object.keys(rec)) {
      if (key !== 'attributes') {
        cols.add(key);
      }
    }
  }
  return [...cols];
}

/** Renders nested objects/arrays compactly for a table cell. */
function flatten(value: any): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'object') {
    if (Array.isArray(value)) {
      return `${value.length} item(s)`;
    }
    // Relationship object: show its type if present.
    return value.attributes?.type ? `{${value.attributes.type}}` : JSON.stringify(value);
  }
  return value;
}

/** Adds a "Run Query" CodeLens at the top of a .soql file. */
class SoqlCodeLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(): vscode.CodeLens[] {
    const range = new vscode.Range(0, 0, 0, 0);
    return [new vscode.CodeLens(range, { title: '$(database) Run Query', command: Commands.runSoql })];
  }
}

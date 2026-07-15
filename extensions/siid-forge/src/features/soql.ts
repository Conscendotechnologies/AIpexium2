/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { Commands } from '../commands';
import { CancellationError } from '../core/sfExecutor';
import { Feature } from './types';
import { ensureDefaultOrg } from '../ui/orgGuard';
import { notify } from '../ui/notify';
import { SoqlResultsPanel, QueryResult } from './soqlResultsPanel';

/**
 * Runs a SOQL query (from the editor selection, a .soql file, or a prompt)
 * and shows the records in an EDITABLE results grid (§H) — non-system fields can
 * be edited inline and saved back to the org via `SoqlResultsPanel`.
 */
export const registerSoql: Feature = ({ context, sf, logger, orgs, schema }) => {
  const cwd = () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ language: 'soql', scheme: 'file' }, new SoqlCodeLensProvider())
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(Commands.runSoql, async () => {
      const query = await resolveQuery();
      if (!query) {
        return;
      }
      if (!(await ensureDefaultOrg(orgs))) {
        return;
      }

      // Auto-add `Id` to the SELECT when it's missing, so records are editable in
      // the results grid without the user hand-editing the query. Then add the
      // lookup Id field for each relationship path (`Account.Name` → `AccountId`)
      // so the parent record Id shows as its own column (and links to the org).
      const finalQuery = ensureRelationshipIds(ensureIdInQuery(query));

      // Resolve SIID's default org first — this also HEALS the project's
      // `.sf/config.json` if it drifted from SIID's selection, so the CLI command
      // below (and every other CLI call) targets the org SIID shows, without
      // needing a per-command `--target-org`. See OrgManager.getDefaultOrg.
      await orgs.getDefaultOrg();

      const root = cwd();
      try {
        const { result } = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'SIID Forge: running SOQL…', cancellable: true },
          (_progress, token) => sf.run<QueryResult>(['data', 'query', '--query', finalQuery], { cwd: root, token })
        );
        SoqlResultsPanel.show({ sf, orgs, schema, logger, root: root ?? '' }, finalQuery, result);
      } catch (err: any) {
        if (err instanceof CancellationError) {
          notify.cancelled('SOQL');
          return;
        }
        logger.error(err.message);
        notify.err(`SOQL failed: ${err.message}`);
      }
    })
  );
};

/**
 * Adds `Id` to a query's SELECT list when it's missing, so the results grid can
 * target records for editing. Left unchanged when: there's no plain `FROM`
 * object, `Id` is already selected, the query is an aggregate (`COUNT()` /
 * `GROUP BY`), or it already pulls all fields (`FIELDS(...)`). Case-insensitive.
 */
export function ensureIdInQuery(query: string): string {
  const m = query.match(/^\s*select\s+(.+?)\s+from\s+([A-Za-z_]\w*)/is);
  if (!m) {
    return query; // no plain SELECT … FROM <object>
  }
  const selectList = m[1];
  // Skip aggregates / all-field selects — injecting Id would break or be moot.
  if (/\bgroup\s+by\b/i.test(query) || /\bcount\s*\(/i.test(selectList) || /\bfields\s*\(/i.test(selectList)) {
    return query;
  }
  // Already selecting Id (as a top-level field, not part of a relationship)?
  const hasId = selectList.split(',').some((f) => f.trim().toLowerCase() === 'id');
  if (hasId) {
    return query;
  }
  // Insert `Id, ` right after the SELECT keyword, preserving the rest verbatim.
  return query.replace(/(\bselect\s+)/i, `$1Id, `);
}

/**
 * For each relationship path in the SELECT (`Account.Name`, `Owner.Profile.Name`),
 * adds the corresponding lookup Id field (`AccountId`, `OwnerId`) to the SELECT so
 * the parent record's Id shows as its own column in the grid — and links out to
 * the org. The lookup field is derived from the FIRST relationship segment:
 *   - standard relationship `Account`   → `AccountId`
 *   - custom relationship   `MyRel__r`  → `MyRel__c`
 * Skipped when the Id field is already selected, or for aggregate/all-field
 * queries (same guards as {@link ensureIdInQuery}). Case-insensitive; the rest of
 * the query (WHERE/ORDER BY/LIMIT) is preserved verbatim.
 */
export function ensureRelationshipIds(query: string): string {
  const m = query.match(/^\s*select\s+(.+?)\s+from\s+([A-Za-z_]\w*)/is);
  if (!m) {
    return query;
  }
  const selectList = m[1];
  if (/\bgroup\s+by\b/i.test(query) || /\bcount\s*\(/i.test(selectList) || /\bfields\s*\(/i.test(selectList)) {
    return query;
  }
  const existing = new Set(selectList.split(',').map((f) => f.trim().toLowerCase()));
  // First segment of every dotted (relationship) column, e.g. `Account` from
  // `Account.RecordType.Name`. A Set keeps each parent's Id field added once.
  const idFields: string[] = [];
  for (const col of selectList.split(',').map((s) => s.trim())) {
    if (!col.includes('.') || !/^[A-Za-z_][\w.]*$/.test(col)) {
      continue;
    }
    const rel = col.split('.')[0];
    const idField = rel.toLowerCase().endsWith('__r') ? rel.slice(0, -3) + '__c' : rel + 'Id';
    if (!existing.has(idField.toLowerCase())) {
      existing.add(idField.toLowerCase());
      idFields.push(idField);
    }
  }
  if (!idFields.length) {
    return query;
  }
  // Insert the lookup Id fields right after the SELECT keyword.
  return query.replace(/(\bselect\s+)/i, `$1${idFields.join(', ')}, `);
}

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

/** Adds a "Run Query" CodeLens at the top of a .soql file. */
class SoqlCodeLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(): vscode.CodeLens[] {
    const range = new vscode.Range(0, 0, 0, 0);
    return [new vscode.CodeLens(range, { title: '$(database) Run Query', command: Commands.runSoql })];
  }
}

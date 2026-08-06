/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Commands } from '../commands';
import { ensureSiidSubdir } from '../core/forgeConfig';
import { notify } from '../ui/notify';
import { LogAnalyzerPanel } from './logAnalyzerPanel';
import { Feature } from './types';

/**
 * Registers the Apex Log Analyzer command. Lets the user pick a locally-saved
 * `.siid/logs/*.log`, or pull a recent log straight from the org, then opens the
 * visual analysis (limits / timings / SOQL-DML / debug+errors) in a webview over
 * the headless `analyzeLog` service.
 *
 * Also accepts a file path argument (`analyzeLog(logPath)`) so other features
 * (e.g. after a test/anon run) can deep-link straight into the analysis.
 */
export const registerLogAnalyzer: Feature = ({ context, sf, orgs, schema, logger }) => {
  const root = () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  context.subscriptions.push(
    vscode.commands.registerCommand(Commands.analyzeLog, async (arg?: string | vscode.Uri) => {
      const projectRoot = root();
      if (!projectRoot) {
        notify.err('Open a project folder first.');
        return;
      }
      // From a context menu VS Code passes the resource Uri; from the palette,
      // nothing (→ show the picker); a caller may pass an explicit path string.
      const argPath = arg instanceof vscode.Uri ? arg.fsPath : typeof arg === 'string' ? arg : undefined;
      const file = argPath ?? (await pickLog(sf, orgs, projectRoot, logger));
      if (!file) {
        return;
      }
      try {
        LogAnalyzerPanel.show(
          {
            schema,
            logger,
            root: projectRoot,
            // "Compare…" in the panel: pick another local log (or fetch from org).
            pickCompareLog: () => pickLog(sf, orgs, projectRoot, logger)
          },
          file
        );
      } catch (err: any) {
        logger.error(`analyzeLog: ${err?.message}`);
        notify.err(`Could not analyze log: ${err?.message}`);
      }
    })
  );
};

/** Local `.siid/logs/*.log` files, newest first. */
function localLogs(projectRoot: string): string[] {
  const dir = path.join(projectRoot, '.siid', 'logs');
  try {
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith('.log'))
      .map((f) => path.join(dir, f))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  } catch {
    return [];
  }
}

/**
 * Quick-pick: a local saved log, or "Fetch from org…" to download a recent org
 * log into `.siid/logs/`. Returns the chosen file path (or undefined if cancelled).
 */
async function pickLog(
  sf: import('../core/sfExecutor').SfExecutor,
  orgs: import('../core/orgManager').OrgManager,
  projectRoot: string,
  logger: import('../core/logger').Logger
): Promise<string | undefined> {
  const files = localLogs(projectRoot);
  const FETCH = '$(cloud-download) Fetch a recent log from the org…';
  const items: Array<vscode.QuickPickItem & { file?: string; fetch?: boolean }> = [
    { label: FETCH, fetch: true, alwaysShow: true },
    ...files.map((f) => ({ label: path.basename(f), description: f, file: f }))
  ];
  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: files.length ? 'Select a saved Apex log — or fetch one from the org' : 'No saved logs — fetch one from the org'
  });
  if (!pick) {
    return undefined;
  }
  return pick.fetch ? fetchFromOrg(sf, orgs, projectRoot, logger) : pick.file;
}

/**
 * Lists the org's recent debug logs, lets the user pick one, downloads it into
 * `.siid/logs/`, and returns the saved path.
 */
async function fetchFromOrg(
  sf: import('../core/sfExecutor').SfExecutor,
  orgs: import('../core/orgManager').OrgManager,
  projectRoot: string,
  logger: import('../core/logger').Logger
): Promise<string | undefined> {
  const org = await orgs.getDefaultOrg();
  if (!org) {
    notify.err('No default Salesforce org is set.');
    return undefined;
  }
  try {
    const { result } = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'SIID Forge: listing org logs…' },
      () => sf.run<Array<{ Id: string; Operation?: string; StartTime?: string; DurationMilliseconds?: number; LogLength?: number; Status?: string }>>(['apex', 'list', 'log'], { cwd: projectRoot })
    );
    const logs = (Array.isArray(result) ? result : []).sort(
      (a, b) => Date.parse(b.StartTime ?? '') - Date.parse(a.StartTime ?? '')
    );
    if (!logs.length) {
      notify.warn('No debug logs in the org. Run something first (a test, anon Apex, or a UI action with a trace flag).');
      return undefined;
    }
    const pick = await vscode.window.showQuickPick(
      logs.slice(0, 50).map((l) => ({
        label: l.Operation || l.Id,
        description: `${l.Status ?? ''} · ${l.DurationMilliseconds ?? '?'}ms · ${((l.LogLength ?? 0) / 1024).toFixed(0)}KB`,
        detail: l.StartTime,
        id: l.Id
      })),
      { placeHolder: 'Select an org debug log to download' }
    );
    if (!pick) {
      return undefined;
    }
    const { result: body } = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'SIID Forge: downloading log…' },
      () => sf.run<string>(['apex', 'get', 'log', '--log-id', pick.id], { cwd: projectRoot, json: false })
    );
    const dir = ensureSiidSubdir(projectRoot, 'logs');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(dir, `org-${stamp}-${pick.id}.log`);
    fs.writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body, null, 2), 'utf-8');
    return file;
  } catch (err: any) {
    logger.error(`fetchFromOrg: ${err?.message}`);
    notify.err(`Could not fetch org logs: ${err?.message}`);
    return undefined;
  }
}

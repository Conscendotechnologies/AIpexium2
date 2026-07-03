/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { Commands } from '../commands';
import { CancellationError } from '../core/sfExecutor';
import { SchemaManager } from '../core/schemaManager';
import { findProjectRoot, getWorkspaceCwd } from '../core/workspace';
import { notify } from '../ui/notify';
import { Feature } from './types';

/**
 * Refreshes the local schema cache (objects/Apex/LWC) and shows a Schema
 * Explorer tree. Org parts run via the CLI; Apex/LWC parse local files.
 */
export const registerSchema: Feature = ({ context, schema, logger, orgs }) => {
  const provider = new SchemaTreeProvider(schema);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('siidForgeSchema', provider)
  );

  const refreshTree = () => provider.refresh();

  // Keep the Apex cache live as .cls files change/create/delete.
  const clsWatcher = vscode.workspace.createFileSystemWatcher('**/*.cls');
  const onClsUpsert = (uri: vscode.Uri) => {
    const r = findProjectRoot(uri.fsPath);
    schema.refreshApexFile(r, uri.fsPath);
    schema.refreshAuraEnabled(r);
    refreshTree();
  };
  clsWatcher.onDidCreate(onClsUpsert);
  clsWatcher.onDidChange(onClsUpsert);
  clsWatcher.onDidDelete((uri) => {
    const r = findProjectRoot(uri.fsPath);
    schema.removeApexFile(r, uri.fsPath);
    schema.refreshAuraEnabled(r);
    refreshTree();
  });
  context.subscriptions.push(clsWatcher);

  // Keep the LWC cache live as component files change. LWC schema is parsed from
  // the whole component folder, so any of its files changing re-parses the set;
  // refreshLwc() is cheap (local reads) and rebuilds the index each time.
  const lwcWatcher = vscode.workspace.createFileSystemWatcher('**/lwc/**/*.{js,html,js-meta.xml}');
  const onLwcChange = (uri: vscode.Uri) => {
    schema.refreshLwc(findProjectRoot(uri.fsPath));
    refreshTree();
  };
  lwcWatcher.onDidCreate(onLwcChange);
  lwcWatcher.onDidChange(onLwcChange);
  lwcWatcher.onDidDelete(onLwcChange);
  context.subscriptions.push(lwcWatcher);

  context.subscriptions.push(
    vscode.commands.registerCommand(Commands.refreshSchema, () => refreshAll(schema, logger, refreshTree)),
    vscode.commands.registerCommand(Commands.refreshObjectSchema, () => refreshObjects(schema, logger, refreshTree)),
    vscode.commands.registerCommand(Commands.refreshApexSchema, () => refreshLocal(schema, 'apex', refreshTree)),
    vscode.commands.registerCommand(Commands.refreshLwcSchema, () => refreshLocal(schema, 'lwc', refreshTree)),
    vscode.commands.registerCommand(Commands.describeObject, () => describeObject(schema, logger, refreshTree)),
    // Internal: event-driven syncs (create/retrieve/deploy) call this to repaint
    // the tree after they refresh the cache.
    vscode.commands.registerCommand(Commands.refreshSchemaTree, () => refreshTree())
  );

  // Periodic OBJECT schema refresh — the only org-sourced schema, so the only one
  // that can drift from changes made in the org. Apex/LWC are local and kept in
  // sync by the watchers above. Runs quietly (no toasts); skips when no default
  // org is set. Reschedules when the settings change.
  registerObjectAutoRefresh(context, schema, orgs, logger, refreshTree);
};

/**
 * Sets up the background timer that re-describes the object schema from the org.
 * Honors `siid-forge.schemaAutoRefresh.{enabled,intervalMinutes}` and reschedules
 * live when those settings change.
 */
function registerObjectAutoRefresh(
  context: vscode.ExtensionContext,
  schema: SchemaManager,
  orgs: { getDefaultOrg(): Promise<string | undefined> },
  logger: { error(m: string): void; info(m: string): void },
  refreshTree: () => void
): void {
  let timer: ReturnType<typeof setInterval> | undefined;

  const intervalMinutes = () =>
    Math.max(15, vscode.workspace.getConfiguration('siid-forge').get<number>('schemaAutoRefresh.intervalMinutes', 120));

  const isEnabled = () =>
    vscode.workspace.getConfiguration('siid-forge').get<boolean>('schemaAutoRefresh.enabled', true);

  /** True when the object cache is older than one interval (or never built). */
  const isStale = (cwd: string): boolean => {
    const last = schema.getLastRefresh(cwd, 'objects');
    return !last || Date.now() - last.getTime() >= intervalMinutes() * 60_000;
  };

  const runQuietly = async () => {
    const cwd = getWorkspaceCwd();
    if (!cwd) {
      return;
    }
    // Staleness gate: an event-driven refresh (create/retrieve/deploy) stamps
    // meta.json too, so if something refreshed objects within the window, the
    // timer skips — the tick is a safety net, not a fixed re-fetch.
    if (!isStale(cwd)) {
      return;
    }
    // No org → nothing to pull; skip silently (the timer keeps ticking).
    const org = await orgs.getDefaultOrg().catch(() => undefined);
    if (!org) {
      return;
    }
    try {
      const count = await schema.refreshObjects(cwd);
      logger.info(`[schema] auto-refreshed ${count} object(s) from org "${org}"`);
      refreshTree();
    } catch (err: any) {
      logger.error(`[schema] auto-refresh: ${err.message}`);
    }
  };

  const reschedule = () => {
    if (timer) { clearInterval(timer); timer = undefined; }
    if (!isEnabled()) {
      return;
    }
    // Tick at the interval; runQuietly re-checks staleness each time so an event
    // refresh inside the window defers the next org fetch.
    timer = setInterval(() => { void runQuietly(); }, intervalMinutes() * 60_000);
    if (typeof timer.unref === 'function') { timer.unref(); }
  };

  // Startup catch-up: deferred past the activation burst; runQuietly's own
  // staleness gate decides whether a refresh is actually due.
  const catchUpTimer = setTimeout(() => { void runQuietly(); }, 20_000);
  if (typeof catchUpTimer.unref === 'function') { catchUpTimer.unref(); }
  context.subscriptions.push({ dispose: () => clearTimeout(catchUpTimer) });

  reschedule();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('siid-forge.schemaAutoRefresh')) {
        reschedule();
      }
    }),
    { dispose: () => { if (timer) { clearInterval(timer); } } }
  );
}

async function refreshAll(schema: SchemaManager, logger: { error(m: string): void }, refresh: () => void): Promise<void> {
  const cwd = getWorkspaceCwd();
  if (!cwd) {
    return;
  }
  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'SIID Forge: building schema cache…', cancellable: true },
      async (progress, token) => {
        progress.report({ message: 'objects (org)…' });
        const objs = await schema.refreshObjects(cwd, token);
        progress.report({ message: 'apex (local)…' });
        const apex = schema.refreshApex(cwd);
        progress.report({ message: 'lwc (local)…' });
        const lwc = schema.refreshLwc(cwd);
        notify.ok(`Schema cached: ${objs} object(s), ${apex} class(es), ${lwc} LWC.`);
      }
    );
  } catch (err: any) {
    if (err instanceof CancellationError) {
      notify.cancelled('Schema refresh');
    } else {
      logger.error(err.message);
      notify.err(`Schema refresh failed: ${err.message}`);
    }
  }
  refresh();
}

async function refreshObjects(schema: SchemaManager, logger: { error(m: string): void }, refresh: () => void): Promise<void> {
  const cwd = getWorkspaceCwd();
  if (!cwd) {
    return;
  }
  try {
    const count = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'SIID Forge: refreshing object schema…', cancellable: true },
      (_p, token) => schema.refreshObjects(cwd, token)
    );
    notify.ok(`Cached ${count} object schema(s).`);
  } catch (err: any) {
    if (err instanceof CancellationError) {
      notify.cancelled('Object schema refresh');
    } else {
      logger.error(err.message);
      notify.err(`Object schema refresh failed: ${err.message}`);
    }
  }
  refresh();
}

function refreshLocal(schema: SchemaManager, kind: 'apex' | 'lwc', refresh: () => void): void {
  const cwd = getWorkspaceCwd();
  if (!cwd) {
    return;
  }
  const count = kind === 'apex' ? schema.refreshApex(cwd) : schema.refreshLwc(cwd);
  notify.ok(`Cached ${count} ${kind === 'apex' ? 'Apex class(es)' : 'LWC component(s)'}.`);
  refresh();
}

async function describeObject(schema: SchemaManager, logger: { error(m: string): void }, refresh: () => void): Promise<void> {
  const cwd = getWorkspaceCwd();
  if (!cwd) {
    return;
  }
  const name = await vscode.window.showInputBox({ prompt: 'SObject API name to describe', placeHolder: 'Account' });
  if (!name) {
    return;
  }
  try {
    const ok = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `SIID Forge: describing ${name}…`, cancellable: true },
      (_p, token) => schema.describeObject(cwd, name.trim(), token)
    );
    if (ok) {
      notify.ok(`Cached schema for ${name}.`);
    } else {
      notify.err(`Could not describe ${name}.`);
    }
  } catch (err: any) {
    logger.error(err.message);
    notify.err(`Describe failed: ${err.message}`);
  }
  refresh();
}

// ----------------------------------------------------------- Schema Explorer

type Node =
  | { kind: 'category'; label: string; category: 'objects' | 'apex' | 'lwc' | 'aura' }
  | { kind: 'object'; name: string }
  | { kind: 'field'; label: string }
  | { kind: 'apex'; name: string }
  | { kind: 'apexMember'; label: string }
  | { kind: 'lwc'; name: string }
  | { kind: 'lwcDetail'; label: string }
  | { kind: 'auraClass'; name: string }
  | { kind: 'auraMethod'; label: string };

class SchemaTreeProvider implements vscode.TreeDataProvider<Node> {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  constructor(private readonly schema: SchemaManager) { }

  refresh(): void {
    this._onDidChange.fire();
  }

  getTreeItem(node: Node): vscode.TreeItem {
    switch (node.kind) {
      case 'category':
        return collapsible(node.label, vscode.TreeItemCollapsibleState.Collapsed, 'symbol-namespace');
      case 'object':
        return collapsible(node.name, vscode.TreeItemCollapsibleState.Collapsed, 'symbol-class');
      case 'apex':
        return collapsible(node.name, vscode.TreeItemCollapsibleState.Collapsed, 'symbol-class');
      case 'auraClass':
        return collapsible(node.name, vscode.TreeItemCollapsibleState.Collapsed, 'symbol-method');
      case 'lwc':
        return collapsible(node.name, vscode.TreeItemCollapsibleState.Collapsed, 'symbol-event');
      default:
        return new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
    }
  }

  getChildren(node?: Node): Node[] {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!cwd) {
      return [];
    }
    if (!node) {
      return [
        { kind: 'category', label: 'Objects', category: 'objects' },
        { kind: 'category', label: 'Apex', category: 'apex' },
        { kind: 'category', label: 'Apex @AuraEnabled (LWC)', category: 'aura' },
        { kind: 'category', label: 'LWC', category: 'lwc' }
      ];
    }
    if (node.kind === 'category') {
      if (node.category === 'objects') {
        return this.schema.cachedObjectNames(cwd).sort().map((name) => ({ kind: 'object', name }));
      }
      if (node.category === 'apex') {
        return this.schema.listApex(cwd).map((a) => ({ kind: 'apex', name: a.name }));
      }
      if (node.category === 'aura') {
        return Object.keys(this.schema.readAuraEnabled(cwd)).sort().map((name) => ({ kind: 'auraClass', name }));
      }
      return this.schema.listLwc(cwd).map((l) => ({ kind: 'lwc', name: l.name }));
    }
    if (node.kind === 'auraClass') {
      const methods = this.schema.readAuraEnabled(cwd)[node.name] ?? [];
      return methods.map((m) => ({ kind: 'auraMethod', label: `${m.name}() : ${m.returnType ?? '?'}` }));
    }
    if (node.kind === 'object') {
      const obj = this.schema.readObject(cwd, node.name);
      return (obj?.fields ?? []).map((f) => ({
        kind: 'field',
        label: `${f.name} : ${f.type ?? '?'}${f.referenceTo ? ` -> ${f.referenceTo.join(',')}` : ''}`
      }));
    }
    if (node.kind === 'apex') {
      const cls = this.schema.listApex(cwd).find((a) => a.name === node.name);
      return (cls?.members ?? []).map((m) => ({
        kind: 'apexMember',
        label: `${m.kind === 'method' ? '()' : '·'} ${m.name} : ${m.returnType ?? '?'}`
      }));
    }
    if (node.kind === 'lwc') {
      const cmp = this.schema.listLwc(cwd).find((l) => l.name === node.name);
      const details: Node[] = [];
      details.push({ kind: 'lwcDetail', label: `exposed: ${cmp?.isExposed ? 'yes' : 'no'}` });
      for (const p of cmp?.apiProperties ?? []) {
        details.push({ kind: 'lwcDetail', label: `@api ${p}` });
      }
      for (const t of cmp?.targets ?? []) {
        details.push({ kind: 'lwcDetail', label: `target: ${t}` });
      }
      return details;
    }
    return [];
  }
}

function collapsible(label: string, state: vscode.TreeItemCollapsibleState, icon: string): vscode.TreeItem {
  const item = new vscode.TreeItem(label, state);
  item.iconPath = new vscode.ThemeIcon(icon);
  return item;
}

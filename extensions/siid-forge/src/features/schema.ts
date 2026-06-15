/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { Commands } from '../commands';
import { CancellationError } from '../core/sfExecutor';
import { SchemaManager } from '../core/schemaManager';
import { findProjectRoot, getWorkspaceCwd } from '../core/workspace';
import { Feature } from './types';

/**
 * Refreshes the local schema cache (objects/Apex/LWC) and shows a Schema
 * Explorer tree. Org parts run via the CLI; Apex/LWC parse local files.
 */
export const registerSchema: Feature = ({ context, schema, logger }) => {
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

  context.subscriptions.push(
    vscode.commands.registerCommand(Commands.refreshSchema, () => refreshAll(schema, logger, refreshTree)),
    vscode.commands.registerCommand(Commands.refreshObjectSchema, () => refreshObjects(schema, logger, refreshTree)),
    vscode.commands.registerCommand(Commands.refreshApexSchema, () => refreshLocal(schema, 'apex', refreshTree)),
    vscode.commands.registerCommand(Commands.refreshLwcSchema, () => refreshLocal(schema, 'lwc', refreshTree)),
    vscode.commands.registerCommand(Commands.describeObject, () => describeObject(schema, logger, refreshTree))
  );
};

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
        vscode.window.showInformationMessage(`✅ Schema cached: ${objs} object(s), ${apex} class(es), ${lwc} LWC.`);
      }
    );
  } catch (err: any) {
    if (err instanceof CancellationError) {
      vscode.window.showInformationMessage('Schema refresh cancelled.');
    } else {
      logger.error(err.message);
      vscode.window.showErrorMessage(`❌ Schema refresh failed: ${err.message}`);
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
    vscode.window.showInformationMessage(`✅ Cached ${count} object schema(s).`);
  } catch (err: any) {
    if (err instanceof CancellationError) {
      vscode.window.showInformationMessage('Object schema refresh cancelled.');
    } else {
      logger.error(err.message);
      vscode.window.showErrorMessage(`❌ Object schema refresh failed: ${err.message}`);
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
  vscode.window.showInformationMessage(`✅ Cached ${count} ${kind === 'apex' ? 'Apex class(es)' : 'LWC component(s)'}.`);
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
      vscode.window.showInformationMessage(`✅ Cached schema for ${name}.`);
    } else {
      vscode.window.showErrorMessage(`❌ Could not describe ${name}.`);
    }
  } catch (err: any) {
    logger.error(err.message);
    vscode.window.showErrorMessage(`❌ Describe failed: ${err.message}`);
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

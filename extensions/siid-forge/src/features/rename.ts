/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as path from 'path';
import * as vscode from 'vscode';
import { SchemaManager } from '../core/schemaManager';
import { findReferences, RenameTarget } from '../core/refactor';
import { Feature } from './types';

/**
 * Project-wide rename (F2) for Apex symbols, schema-aware. Renaming a class or a
 * method updates every reference across `.cls`/`.trigger`/LWC/Aura files, with
 * VS Code's built-in rename preview. Reference discovery lives in
 * `core/refactor` (agent-consumable); this is the editor integration.
 *
 * Scope/honesty: identifier-token based (no full Apex AST). It renames the bare
 * name everywhere it appears as a word (comments/strings excluded). For common
 * cases (class names, distinctively-named methods) this is accurate; very common
 * names may over-match — the rename preview lets the user untick those.
 */
export const registerRename: Feature = ({ context, schema }) => {
  const provider = new ApexRenameProvider(schema);
  const selector = [{ language: 'apex', scheme: 'file' }];
  context.subscriptions.push(
    vscode.languages.registerRenameProvider(selector, provider)
  );
};

class ApexRenameProvider implements vscode.RenameProvider {
  constructor(private readonly schema: SchemaManager) { }

  private root(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  /** Validate the symbol under the cursor is something we know how to rename. */
  prepareRename(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.ProviderResult<vscode.Range | { range: vscode.Range; placeholder: string }> {
    const range = document.getWordRangeAtPosition(position);
    if (!range) {
      throw new Error('Nothing to rename here.');
    }
    const target = this.identify(document, range);
    if (!target) {
      throw new Error('SIID Forge can only rename known Apex classes or methods.');
    }
    return { range, placeholder: document.getText(range) };
  }

  provideRenameEdits(
    document: vscode.TextDocument,
    position: vscode.Position,
    newName: string
  ): vscode.ProviderResult<vscode.WorkspaceEdit> {
    const root = this.root();
    const range = document.getWordRangeAtPosition(position);
    if (!root || !range) {
      return undefined;
    }
    if (!/^[A-Za-z_]\w*$/.test(newName)) {
      throw new Error('Invalid Apex identifier.');
    }
    const target = this.identify(document, range);
    if (!target) {
      throw new Error('SIID Forge can only rename known Apex classes or methods.');
    }

    const refs = findReferences(this.schema, root, target);
    const edit = new vscode.WorkspaceEdit();
    for (const r of refs) {
      const refRange = new vscode.Range(r.line, r.column, r.line, r.column + r.length);
      edit.replace(vscode.Uri.file(r.filePath), refRange, newName);
    }

    // If renaming a class, also rename its files (.cls + .cls-meta.xml, etc.).
    if (target.kind === 'class') {
      this.addFileRenames(edit, root, target.name, newName);
    }
    return edit;
  }

  /** Classifies the word under the cursor as a known class or method. */
  private identify(document: vscode.TextDocument, range: vscode.Range): RenameTarget | undefined {
    const root = this.root();
    if (!root) {
      return undefined;
    }
    const word = document.getText(range);

    // A known class name?
    if (this.schema.readApex(root, word)) {
      return { kind: 'class', name: word };
    }

    // A method of the current class (or any cached class)?
    const localClass = this.schema.readApex(root, path.basename(document.fileName, '.cls'));
    if (localClass?.members.some((m) => m.kind === 'method' && m.name === word)) {
      return { kind: 'method', name: word, owner: localClass.name };
    }
    for (const cls of this.schema.listApex(root)) {
      if (cls.members.some((m) => m.kind === 'method' && m.name === word)) {
        return { kind: 'method', name: word, owner: cls.name };
      }
    }
    return undefined;
  }

  /** Adds renames for the class's own files (Class.cls, Class.cls-meta.xml). */
  private addFileRenames(edit: vscode.WorkspaceEdit, root: string, oldName: string, newName: string): void {
    const file = this.schema.readApex(root, oldName)?.filePath;
    if (!file) {
      return;
    }
    const dir = path.dirname(file);
    const candidates = [`${oldName}.cls`, `${oldName}.cls-meta.xml`];
    for (const base of candidates) {
      const oldPath = path.join(dir, base);
      const newBase = base.replace(oldName, newName);
      const newPath = path.join(dir, newBase);
      edit.renameFile(vscode.Uri.file(oldPath), vscode.Uri.file(newPath), { ignoreIfExists: false });
    }
  }
}

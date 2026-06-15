/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Walks up from a starting directory to find the SFDX project root
 * (the folder containing sfdx-project.json). Falls back to the owning
 * workspace folder, then the starting directory itself.
 */
export function findProjectRoot(startFsPath: string): string {
  let dir = startFsPath;
  while (true) {
    if (fs.existsSync(path.join(dir, 'sfdx-project.json'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  const owning = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(startFsPath));
  return owning?.uri.fsPath ?? startFsPath;
}

/**
 * Resolves the workspace folder a command should run in. Prefers the folder of
 * the active editor, falling back to the first workspace folder.
 * Shows an error and returns undefined when no folder is open.
 */
export function getWorkspaceCwd(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    vscode.window.showErrorMessage('SIID Forge: open a Salesforce project folder first.');
    return undefined;
  }

  const activeUri = vscode.window.activeTextEditor?.document.uri;
  if (activeUri) {
    const owning = vscode.workspace.getWorkspaceFolder(activeUri);
    if (owning) {
      return owning.uri.fsPath;
    }
  }
  return folders[0].uri.fsPath;
}

/**
 * Resolves the resource a command should act on: the explicitly passed uri
 * (from an explorer/editor context menu), falling back to the active editor's
 * file. Shows an error and returns undefined when nothing is available.
 */
export function resolveResourceUri(uri?: vscode.Uri): vscode.Uri | undefined {
  if (uri) {
    return uri;
  }
  const active = vscode.window.activeTextEditor?.document.uri;
  if (active && active.scheme === 'file') {
    return active;
  }
  vscode.window.showErrorMessage('SIID Forge: no file selected.');
  return undefined;
}

/**
 * Resolves the cwd (project root) and absolute output directory for a generate
 * command. When a folder was clicked in the explorer, it is used directly;
 * otherwise the user is prompted for a directory relative to the workspace.
 */
export async function resolveOutputTarget(
  folderUri: vscode.Uri | undefined,
  defaultRelDir: string
): Promise<{ cwd: string; outputDir: string } | undefined> {
  if (folderUri) {
    return { cwd: findProjectRoot(folderUri.fsPath), outputDir: folderUri.fsPath };
  }

  const cwd = getWorkspaceCwd();
  if (!cwd) {
    return undefined;
  }
  const relDir = await vscode.window.showInputBox({
    prompt: 'Output directory',
    value: defaultRelDir,
    validateInput: (value) => (value.trim() ? undefined : 'Directory is required.')
  });
  if (!relDir) {
    return undefined;
  }
  return { cwd, outputDir: `${cwd}/${relDir.trim()}` };
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/** Max length of a Salesforce API name (Apex class/trigger, Aura bundle, etc.). */
export const SF_API_NAME_MAX_LEN = 40;

/** Default metadata API version used when a project doesn't declare one. */
export const DEFAULT_API_VERSION = '62.0';

/**
 * Reads `sourceApiVersion` from the project's sfdx-project.json, or undefined
 * when the project doesn't declare one.
 */
export function readProjectApiVersion(root: string): string | undefined {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(root, 'sfdx-project.json'), 'utf-8'));
    if (cfg.sourceApiVersion) {
      return String(cfg.sourceApiVersion);
    }
  } catch {
    // no/invalid project file
  }
  return undefined;
}

/**
 * Resolves the metadata API version for local scaffolds, in order of confidence:
 * the project's `sourceApiVersion` (authoritative for the project) → the org's
 * API version (via `orgs.getApiVersion()`, cached/mirrored) → {@link
 * DEFAULT_API_VERSION}. Async because the org lookup may hit the (cached) CLI.
 */
export async function resolveApiVersion(
  root: string,
  orgs: { getApiVersion(): Promise<string | undefined> }
): Promise<string> {
  const fromProject = readProjectApiVersion(root);
  if (fromProject) {
    return fromProject;
  }
  try {
    const fromOrg = await orgs.getApiVersion();
    if (fromOrg) {
      return fromOrg;
    }
  } catch {
    // org unavailable — fall through to the default
  }
  return DEFAULT_API_VERSION;
}

/**
 * Synchronous project-only version read with the hard default. Retained for
 * callers that can't await / have no org handle (e.g. test scaffolds).
 */
export function readSourceApiVersion(root: string): string {
  return readProjectApiVersion(root) ?? DEFAULT_API_VERSION;
}

/** Numeric compare of two API-version strings ("67.0" > "66.0"). */
export function apiVersionIsNewer(a: string, b: string): boolean {
  return parseFloat(a) > parseFloat(b);
}

/**
 * Writes `sourceApiVersion` into the project's sfdx-project.json in place,
 * preserving the file's existing 2-space JSON formatting. Returns true on
 * success. Best-effort: returns false (without throwing) if the file is missing
 * or unparseable, so callers can degrade gracefully.
 */
export function writeProjectApiVersion(root: string, version: string): boolean {
  const file = path.join(root, 'sfdx-project.json');
  try {
    const cfg = JSON.parse(fs.readFileSync(file, 'utf-8'));
    cfg.sourceApiVersion = version;
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n', 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates a proposed Salesforce API name (Apex class/trigger, Aura component)
 * for an `InputBox`. Returns an error string to display, or `undefined` when the
 * name is valid. Enforces BOTH the identifier pattern AND the 40-char limit —
 * the length check is easy to forget and produces a confusing "Identifier name
 * is too long" only at deploy time, long after the file was created.
 */
export function validateApexName(value: string): string | undefined {
  const name = value.trim();
  if (!/^[A-Za-z_]\w*$/.test(name)) {
    return 'Must start with a letter/underscore; letters, numbers, underscores only.';
  }
  if (name.length > SF_API_NAME_MAX_LEN) {
    return `Too long: ${name.length}/${SF_API_NAME_MAX_LEN} characters. Salesforce API names are capped at ${SF_API_NAME_MAX_LEN}.`;
  }
  return undefined;
}

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

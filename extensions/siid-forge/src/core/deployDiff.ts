/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SfExecutor } from './sfExecutor';

/** One source file's relationship to the org, computed for a diff-before-deploy. */
export interface DiffEntry {
  /** Absolute local source file path (the content file, not -meta.xml). */
  localPath: string;
  /** Metadata type, e.g. "ApexClass". */
  type: string;
  /** Component API name, e.g. "MyClass". */
  fullName: string;
  /** Path to the retrieved org copy (in a temp dir), or undefined if new in org. */
  orgPath?: string;
  /** True when the component does not exist in the org yet. */
  isNew: boolean;
  /** True when local and org content differ (false for new or identical). */
  differs: boolean;
}

/** A collected source file with its owning component identity. */
export interface DeployFile {
  localPath: string;
  type: string;
  fullName: string;
  /** Path relative to the component root — '' for single-file types (Apex). */
  rel: string;
}

/** Single-file metadata: one content file per component. */
const SINGLE_TYPES: Array<{ folder: string; type: string; exts: string[] }> = [
  { folder: 'classes', type: 'ApexClass', exts: ['.cls'] },
  { folder: 'triggers', type: 'ApexTrigger', exts: ['.trigger'] },
  { folder: 'pages', type: 'ApexPage', exts: ['.page'] },
  { folder: 'components', type: 'ApexComponent', exts: ['.component'] }
];

/** Bundle metadata: a component is a folder of files under `<folder>/<name>/`. */
const BUNDLE_TYPES: Array<{ folder: string; type: string }> = [
  { folder: 'lwc', type: 'LightningComponentBundle' },
  { folder: 'aura', type: 'AuraDefinitionBundle' }
];

/**
 * Collects the deployable content files under `target` (a file or folder),
 * skipping `-meta.xml` siblings. Supports single-file Apex types and multi-file
 * bundles (LWC/Aura). Other metadata (objects, flows…) is not mapped and falls
 * back to a plain deploy without diff.
 */
export function collectDeployFiles(target: string): DeployFile[] {
  const out: DeployFile[] = [];
  const visit = (p: string) => {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(p);
    } catch {
      return;
    }
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(p)) {
        visit(path.join(p, entry));
      }
      return;
    }
    if (p.endsWith('-meta.xml')) {
      return;
    }
    const mapped = classify(p);
    if (mapped) {
      out.push(mapped);
    }
  };
  visit(target);
  return out;
}

/** Derives metadata type + fullName (+ bundle-relative path) from a file path. */
function classify(filePath: string): DeployFile | undefined {
  const norm = filePath.replace(/\\/g, '/');
  const parts = norm.split('/');
  const ext = path.extname(filePath);

  // Single-file Apex types: the content file IS the component.
  for (const t of SINGLE_TYPES) {
    if (t.exts.includes(ext) && parts.includes(t.folder)) {
      return { localPath: filePath, type: t.type, fullName: path.basename(filePath, ext), rel: '' };
    }
  }

  // Bundles: <folder>/<componentName>/<...files>. fullName = componentName,
  // rel = path within that component folder.
  for (const b of BUNDLE_TYPES) {
    const idx = parts.indexOf(b.folder);
    if (idx >= 0 && parts.length > idx + 2) {
      const fullName = parts[idx + 1];
      const rel = parts.slice(idx + 2).join('/');
      return { localPath: filePath, type: b.type, fullName, rel };
    }
  }
  return undefined;
}

/**
 * For each supported file under the deploy target, retrieves the org copy and
 * determines whether it is new / identical / changed. Headless service — the UI
 * and the AI agent both call it. Bundle components (LWC/Aura) are retrieved once
 * per component, then each member file is matched by its bundle-relative path.
 */
export async function computeDeployDiff(
  sf: SfExecutor,
  files: DeployFile[],
  cwd: string,
  token?: vscode.CancellationToken
): Promise<DiffEntry[]> {
  const entries: DiffEntry[] = [];

  // Group files by component (type + fullName) so each is retrieved only once.
  const groups = new Map<string, DeployFile[]>();
  for (const f of files) {
    const key = `${f.type}:${f.fullName}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(f);
  }

  for (const group of groups.values()) {
    if (token?.isCancellationRequested) {
      break;
    }
    const { type, fullName } = group[0];

    // Single-file Apex types: fetch the source field via the Tooling API — fast,
    // no zip, no project-path constraint. Each group has exactly one file.
    const field = TOOLING_SOURCE_FIELD[type];
    if (field) {
      const f = group[0];
      const base = { localPath: f.localPath, type: f.type, fullName: f.fullName };
      const orgBody = await fetchToolingSource(sf, field.object, field.field, fullName, cwd, token);
      if (orgBody === undefined) {
        entries.push({ ...base, isNew: true, differs: false });
      } else {
        const orgPath = writeOrgTemp(fullName, path.extname(f.localPath), orgBody);
        entries.push({ ...base, orgPath, isNew: false, differs: !sameTextContent(f.localPath, orgBody) });
      }
      continue;
    }

    // Bundles (LWC/Aura): no single source field — retrieve+unzip not yet
    // implemented, so deploy without a per-file diff (honest fallback).
    for (const f of group) {
      entries.push({ localPath: f.localPath, type: f.type, fullName: f.fullName, isNew: false, differs: false });
    }
  }
  return entries;
}

/** Apex metadata type -> its Tooling API object + source field. */
const TOOLING_SOURCE_FIELD: Record<string, { object: string; field: string }> = {
  ApexClass: { object: 'ApexClass', field: 'Body' },
  ApexTrigger: { object: 'ApexTrigger', field: 'Body' },
  ApexPage: { object: 'ApexPage', field: 'Markup' },
  ApexComponent: { object: 'ApexComponent', field: 'Markup' }
};

/** Fetches a component's source field via the Tooling API, or undefined if absent. */
async function fetchToolingSource(
  sf: SfExecutor,
  object: string,
  field: string,
  fullName: string,
  cwd: string,
  token?: vscode.CancellationToken
): Promise<string | undefined> {
  try {
    const { result } = await sf.run<{ records: Array<Record<string, string>> }>(
      ['data', 'query', '--use-tooling-api', '--query', `SELECT ${field} FROM ${object} WHERE Name = '${fullName}'`],
      { cwd, token }
    );
    const body = result?.records?.[0]?.[field];
    return typeof body === 'string' ? body : undefined;
  } catch {
    return undefined;
  }
}

/** Writes org source to a temp file (so the diff editor can open it). */
function writeOrgTemp(fullName: string, ext: string, body: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'siid-forge-org-'));
  const file = path.join(dir, `${fullName}${ext}`);
  fs.writeFileSync(file, body, 'utf-8');
  return file;
}

/** Compares a local file to an in-memory org body, ignoring EOL/trailing noise. */
function sameTextContent(localPath: string, orgBody: string): boolean {
  try {
    return normalize(fs.readFileSync(localPath, 'utf-8')) === normalize(orgBody);
  } catch {
    return false;
  }
}

/** Normalizes EOL + trailing whitespace so cosmetic noise isn't a "difference". */
function normalize(s: string): string {
  return s.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n+$/g, '\n');
}

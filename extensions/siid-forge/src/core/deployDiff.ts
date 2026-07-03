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

/** One deployable/retrievable component (all its files grouped under its identity). */
export interface ComponentRef {
  /** Metadata type, e.g. "ApexClass" / "LightningComponentBundle". */
  type: string;
  /** Component API name, e.g. "MyClass". */
  fullName: string;
  /** Every local file that belongs to this component (one for Apex, many for a bundle). */
  paths: string[];
}

/** SFDX `packageDirectories` from sfdx-project.json, defaulting to `force-app`. */
function packageDirs(cwd: string): string[] {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(cwd, 'sfdx-project.json'), 'utf-8'));
    const dirs = Array.isArray(cfg.packageDirectories)
      ? cfg.packageDirectories.map((d: { path?: string }) => d.path).filter((p: unknown): p is string => typeof p === 'string' && !!p)
      : [];
    return dirs.length ? dirs : ['force-app'];
  } catch {
    return ['force-app'];
  }
}

/**
 * Enumerates every supported local component under the project's package
 * directories, grouped by metadata type + name. Backs the component multi-picker
 * for `Deploy to Org…` / `Retrieve from Org…` — selection is by COMPONENT, not by
 * dumping a folder. Reuses the same classifier as the diff/deploy path
 * (`collectDeployFiles`), so "what's a component" has a single definition.
 */
export function listLocalComponents(cwd: string): ComponentRef[] {
  const files: DeployFile[] = [];
  for (const dir of packageDirs(cwd)) {
    const abs = path.join(cwd, dir);
    if (fs.existsSync(abs)) {
      files.push(...collectDeployFiles(abs));
    }
  }
  return groupComponents(files);
}

/** Groups collected files by `type:fullName` into ComponentRefs (sorted by type, then name). */
export function groupComponents(files: DeployFile[]): ComponentRef[] {
  const map = new Map<string, ComponentRef>();
  for (const f of files) {
    const key = `${f.type}:${f.fullName}`;
    let ref = map.get(key);
    if (!ref) {
      ref = { type: f.type, fullName: f.fullName, paths: [] };
      map.set(key, ref);
    }
    ref.paths.push(f.localPath);
  }
  return [...map.values()].sort((a, b) => a.type.localeCompare(b.type) || a.fullName.localeCompare(b.fullName));
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
 * XML-defined metadata whose definition lives entirely in a single `-meta.xml`
 * file (no separate content file, no Tooling source field). These are diffed by
 * retrieving the org copy and comparing the file text.
 *
 * `folder` is the SFDX source folder; `srcSuffix` is the source-format filename
 * suffix (what's on disk locally); `mdExt` is the metadata-format extension the
 * org retrieve produces (the org copy comes back in metadata format, which uses a
 * different suffix). Both are needed because we compare a local source-format
 * file to an org metadata-format file.
 *
 * NOTE: `CustomObject` is intentionally EXCLUDED. Objects are *decomposed* in
 * source format (one `-meta.xml` per field/listView under `objects/<name>/…`) but
 * come back as a single inline `<name>.object` from a metadata-format retrieve, so
 * the two are not file-comparable without a source-convert step. Object/field diff
 * is deferred (see §19 notes). Only non-decomposed single-file XML types are here:
 * these DO map 1:1 between source and metadata format by component name.
 */
const XML_TYPES: Array<{ folder: string; type: string; srcSuffix: string; mdExt: string }> = [
  { folder: 'permissionsets', type: 'PermissionSet', srcSuffix: 'permissionset-meta.xml', mdExt: 'permissionset' },
  { folder: 'flows', type: 'Flow', srcSuffix: 'flow-meta.xml', mdExt: 'flow' }
];

/**
 * Collects the deployable content files under `target` (a file or folder),
 * skipping `-meta.xml` siblings for types that have a separate content file.
 * Supports single-file Apex types, multi-file bundles (LWC/Aura), and XML-only
 * metadata (objects, permission sets, flows) — for which the `-meta.xml` IS the
 * content file and is kept. Other metadata is not mapped and falls back to a
 * plain deploy without diff.
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
  const isMeta = norm.endsWith('-meta.xml');

  // XML-only metadata: the `-meta.xml` file IS the component definition. Match
  // these first (and only these) among -meta.xml files; every other -meta.xml is
  // a sidecar for a content file handled below and must be skipped.
  for (const x of XML_TYPES) {
    if (norm.endsWith(`.${x.srcSuffix}`) && parts.includes(x.folder)) {
      const base = path.basename(filePath).replace(new RegExp(`\\.${x.srcSuffix}$`), '');
      return { localPath: filePath, type: x.type, fullName: base, rel: '' };
    }
  }
  if (isMeta) {
    return undefined; // a content file's sidecar — skip.
  }

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
 * and the AI agent both call it.
 *
 * Two diff paths:
 * - **Single-file Apex** uses a fast Tooling-API field query (no zip).
 * - **Bundles + XML metadata** use a single BATCHED `sf project retrieve start`
 *   into a temp dir, then match each local file to its retrieved counterpart.
 *
 * `targetOrg` (a username or alias) points the diff at a specific org via
 * `--target-org`; omit it to use the project's default org. This is what lets a
 * diff/deploy target a secondary org without changing the primary.
 */
export async function computeDeployDiff(
  sf: SfExecutor,
  files: DeployFile[],
  cwd: string,
  token?: vscode.CancellationToken,
  targetOrg?: string
): Promise<DiffEntry[]> {
  const entries: DiffEntry[] = [];

  // Group files by component (type + fullName) so each is retrieved only once.
  const groups = new Map<string, DeployFile[]>();
  for (const f of files) {
    const key = `${f.type}:${f.fullName}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(f);
  }

  // Components needing the retrieve-based path (bundles + XML metadata), collected
  // so they can be retrieved in ONE batched call below.
  const retrieveGroups: DeployFile[][] = [];

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
      const orgBody = await fetchToolingSource(sf, field.object, field.field, fullName, cwd, token, targetOrg);
      if (orgBody === undefined) {
        entries.push({ ...base, isNew: true, differs: false });
      } else {
        const orgPath = writeOrgTemp(fullName, path.extname(f.localPath), orgBody);
        entries.push({ ...base, orgPath, isNew: false, differs: !sameTextContent(f.localPath, orgBody) });
      }
      continue;
    }

    retrieveGroups.push(group);
  }

  // Retrieve-based path: one batched retrieve of every bundle/XML component, then
  // match locals to their retrieved counterparts by path.
  if (retrieveGroups.length && !token?.isCancellationRequested) {
    entries.push(...await diffViaRetrieve(sf, retrieveGroups, cwd, token, targetOrg));
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
  token?: vscode.CancellationToken,
  targetOrg?: string
): Promise<string | undefined> {
  try {
    const args = ['data', 'query', '--use-tooling-api', '--query', `SELECT ${field} FROM ${object} WHERE Name = '${fullName}'`];
    if (targetOrg) {
      args.push('--target-org', targetOrg);
    }
    const { result } = await sf.run<{ records: Array<Record<string, string>> }>(args, { cwd, token });
    const body = result?.records?.[0]?.[field];
    return typeof body === 'string' ? body : undefined;
  } catch {
    return undefined;
  }
}

/** The `result.files` shape from `sf project retrieve start --json`. */
interface RetrieveResult {
  files?: Array<{ fullName: string; type: string; state?: string; error?: string }>;
}

/**
 * Diffs bundle (LWC/Aura) and non-decomposed XML (permset/flow) components against
 * the org using ONE batched `sf project retrieve start`. Pays the cold-CLI cost
 * once regardless of component count, then walks the retrieved tree and matches
 * each local file to its org counterpart:
 * - **Bundles:** by bundle-relative path within `<folder>/<name>/`.
 * - **XML metadata:** by the component's single definition file under `<folder>/`.
 *
 * Mechanics forced by live CLI behavior (validated 2026-07-03):
 * - The org copy is pulled with `--target-metadata-dir <dir> --unzip`, NOT
 *   `--output-dir`. `--output-dir` honors SOURCE TRACKING, so already-tracked
 *   components retrieve NOTHING ("Nothing retrieved") — useless for a diff.
 *   `--target-metadata-dir --unzip` always pulls a fresh copy into
 *   `<dir>/unpackaged/unpackaged/…` in METADATA format.
 * - `<dir>` MUST be inside the project root — the CLI rejects an OS-temp path with
 *   `OutputDirOutsideProjectError`. So we mkdtemp under `<cwd>/.siid`.
 * - A component missing from the org comes back as `result.files[].state === 'Failed'`
 *   with a "cannot be found" error and no file on disk → treated as new-in-org.
 * - Metadata format uses a different suffix than source format for XML types
 *   (`X.permissionset` vs `X.permissionset-meta.xml`), so bundles map by rel path
 *   but XML types map by `<folder>/<name>.<mdExt>`.
 */
async function diffViaRetrieve(
  sf: SfExecutor,
  groups: DeployFile[][],
  cwd: string,
  token?: vscode.CancellationToken,
  targetOrg?: string
): Promise<DiffEntry[]> {
  // The output dir MUST live inside the project (CLI constraint). Keep it under
  // .siid and remove it after diffing so it never lingers or gets deployed.
  const baseDir = path.join(cwd, '.siid', 'difftmp');
  fs.mkdirSync(baseDir, { recursive: true });
  const outDir = fs.mkdtempSync(path.join(baseDir, 'retrieve-'));
  // Metadata format lands under this double-nested prefix after --unzip.
  const retrievedRoot = path.join(outDir, 'unpackaged', 'unpackaged');

  // Build one `--metadata Type:Name` arg per component for a single retrieve.
  const metadataArgs: string[] = [];
  for (const group of groups) {
    metadataArgs.push('--metadata', `${group[0].type}:${group[0].fullName}`);
  }

  const args = ['project', 'retrieve', 'start', ...metadataArgs, '--target-metadata-dir', outDir, '--unzip'];
  if (targetOrg) {
    args.push('--target-org', targetOrg);
  }

  // Components the org reports as not-found (so they're new even though the
  // retrieve as a whole "succeeded" with status 0).
  const missing = new Set<string>();
  try {
    // Accept non-zero: a set where NOTHING exists in the org still shouldn't throw
    // — it just means every component is new. Per-component failures live in
    // `result.files`, not the top-level status.
    const { result } = await sf.run<RetrieveResult>(args, { cwd, token, acceptNonZeroStatus: true });
    for (const file of result?.files ?? []) {
      if (file.state === 'Failed') {
        missing.add(`${file.type}:${file.fullName}`);
      }
    }

    const entries: DiffEntry[] = [];
    for (const group of groups) {
      const isBundle = BUNDLE_TYPES.some((b) => b.type === group[0].type);
      const isMissing = missing.has(`${group[0].type}:${group[0].fullName}`);
      for (const f of group) {
        const orgPath = isMissing
          ? undefined
          : isBundle
            ? findRetrievedBundleFile(retrievedRoot, group[0].type, group[0].fullName, f.rel)
            : findRetrievedXmlFile(retrievedRoot, group[0].type, group[0].fullName);
        if (!orgPath) {
          entries.push({ localPath: f.localPath, type: f.type, fullName: f.fullName, isNew: true, differs: false });
        } else {
          // Copy the org file out of the retrieve dir before we delete it, so the
          // diff editor can still open the org side afterwards.
          const kept = keepOrgTemp(orgPath);
          entries.push({
            localPath: f.localPath,
            type: f.type,
            fullName: f.fullName,
            orgPath: kept,
            isNew: false,
            differs: !sameFileContent(f.localPath, orgPath)
          });
        }
      }
    }
    return entries;
  } finally {
    // Always clean the in-project retrieve scratch dir.
    try {
      fs.rmSync(outDir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
}

/** SFDX source folder for a metadata type (used to locate retrieved files). */
function sourceFolderFor(type: string): string | undefined {
  return BUNDLE_TYPES.find((b) => b.type === type)?.folder
    ?? XML_TYPES.find((x) => x.type === type)?.folder;
}

/**
 * Locates a retrieved bundle member by its bundle-relative path. Bundles are NOT
 * decomposed, so metadata and source format share the same member filenames; we
 * search for the `<folder>/<name>/<rel>` tail under the retrieved root.
 */
function findRetrievedBundleFile(root: string, type: string, name: string, rel: string): string | undefined {
  const folder = sourceFolderFor(type);
  if (!folder) {
    return undefined;
  }
  const tail = path.join(folder, name, rel).replace(/\\/g, '/');
  return findByTail(root, tail);
}

/**
 * Locates a retrieved XML component's definition file. The org copy is in metadata
 * format (`<name>.<mdExt>`, e.g. `MyPS.permissionset`), which differs from the
 * local source-format suffix — but both hold the same XML, so they diff cleanly.
 */
function findRetrievedXmlFile(root: string, type: string, name: string): string | undefined {
  const x = XML_TYPES.find((t) => t.type === type);
  if (!x) {
    return undefined;
  }
  const tail = path.join(x.folder, `${name}.${x.mdExt}`).replace(/\\/g, '/');
  return findByTail(root, tail);
}

/** Copies a retrieved org file into a stable temp file that outlives the scratch dir. */
function keepOrgTemp(orgPath: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'siid-forge-org-'));
  const dest = path.join(dir, path.basename(orgPath));
  fs.copyFileSync(orgPath, dest);
  return dest;
}

/** Recursively finds the first file under `root` whose path ends with `tail`. */
function findByTail(root: string, tail: string): string | undefined {
  const want = `/${tail}`;
  let found: string | undefined;
  const visit = (p: string) => {
    if (found) {
      return;
    }
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
    if (`/${p.replace(/\\/g, '/')}`.endsWith(want)) {
      found = p;
    }
  };
  visit(root);
  return found;
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

/** Compares two on-disk files, ignoring EOL/trailing whitespace noise. */
function sameFileContent(localPath: string, orgPath: string): boolean {
  try {
    return normalize(fs.readFileSync(localPath, 'utf-8')) === normalize(fs.readFileSync(orgPath, 'utf-8'));
  } catch {
    return false;
  }
}

/** Normalizes EOL + trailing whitespace so cosmetic noise isn't a "difference". */
function normalize(s: string): string {
  return s.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n+$/g, '\n');
}

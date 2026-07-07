/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { SfExecutor, SfCommandStatus } from './sfExecutor';
import {
  collectDeployFiles,
  findByTail,
  sameFileContent,
  isBundleType,
  isDiffableType,
  xmlMdExt,
  xmlSrcSuffix,
  metadataSourceFolder
} from './deployDiff';

/**
 * Type-level org↔local diff (§19 extension). The existing engine
 * (`computeDeployDiff` / `compareOrgs`) diffs a KNOWN set of components. This
 * module diffs a WHOLE metadata type: it enumerates the union of the org's
 * members and the local members for each requested type, then rolls each member
 * up to a status. That surfaces components that exist only in the org (new to
 * pull) as well as only-local ones — which a component-list diff can't see.
 *
 * It reuses the deploy-diff classifier (`collectDeployFiles`) and file locators
 * so "what's a component / where does its file live" has ONE definition.
 *
 * `CustomObject` is intentionally NOT compared here (see the note in
 * `deployDiff.ts`): objects are decomposed locally but come back inline from a
 * metadata retrieve, so the two aren't file-comparable without a source-convert.
 * Such types are reported with every member `retrieved-not-compared` so a caller
 * can still retrieve them, just without a diff.
 */

/** Per-member status in a type-level diff. */
export type TypeDiffStatus =
  | 'new-in-org'            // exists in org, not locally → retrieve adds it
  | 'changed'              // exists on both, content differs
  | 'only-local'           // exists locally, not in org
  | 'identical'            // exists on both, same content
  | 'retrieved-not-compared'; // type isn't file-comparable (e.g. CustomObject)

/** One component's row within a type group. */
export interface TypeDiffRow {
  /** Component API name (fullName). */
  fullName: string;
  status: TypeDiffStatus;
  /** Absolute path to the org copy (temp), when retrieved. */
  orgPath?: string;
  /** Absolute path to the local copy, when present. */
  localPath?: string;
}

/** All rows for one metadata type. */
export interface TypeDiffGroup {
  /** Metadata API name, e.g. "ApexClass". */
  type: string;
  /** True when this type is not file-comparable (rows are all `retrieved-not-compared`). */
  comparedByContent: boolean;
  rows: TypeDiffRow[];
  /**
   * Releases the temp org files backing this group's `orgPath`s. Call when the
   * diff UI closes — the `orgPath`s are invalid afterwards. Use `disposeTypeDiff`
   * to dispose a whole result at once.
   */
  dispose?: () => void;
  /**
   * Internal: the retrieved metadata-format root holding this group's FULL org
   * components (kept alive until `dispose`). `applyToLocal` copies from here to
   * avoid a second org retrieve. Undefined for non-comparable groups.
   */
  _mdRoot?: string;
}

/** Options for a type-level diff. */
export interface DiffMetadataTypesOptions {
  /** Target a specific org (username/alias); omit for the default org. */
  targetOrg?: string;
  token?: vscode.CancellationToken;
  /** Streams each underlying `sf` command's lifecycle (list + retrieve per type). */
  onStatus?: (status: SfCommandStatus) => void;
  /**
   * Fired once as each type STARTS processing, so a consumer can show which type
   * is in flight and overall progress (e.g. "Comparing LWC (3 of 7)…"). `index`
   * is 0-based; `total` is the number of requested types.
   */
  onType?: (info: { type: string; index: number; total: number }) => void;
}

/**
 * Whether a metadata type can be content-diffed (maps 1:1 between source and
 * metadata format). Callers use this to split a selection: diffable types go
 * through `byMetadataTypes` (compare + review); the rest are pulled wholesale via
 * `retrieveTypesToLocal` (no per-member list — avoids command-line overflow).
 */
export function isDiffableMetadataType(type: string): boolean {
  return isDiffableType(type);
}

/** `sf org list metadata` row shape. */
interface OrgMetadataItem { fullName?: string; }
/** `sf project retrieve start --json` result shape. */
interface RetrieveResult { files?: Array<{ fullName: string; type: string; state?: string }>; }

/**
 * Diffs each requested metadata `type` between the org and the local project.
 * Enumerates org members (`sf org list metadata`) ∪ local members, batch-
 * retrieves the org copies into a temp dir, and rolls each member up to a status.
 * Returns one group per type (types with no members are omitted).
 */
export async function diffMetadataTypes(
  sf: SfExecutor,
  types: string[],
  cwd: string,
  opts?: DiffMetadataTypesOptions
): Promise<TypeDiffGroup[]> {
  const groups: TypeDiffGroup[] = [];
  for (let index = 0; index < types.length; index++) {
    if (opts?.token?.isCancellationRequested) {
      break;
    }
    const type = types[index];
    try {
      opts?.onType?.({ type, index, total: types.length });
    } catch {
      /* progress callback is side-effect free — never let it break the diff */
    }
    groups.push(await diffOneType(sf, type, cwd, opts));
  }
  return groups;
}

/**
 * Releases every temp org file backing a diff result. Call once when the diff UI
 * closes; the `orgPath`s in the groups are invalid afterwards. Idempotent.
 */
export function disposeTypeDiff(groups: TypeDiffGroup[]): void {
  for (const g of groups) {
    g.dispose?.();
    g.dispose = undefined;
  }
}

/** Diffs a single metadata type. */
async function diffOneType(
  sf: SfExecutor,
  type: string,
  cwd: string,
  opts?: DiffMetadataTypesOptions
): Promise<TypeDiffGroup> {
  const orgMembers = await listOrgMembers(sf, type, cwd, opts);
  const localByName = localMembers(cwd, type);

  // Types the engine can't content-diff (CustomObject, Report, Site, Agentforce,
  // …): report the union, all as retrieved-not-compared, so they can still be
  // pulled wholesale (retrieve-only) without a misleading diff.
  if (!isDiffableType(type)) {
    const names = new Set<string>([...orgMembers, ...localByName.keys()]);
    const rows: TypeDiffRow[] = [...names].sort().map((fullName) => ({
      fullName,
      status: 'retrieved-not-compared' as const,
      localPath: localByName.get(fullName)?.[0]
    }));
    return { type, comparedByContent: false, rows };
  }

  // Retrieve every org member of this type into a temp dir. The tree is KEPT
  // alive (not deleted after rollup): it backs the diff editor AND lets a later
  // "take org" apply copy whole components from it with no second org retrieve.
  const orgFiles = await retrieveTypeToTemp(sf, type, orgMembers, cwd, opts);
  const names = new Set<string>([...orgMembers, ...localByName.keys()]);
  const rows: TypeDiffRow[] = [];
  for (const fullName of [...names].sort()) {
    const local = localByName.get(fullName);
    const inLocal = !!local?.length;
    const orgPrimary = orgFiles.get(fullName);
    const inOrg = !!orgPrimary;

    if (inOrg && !inLocal) {
      rows.push({ fullName, status: 'new-in-org', orgPath: orgPrimary });
    } else if (!inOrg && inLocal) {
      rows.push({ fullName, status: 'only-local', localPath: local![0] });
    } else if (inOrg && inLocal) {
      const differs = !membersIdentical(type, fullName, local!, orgFiles.dir, opts);
      rows.push({
        fullName,
        status: differs ? 'changed' : 'identical',
        orgPath: orgPrimary,
        localPath: local![0]
      });
    }
  }
  // `_mdRoot` + `dispose` let apply copy from the kept tree; the caller disposes
  // when the diff UI closes.
  return { type, comparedByContent: true, rows, dispose: orgFiles.dispose, _mdRoot: orgFiles.dir };
}

/** Lists a type's org members via `sf org list metadata`. */
async function listOrgMembers(
  sf: SfExecutor,
  type: string,
  cwd: string,
  opts?: DiffMetadataTypesOptions
): Promise<string[]> {
  const args = ['org', 'list', 'metadata', '--metadata-type', type];
  if (opts?.targetOrg) {
    args.push('--target-org', opts.targetOrg);
  }
  try {
    const { result } = await sf.run<OrgMetadataItem[]>(args, {
      cwd,
      token: opts?.token,
      onStatus: opts?.onStatus,
      acceptNonZeroStatus: true
    });
    const names = (Array.isArray(result) ? result : [])
      .map((r) => r?.fullName)
      .filter((n): n is string => !!n);
    return [...new Set(names)].sort();
  } catch {
    return [];
  }
}

/** Local members of a type: fullName → its local file paths. */
function localMembers(cwd: string, type: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const packageDirs = readPackageDirs(cwd);
  for (const dir of packageDirs) {
    const abs = path.join(cwd, dir);
    if (!fs.existsSync(abs)) {
      continue;
    }
    for (const df of collectDeployFiles(abs)) {
      if (df.type !== type) {
        continue;
      }
      (map.get(df.fullName) ?? map.set(df.fullName, []).get(df.fullName)!).push(df.localPath);
    }
  }
  return map;
}

/** SFDX packageDirectories (defaults to force-app). */
function readPackageDirs(cwd: string): string[] {
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

/** A materialized org side for one type: fullName → primary org file, + the retrieve root. */
interface OrgFiles {
  get(fullName: string): string | undefined;
  /**
   * The retrieved metadata-format root (`<outDir>/unpackaged/unpackaged`). Holds
   * the FULL component tree — bundle members, meta sidecars, everything — so both
   * the diff (primaries) AND a later apply (whole components) copy from here with
   * NO second org round-trip. Stays alive until `dispose()`.
   */
  dir: string;
  /** Removes the whole retrieve tree. Call when the diff UI closes. */
  dispose(): void;
}

/**
 * Retrieves all `members` of `type` from the org into an in-project temp dir
 * (metadata format, `--target-metadata-dir --unzip` — the same mechanics the
 * deploy-diff uses: always fresh, bypasses source tracking) and KEEPS the whole
 * tree alive so a later "take org" apply copies from it instead of retrieving
 * again. Returns a lookup from fullName to its primary retrieved file. Empty
 * member list → empty lookup (no retrieve).
 */
async function retrieveTypeToTemp(
  sf: SfExecutor,
  type: string,
  members: string[],
  cwd: string,
  opts?: DiffMetadataTypesOptions
): Promise<OrgFiles> {
  if (!members.length) {
    return { get: () => undefined, dir: '', dispose: () => { /* nothing */ } };
  }
  const baseDir = path.join(cwd, '.siid', 'difftmp');
  fs.mkdirSync(baseDir, { recursive: true });
  const outDir = fs.mkdtempSync(path.join(baseDir, 'typediff-'));
  const retrievedRoot = path.join(outDir, 'unpackaged', 'unpackaged');

  const metadataArgs = members.flatMap((m) => ['--metadata', `${type}:${m}`]);
  const args = ['project', 'retrieve', 'start', ...metadataArgs, '--target-metadata-dir', outDir, '--unzip'];
  if (opts?.targetOrg) {
    args.push('--target-org', opts.targetOrg);
  }

  // The whole retrieve tree stays alive until the diff UI closes: the diff reads
  // primaries from it AND a later apply copies whole components from it (no second
  // org round-trip). Only `dispose()` removes it.
  const dispose = () => {
    try { fs.rmSync(outDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  };

  const primaryByName = new Map<string, string>();
  try {
    const { result } = await sf.run<RetrieveResult>(args, { cwd, token: opts?.token, onStatus: opts?.onStatus, acceptNonZeroStatus: true });
    const failed = new Set<string>();
    for (const f of result?.files ?? []) {
      if (f.state === 'Failed') {
        failed.add(f.fullName);
      }
    }
    for (const name of members) {
      if (failed.has(name)) {
        continue;
      }
      // Point the diff primary straight at the retrieved file in `outDir` — no
      // copy needed, the tree lives until dispose.
      const found = locatePrimary(retrievedRoot, type, name);
      if (found) {
        primaryByName.set(name, found);
      }
    }
    return {
      get: (fullName) => primaryByName.get(fullName),
      dir: retrievedRoot,
      dispose
    };
  } catch (err) {
    // On failure nothing downstream reads the tree — clean up and rethrow.
    dispose();
    throw err;
  }
}

/**
 * Locates a component's primary retrieved file. For single-file/bundle types the
 * primary is the content file; for XML types it's the definition file. Used both
 * as the diff-editor org side and as the presence signal.
 */
function locatePrimary(root: string, type: string, name: string): string | undefined {
  const folder = metadataSourceFolder(type) ?? singleFolder(type);
  if (!folder) {
    return undefined;
  }
  if (isBundleType(type)) {
    // Bundle: primary is the entry file inside <folder>/<name>/ — locate the dir,
    // then its main file. We locate any member and return the bundle's .js/.cmp.
    const tail = `${folder}/${name}/`;
    const anyMember = findByTail(root, `${folder}/${name}/${name}.js`)
      ?? findByTail(root, `${folder}/${name}/${name}.cmp`)
      ?? findFirstUnder(root, tail);
    return anyMember;
  }
  const ext = xmlMdExt(type);
  if (ext) {
    return findByTail(root, `${folder}/${name}.${ext}`);
  }
  // Single-file Apex types: metadata format keeps the source extension.
  for (const s of SINGLE_FOLDERS) {
    if (s.type === type) {
      return findByTail(root, `${folder}/${name}${s.ext}`);
    }
  }
  return undefined;
}

/** Single-file Apex type → source folder + content extension (metadata format keeps it). */
const SINGLE_FOLDERS: Array<{ type: string; folder: string; ext: string }> = [
  { type: 'ApexClass', folder: 'classes', ext: '.cls' },
  { type: 'ApexTrigger', folder: 'triggers', ext: '.trigger' },
  { type: 'ApexPage', folder: 'pages', ext: '.page' },
  { type: 'ApexComponent', folder: 'components', ext: '.component' }
];
function singleFolder(type: string): string | undefined {
  return SINGLE_FOLDERS.find((s) => s.type === type)?.folder;
}

/**
 * Whether a component is content-identical between local and org. For single-file
 * and XML types, compares the two primary files. For bundles, compares every local
 * member against its retrieved counterpart by bundle-relative path (a differing OR
 * missing member ⇒ not identical).
 */
function membersIdentical(
  type: string,
  fullName: string,
  localPaths: string[],
  retrievedRoot: string,
  _opts?: DiffMetadataTypesOptions
): boolean {
  if (isBundleType(type)) {
    const folder = metadataSourceFolder(type)!;
    for (const lp of localPaths) {
      const rel = bundleRel(lp, folder, fullName);
      if (!rel) {
        continue;
      }
      const orgFile = findByTail(retrievedRoot, `${folder}/${fullName}/${rel}`);
      if (!orgFile || !sameFileContent(lp, orgFile)) {
        return false;
      }
    }
    return true;
  }
  // Single-file / XML: one local content file vs the primary org file.
  const orgPrimary = locatePrimary(retrievedRoot, type, fullName);
  const local = localPaths[0];
  return !!orgPrimary && !!local && sameFileContent(local, orgPrimary);
}

/** Bundle-relative path of a local file (within <folder>/<name>/), or undefined. */
function bundleRel(localPath: string, folder: string, name: string): string | undefined {
  const norm = localPath.replace(/\\/g, '/');
  const marker = `/${folder}/${name}/`;
  const idx = norm.indexOf(marker);
  return idx >= 0 ? norm.slice(idx + marker.length) : undefined;
}

/** First file found anywhere under a `<tail>` directory prefix. */
function findFirstUnder(root: string, tail: string): string | undefined {
  const want = `/${tail}`;
  let found: string | undefined;
  const visit = (p: string) => {
    if (found) {
      return;
    }
    let stat: fs.Stats;
    try { stat = fs.statSync(p); } catch { return; }
    if (stat.isDirectory()) {
      for (const e of fs.readdirSync(p)) {
        visit(path.join(p, e));
      }
      return;
    }
    if (`/${p.replace(/\\/g, '/')}`.includes(want) && !p.endsWith('-meta.xml')) {
      found = p;
    }
  };
  visit(root);
  return found;
}


// ───────────────────────── Apply (retrieve → local) ─────────────────────────

/** A component to pull into the local project. */
export interface ApplyRef { type: string; fullName: string; }

/** Result of an apply-to-local. */
export interface ApplyResult {
  /** Components successfully written into the project. */
  applied: ApplyRef[];
  /** Components the org reported as missing (not written). */
  missing: ApplyRef[];
}

/**
 * Pulls specific components into the local project WITHOUT running a source-
 * tracked `project retrieve start` — which fails wholesale if the project has any
 * broken component (e.g. an orphaned `.cls-meta.xml` with no `.cls`). It retrieves
 * to a temp metadata dir (`--target-metadata-dir --unzip`, the same orphan-immune
 * mechanism the diff uses) and copies the retrieved files into the project's
 * package dir, overwriting local.
 *
 * We do NOT use `sf project convert mdapi`: run from inside a DX project it
 * silently converts nothing ("No results to format"), and it refuses to run from
 * outside one. For the diff-able types the retrieved metadata-format layout is
 * already source-shaped (`classes/X.cls` + `.cls-meta.xml`, `lwc/X/…`), so a
 * direct copy is correct. XML types (permset/flow) need the metadata-format
 * extension renamed to the source-format suffix.
 *
 * Returns which components were applied vs. reported missing by the org.
 */
/**
 * Applies components by copying from an EXISTING diff result's kept org trees —
 * no second org retrieve. Each `TypeDiffGroup` from `byMetadataTypes` holds its
 * full retrieved tree (`_mdRoot`) alive until disposed; this copies the requested
 * components straight out of it. Components whose group tree is missing (e.g. it
 * was already disposed) fall back to a fresh `applyMetadataToLocal` retrieve.
 *
 * This is what makes "Take org" instant: the compare step already paid the CLI
 * cold-start + org round-trip, so apply is a pure local file copy.
 */
export async function applyFromDiffGroups(
  sf: SfExecutor,
  groups: TypeDiffGroup[],
  refs: ApplyRef[],
  cwd: string,
  opts?: DiffMetadataTypesOptions
): Promise<ApplyResult> {
  if (!refs.length) {
    return { applied: [], missing: [] };
  }
  const rootByType = new Map<string, string>();
  for (const g of groups) {
    if (g._mdRoot) {
      rootByType.set(g.type, g._mdRoot);
    }
  }
  const pkgRoot = path.join(cwd, readPackageDirs(cwd)[0] ?? 'force-app', 'main', 'default');

  const applied: ApplyRef[] = [];
  const needRetrieve: ApplyRef[] = [];
  for (const ref of refs) {
    const mdRoot = rootByType.get(ref.type);
    // Copy from the kept tree if present AND the component is actually there
    // (it was retrieved during compare).
    if (mdRoot && fs.existsSync(mdRoot) && copyComponentIntoProject(mdRoot, pkgRoot, ref.type, ref.fullName)) {
      applied.push(ref);
    } else {
      needRetrieve.push(ref); // tree gone or component not in it → retrieve fresh
    }
  }

  if (!needRetrieve.length) {
    return { applied, missing: [] };
  }
  // Fallback for anything not covered by a live tree.
  const fresh = await applyMetadataToLocal(sf, needRetrieve, cwd, opts);
  return { applied: [...applied, ...fresh.applied], missing: fresh.missing };
}

export async function applyMetadataToLocal(
  sf: SfExecutor,
  refs: ApplyRef[],
  cwd: string,
  opts?: DiffMetadataTypesOptions
): Promise<ApplyResult> {
  if (!refs.length) {
    return { applied: [], missing: [] };
  }
  const baseDir = path.join(cwd, '.siid', 'difftmp');
  fs.mkdirSync(baseDir, { recursive: true });
  const outDir = fs.mkdtempSync(path.join(baseDir, 'apply-'));
  const mdRoot = path.join(outDir, 'unpackaged', 'unpackaged');

  const metadataArgs = refs.flatMap((r) => ['--metadata', `${r.type}:${r.fullName}`]);
  const retrieveArgs = ['project', 'retrieve', 'start', ...metadataArgs, '--target-metadata-dir', outDir, '--unzip'];
  if (opts?.targetOrg) {
    retrieveArgs.push('--target-org', opts.targetOrg);
  }

  try {
    const { result } = await sf.run<RetrieveResult>(retrieveArgs, {
      cwd, token: opts?.token, onStatus: opts?.onStatus, acceptNonZeroStatus: true
    });
    const failed = new Set<string>();
    for (const f of result?.files ?? []) {
      if (f.state === 'Failed') {
        failed.add(`${f.type}:${f.fullName}`);
      }
    }
    const missing = refs.filter((r) => failed.has(`${r.type}:${r.fullName}`));
    const applied: ApplyRef[] = [];
    const pkgRoot = path.join(cwd, readPackageDirs(cwd)[0] ?? 'force-app', 'main', 'default');

    for (const ref of refs) {
      if (failed.has(`${ref.type}:${ref.fullName}`)) {
        continue;
      }
      if (copyComponentIntoProject(mdRoot, pkgRoot, ref.type, ref.fullName)) {
        applied.push(ref);
      } else {
        missing.push(ref); // retrieved but couldn't be located/copied → treat as not applied
      }
    }
    return { applied, missing };
  } finally {
    try { fs.rmSync(outDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

/**
 * Retrieves WHOLE metadata types into the local project — `--metadata <Type>` per
 * type (NOT `Type:Name` per member). This is the right path for retrieve-only
 * types (CustomObject, Report, …): a type like CustomObject has hundreds of
 * members, so per-member args overflow the OS command line ("command line is too
 * long"). One `--metadata CustomObject` retrieves them all in a single arg.
 *
 * Retrieves to a temp dir (orphan-immune) then mirrors the entire retrieved tree
 * into the package dir, overwriting local. Returns the types retrieved.
 */
export async function retrieveTypesToLocal(
  sf: SfExecutor,
  types: string[],
  cwd: string,
  opts?: DiffMetadataTypesOptions
): Promise<{ types: string[] }> {
  if (!types.length) {
    return { types: [] };
  }
  const baseDir = path.join(cwd, '.siid', 'difftmp');
  fs.mkdirSync(baseDir, { recursive: true });
  const outDir = fs.mkdtempSync(path.join(baseDir, 'typeget-'));
  const mdRoot = path.join(outDir, 'unpackaged', 'unpackaged');

  // One `--metadata <Type>` per type — no per-member args.
  const metadataArgs = types.flatMap((t) => ['--metadata', t]);
  const retrieveArgs = ['project', 'retrieve', 'start', ...metadataArgs, '--target-metadata-dir', outDir, '--unzip'];
  if (opts?.targetOrg) {
    retrieveArgs.push('--target-org', opts.targetOrg);
  }

  try {
    await sf.run<RetrieveResult>(retrieveArgs, { cwd, token: opts?.token, onStatus: opts?.onStatus, acceptNonZeroStatus: true });
    // Mirror the whole retrieved metadata tree into the package dir. Every folder
    // under `mdRoot` (classes/, objects/, reports/, …) except package.xml maps
    // straight into `main/default/` — these types come back source-compatible.
    if (fs.existsSync(mdRoot)) {
      const pkgRoot = path.join(cwd, readPackageDirs(cwd)[0] ?? 'force-app', 'main', 'default');
      for (const entry of fs.readdirSync(mdRoot)) {
        if (entry === 'package.xml') {
          continue;
        }
        copyDirRecursive(path.join(mdRoot, entry), path.join(pkgRoot, entry));
      }
    }
    return { types };
  } finally {
    try { fs.rmSync(outDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

/**
 * Copies one retrieved component from the metadata-format temp tree (`mdRoot`)
 * into the project's `main/default` (`pkgRoot`), overwriting local. Returns true
 * if files were copied.
 *
 * - **Single-file Apex**: copy `<folder>/<name><ext>` and its `-meta.xml`.
 * - **Bundle (LWC/Aura)**: copy the whole `<folder>/<name>/` directory.
 * - **XML (permset/flow)**: copy `<folder>/<name>.<mdExt>` and rename to the
 *   source-format suffix (`<name>.<srcSuffix>`).
 */
function copyComponentIntoProject(mdRoot: string, pkgRoot: string, type: string, name: string): boolean {
  // Bundles: copy the component directory wholesale.
  if (isBundleType(type)) {
    const folder = metadataSourceFolder(type)!;
    const srcDir = findDirByTail(mdRoot, `${folder}/${name}`);
    if (!srcDir) {
      return false;
    }
    const destDir = path.join(pkgRoot, folder, name);
    copyDirRecursive(srcDir, destDir);
    return true;
  }

  // Single-file Apex: copy the content file + its meta sidecar.
  for (const s of SINGLE_FOLDERS) {
    if (s.type === type) {
      const src = findByTail(mdRoot, `${s.folder}/${name}${s.ext}`);
      if (!src) {
        return false;
      }
      const destFolder = path.join(pkgRoot, s.folder);
      fs.mkdirSync(destFolder, { recursive: true });
      fs.copyFileSync(src, path.join(destFolder, `${name}${s.ext}`));
      const meta = `${src}-meta.xml`;
      if (fs.existsSync(meta)) {
        fs.copyFileSync(meta, path.join(destFolder, `${name}${s.ext}-meta.xml`));
      }
      return true;
    }
  }

  // XML types (permset/flow): metadata `<name>.<mdExt>` → source `<name>.<srcSuffix>`.
  const folder = metadataSourceFolder(type);
  const mdExt = xmlMdExt(type);
  const srcSuffix = xmlSrcSuffix(type);
  if (folder && mdExt && srcSuffix) {
    const src = findByTail(mdRoot, `${folder}/${name}.${mdExt}`);
    if (!src) {
      return false;
    }
    const destFolder = path.join(pkgRoot, folder);
    fs.mkdirSync(destFolder, { recursive: true });
    fs.copyFileSync(src, path.join(destFolder, `${name}.${srcSuffix}`));
    return true;
  }

  // Retrieve-only fallback (unmapped types: Report, EmailTemplate, Site, Queue,
  // …). The org retrieve already lays these under their metadata folder in a
  // source-compatible shape, so mirror every retrieved file whose path contains
  // the component name into the project, preserving its relative path. Handles
  // folder-based types (reports/Folder/Name.report) too.
  const files = findFilesForComponent(mdRoot, name);
  if (!files.length) {
    return false;
  }
  for (const abs of files) {
    const rel = path.relative(mdRoot, abs).replace(/\\/g, '/');
    const dest = path.join(pkgRoot, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(abs, dest);
  }
  return true;
}

/** All retrieved files whose path segment matches the component `name`. */
function findFilesForComponent(root: string, name: string): string[] {
  const out: string[] = [];
  const base = name.split('/').pop()!; // folder-based fullNames: Folder/Name
  const visit = (p: string) => {
    let stat: fs.Stats;
    try { stat = fs.statSync(p); } catch { return; }
    if (stat.isDirectory()) {
      if (path.basename(p) === 'package.xml') {
        return;
      }
      for (const e of fs.readdirSync(p)) {
        visit(path.join(p, e));
      }
      return;
    }
    if (path.basename(p) === 'package.xml') {
      return;
    }
    // Match a file that starts with the component base name (content + its meta).
    if (path.basename(p).startsWith(base + '.') || path.basename(p) === base) {
      out.push(p);
    }
  };
  visit(root);
  return out;
}

/** Recursively copies a directory (creating dest), overwriting existing files. */
function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src)) {
    const s = path.join(src, entry);
    const d = path.join(dest, entry);
    if (fs.statSync(s).isDirectory()) {
      copyDirRecursive(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

/** Finds the first DIRECTORY under `root` whose path ends with `tail`. */
function findDirByTail(root: string, tail: string): string | undefined {
  const want = `/${tail}`;
  let found: string | undefined;
  const visit = (p: string) => {
    if (found) {
      return;
    }
    let stat: fs.Stats;
    try { stat = fs.statSync(p); } catch { return; }
    if (!stat.isDirectory()) {
      return;
    }
    if (`/${p.replace(/\\/g, '/')}`.endsWith(want)) {
      found = p;
      return;
    }
    for (const e of fs.readdirSync(p)) {
      visit(path.join(p, e));
    }
  };
  visit(root);
  return found;
}

/**
 * Finds orphaned `-meta.xml` sidecars: a `<name>.<ext>-meta.xml` whose content
 * file `<name>.<ext>` is missing. These break `project retrieve start` for the
 * whole project, so surfacing them lets the caller warn/clean. Scans the project's
 * package dirs. Returns absolute paths of the orphan meta files.
 */
export function findOrphanedMetaFiles(cwd: string): string[] {
  const orphans: string[] = [];
  const visit = (p: string) => {
    let stat: fs.Stats;
    try { stat = fs.statSync(p); } catch { return; }
    if (stat.isDirectory()) {
      for (const e of fs.readdirSync(p)) {
        visit(path.join(p, e));
      }
      return;
    }
    // A sidecar `<content>-meta.xml` (NOT a standalone XML component like
    // `.permissionset-meta.xml`) is orphaned if its `<content>` twin is gone.
    const m = p.match(/^(.*\.(cls|trigger|page|component))-meta\.xml$/i);
    if (m && !fs.existsSync(m[1])) {
      orphans.push(p);
    }
  };
  for (const dir of readPackageDirs(cwd)) {
    const abs = path.join(cwd, dir);
    if (fs.existsSync(abs)) {
      visit(abs);
    }
  }
  return orphans;
}

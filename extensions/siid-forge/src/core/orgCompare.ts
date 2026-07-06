/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SfExecutor } from './sfExecutor';
import {
  ComponentRef,
  collectDeployFiles,
  findByTail,
  sameFileContent,
  isBundleType,
  xmlMdExt,
  metadataSourceFolder
} from './deployDiff';

/**
 * Org-compare engine (§19 revised): compare a set of metadata components between
 * TWO sides — each side is either the local project or an authorized org — and
 * report per-component status so the UI can show a diff and sync one side → the
 * other. Generalizes the phase-1 "local vs one org" diff to "any two sides".
 *
 * An org side is materialized by retrieving the chosen components into a temp dir
 * (the phase-1 `--target-metadata-dir --unzip` mechanics, now parameterized by
 * org); a local side uses the working files directly. Both sides reduce to a flat
 * `Map<memberKey → filePath>`, and comparison is per-member.
 */

/** One side of a comparison: the local project, or a specific authorized org. */
export type CompareSide =
  | { kind: 'local' }
  | { kind: 'org'; org: string };

/** Human label for a side (for panel headers / diff titles). */
export function sideLabel(side: CompareSide): string {
  return side.kind === 'local' ? 'Local' : side.org;
}

/** Per-component comparison status. */
export type CompareStatus = 'identical' | 'differs' | 'onlyA' | 'onlyB';

/** One component's comparison result across the two sides. */
export interface CompareRow {
  type: string;
  fullName: string;
  status: CompareStatus;
  /** Absolute path to side A's copy of the component's primary file (for the diff editor). */
  pathA?: string;
  /** Absolute path to side B's copy of the component's primary file. */
  pathB?: string;
}

/** A member file keyed for cross-side matching: `type:fullName:rel`. */
interface Member {
  type: string;
  fullName: string;
  /** Bundle-relative path ('' for single-file types). */
  rel: string;
  path: string;
}

/** A materialized side: its member files + a temp dir to clean up (if any). */
interface MaterializedSide {
  members: Map<string, Member>;
  cleanup: () => void;
}

const memberKey = (type: string, fullName: string, rel: string): string => `${type}:${fullName}:${rel}`;

/**
 * Compares `components` between `a` and `b`. Retrieves each org side once
 * (batched), compares member-by-member, and rolls members up to a per-component
 * status. Cleans up any temp retrieve dirs before returning.
 */
export async function compareOrgs(
  sf: SfExecutor,
  a: CompareSide,
  b: CompareSide,
  components: ComponentRef[],
  cwd: string,
  token?: vscode.CancellationToken
): Promise<CompareRow[]> {
  const sideA = await materialize(sf, a, components, cwd, token);
  try {
    const sideB = await materialize(sf, b, components, cwd, token);
    try {
      return rollUp(components, sideA.members, sideB.members);
    } finally {
      sideB.cleanup();
    }
  } finally {
    sideA.cleanup();
  }
}

/**
 * Rolls member-level presence/difference up to one row per component:
 * - present on neither → skipped (shouldn't happen; components came from a side).
 * - only on A / only on B → onlyA / onlyB.
 * - present on both, any member differs → differs; else identical.
 * The row's pathA/pathB point at the component's PRIMARY file (the first member),
 * which is what the diff editor opens.
 */
function rollUp(
  components: ComponentRef[],
  a: Map<string, Member>,
  b: Map<string, Member>
): CompareRow[] {
  const rows: CompareRow[] = [];
  for (const comp of components) {
    const membersA = [...a.values()].filter((m) => m.type === comp.type && m.fullName === comp.fullName);
    const membersB = [...b.values()].filter((m) => m.type === comp.type && m.fullName === comp.fullName);
    const inA = membersA.length > 0;
    const inB = membersB.length > 0;

    const primaryA = pickPrimary(membersA);
    const primaryB = pickPrimary(membersB);

    let status: CompareStatus;
    if (inA && !inB) {
      status = 'onlyA';
    } else if (!inA && inB) {
      status = 'onlyB';
    } else if (!inA && !inB) {
      continue;
    } else {
      // Present on both: differ if the member SETS differ, or any shared member differs.
      const keysA = new Set(membersA.map((m) => m.rel));
      const keysB = new Set(membersB.map((m) => m.rel));
      let differs = keysA.size !== keysB.size || [...keysA].some((k) => !keysB.has(k));
      if (!differs) {
        for (const m of membersA) {
          const counterpart = membersB.find((n) => n.rel === m.rel)!;
          if (!sameFileContent(m.path, counterpart.path)) {
            differs = true;
            break;
          }
        }
      }
      status = differs ? 'differs' : 'identical';
    }

    rows.push({
      type: comp.type,
      fullName: comp.fullName,
      status,
      pathA: primaryA?.path,
      pathB: primaryB?.path
    });
  }
  return rows.sort((x, y) => x.type.localeCompare(y.type) || x.fullName.localeCompare(y.fullName));
}

/** Picks the "primary" member to show in the diff: the .js for LWC, else the first. */
function pickPrimary(members: Member[]): Member | undefined {
  if (!members.length) {
    return undefined;
  }
  return (
    members.find((m) => /\.(cls|trigger|page|component)$/i.test(m.path)) ??
    members.find((m) => /\.js$/i.test(m.path) && !/\.js-meta\.xml$/i.test(m.path)) ??
    members.find((m) => !m.path.endsWith('-meta.xml')) ??
    members[0]
  );
}

/** Materializes a side into member files (retrieving from the org if needed). */
async function materialize(
  sf: SfExecutor,
  side: CompareSide,
  components: ComponentRef[],
  cwd: string,
  token?: vscode.CancellationToken
): Promise<MaterializedSide> {
  if (side.kind === 'local') {
    // Local side: classify the working files directly — no retrieve, no cleanup.
    const members = new Map<string, Member>();
    for (const comp of components) {
      for (const p of comp.paths) {
        for (const df of collectDeployFiles(p)) {
          members.set(memberKey(df.type, df.fullName, df.rel), {
            type: df.type,
            fullName: df.fullName,
            rel: df.rel,
            path: df.localPath
          });
        }
      }
    }
    return { members, cleanup: () => { /* nothing to clean */ } };
  }

  return materializeOrg(sf, side.org, components, cwd, token);
}

/** The `result.files` shape from `sf project retrieve start --json`. */
interface RetrieveResult {
  files?: Array<{ fullName: string; type: string; state?: string }>;
}

/**
 * Retrieves `components` from `org` into a temp dir (metadata format) and maps
 * each retrieved file back to a member. Uses the phase-1 mechanics:
 * `--target-metadata-dir <dir> --unzip` (bypasses source tracking, always fresh),
 * dir INSIDE the project (CLI constraint), files land under
 * `<dir>/unpackaged/unpackaged/…`. A component the org reports as `Failed`
 * (not found) simply contributes no members → shows as only-on-the-other-side.
 */
async function materializeOrg(
  sf: SfExecutor,
  org: string,
  components: ComponentRef[],
  cwd: string,
  token?: vscode.CancellationToken
): Promise<MaterializedSide> {
  const baseDir = path.join(cwd, '.siid', 'difftmp');
  fs.mkdirSync(baseDir, { recursive: true });
  const outDir = fs.mkdtempSync(path.join(baseDir, 'compare-'));
  const retrievedRoot = path.join(outDir, 'unpackaged', 'unpackaged');
  // Copy located files OUT to a stable dir so they survive outDir cleanup and can
  // back the diff editor after compare returns.
  const keepDir = fs.mkdtempSync(path.join(os.tmpdir(), 'siid-forge-cmp-'));

  const metadataArgs = components.flatMap((c) => ['--metadata', `${c.type}:${c.fullName}`]);
  const args = ['project', 'retrieve', 'start', ...metadataArgs, '--target-metadata-dir', outDir, '--unzip', '--target-org', org];

  const members = new Map<string, Member>();
  try {
    const { result } = await sf.run<RetrieveResult>(args, { cwd, token, acceptNonZeroStatus: true });
    const missing = new Set<string>();
    for (const f of result?.files ?? []) {
      if (f.state === 'Failed') {
        missing.add(`${f.type}:${f.fullName}`);
      }
    }

    for (const comp of components) {
      if (missing.has(`${comp.type}:${comp.fullName}`)) {
        continue; // not in this org → no members
      }
      // Enumerate the component's members from its LOCAL file list (same rel paths),
      // then locate each in the retrieved tree. For a bundle each member maps 1:1;
      // for XML types the org file has a metadata-format suffix.
      const localFiles = comp.paths.flatMap((p) => collectDeployFiles(p));
      const rels = localFiles.length ? localFiles : [{ type: comp.type, fullName: comp.fullName, rel: '', localPath: '' }];
      for (const lf of rels) {
        const found = locateRetrieved(retrievedRoot, comp.type, comp.fullName, lf.rel);
        if (found) {
          const kept = copyKept(found, keepDir);
          members.set(memberKey(comp.type, comp.fullName, lf.rel), {
            type: comp.type,
            fullName: comp.fullName,
            rel: lf.rel,
            path: kept
          });
        }
      }
    }
    return {
      members,
      cleanup: () => {
        try { fs.rmSync(keepDir, { recursive: true, force: true }); } catch { /* best-effort */ }
      }
    };
  } finally {
    // The metadata-format scratch dir is never needed after mapping.
    try { fs.rmSync(outDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

/** Locates a retrieved component file (bundle member by rel, XML by md-suffix name). */
function locateRetrieved(root: string, type: string, name: string, rel: string): string | undefined {
  const folder = metadataSourceFolder(type);
  if (!folder) {
    return undefined;
  }
  if (isBundleType(type)) {
    const tail = path.join(folder, name, rel).replace(/\\/g, '/');
    return findByTail(root, tail);
  }
  const ext = xmlMdExt(type);
  if (ext) {
    return findByTail(root, path.join(folder, `${name}.${ext}`).replace(/\\/g, '/'));
  }
  return undefined;
}

/** Copies a file into `keepDir` under a unique subdir (preserving its basename). */
function copyKept(src: string, keepDir: string): string {
  const sub = fs.mkdtempSync(path.join(keepDir, 'm-'));
  const dest = path.join(sub, path.basename(src));
  fs.copyFileSync(src, dest);
  return dest;
}

/**
 * Syncs a set of components FROM `from` TO `to` (one direction of the compare
 * view). Behavior by destination:
 * - **destination is an org** → deploy the source side's version to it. When the
 *   source is Local, deploy the local files directly (`--source-dir`). When the
 *   source is another ORG, the source must first be retrieved to disk, then
 *   deployed to the destination (retrieve→deploy bridge).
 * - **destination is Local** → the source must be an org; retrieve those
 *   components from it into the local project (overwrites local).
 *
 * Returns the count of components pushed. Throws on CLI failure (caller reports).
 */
export async function syncComponents(
  sf: SfExecutor,
  from: CompareSide,
  to: CompareSide,
  components: ComponentRef[],
  cwd: string,
  token?: vscode.CancellationToken
): Promise<number> {
  if (!components.length) {
    return 0;
  }
  const metadataArgs = components.flatMap((c) => ['--metadata', `${c.type}:${c.fullName}`]);

  if (to.kind === 'org') {
    if (from.kind === 'local') {
      // Local → org: deploy local files straight to the destination org.
      const srcDirs = components.flatMap((c) => c.paths).flatMap((p) => ['--source-dir', p]);
      await sf.run(['project', 'deploy', 'start', ...srcDirs, '--target-org', to.org], { cwd, token });
      return components.length;
    }
    // Org → org: retrieve from the source org (METADATA format, always fresh —
    // `--output-dir` honors source tracking and would retrieve nothing for
    // tracked components, exactly like the phase-1 diff), then deploy that
    // metadata dir straight to the destination org with `--metadata-dir`.
    // Validated live 2026-07-03 (dry-run: conditionEvaluator → Created).
    const bridge = fs.mkdtempSync(path.join(ensureDiffTmp(cwd), 'bridge-'));
    try {
      await sf.run(
        ['project', 'retrieve', 'start', ...metadataArgs, '--target-metadata-dir', bridge, '--unzip', '--target-org', from.org],
        { cwd, token }
      );
      const mdDir = path.join(bridge, 'unpackaged', 'unpackaged');
      await sf.run(
        ['project', 'deploy', 'start', '--metadata-dir', mdDir, '--target-org', to.org],
        { cwd, token }
      );
      return components.length;
    } finally {
      try { fs.rmSync(bridge, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  }

  // Destination is Local → source must be an org: retrieve into the project.
  if (from.kind !== 'org') {
    throw new Error('Cannot sync Local → Local.');
  }
  await sf.run(['project', 'retrieve', 'start', ...metadataArgs, '--target-org', from.org], { cwd, token });
  return components.length;
}

/** Ensures `<cwd>/.siid/difftmp` exists and returns it. */
function ensureDiffTmp(cwd: string): string {
  const dir = path.join(cwd, '.siid', 'difftmp');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as fs from 'fs';
import { SchemaManager } from './schemaManager';
import { findDependencies, DependencyRef, FileReader } from './dependencyFinder';

/** A single textual reference to a symbol. (Alias of the dependency finder.) */
export type SymbolRef = DependencyRef;

/** What kind of Apex symbol we're refactoring. */
export type SymbolKind = 'class' | 'method' | 'field' | 'object' | 'lwc' | 'variable';

export interface RenameTarget {
  kind: SymbolKind;
  name: string;
  /** For methods: the owning class name (helps disambiguate). */
  owner?: string;
  /** For variable renames: restrict to this file. */
  scopeFile?: string;
}

/**
 * Finds project-wide references to a symbol via the shared dependency finder.
 * Headless service — the UI (RenameProvider) and the AI agent both call it.
 */
export function findReferences(
  _schema: SchemaManager,
  projectRoot: string,
  target: RenameTarget,
  readFile?: FileReader
): SymbolRef[] {
  return findDependencies(
    projectRoot,
    { name: target.name, symbol: target.kind },
    target.scopeFile,
    readFile
  );
}

/** A reference that a rename would rewrite, with a stable key + code preview. */
export interface RenameEdit extends DependencyRef {
  /** Stable id for UI selection: `<filePath>:<line>:<column>`. */
  key: string;
  /** Workspace-relative path for display. */
  relPath: string;
  /** The source line text (trimmed) for a preview. */
  preview: string;
  /**
   * `true` when this ref is highly confident (declaration, owner-scoped call,
   * qualified `Owner.method`, LWC import). `false` for bare-name matches that
   * may be a different symbol — defaulted OFF so the user opts in.
   */
  confident: boolean;
}

/** The full plan for a rename: what would change, before anything is applied. */
export interface RenamePlan {
  target: RenameTarget;
  newName: string;
  edits: RenameEdit[];
  /** Files this plan would rename (e.g. `Class.cls` → `New.cls`). */
  fileRenames: Array<{ from: string; to: string }>;
}

/**
 * Builds a rename plan WITHOUT touching disk. Headless + agent-consumable: the
 * rename webview and the AI agent both call this, then let the user pick which
 * edits to apply. Confidence is scored so low-certainty matches default off.
 *
 *  - method:   scoped to the owner class file + qualified `Owner.method` calls +
 *              LWC `@salesforce/apex/Owner.method` imports are CONFIDENT; bare
 *              same-name hits elsewhere are listed but unconfident.
 *  - variable: restricted to `scopeFile` (all hits there are confident).
 *  - class:    all refs confident (class names are unique).
 */
export function planRename(
  schema: SchemaManager,
  projectRoot: string,
  target: RenameTarget,
  newName: string,
  readFile?: FileReader
): RenamePlan {
  const refs = findReferences(schema, projectRoot, target, readFile);
  const edits: RenameEdit[] = refs
    .filter((r) => r.line >= 0) // skip filename-only refs; handled via fileRenames
    .map((r) => toEdit(r, target, readFile));

  const fileRenames = target.kind === 'class'
    ? classFileRenames(schema, projectRoot, target.name, newName)
    : [];

  return { target, newName, edits, fileRenames };
}

/** Converts a raw ref into a UI-ready edit, scoring confidence by context. */
function toEdit(r: DependencyRef, target: RenameTarget, readFile?: FileReader): RenameEdit {
  const relPath = toRel(r.filePath);
  let preview = '';
  const override = readFile?.(r.filePath);
  try {
    const content = typeof override === 'string' ? override : fs.readFileSync(r.filePath, 'utf-8');
    const line = content.split(/\r?\n/)[r.line] ?? '';
    preview = line.trim().slice(0, 200);
  } catch { /* file vanished mid-plan; leave preview empty */ }
  return { ...r, key: `${r.filePath}:${r.line}:${r.column}`, relPath, preview, confident: isConfident(r, target) };
}

/** Heuristic confidence for whether a ref truly belongs to the target symbol. */
function isConfident(r: DependencyRef, target: RenameTarget): boolean {
  if (target.kind === 'class') {
    return true; // class names are project-unique
  }
  if (target.kind === 'variable') {
    return true; // scoped to one file already
  }
  // method: confident when it's a declaration, a qualified/static call
  // (`Owner.method`), an LWC apex import, or sits in the owner class file.
  if (r.kind === 'apex-decl' || r.kind === 'apex-static' || r.kind === 'apex-member' || r.kind === 'lwc-import') {
    return true;
  }
  if (target.owner) {
    const base = r.filePath.replace(/\\/g, '/').split('/').pop() ?? '';
    if (base === `${target.owner}.cls` || base === `${target.owner}.trigger`) {
      return true; // a bare call inside the owning class
    }
  }
  return false;
}

/** Builds the `.cls`/`.cls-meta.xml` file renames for a class rename. */
function classFileRenames(
  schema: SchemaManager,
  projectRoot: string,
  oldName: string,
  newName: string
): Array<{ from: string; to: string }> {
  const file = schema.readApex(projectRoot, oldName)?.filePath;
  if (!file) {
    return [];
  }
  const dir = file.replace(/[\\/][^\\/]+$/, '');
  return [`${oldName}.cls`, `${oldName}.cls-meta.xml`].map((base) => ({
    from: `${dir}/${base}`,
    to: `${dir}/${base.replace(oldName, newName)}`
  }));
}

function toRel(filePath: string): string {
  const norm = filePath.replace(/\\/g, '/');
  const idx = norm.lastIndexOf('/force-app/');
  return idx >= 0 ? norm.slice(idx + 1) : norm.split('/').pop() ?? norm;
}

/**
 * Lists `@AuraEnabled` methods that have NO reference from any LWC/Aura file —
 * candidates for removal. Uses the AuraEnabled map + the dependency finder.
 */
export function findUnusedAuraEnabled(
  schema: SchemaManager,
  projectRoot: string
): Array<{ className: string; method: string; filePath?: string; line?: number }> {
  const map = schema.readAuraEnabled(projectRoot);
  const unused: Array<{ className: string; method: string; filePath?: string; line?: number }> = [];
  for (const [className, methods] of Object.entries(map)) {
    for (const m of methods) {
      const clientRefs = findDependencies(projectRoot, { name: m.name, symbol: 'method' })
        .filter((r) => /[\\/](lwc|aura)[\\/]/.test(r.filePath));
      if (clientRefs.length === 0) {
        unused.push({ className, method: m.name, filePath: m.filePath, line: m.line });
      }
    }
  }
  return unused;
}

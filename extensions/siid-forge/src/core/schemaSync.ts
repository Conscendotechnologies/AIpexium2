/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { SchemaManager } from './schemaManager';
import { findProjectRoot } from './workspace';

/**
 * Event-driven schema refresh: keeps the schema cache in sync with IDE actions
 * that change metadata (create / retrieve / deploy), refreshing only the parts a
 * given path touches. Object refresh hits the org (describe); apex/lwc re-parse
 * local files. All paths flow through the SchemaManager's `refresh*` methods,
 * which stamp `meta.json` — so an event refresh also resets the staleness clock
 * the periodic timer reads, and the timer won't re-run right after an event.
 *
 * `onRefreshed` (optional) lets a caller repaint the Schema tree after a sync.
 */
export interface SchemaSyncKinds {
  objects: boolean;
  apex: boolean;
  lwc: boolean;
}

/** Infers which schema kinds a set of touched paths affects (by folder). */
export function kindsForPaths(paths: string[]): SchemaSyncKinds {
  const kinds: SchemaSyncKinds = { objects: false, apex: false, lwc: false };
  for (const p of paths) {
    const norm = p.replace(/\\/g, '/');
    if (/\/objects\//.test(norm)) { kinds.objects = true; }
    // Apex schema is built from .cls files; a path under classes/ or ending in
    // .cls means re-parse. (Triggers aren't part of the schema, so they don't
    // set this — but a mixed folder retrieve still refreshes via the folder.)
    if (/\/classes\//.test(norm) || norm.endsWith('.cls')) { kinds.apex = true; }
    if (/\/lwc\//.test(norm)) { kinds.lwc = true; }
  }
  return kinds;
}

/**
 * Refreshes the schema kinds implied by `paths`. When `paths` can't be narrowed
 * (e.g. a whole-folder retrieve), pass `{ objects: true, apex: true, lwc: true }`
 * via `force` to refresh everything. Errors are swallowed per-kind (best-effort;
 * a sync must never break the create/retrieve/deploy it follows).
 */
export async function syncSchemaAfter(
  schema: SchemaManager,
  anchorPath: string,
  kinds: SchemaSyncKinds,
  onRefreshed?: () => void
): Promise<void> {
  const root = findProjectRoot(anchorPath);
  if (kinds.apex) {
    try { schema.refreshApex(root); } catch { /* best-effort */ }
  }
  if (kinds.lwc) {
    try { schema.refreshLwc(root); } catch { /* best-effort */ }
  }
  if (kinds.objects) {
    try { await schema.refreshObjects(root); } catch { /* best-effort */ }
  }
  onRefreshed?.();
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { SchemaManager } from './schemaManager';
import { findDependencies, DependencyRef } from './dependencyFinder';

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
  target: RenameTarget
): SymbolRef[] {
  return findDependencies(
    projectRoot,
    { name: target.name, symbol: target.kind },
    target.scopeFile
  );
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

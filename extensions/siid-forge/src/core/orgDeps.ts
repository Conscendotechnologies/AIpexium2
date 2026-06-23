/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { SfExecutor } from './sfExecutor';

/** An org component that references the queried symbol. */
export interface OrgRef {
  /** Display name of the referencing component, e.g. "LayoutConfigController". */
  name: string;
  /** Metadata type of the referencer, e.g. "ApexClass", "Flow", "Layout". */
  type: string;
  /** The referencer's component Id (e.g. a Flow version 301… id), if known. */
  id?: string;
}

export interface OrgRefResult {
  refs: OrgRef[];
  /** True if the Dependency API was usable; false → result is empty/unavailable. */
  available: boolean;
  message?: string;
}

interface QueryResult<T> {
  records: T[];
}

/**
 * Finds org components that reference a field/object via the Tooling API's
 * `MetadataComponentDependency`. Headless service — UI + AI agent both call it.
 * This is exactly how Salesforce's own "Where is this used?" works, so it
 * reports flows, layouts, apex, etc. directly — no metadata retrieve/scan needed.
 *
 * Key: we resolve the field/object's component **Id** first, then query the
 * dependency table by `RefMetadataComponentId`. Filtering by name is rejected by
 * the API and a type-only query is capped (LIMIT) and misses refs — filtering by
 * Id is exact and complete.
 */
export async function findOrgRefs(
  sf: SfExecutor,
  field: string,
  object: string,
  cwd: string,
  token?: vscode.CancellationToken
): Promise<OrgRefResult> {
  try {
    const componentId = await resolveFieldId(sf, field, object, cwd, token);
    if (!componentId) {
      return { refs: [], available: true, message: `Could not resolve a component Id for ${object}.${field}.` };
    }

    const { result } = await sf.run<QueryResult<{ MetadataComponentName: string; MetadataComponentType: string; MetadataComponentId: string }>>(
      ['data', 'query', '--use-tooling-api', '--query',
        `SELECT MetadataComponentName, MetadataComponentType, MetadataComponentId FROM MetadataComponentDependency WHERE RefMetadataComponentId = '${componentId}'`],
      { cwd, token }
    );
    const records = result?.records ?? [];

    // De-duplicate by name+type (a component — e.g. a flow with many versions —
    // appears once; we keep the first/highest component id we see for opening).
    const seen = new Map<string, OrgRef>();
    for (const r of records) {
      const key = `${r.MetadataComponentType}:${r.MetadataComponentName}`;
      const existing = seen.get(key);
      if (!existing) {
        seen.set(key, { name: r.MetadataComponentName, type: r.MetadataComponentType, id: r.MetadataComponentId });
      } else if (r.MetadataComponentId > (existing.id ?? '')) {
        // Prefer the latest version id (lexically highest for same-length 18-char ids).
        existing.id = r.MetadataComponentId;
      }
    }
    return { refs: [...seen.values()], available: true };
  } catch (err: any) {
    // Dependency API not enabled / not permitted in this org.
    return { refs: [], available: false, message: err?.message };
  }
}

/**
 * Resolves a custom field's Tooling CustomField Id, scoped to its object. The
 * Tooling `CustomField.DeveloperName` is the API name WITHOUT the `__c` suffix;
 * `TableEnumOrId` is the object (API name for standard objects, an Id for custom).
 */
async function resolveFieldId(
  sf: SfExecutor,
  field: string,
  object: string,
  cwd: string,
  token?: vscode.CancellationToken
): Promise<string | undefined> {
  const dev = field.replace(/__c$/i, '');
  const { result } = await sf.run<QueryResult<{ Id: string; TableEnumOrId: string }>>(
    ['data', 'query', '--use-tooling-api', '--query',
      `SELECT Id, TableEnumOrId FROM CustomField WHERE DeveloperName = '${dev.replace(/'/g, "\\'")}'`],
    { cwd, token }
  );
  const rows = result?.records ?? [];
  if (!rows.length) {
    return undefined;
  }
  if (rows.length === 1) {
    return rows[0].Id;
  }

  // Multiple objects have a field with this DeveloperName — pick the one on our
  // object. TableEnumOrId is the object's API name (standard) or its Id (custom);
  // match the API name directly, else resolve the custom object's Id.
  const direct = rows.find((r) => r.TableEnumOrId.toLowerCase() === object.toLowerCase());
  if (direct) {
    return direct.Id;
  }
  const objectId = await resolveCustomObjectId(sf, object, cwd, token);
  const byId = objectId ? rows.find((r) => r.TableEnumOrId === objectId) : undefined;
  return (byId ?? rows[0]).Id;
}

/** Resolves a custom object's Tooling EntityDefinition/CustomObject Id. */
async function resolveCustomObjectId(
  sf: SfExecutor,
  object: string,
  cwd: string,
  token?: vscode.CancellationToken
): Promise<string | undefined> {
  try {
    const { result } = await sf.run<QueryResult<{ Id: string }>>(
      ['data', 'query', '--use-tooling-api', '--query',
        `SELECT Id FROM CustomObject WHERE DeveloperName = '${object.replace(/__c$/i, '').replace(/'/g, "\\'")}'`],
      { cwd, token }
    );
    return result?.records?.[0]?.Id;
  } catch {
    return undefined;
  }
}

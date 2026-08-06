/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { SfExecutor } from './sfExecutor';
import { ObjectSchema } from './schemaManager';

/**
 * Headless service for editing queried records and writing them back to the org
 * (§H). Presentation-free — the SOQL results panel and the SDK/agent call these
 * same functions. One record is updated per call via `sf data update record`
 * (the same command TraceManager uses), so each row's success/failure is
 * independent.
 */

/**
 * The SObject a query targets, from its `FROM <Object>` clause (case-insensitive;
 * ignores relationship sub-queries). Returns undefined if there's no plain FROM
 * object (e.g. an aggregate `SELECT COUNT()`).
 */
export function objectFromQuery(query: string): string | undefined {
  const m = query.match(/\bFROM\s+([A-Za-z_][\w]*)/i);
  return m?.[1];
}

/** The update target for one editable cell: which object/record/field to write. */
export interface CellTarget {
  /** SObject to update (the base object, or a relationship's target object). */
  sobject: string;
  /** Record Id to update. */
  recordId: string;
  /** The leaf field API name on `sobject`. */
  field: string;
}

/** Extracts the 15/18-char SObject Id from a record's `attributes.url`. */
function idFromAttributes(obj: any): string | undefined {
  const url: string | undefined = obj?.attributes?.url;
  const m = url?.match(/\/([A-Za-z0-9]{15,18})$/);
  return m?.[1] ?? (typeof obj?.Id === 'string' ? obj.Id : undefined);
}

/**
 * Resolves what a query COLUMN edits on a given record, following relationship
 * paths. For a plain column (`Industry`) it's the base object + the row Id. For
 * a relationship path (`Account.Owner.Name`) it walks into the nested objects,
 * and the target becomes the LAST relationship object's type + Id, with the leaf
 * segment (`Name`) as the field. Returns undefined when the path can't be
 * resolved to a concrete record (e.g. a null relationship, or no Id available) —
 * such a cell is not editable.
 */
export function resolveCellTarget(
  record: Record<string, any>,
  column: string,
  baseObject: string,
  baseRecordId: string | undefined
): CellTarget | undefined {
  const segs = column.split('.');
  // Plain field on the base object.
  if (segs.length === 1) {
    return baseRecordId ? { sobject: baseObject, recordId: baseRecordId, field: column } : undefined;
  }
  // Relationship path: walk objects until the last segment (the leaf field).
  let obj: any = record;
  for (let i = 0; i < segs.length - 1; i++) {
    obj = obj?.[segs[i]];
    if (obj === null || obj === undefined || typeof obj !== 'object') {
      return undefined; // broken/null relationship
    }
  }
  const field = segs[segs.length - 1];
  const sobject: string | undefined = obj?.attributes?.type;
  const recordId = idFromAttributes(obj);
  if (!sobject || !recordId) {
    return undefined;
  }
  return { sobject, recordId, field };
}

/** A single edited field value (already the desired new value, as a string). */
export interface FieldEdit {
  field: string;
  value: string;
}

/** One record's pending edits. */
export interface RecordEdit {
  recordId: string;
  fields: FieldEdit[];
  /**
   * SObject to update. Optional — defaults to the caller's base object. Set when
   * the edit targets a RELATIONSHIP's parent record (e.g. editing
   * `Account.Owner.Name` updates the `User`, not the base object).
   */
  sobject?: string;
}

/** Per-record outcome of a save. */
export interface RecordSaveResult {
  recordId: string;
  success: boolean;
  error?: string;
}

/**
 * Field API names that are never user-updateable, independent of object. Used as
 * a fallback when the object schema isn't cached (schema-driven detection is
 * preferred; see {@link isReadOnlyField}).
 */
const SYSTEM_READONLY = new Set(
  [
    'Id', 'IsDeleted', 'CreatedDate', 'CreatedById', 'LastModifiedDate',
    'LastModifiedById', 'SystemModstamp', 'LastActivityDate', 'LastViewedDate',
    'LastReferencedDate'
  ].map((f) => f.toLowerCase())
);

/**
 * True if a field should be presented read-only in the editable grid. A lookup's
 * relationship OBJECT (nested record) is always read-only (you edit the Id field,
 * not the parent). Formula/rollup/auto-number/system fields are read-only too.
 * When the object schema is available we honor field types; otherwise we fall
 * back to the system-field name list.
 */
export function isReadOnlyField(field: string, value: unknown, schema?: ObjectSchema): boolean {
  // Nested relationship object (e.g. `Owner: { Name: ... }`) — not directly editable.
  if (value !== null && typeof value === 'object') {
    return true;
  }
  if (SYSTEM_READONLY.has(field.toLowerCase())) {
    return true;
  }
  const meta = schema?.fields.find((f) => f.name.toLowerCase() === field.toLowerCase());
  if (meta) {
    // The describe's `updateable` is authoritative: formula/rollup/auto-number
    // and non-writable standard fields (e.g. Account.Name on a Person Account)
    // are false. Locking these stops the org rejecting the save. Only trust it
    // when present (older cached schema may lack the flag).
    if (meta.updateable === false) {
      return true;
    }
    // Compound/derived types Salesforce won't accept on a plain update.
    const t = (meta.type ?? '').toLowerCase();
    if (t === 'address' || t === 'location') {
      return true;
    }
  }
  return false;
}

/**
 * Formats a field/value map into the `--values` argument for
 * `sf data update record` (`"Field1='v1' Field2='v2'"`). String values are
 * single-quoted with embedded quotes escaped; the caller decides which fields to
 * include (only the dirty, editable ones).
 */
export function formatValues(fields: FieldEdit[]): string {
  return fields
    .map((f) => {
      const escaped = f.value.replace(/'/g, "\\'");
      return `${f.field}='${escaped}'`;
    })
    .join(' ');
}

/**
 * Updates a single record's fields in the org. Returns a structured outcome
 * rather than throwing, so a batch caller can continue past a failed row.
 */
export async function updateRecord(
  sf: SfExecutor,
  projectRoot: string,
  sobject: string,
  edit: RecordEdit,
  token?: vscode.CancellationToken
): Promise<RecordSaveResult> {
  if (!edit.fields.length) {
    return { recordId: edit.recordId, success: true }; // nothing to do
  }
  try {
    await sf.run(
      [
        'data', 'update', 'record',
        '--sobject', sobject,
        '--record-id', edit.recordId,
        '--values', formatValues(edit.fields)
      ],
      { cwd: projectRoot, token }
    );
    return { recordId: edit.recordId, success: true };
  } catch (err: any) {
    return { recordId: edit.recordId, success: false, error: err?.message ?? 'Update failed.' };
  }
}

/**
 * Saves several record edits sequentially (one `data update record` each),
 * returning a per-record result. Sequential rather than parallel so the org
 * isn't hammered and a cancel stops promptly between rows.
 */
export async function saveRecordEdits(
  sf: SfExecutor,
  projectRoot: string,
  sobject: string,
  edits: RecordEdit[],
  token?: vscode.CancellationToken
): Promise<RecordSaveResult[]> {
  const results: RecordSaveResult[] = [];
  for (const edit of edits) {
    if (token?.isCancellationRequested) {
      break;
    }
    // A relationship edit carries its own target object; else use the base.
    results.push(await updateRecord(sf, projectRoot, edit.sobject ?? sobject, edit, token));
  }
  return results;
}

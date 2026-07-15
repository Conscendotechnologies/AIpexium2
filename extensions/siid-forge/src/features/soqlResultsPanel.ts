/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { SfExecutor, CancellationError } from '../core/sfExecutor';
import { OrgManager } from '../core/orgManager';
import { SchemaManager, ObjectSchema } from '../core/schemaManager';
import { Logger } from '../core/logger';
import { isReadOnlyField, saveRecordEdits, objectFromQuery, resolveCellTarget, RecordEdit, RecordSaveResult } from '../core/dataEditor';
import { openOrgAt } from './openOrg';
import { escapeHtml, FORGE_STYLES } from '../ui/webview';

export interface QueryResult {
  totalSize?: number;
  done?: boolean;
  records?: Array<Record<string, any>>;
}

interface PanelDeps {
  sf: SfExecutor;
  orgs: OrgManager;
  schema: SchemaManager;
  logger: Logger;
  root: string;
}

/** Message from the webview to the extension. */
interface InMessage {
  command: 'save' | 'openRecord';
  /** Edited targets: each carries its own object + record (base or a relationship parent). */
  edits?: Array<{ sobject?: string; recordId: string; fields: Array<{ field: string; value: string }> }>;
  /** For 'openRecord': the record Id to open in the org. */
  recordId?: string;
  /** For 'openRecord': the SObject type, so the deep link resolves reliably. */
  sobject?: string;
}

/**
 * Editable SOQL results panel (§H). Renders query records in a grid where
 * non-system, non-relationship fields are editable, tracks dirty cells, and
 * writes changes back to the org via the headless `saveRecordEdits` service —
 * one `data update record` per edited row. Saving to a non-sandbox org asks for
 * confirmation first (the "never silently touch production" principle).
 *
 * A singleton panel, reused across queries (like the old read-only view).
 */
export class SoqlResultsPanel {
  private static current: SoqlResultsPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private saving: vscode.CancellationTokenSource | undefined;

  /** Current query context, needed to save edits back to the right object. */
  private sobject: string | undefined;

  static show(deps: PanelDeps, query: string, result: QueryResult): void {
    if (!SoqlResultsPanel.current) {
      SoqlResultsPanel.current = new SoqlResultsPanel(deps);
    }
    SoqlResultsPanel.current.render(query, result);
  }

  private constructor(private readonly deps: PanelDeps) {
    this.panel = vscode.window.createWebviewPanel(
      'siidForgeSoql',
      'SOQL Results',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    this.panel.webview.onDidReceiveMessage((m: InMessage) => this.onMessage(m));
    this.panel.onDidDispose(() => {
      this.saving?.cancel();
      SoqlResultsPanel.current = undefined;
    });
  }

  private post(msg: Record<string, unknown>): void {
    void this.panel.webview.postMessage(msg);
  }

  private render(query: string, result: QueryResult): void {
    this.sobject = objectFromQuery(query);
    let schema = this.sobject ? this.deps.schema.readObject(this.deps.root, this.sobject) : undefined;
    this.panel.webview.html = this.html(query, result, schema);
    this.panel.reveal(vscode.ViewColumn.Active);

    // Typed editors (picklist/date/datetime/boolean) and the `updateable` lock
    // need the object's field schema. Describe on demand when it's missing OR
    // stale — an older cache lacks the `updateable` flag, so re-describe so
    // non-writable fields (formula/rollup, Account.Name on a Person Account) get
    // locked. Only bother when there's an editable grid to improve.
    // Warm the org-kind cache in the background now (it runs a one-time
    // `SELECT … FROM Organization`). Doing it on open means the save-time
    // production check is instant — the "Running SOQL query" blip doesn't stall
    // the confirm dialog. Cached by OrgManager, so this is at most one query.
    void this.deps.orgs.getOrgKind().catch(() => undefined);

    const records = result.records ?? [];
    const staleSchema = !!schema && schema.fields.every((f) => f.updateable === undefined);

    // Objects to describe so typed editors + the updateable lock work: the base
    // object (when missing/stale) plus any RELATIONSHIP target objects that
    // appear in the results (e.g. User for `Account.Owner.Name`) and aren't
    // cached yet. Describe them, then re-render once with the richer schema.
    const toDescribe = new Set<string>();
    if (this.sobject && (!schema || staleSchema)) {
      toDescribe.add(this.sobject);
    }
    for (const col of this.relationshipColumns(query)) {
      // Sample a few rows to learn the target object type — no need to scan all
      // (they share the relationship's type). One uncached type per column max.
      for (const rec of records.slice(0, 20)) {
        const t = resolveCellTarget(rec, col, this.sobject ?? '', rec.Id);
        if (t && !this.deps.schema.readObject(this.deps.root, t.sobject)) {
          toDescribe.add(t.sobject);
          break;
        }
      }
    }
    if (toDescribe.size) {
      const forQuery = query;
      void Promise.all([...toDescribe].map((o) =>
        this.deps.schema.describeObject(this.deps.root, o).catch((e) => {
          this.deps.logger.error(`soql describe ${o}: ${e?.message}`);
          return false;
        })
      )).then((oks) => {
        // Re-render only if this is still the same query and something landed.
        if (oks.some(Boolean) && this.sobject === objectFromQuery(forQuery)) {
          const fresh = this.sobject ? this.deps.schema.readObject(this.deps.root, this.sobject) : undefined;
          this.panel.webview.html = this.html(forQuery, result, fresh);
        }
      });
    }
  }

  /** Dotted (relationship-path) columns from a query's SELECT list. */
  private relationshipColumns(query: string): string[] {
    const m = query.match(/select\s+(.+?)\s+from\b/is);
    if (!m) {
      return [];
    }
    return m[1].split(',').map((s) => s.trim()).filter((s) => s.includes('.') && /^[A-Za-z_][\w.]*$/.test(s));
  }

  private async onMessage(m: InMessage): Promise<void> {
    if (m.command === 'save') {
      await this.save(m.edits ?? []);
    } else if (m.command === 'openRecord' && m.recordId) {
      // Open the record by appending the raw Id to the instance URL
      // (`<instanceUrl>/<recordId>`) — the same approach Salesforce Inspector
      // uses. Salesforce's classic redirect resolves the Id to the right
      // Lightning page WITHOUT needing the object type, and opening the absolute
      // URL directly avoids `sf org open --path` mangling the leading slash on
      // Windows (which produced a "Page not found"). Falls back to `sf org open`
      // only when the instance URL can't be determined.
      void this.openRecordInOrg(m.recordId).catch((e) =>
        this.deps.logger.error(`openRecord ${m.recordId}: ${e?.message}`)
      );
    }
  }

  /**
   * Opens a record in the browser by appending its Id to the org instance URL
   * (`<instanceUrl>/<recordId>`) — Salesforce's classic redirect forwards it to
   * the correct Lightning record page without needing the object type. Opened
   * with `vscode.env.openExternal` so no CLI path-mangling is involved. Falls
   * back to `sf org open` (relative `<recordId>` path) when the instance URL is
   * unavailable.
   */
  private async openRecordInOrg(recordId: string): Promise<void> {
    const instanceUrl = await this.deps.orgs.getInstanceUrl().catch(() => undefined);
    if (instanceUrl) {
      const base = instanceUrl.replace(/\/+$/, '');
      await vscode.env.openExternal(vscode.Uri.parse(`${base}/${recordId}`));
      return;
    }
    // Fallback: let the CLI resolve + open. A relative `<recordId>` path (no
    // leading slash) still hits the classic redirect and avoids MSYS mangling.
    const org = await this.deps.orgs.getDefaultOrg().catch(() => undefined);
    await openOrgAt(this.deps.sf, org, this.deps.root, recordId);
  }

  /** Confirms (when needed), saves each dirty row, and reports per-row results. */
  private async save(rawEdits: NonNullable<InMessage['edits']>): Promise<void> {
    const edits: RecordEdit[] = (rawEdits ?? [])
      .map((e) => ({ recordId: e.recordId, fields: e.fields, sobject: e.sobject }))
      .filter((e) => e.recordId && e.fields.length);

    if (!edits.length) {
      this.post({ command: 'saved', results: [], message: 'No changes to save.' });
      return;
    }
    // Every edit must know its target object — either its own (relationship
    // parent) or the base object. If neither is available, we can't save.
    if (!this.sobject && edits.some((e) => !e.sobject)) {
      this.post({ command: 'saveError', message: 'Could not determine the object to update (no FROM clause parsed).' });
      return;
    }

    // Production guard: allow editing any org, but confirm before writing to a
    // non-sandbox org. Only PRODUCTION is called out by name (the risky case);
    // scratch/developer/trial orgs — which getOrgKind can't always tell apart —
    // read as the neutral "non-sandbox" so a misclassification isn't alarming.
    // Resolve SIID's default org — this also HEALS a drifted `.sf/config.json`,
    // so the CLI writes below target the org SIID shows (no per-command
    // `--target-org` needed). Used for the confirmation label too.
    const org = (await this.deps.orgs.getDefaultOrg()) ?? 'the default org';
    const kind = await this.deps.orgs.getOrgKind();
    if (kind !== 'sandbox') {
      const label = kind === 'production' ? 'PRODUCTION' : 'non-sandbox';
      const pick = await vscode.window.showWarningMessage(
        `Save ${edits.length} record(s) to ${label} org "${org}"?`,
        { modal: true },
        'Save'
      );
      if (pick !== 'Save') {
        this.post({ command: 'saveCancelled' });
        return;
      }
    }

    this.saving?.cancel();
    this.saving = new vscode.CancellationTokenSource();
    this.post({ command: 'saving' });

    let results: RecordSaveResult[] = [];
    try {
      results = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `SIID Forge: saving ${edits.length} record(s)…`, cancellable: true },
        (_p, token) => {
          token.onCancellationRequested(() => this.saving?.cancel());
          // Base object for edits that didn't carry their own (plain fields);
          // relationship edits already have `sobject` set.
          return saveRecordEdits(this.deps.sf, this.deps.root, this.sobject ?? '', edits, this.saving!.token);
        }
      );
    } catch (err: any) {
      if (!(err instanceof CancellationError)) {
        this.deps.logger.error(`saveRecordEdits: ${err?.message}`);
      }
      this.post({ command: 'saveError', message: err?.message ?? 'Save failed.' });
      this.saving = undefined;
      return;
    }
    this.saving = undefined;

    const failed = results.filter((r) => !r.success);
    this.post({ command: 'saved', results });
    if (failed.length) {
      void vscode.window.showErrorMessage(`Saved ${results.length - failed.length}/${results.length} record(s); ${failed.length} failed.`);
    } else {
      void vscode.window.showInformationMessage(`Saved ${results.length} record(s).`);
    }
  }

  private html(query: string, result: QueryResult, schema?: ObjectSchema): string {
    const records = result.records ?? [];
    // Prefer the query's SELECT list — it has the real (possibly dotted) column
    // names like `Account.RecordType.Name`, which the CLI returns NESTED under a
    // single `Account` key. Deriving from the record keys would wrongly collapse
    // `Account.Name` and `Account.RecordType.Name` into one `Account` column.
    const columns = selectColumns(query) ?? deriveColumns(records);

    const baseId = this.sobject && objectFromQuery(query) ? this.sobject : undefined;

    // The schema for a column's TARGET object: the base object for a plain field,
    // else the related object a relationship path lands on (its API name is the
    // last relationship object's type). Described on demand + cached here.
    const schemaFor = (sobject: string): ObjectSchema | undefined =>
      sobject === this.sobject ? schema : this.deps.schema.readObject(this.deps.root, sobject);

    // A column is a candidate for editing when it's not the (locked) Id and,
    // for a plain field, isn't read-only on the base object. Relationship paths
    // (with a dot) are candidates; each CELL's real editability is decided per
    // row by whether its target resolves (see resolveCellTarget).
    const isRelPath = (col: string) => col.includes('.');

    // Lookup-Id columns (`AccountId`, `OwnerId`, `MyRel__c`) link to the PARENT
    // record. Resolve each one's target object from a paired relationship path in
    // the same query: `AccountId`↔`Account.*`, `MyRel__c`↔`MyRel__r.*`. We read
    // the related object's type from the first row that has the nested object.
    const lookupTargets = new Map<string, string>(); // lookup column -> parent object
    for (const col of columns) {
      if (isRelPath(col) || col === 'Id') { continue; }
      const rel = /__c$/i.test(col) ? col.slice(0, -3) + '__r' : /Id$/.test(col) ? col.slice(0, -2) : undefined;
      if (!rel) { continue; }
      const relCol = columns.find((c) => c.split('.')[0].toLowerCase() === rel.toLowerCase() && c.includes('.'));
      if (!relCol) { continue; }
      for (const rec of records) {
        const nested = getByPath(rec, rel);
        const t = nested && typeof nested === 'object' ? (nested as any)?.attributes?.type : undefined;
        if (t) { lookupTargets.set(col, t); break; }
      }
    }

    const candidate = new Map<string, boolean>();
    for (const col of columns) {
      if (col === 'Id') { candidate.set(col, false); continue; }
      if (isRelPath(col)) { candidate.set(col, true); continue; }
      const ro = records.some((rec) => isReadOnlyField(col, getByPath(rec, col), schema));
      candidate.set(col, !ro);
    }
    const hasId = columns.includes('Id');

    const header = columns
      .map((c, i) =>
        `<th class="sortable" data-col="${i}">${escapeHtml(c)}${candidate.get(c) ? '' : ' <span class="ro">🔒</span>'}<span class="arrow"></span></th>`)
      .join('');

    // Per-column editor spec (kind + options), resolved against the column's
    // TARGET object schema — for a relationship path that's the related object
    // (User for `Account.Owner.Name`). Falls back to text when the target schema
    // isn't available. Sent to the client to build the editor lazily on click.
    const specForField = (sobject: string | undefined, leaf: string): { kind: string; options?: string[] } => {
      const f = sobject ? schemaFor(sobject)?.fields.find((x) => x.name.toLowerCase() === leaf.toLowerCase()) : undefined;
      const t = (f?.type ?? '').toLowerCase();
      if (f?.picklistValues?.length) { return { kind: 'picklist', options: f.picklistValues }; }
      if (t === 'boolean') { return { kind: 'boolean' }; }
      if (t === 'date') { return { kind: 'date' }; }
      if (t === 'datetime') { return { kind: 'datetime' }; }
      return { kind: 'text' };
    };
    // Resolve one representative target object per column (from the first row
    // that has it) to pick the editor kind for the whole column.
    const editorSpec: Record<string, { kind: string; options?: string[] }> = {};
    for (const col of columns) {
      if (!candidate.get(col)) { continue; }
      const leaf = col.split('.').pop()!;
      let targetObj: string | undefined = isRelPath(col) ? undefined : baseId;
      if (isRelPath(col)) {
        for (const rec of records) {
          const t = resolveCellTarget(rec, col, baseId ?? '', rec.Id);
          if (t) { targetObj = t.sobject; break; }
        }
      }
      editorSpec[col] = specForField(targetObj, leaf);
    }

    const rows = records
      .map((rec) => {
        const id = rec.Id ?? '';
        const cells = columns
          .map((c) => {
            // Read by PATH — the CLI nests `Account.RecordType.Name` under the
            // `Account` object, so rec[c] would be undefined for a dotted column.
            const raw = flatten(getByPath(rec, c));
            // The Id column links out to the record in the org (open ↗).
            if (c === 'Id') {
              const link = raw
                ? `<a class="reclink" data-rid="${escapeHtml(raw)}" data-obj="${escapeHtml(baseId ?? '')}" title="Open record ${escapeHtml(raw)} in org">↗</a>`
                : '';
              return `<td class="idcell">${escapeHtml(raw)}${link}</td>`;
            }
            // A lookup-Id column (`AccountId`) links to the PARENT record, using
            // the related object type resolved from the paired relationship path.
            const parentObj = lookupTargets.get(c);
            if (parentObj && raw) {
              const plink = `<a class="reclink" data-rid="${escapeHtml(raw)}" data-obj="${escapeHtml(parentObj)}" title="Open ${escapeHtml(parentObj)} ${escapeHtml(raw)} in org">↗</a>`;
              return `<td class="idcell">${escapeHtml(raw)}${plink}</td>`;
            }
            if (!candidate.get(c)) {
              return `<td>${escapeHtml(raw)}</td>`;
            }
            // Resolve THIS cell's save target (base field, or a relationship's
            // parent record). Not editable if it can't resolve to a record.
            const target = resolveCellTarget(rec, c, baseId ?? '', id || undefined);
            if (!target) {
              return `<td>${escapeHtml(raw)}</td>`;
            }
            // Honor the TARGET object's schema: a relationship leaf that isn't
            // updateable (formula/system field on the related object) stays
            // read-only, same as base fields. Pass the leaf scalar as the value
            // (a base cell has it at rec[c]; a relationship leaf is already a
            // scalar, so the object-guard is a no-op there).
            const targetSchema = schemaFor(target.sobject);
            const leafValue = c.includes('.') ? raw : rec[c];
            if (targetSchema && isReadOnlyField(target.field, leafValue, targetSchema)) {
              return `<td>${escapeHtml(raw)}</td>`;
            }
            // Lightweight editable cell: plain text now, upgraded on click. It
            // carries its own save target (sobject + recordId + leaf field). No
            // inline link — that blocked editing; the Id column carries the
            // open-in-org links. A relationship cell notes its parent on hover.
            const isRel = c.includes('.');
            const tip = isRel ? ` title="Edits ${escapeHtml(target.sobject)} · ${escapeHtml(target.recordId)}"` : '';
            return `<td class="ecell" data-colname="${escapeHtml(c)}" data-sobject="${escapeHtml(target.sobject)}" data-rid="${escapeHtml(target.recordId)}" data-field="${escapeHtml(target.field)}" data-orig="${escapeHtml(raw)}" tabindex="0"${tip}>${escapeHtml(raw)}</td>`;
          })
          .join('');
        return `<tr data-id="${escapeHtml(id)}">${cells}</tr>`;
      })
      .join('');

    const table = records.length
      ? `<table><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table>`
      : '<p class="muted">No records returned.</p>';

    // The grid is editable if any cell resolved a save target. Base fields need
    // the row's `Id`; relationship cells (`Account.Owner.Name`) instead use the
    // parent record's Id embedded in the nested object, so they can be editable
    // even without a top-level Id in the SELECT.
    const canEdit = rows.includes('class="ecell"');
    const editNote = canEdit
      ? ''
      : !this.sobject
        ? '<div class="warn section">Editing disabled: could not parse the object from the query.</div>'
        : !hasId
          ? '<div class="warn section">Editing disabled: add <code>Id</code> (or a relationship field that carries the parent Id) to the SELECT to edit records.</div>'
          : '<div class="warn section">No editable fields in this result.</div>';

    return /* html */ `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<style>${FORGE_STYLES}
  /* Compact, single-line rows — cells must not stretch to fill the panel. */
  table { table-layout: auto; border-collapse: separate; border-spacing: 0; }
  th, td { vertical-align: middle; height: 28px; white-space: nowrap; max-width: 320px; overflow: hidden; text-overflow: ellipsis; }
  /* Fixed header: keep the column headers pinned while the body scrolls. Stick
     just below the sticky toolbar (its height ~44px) with an opaque background
     so rows scroll underneath it. */
  thead th { position: sticky; top: 44px; z-index: 2; background: var(--forge-th, var(--vscode-keybindingTable-headerBackground, #2a2a2a)); }
  /* Editable cells render as plain text; a real editor is materialized on click
     (lazy — avoids creating thousands of controls upfront). */
  td.ecell { cursor: text; }
  td.ecell.editing { padding: 0; overflow: visible; }
  td.ecell .editor { width: 100%; height: 100%; box-sizing: border-box; background: transparent; color: inherit; border: none; font: inherit; padding: 2px 8px; outline: 2px solid var(--forge-purple); outline-offset: -2px; }
  td.ecell select.editor option { background-color: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); }
  /* Pending edit (ORANGE), saved OK (GREEN), failed (red). A left accent bar
     makes the state unambiguous even where the tint is subtle. The saved class
     never applies while dirty (markCell removes it); :not guards it anyway. */
  td.dirty { background: rgba(230, 126, 34, 0.28); box-shadow: inset 3px 0 0 var(--vscode-editorWarning-foreground, #e67e22); }
  td.saved:not(.dirty) { background: rgba(94, 186, 125, 0.24); box-shadow: inset 3px 0 0 var(--vscode-charts-green, #4ec96a); }
  td.saveFail { background: rgba(244, 71, 71, 0.18); outline: 2px solid var(--vscode-errorForeground, #f44); outline-offset: -2px; }
  /* The Id column links out to the record in the org. */
  a.reclink { color: var(--forge-purple, var(--vscode-textLink-foreground)); cursor: pointer; text-decoration: none; margin-left: 8px; font-size: 13px; opacity: 0.75; }
  a.reclink:hover { opacity: 1; text-decoration: underline; }
  .ro { opacity: 0.6; font-size: 11px; }
  .toolbar { position: sticky; top: 0; background: var(--vscode-editor-background); padding: 8px 0; z-index: 3; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  #status { margin-left: 4px; }
  #filter { flex: 1; min-width: 160px; max-width: 320px; padding: 4px 8px; }
  #filterCount { color: var(--forge-muted); font-size: 12px; }
  tr.hidden { display: none; }
  #errBanner { display: none; background: var(--vscode-inputValidation-errorBackground, #5a1d1d); border: 1px solid var(--vscode-errorForeground, #f44); border-radius: 4px; padding: 8px 12px; margin: 8px 0; }
  #errBanner ul { margin: 6px 0 0; padding-left: 18px; }
  #errBanner li { margin: 2px 0; }
  /* Sortable headers. */
  th.sortable { cursor: pointer; user-select: none; }
  th.sortable:hover { color: var(--forge-purple); }
  th .arrow { opacity: 0.5; font-size: 10px; margin-left: 4px; }
  /* Collapsible query preview — long FIELDS(ALL) queries shouldn't eat the panel. */
  #query { position: relative; }
  #queryText { white-space: pre-wrap; word-break: break-word; overflow: hidden; }
  #query.collapsed #queryText { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; max-height: 3.2em; }
  #queryToggle { background: none; border: none; color: var(--forge-purple); cursor: pointer; padding: 2px 0; font-size: 12px; }
</style></head>
<body>
  <h1>SOQL Results</h1>
  <div id="query" class="collapsed">
    <div id="queryText" class="muted">${escapeHtml(query)}</div>
    <button id="queryToggle" style="display:none">Show full query ▾</button>
    <span class="muted"> &middot; ${result.totalSize ?? records.length} record(s)</span>
  </div>
  ${editNote}
  <div class="toolbar">
    <input id="filter" type="search" placeholder="Filter rows (local)…" />
    <span id="filterCount"></span>
    ${canEdit ? '<span style="flex-basis:100%"></span><button id="save" disabled>Save changes</button><button id="revert" class="secondary" disabled>Revert</button><span id="status" class="muted"></span>' : ''}
  </div>
  <div id="errBanner"></div>
  ${table}

  <script>
    const vscode = acquireVsCodeApi();
    const canEdit = ${canEdit ? 'true' : 'false'};
    // Per-column editor spec (kind + picklist options) for lazily building the
    // right editor when a cell is clicked.
    const EDITORS = ${JSON.stringify(editorSpec)};
    const saveBtn = document.getElementById('save');
    const revertBtn = document.getElementById('revert');
    const statusEl = document.getElementById('status');

    // --- Lazy cell editing --------------------------------------------------
    // Editable cells (td.ecell) render as plain text. Clicking one materializes
    // the right editor (picklist/boolean/date/datetime/text) from EDITORS, so we
    // never build thousands of controls upfront. The cell's current value lives
    // in its text (or the live editor when editing); data-orig is the baseline.

    const dirtyCells = new Set();          // td.ecell elements the user changed
    // Editable cells are plain text (links live only in the read-only Id column),
    // so the value is simply the live editor's value or the cell's text.
    function cellValue(td) {
      const ed = td.querySelector('.editor');
      if (ed) return (ed.tagName === 'SELECT' || ed.tagName === 'INPUT') ? ed.value : ed.textContent;
      return td.textContent;
    }
    function paintCell(td, value) { td.textContent = value; }
    function cellDirty(td) { return cellValue(td) !== td.getAttribute('data-orig'); }
    function updateStatus() {
      const n = dirtyCells.size;
      if (saveBtn) { saveBtn.disabled = n === 0; revertBtn.disabled = n === 0; }
      if (statusEl) statusEl.textContent = n ? (n + ' change(s) pending') : '';
    }
    function markCell(td) {
      const dirty = cellDirty(td);
      td.classList.toggle('dirty', dirty);
      td.classList.remove('saved', 'saveFail');
      if (dirty) dirtyCells.add(td); else dirtyCells.delete(td);
      td._cache = cellValue(td);           // keep the row-search cache fresh
    }

    // Commit the open editor's value back into the cell (preserving any link).
    function commitEditor(td) {
      const ed = td.querySelector('.editor');
      if (!ed) return;
      let v = (ed.tagName === 'SELECT' || ed.tagName === 'INPUT') ? ed.value : ed.textContent;
      if (ed.type === 'datetime-local' && v && v.length === 16) v += ':00';
      td.classList.remove('editing');
      ed.remove();
      paintCell(td, v);
      markCell(td);
      updateStatus();
    }

    // Build + focus an editor inside the cell (over the value span; the ↗ link,
    // if any, stays put).
    function openEditor(td) {
      if (td.querySelector('.editor')) return;         // already editing
      const spec = EDITORS[td.getAttribute('data-colname')] || { kind: 'text' };
      const cur = cellValue(td);
      let ed;
      if (spec.kind === 'picklist' || spec.kind === 'boolean') {
        ed = document.createElement('select');
        const opts = spec.kind === 'boolean' ? ['true', 'false'] : [''].concat((spec.options || []).filter((v) => v !== ''));
        if (cur && opts.indexOf(cur) === -1) opts.unshift(cur);
        ed.innerHTML = opts.map((v) => '<option value="' + v.replace(/"/g, '&quot;') + '"' + (v === cur ? ' selected' : '') + '>' + (v === '' ? '— none —' : v.replace(/</g, '&lt;')) + '</option>').join('');
      } else if (spec.kind === 'date') {
        ed = document.createElement('input'); ed.type = 'date'; ed.value = (cur || '').slice(0, 10);
      } else if (spec.kind === 'datetime') {
        ed = document.createElement('input'); ed.type = 'datetime-local'; ed.value = (cur || '').replace(' ', 'T').slice(0, 16);
      } else {
        ed = document.createElement('input'); ed.type = 'text'; ed.value = cur;
      }
      ed.className = 'editor';
      td.classList.add('editing');
      td.textContent = '';
      td.appendChild(ed);
      ed.focus();
      if (ed.select) { try { ed.select(); } catch (e) {} }
      ed.addEventListener('blur', () => commitEditor(td));
      ed.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); ed.blur(); }
        else if (e.key === 'Escape') { td.classList.remove('editing'); ed.remove(); paintCell(td, td.getAttribute('data-orig')); }
      });
    }

    // --- Row model (precomputed, for fast filter + sort) --------------------
    const theTable = document.querySelector('table');
    const theBody = theTable ? theTable.querySelector('tbody') : null;
    const rowEls = theBody ? Array.from(theBody.querySelectorAll('tr')) : [];
    function cellText(td) { return td._cache != null ? td._cache : (td.classList.contains('ecell') ? cellValue(td) : td.textContent); }
    function buildRowCache(tr) {
      let s = '';
      for (let i = 0; i < tr.children.length; i++) {
        const c = tr.children[i];
        c._cache = c.classList.contains('ecell') ? cellValue(c) : c.textContent;
        s += c._cache + ' ';
      }
      tr._search = s.toLowerCase();
    }
    rowEls.forEach(buildRowCache);

    if (canEdit) {
      document.querySelectorAll('td.ecell').forEach((td) => {
        td.setAttribute('data-orig', td.textContent);
      });
      if (theBody) {
        theBody.addEventListener('click', (e) => {
          // The ↗ link opens the parent record in the org (don't start editing).
          const link = e.target.closest('.reclink');
          if (link) {
            e.stopPropagation();
            vscode.postMessage({ command: 'openRecord', recordId: link.getAttribute('data-rid'), sobject: link.getAttribute('data-obj') || undefined });
            return;
          }
          const td = e.target.closest('td.ecell');
          if (td) openEditor(td);
        });
      }
      updateStatus();
    }

    function refreshDirty() {
      dirtyCells.clear();
      document.querySelectorAll('td.ecell').forEach((td) => {
        const dirty = cellDirty(td);
        td.classList.toggle('dirty', dirty);
        td.classList.remove('saved', 'saveFail');
        if (dirty) dirtyCells.add(td);
        td._cache = cellValue(td);
      });
      updateStatus();
    }

    (function enableQueryToggle() {
      const wrap = document.getElementById('query');
      const text = document.getElementById('queryText');
      const btn = document.getElementById('queryToggle');
      if (!wrap || !text || !btn) return;
      if (text.scrollHeight > text.clientHeight + 2) btn.style.display = '';
      btn.addEventListener('click', () => {
        const collapsed = wrap.classList.toggle('collapsed');
        btn.textContent = collapsed ? 'Show full query ▾' : 'Show less ▴';
      });
    })();

    (function enableFilter() {
      const input = document.getElementById('filter');
      const countEl = document.getElementById('filterCount');
      if (!input || !theBody) return;
      function apply() {
        const q = input.value.trim().toLowerCase();
        let shown = 0;
        for (const tr of rowEls) {
          const hit = !q || tr._search.includes(q);
          if (tr.classList.contains('hidden') === hit) tr.classList.toggle('hidden', !hit);
          if (hit) shown++;
        }
        countEl.textContent = q ? (shown + ' of ' + rowEls.length + ' shown') : '';
      }
      let deb;
      input.addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(apply, 150); });
    })();

    (function enableSort() {
      if (!theTable || !theBody) return;
      let sortCol = -1, sortDir = 1;
      theTable.querySelectorAll('th.sortable').forEach((th) => {
        th.addEventListener('click', () => {
          const i = +th.getAttribute('data-col');
          sortDir = sortCol === i ? -sortDir : 1; sortCol = i;
          const sorted = rowEls.slice().sort((a, b) => {
            const x = (cellText(a.children[i]) || '').trim(), y = (cellText(b.children[i]) || '').trim();
            const nx = parseFloat(x), ny = parseFloat(y);
            const bothNum = !isNaN(nx) && !isNaN(ny) && x !== '' && y !== '';
            return (bothNum ? nx - ny : x.localeCompare(y)) * sortDir;
          });
          const frag = document.createDocumentFragment();
          sorted.forEach((r) => frag.appendChild(r));
          theBody.appendChild(frag);
          theTable.querySelectorAll('th .arrow').forEach((a) => (a.textContent = ''));
          th.querySelector('.arrow').textContent = sortDir > 0 ? '▲' : '▼';
        });
      });
    })();

    if (canEdit) {
      saveBtn.addEventListener('click', () => {
        document.querySelectorAll('td.ecell.editing').forEach(commitEditor);
        // Group dirty cells by their save TARGET (sobject + recordId), since a
        // relationship cell targets a different object/record than the base row.
        const byTarget = new Map();
        dirtyCells.forEach((td) => {
          const sobject = td.getAttribute('data-sobject');
          const recordId = td.getAttribute('data-rid');
          if (!sobject || !recordId) return;
          const key = sobject + '|' + recordId;
          if (!byTarget.has(key)) byTarget.set(key, { sobject, recordId, fields: [] });
          byTarget.get(key).fields.push({ field: td.getAttribute('data-field'), value: cellValue(td) });
        });
        const edits = [...byTarget.values()];
        if (!edits.length) return;
        saveBtn.disabled = true; revertBtn.disabled = true;
        statusEl.textContent = 'Saving…';
        vscode.postMessage({ command: 'save', edits });
      });

      revertBtn.addEventListener('click', () => {
        document.querySelectorAll('td.ecell').forEach((td) => {
          td.classList.remove('editing');
          const ed = td.querySelector('.editor'); if (ed) ed.remove();
          paintCell(td, td.getAttribute('data-orig'));
        });
        refreshDirty();
      });
    }

    const errBanner = document.getElementById('errBanner');
    function showErrors(msgs) {
      if (!errBanner) return;
      if (!msgs || !msgs.length) { errBanner.style.display = 'none'; errBanner.innerHTML = ''; return; }
      errBanner.innerHTML = '<strong>Save failed</strong><ul>' +
        msgs.map((s) => '<li>' + String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])) + '</li>').join('') + '</ul>';
      errBanner.style.display = '';
    }

    window.addEventListener('message', (ev) => {
      const m = ev.data;
      if (m.command === 'saving') { statusEl.textContent = 'Saving…'; showErrors([]); return; }
      if (m.command === 'saveCancelled') { statusEl.textContent = 'Save cancelled.'; refreshDirty(); return; }
      if (m.command === 'saveError') { showErrors(['Error: ' + m.message]); statusEl.textContent = ''; return; }
      if (m.command === 'saved') {
        // Results are keyed by the TARGET record Id (which is the cell's data-rid
        // — the base row for a plain field, or the parent record for a rel cell).
        const byId = {};
        (m.results || []).forEach((r) => { byId[r.recordId] = r; });
        const errors = [];
        Array.from(dirtyCells).forEach((td) => {
          const r = byId[td.getAttribute('data-rid')];
          if (!r) return;
          if (r.success) {
            td.setAttribute('data-orig', cellValue(td));
            td.classList.remove('dirty'); td.classList.add('saved'); dirtyCells.delete(td);
          } else {
            td.classList.add('saveFail'); td.title = r.error || 'Update failed';
            if (r.error) errors.push(r.error);
          }
        });
        updateStatus();
        const ok = (m.results || []).filter((r) => r.success).length;
        const failed = (m.results || []).length - ok;
        statusEl.textContent = failed ? ('Saved ' + ok + ', ' + failed + ' failed') : (m.message || 'Save complete.');
        showErrors([...new Set(errors)]);
        return;
      }
    });
  </script>
</body></html>`;
  }
}

/** Column keys across records, excluding Salesforce's `attributes` metadata. */
function deriveColumns(records: Array<Record<string, any>>): string[] {
  const cols = new Set<string>();
  for (const rec of records) {
    for (const key of Object.keys(rec)) {
      if (key !== 'attributes') {
        cols.add(key);
      }
    }
  }
  return [...cols];
}

/**
 * The column names from a query's SELECT list, preserving dotted relationship
 * paths (`Account.RecordType.Name`) as single columns. Returns undefined when
 * the list can't be treated as a flat field list — `FIELDS(...)`, aggregates,
 * sub-queries `(SELECT …)` — so the caller falls back to record-key derivation.
 */
function selectColumns(query: string): string[] | undefined {
  const m = query.match(/^\s*select\s+(.+?)\s+from\b/is);
  if (!m) {
    return undefined;
  }
  const list = m[1];
  if (/\bfields\s*\(/i.test(list) || /\bcount\s*\(/i.test(list) || list.includes('(')) {
    return undefined; // FIELDS()/aggregates/sub-queries — not a plain field list
  }
  const cols = list.split(',').map((s) => s.trim()).filter(Boolean);
  // Every entry must look like a (dotted) field path; otherwise bail out.
  if (!cols.length || !cols.every((c) => /^[A-Za-z_][\w.]*$/.test(c))) {
    return undefined;
  }
  return cols;
}

/** Reads a value from a record by a dotted path, walking nested relationship objects. */
function getByPath(rec: Record<string, any>, path: string): any {
  if (!path.includes('.')) {
    return rec[path];
  }
  let cur: any = rec;
  for (const seg of path.split('.')) {
    if (cur === null || cur === undefined) {
      return undefined;
    }
    cur = cur[seg];
  }
  return cur;
}

/**
 * Renders a cell value as text. Relationship-path selects (`Account.Owner.Name`)
 * come back as NESTED objects (`{ Account: { Owner: { Name: "…" } } }`); walk
 * through the single non-`attributes` child to reach the leaf scalar instead of
 * showing the useless `{Account}` type marker. Arrays (child sub-queries) show a
 * count; a relationship object with no clear leaf falls back to its type.
 */
function flatten(value: any): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value !== 'object') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `${value.length} item(s)`;
  }
  // Walk a chain of single-child relationship objects to the leaf value.
  let cur: any = value;
  for (let depth = 0; depth < 10 && cur && typeof cur === 'object' && !Array.isArray(cur); depth++) {
    const keys = Object.keys(cur).filter((k) => k !== 'attributes');
    if (keys.length !== 1) {
      // Not a simple relationship chain — show the type, or the object.
      return cur.attributes?.type ? `{${cur.attributes.type}}` : JSON.stringify(cur);
    }
    cur = cur[keys[0]];
  }
  if (cur === null || cur === undefined) {
    return '';
  }
  return typeof cur === 'object' ? (cur.attributes?.type ? `{${cur.attributes.type}}` : JSON.stringify(cur)) : String(cur);
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as fs from 'fs';
import * as vscode from 'vscode';
import { saveApexLogs } from '../core/apexLogs';
import {
  evaluateFormula,
  evaluateFormulaMulti,
  fetchSampleRecords,
  FORMULA_RETURN_TYPES,
  FormulaReturnType,
  FormulaEvalResult,
  FormulaMultiResult
} from '../core/formulaEval';
import { SfExecutor, CancellationError } from '../core/sfExecutor';
import { OrgManager } from '../core/orgManager';
import { TraceManager } from '../core/traceManager';
import { Logger } from '../core/logger';
import { escapeHtml, FORGE_STYLES } from '../ui/webview';

/**
 * Interactive Formula Evaluation panel — a webview form (formula / object /
 * return type / optional record id) with an Evaluate button that runs the
 * headless `evaluateFormula` service and renders the result inline, keeping the
 * panel open so the user iterates (tweak formula → re-evaluate) instead of
 * re-answering command-palette prompts each time.
 *
 * Presentation + orchestration only: all evaluation logic lives in
 * `core/formulaEval.ts` (the same service the SDK/agent call). This panel just
 * arms the FINEST trace, calls the service, and shows the structured result.
 */

interface EvalMessage {
  command: 'evaluate' | 'evaluateAll' | 'cancel' | 'loadRecords';
  formula?: string;
  objectName?: string;
  returnType?: string;
  recordId?: string;
  /** For 'evaluateAll': the loaded record Ids to evaluate against. */
  recordIds?: string[];
  /** For 'loadRecords': a monotonic id so the webview can discard stale responses. */
  reqId?: number;
}

export interface FormulaPanelSeed {
  formula?: string;
  objectName?: string;
  returnType?: FormulaReturnType;
}

interface PanelDeps {
  sf: SfExecutor;
  orgs: OrgManager;
  trace: TraceManager;
  logger: Logger;
  root: string;
  objectNames: string[];
}

export class FormulaEvalPanel {
  private static current: FormulaEvalPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private running: vscode.CancellationTokenSource | undefined;

  /** Opens (or reveals) the singleton panel, optionally seeded from context. */
  static show(deps: PanelDeps, seed?: FormulaPanelSeed): void {
    if (FormulaEvalPanel.current) {
      FormulaEvalPanel.current.panel.reveal(vscode.ViewColumn.Active);
      if (seed) {
        FormulaEvalPanel.current.panel.webview.postMessage({ command: 'seed', ...seed });
      }
      return;
    }
    FormulaEvalPanel.current = new FormulaEvalPanel(deps, seed);
  }

  private constructor(private readonly deps: PanelDeps, seed?: FormulaPanelSeed) {
    this.panel = vscode.window.createWebviewPanel(
      'siidForgeFormulaEval',
      'SIID Forge: Evaluate Formula',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    this.panel.webview.html = this.html(seed);
    this.panel.webview.onDidReceiveMessage((m: EvalMessage) => this.onMessage(m));
    this.panel.onDidDispose(() => {
      this.running?.cancel();
      FormulaEvalPanel.current = undefined;
    });
  }

  private post(msg: Record<string, unknown>): void {
    void this.panel.webview.postMessage(msg);
  }

  private async onMessage(m: EvalMessage): Promise<void> {
    if (m.command === 'cancel') {
      this.running?.cancel();
      return;
    }
    if (m.command === 'loadRecords') {
      await this.loadRecords((m.objectName ?? '').trim(), m.reqId ?? 0);
      return;
    }
    if (m.command === 'evaluate') {
      await this.runSingle(m);
      return;
    }
    if (m.command === 'evaluateAll') {
      await this.runMulti(m);
      return;
    }
  }

  /** Validates inputs + confirms a default org; returns the org or posts an error and returns undefined. */
  private async precheck(m: EvalMessage, replyCommand: 'result' | 'multiResult'): Promise<{ formula: string; objectName: string; returnType: FormulaReturnType; org: string } | undefined> {
    const formula = (m.formula ?? '').trim();
    const objectName = (m.objectName ?? '').trim();
    const returnType = m.returnType as FormulaReturnType;
    const err = (error: string) => this.post({ command: replyCommand, result: { success: false, error, rows: [], referencedFields: [], executionTimeMs: 0 } });

    if (!formula || !objectName || !returnType) {
      err('Formula, object and return type are all required.');
      return undefined;
    }
    const org = await this.deps.orgs.getDefaultOrg();
    if (!org) {
      err('No default Salesforce org is set. Authorize or select one first.');
      return undefined;
    }
    return { formula, objectName, returnType, org };
  }

  /** Arms the FINEST trace (so debug output is captured), honoring cancellation. */
  private async armTrace(token: vscode.CancellationToken): Promise<void> {
    const { orgs, trace, logger, root } = this.deps;
    const username = await orgs.getUsername();
    if (username) {
      try { await trace.ensureTraceFlag(root, username); } catch (e: any) { logger.error(`trace: ${e.message}`); }
    }
    if (token.isCancellationRequested) {
      throw new CancellationError();
    }
  }

  /** Reads the FINEST log the run just produced. */
  private readRunLog = async (): Promise<string | undefined> => {
    const { sf, root, logger } = this.deps;
    const files = await saveApexLogs(sf, root, 'formula', new Date(), 1, logger);
    return files[0] ? fs.readFileSync(files[0], 'utf-8') : undefined;
  };

  private newRun(org: string): vscode.CancellationToken {
    this.running?.cancel();
    this.running = new vscode.CancellationTokenSource();
    this.post({ command: 'running', org });
    return this.running.token;
  }

  /** Single-record (or first-record) evaluation. */
  private async runSingle(m: EvalMessage): Promise<void> {
    const pre = await this.precheck(m, 'result');
    if (!pre) {
      return;
    }
    const recordId = (m.recordId ?? '').trim() || undefined;
    const token = this.newRun(pre.org);
    try {
      await this.armTrace(token);
      const result: FormulaEvalResult = await evaluateFormula(
        this.deps.sf, this.deps.root,
        { formula: pre.formula, objectName: pre.objectName, returnType: pre.returnType, recordId },
        async () => this.readRunLog(), token
      );
      this.post({ command: 'result', result });
    } catch (err: any) {
      const error = err instanceof CancellationError ? 'Evaluation cancelled.' : (err?.message ?? 'Evaluation failed.');
      if (!(err instanceof CancellationError)) {
        this.deps.logger.error(error);
      }
      this.post({ command: 'result', result: { success: false, error, referencedFields: [], executionTimeMs: 0 } });
    } finally {
      this.running = undefined;
    }
  }

  /** Multi-record evaluation over the loaded records (one Apex run). */
  private async runMulti(m: EvalMessage): Promise<void> {
    const pre = await this.precheck(m, 'multiResult');
    if (!pre) {
      return;
    }
    const recordIds = (m.recordIds ?? []).filter((id) => id);
    const token = this.newRun(pre.org);
    try {
      await this.armTrace(token);
      const result: FormulaMultiResult = await evaluateFormulaMulti(
        this.deps.sf, this.deps.root,
        { formula: pre.formula, objectName: pre.objectName, returnType: pre.returnType },
        recordIds, async () => this.readRunLog(), Math.max(recordIds.length, 5), token
      );
      this.post({ command: 'multiResult', result });
    } catch (err: any) {
      const error = err instanceof CancellationError ? 'Evaluation cancelled.' : (err?.message ?? 'Evaluation failed.');
      if (!(err instanceof CancellationError)) {
        this.deps.logger.error(error);
      }
      this.post({ command: 'multiResult', result: { success: false, error, rows: [], referencedFields: [], executionTimeMs: 0 } });
    } finally {
      this.running = undefined;
    }
  }

  /**
   * Fetches sample records for the object and sends them to the webview picker.
   * `reqId` + `objectName` are echoed back so the webview discards responses from
   * a superseded request (typing "Account" fires several loads; only the last
   * one's records must win — otherwise an earlier/empty reply overwrites them).
   */
  private async loadRecords(objectName: string, reqId: number): Promise<void> {
    if (!objectName) {
      this.post({ command: 'records', reqId, objectName, records: [], error: 'Enter an SObject first.' });
      return;
    }
    this.post({ command: 'recordsLoading', reqId, objectName });
    try {
      const records = await fetchSampleRecords(this.deps.sf, this.deps.root, objectName, 20);
      this.post({ command: 'records', reqId, objectName, records });
    } catch (err: any) {
      this.deps.logger.error(`formulaEval: loadRecords(${objectName}) failed: ${err?.message}`);
      // A real failure — say so, don't imply the object is empty.
      this.post({ command: 'records', reqId, objectName, records: [], error: err?.message ?? 'Could not load records.', failed: true });
    }
  }

  private html(seed?: FormulaPanelSeed): string {
    const options = FORMULA_RETURN_TYPES
      .map((t) => `<option value="${t}"${seed?.returnType === t ? ' selected' : ''}>${t}</option>`)
      .join('');
    const objectOptions = this.deps.objectNames.map((o) => `<option value="${escapeHtml(o)}"></option>`).join('');
    const seedFormula = escapeHtml(seed?.formula ?? '');
    const seedObject = escapeHtml(seed?.objectName ?? '');

    return /* html */ `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<style>${FORGE_STYLES}
  textarea#formula { width: 100%; min-height: 90px; resize: vertical; font-family: var(--vscode-editor-font-family, monospace); }
  .result { margin-top: 16px; }
  .value { font-family: var(--vscode-editor-font-family, monospace); font-size: 15px; word-break: break-all; }
  .spinner { color: var(--forge-muted); }
</style></head>
<body>
  <h1>Evaluate Formula</h1>
  <p class="muted">Runs the formula against the org via the standard <code>FormulaEval</code> Apex library. Use Salesforce formula syntax; Flow <code>{!…}</code>/<code>$Record.</code> are stripped automatically.</p>

  <div class="field section">
    <label for="formula">Formula</label>
    <textarea id="formula" placeholder="IF(AnnualRevenue >= 1000000, &quot;Enterprise&quot;, &quot;SMB&quot;)">${seedFormula}</textarea>
  </div>

  <div class="row">
    <div class="field grow">
      <label for="object">SObject</label>
      <input id="object" type="text" list="objects" placeholder="Account" value="${seedObject}" />
      <datalist id="objects">${objectOptions}</datalist>
    </div>
    <div class="field">
      <label for="returnType">Return type</label>
      <select id="returnType">${options}</select>
    </div>
    <div class="field grow">
      <label for="recordId">Record <span class="muted">(optional — first record if empty)</span></label>
      <div class="row" style="gap:6px; flex-wrap:nowrap">
        <select id="recordPick" class="grow" style="display:none"></select>
        <input id="recordId" class="grow" type="text" placeholder="paste an Id, or load records →" />
        <button id="loadRecs" class="secondary" title="Fetch a few records of this object">Load records</button>
      </div>
      <div id="recStatus" class="muted"></div>
    </div>
  </div>

  <div class="toolbar">
    <button id="run">Evaluate</button>
    <button id="runAll" class="secondary" style="display:none">Evaluate all</button>
    <button id="stop" class="secondary" style="display:none">Stop</button>
  </div>

  <div id="result" class="result"></div>

  <script>
    const vscode = acquireVsCodeApi();
    const $ = (id) => document.getElementById(id);
    const runBtn = $('run'), runAllBtn = $('runAll'), stopBtn = $('stop'), resultEl = $('result');
    const loadBtn = $('loadRecs'), recPick = $('recordPick'), recId = $('recordId'), recStatus = $('recStatus');
    let loadedIds = [];   // record Ids currently in the picker (for "Evaluate all")

    function common() {
      return { formula: $('formula').value, objectName: $('object').value, returnType: $('returnType').value };
    }
    function evaluate() {
      vscode.postMessage({ command: 'evaluate', ...common(), recordId: recId.value });
    }
    function evaluateAll() {
      vscode.postMessage({ command: 'evaluateAll', ...common(), recordIds: loadedIds });
    }
    runBtn.addEventListener('click', evaluate);
    runAllBtn.addEventListener('click', evaluateAll);
    stopBtn.addEventListener('click', () => vscode.postMessage({ command: 'cancel' }));

    let reqSeq = 0;             // increments per load; only the latest reply is applied
    function loadRecords(obj) {
      const name = (obj != null ? obj : $('object').value).trim();
      if (name) { vscode.postMessage({ command: 'loadRecords', objectName: name, reqId: ++reqSeq }); }
    }
    loadBtn.addEventListener('click', () => loadRecords());
    // Picking a record fills the Id box (kept visible so the user sees the raw Id).
    recPick.addEventListener('change', () => { recId.value = recPick.value; });

    // Auto-load records when the object field settles on a new value. Typing clears
    // the stale picker immediately; a debounce + change/blur triggers the fetch, so
    // we don't query on every keystroke (CLI calls are ~1s). The button stays as a
    // manual re-fetch.
    let lastLoaded = '';
    let debounce;
    function maybeAutoLoad() {
      const name = $('object').value.trim();
      if (name && name !== lastLoaded) { lastLoaded = name; loadRecords(name); }
    }
    $('object').addEventListener('input', () => {
      recPick.style.display = 'none'; recPick.innerHTML = ''; recStatus.textContent = '';
      loadedIds = []; runAllBtn.style.display = 'none';
      clearTimeout(debounce); debounce = setTimeout(maybeAutoLoad, 700);
    });
    // Committing the field (blur, Enter, or datalist pick) loads immediately.
    $('object').addEventListener('change', () => { clearTimeout(debounce); maybeAutoLoad(); });
    // Ctrl/Cmd+Enter evaluates from the textarea.
    $('formula').addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); evaluate(); }
    });

    function esc(s) { const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }

    window.addEventListener('message', (ev) => {
      const m = ev.data;
      if (m.command === 'seed') {
        if (m.formula != null) $('formula').value = m.formula;
        if (m.objectName != null) { $('object').value = m.objectName; maybeAutoLoad(); }
        if (m.returnType != null) $('returnType').value = m.returnType;
        return;
      }
      if (m.command === 'recordsLoading') {
        if ((m.reqId || 0) < reqSeq) return;   // stale
        loadBtn.disabled = true; recStatus.textContent = 'Loading records for ' + esc(m.objectName) + '…';
        return;
      }
      if (m.command === 'records') {
        // Discard a response from a superseded request (e.g. a mid-typing load that
        // resolved after the final one) so it can't overwrite the good records.
        if ((m.reqId || 0) < reqSeq) return;
        loadBtn.disabled = false;
        loadedIds = (m.records || []).map((r) => r.id);
        runAllBtn.style.display = loadedIds.length ? '' : 'none';
        if (m.error) {
          // A real failure reads differently from a genuinely empty object.
          recStatus.innerHTML = '<span class="err">' + esc(m.error) + '</span>';
          recPick.style.display = 'none';
          return;
        }
        if (!m.records.length) { recStatus.textContent = 'No records found for ' + esc(m.objectName) + '.'; recPick.style.display = 'none'; return; }
        recPick.innerHTML =
          m.records.map((r) => '<option value="' + esc(r.id) + '">' + esc(r.label) + '  (' + esc(r.id) + ')</option>').join('') +
          '<option value="">— first record —</option>';
        // Default to the FIRST record (one-click), and fill the Id box to match.
        recPick.selectedIndex = 0; recId.value = m.records[0].id;
        recPick.style.display = '';
        recStatus.textContent = m.records.length + ' record(s) — first selected · "Evaluate all" runs every one.';
        runAllBtn.textContent = 'Evaluate all ' + loadedIds.length;
        return;
      }
      if (m.command === 'running') {
        runBtn.disabled = true; runAllBtn.disabled = true; stopBtn.style.display = '';
        resultEl.innerHTML = '<div class="card spinner">Evaluating against <code>' + esc(m.org) + '</code>…</div>';
        return;
      }
      if (m.command === 'result') {
        runBtn.disabled = false; runAllBtn.disabled = false; stopBtn.style.display = 'none';
        const r = m.result;
        const fields = r.referencedFields && r.referencedFields.length
          ? '<div class="muted section">Referenced fields: ' + r.referencedFields.map(esc).join(', ') + '</div>' : '';
        const time = r.executionTimeMs ? '<span class="muted"> · ' + r.executionTimeMs + 'ms</span>' : '';
        let body;
        if (r.success && r.warning) {
          body = '<div class="card"><h3 class="warn">⚠ Not evaluated</h3><div>' + esc(r.warning) + '</div>' + fields + time + '</div>';
        } else if (r.success) {
          body = '<div class="card"><h3 class="ok">✓ Result</h3><div class="value">' + esc(JSON.stringify(r.value)) + '</div>' + fields + time + '</div>';
        } else {
          body = '<div class="card"><h3 class="err">✗ Failed</h3><div>' + esc(r.error) + '</div>' + time + '</div>';
        }
        resultEl.innerHTML = body;
        return;
      }
      if (m.command === 'multiResult') {
        runBtn.disabled = false; runAllBtn.disabled = false; stopBtn.style.display = 'none';
        const r = m.result;
        const time = r.executionTimeMs ? '<span class="muted"> · ' + r.executionTimeMs + 'ms</span>' : '';
        const fields = r.referencedFields && r.referencedFields.length
          ? '<div class="muted section">Referenced fields: ' + r.referencedFields.map(esc).join(', ') + '</div>' : '';
        if (!r.success) {
          resultEl.innerHTML = '<div class="card"><h3 class="err">✗ Failed</h3><div>' + esc(r.error) + '</div>' + time + '</div>';
          return;
        }
        if (r.warning && (!r.rows || !r.rows.length)) {
          resultEl.innerHTML = '<div class="card"><h3 class="warn">⚠ Not evaluated</h3><div>' + esc(r.warning) + '</div>' + fields + time + '</div>';
          return;
        }
        // Label rows by the loaded record labels when we have them.
        const labelById = {};
        (recPick.options ? Array.from(recPick.options) : []).forEach((o) => { if (o.value) labelById[o.value] = o.textContent; });
        const rows = (r.rows || []).map((row) => {
          const who = row.recordId ? esc(labelById[row.recordId] || row.recordId) : '<span class="muted">(no record)</span>';
          const val = row.error
            ? '<span class="err">ERR: ' + esc(row.error) + '</span>'
            : '<span class="value">' + esc(JSON.stringify(row.value)) + '</span>';
          return '<tr><td>' + who + '</td><td>' + val + '</td></tr>';
        }).join('');
        const cap = r.truncated ? '<div class="warn section">⚠ Capped at ' + (r.rows ? r.rows.length : 0) + ' records (large-org safety limit).</div>' : '';
        resultEl.innerHTML = '<div class="card"><h3 class="ok">✓ ' + (r.rows ? r.rows.length : 0) + ' record(s)</h3>' + cap +
          '<table><thead><tr><th>Record</th><th>Result</th></tr></thead><tbody>' + rows + '</tbody></table>' + fields + time + '</div>';
        return;
      }
    });

    $('formula').focus();
    // A pre-seeded object (e.g. launched from a Flow) auto-loads its records on open.
    maybeAutoLoad();
  </script>
</body></html>`;
  }
}

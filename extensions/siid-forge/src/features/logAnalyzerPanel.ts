/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { analyzeLog, analysisToMarkdown, fmtBytes, AnalyzeOptions, LogAnalysis, MethodNode } from '../core/replay/logAnalyzer';
import { SchemaManager } from '../core/schemaManager';
import { Logger } from '../core/logger';
import { escapeHtml, FORGE_STYLES } from '../ui/webview';

/**
 * Visual Apex Log Analyzer — a webview over the headless `analyzeLog` service.
 * Shows governor-limit usage, per-method timings (hot spots + a collapsible call
 * tree), a timeline/waterfall, SOQL/DML + callouts, heap-over-time, debug output,
 * and errors with stack traces — plus insights (loop/recursion/limit warnings),
 * export (md/json), open-in-raw-log, and side-by-side compare with another log.
 * Presentation only — all extraction lives in `core/replay/logAnalyzer.ts`.
 */

interface InMessage {
  command: 'openLine' | 'openRaw' | 'export' | 'compare';
  className?: string;
  line?: number;
  /** For 'export': the format. */
  format?: 'md' | 'json';
}

interface PanelDeps {
  schema: SchemaManager;
  logger: Logger;
  root: string;
  /** Lets the panel offer "compare with…" by listing/choosing another log. */
  pickCompareLog: () => Promise<string | undefined>;
}

export class LogAnalyzerPanel {
  private static current: LogAnalyzerPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private logFile = '';
  private analysis: LogAnalysis | undefined;

  /** Opens (or reveals) the singleton panel for a given log file. */
  static show(deps: PanelDeps, logFile: string): void {
    const raw = fs.readFileSync(logFile, 'utf-8');
    const analysis = analyzeLog(raw, readAnalyzeOptions());
    if (LogAnalyzerPanel.current) {
      LogAnalyzerPanel.current.panel.reveal(vscode.ViewColumn.Active);
      LogAnalyzerPanel.current.panel.title = `SIID Forge: Log — ${path.basename(logFile)}`;
      LogAnalyzerPanel.current.render(analysis, logFile);
      return;
    }
    LogAnalyzerPanel.current = new LogAnalyzerPanel(deps, analysis, logFile);
  }

  private constructor(private readonly deps: PanelDeps, analysis: LogAnalysis, logFile: string) {
    this.panel = vscode.window.createWebviewPanel(
      'siidForgeLogAnalyzer',
      `SIID Forge: Log — ${path.basename(logFile)}`,
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    this.panel.webview.onDidReceiveMessage((m: InMessage) => this.onMessage(m));
    this.panel.onDidDispose(() => { LogAnalyzerPanel.current = undefined; });
    this.render(analysis, logFile);
  }

  private render(analysis: LogAnalysis, logFile: string): void {
    this.logFile = logFile;
    this.analysis = analysis;
    this.panel.webview.html = this.html(analysis, logFile);
  }

  private async onMessage(m: InMessage): Promise<void> {
    if (m.command === 'openRaw') {
      await this.openRawLog(m.line);
      return;
    }
    if (m.command === 'export') {
      await this.exportReport(m.format ?? 'md');
      return;
    }
    if (m.command === 'compare') {
      await this.compareWith();
      return;
    }
    if (m.command === 'openLine' && m.className) {
      const info = this.deps.schema.readApex(this.deps.root, m.className);
      if (!info?.filePath) {
        vscode.window.showWarningMessage(`SIID Forge: no source found for ${m.className}.`);
        return;
      }
      try {
        const doc = await vscode.workspace.openTextDocument(info.filePath);
        const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
        const ln = Math.max(0, (m.line ?? 1) - 1);
        const pos = new vscode.Position(ln, 0);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
      } catch (err: any) {
        this.deps.logger.error(`openLine ${m.className}:${m.line}: ${err?.message}`);
      }
    }
  }

  /** Opens the raw .log file in an editor, optionally jumping to a line. */
  private async openRawLog(line?: number): Promise<void> {
    try {
      const doc = await vscode.workspace.openTextDocument(this.logFile);
      const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
      if (line != null) {
        const ln = Math.max(0, line - 1);
        const pos = new vscode.Position(ln, 0);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
      }
    } catch (err: any) {
      this.deps.logger.error(`openRaw: ${err?.message}`);
    }
  }

  /** Exports the current analysis as Markdown or JSON, next to the log file. */
  private async exportReport(format: 'md' | 'json'): Promise<void> {
    if (!this.analysis) {
      return;
    }
    const base = this.logFile.replace(/\.log$/i, '');
    const content = format === 'json'
      ? JSON.stringify(this.analysis, null, 2)
      : analysisToMarkdown(this.analysis, path.basename(this.logFile));
    const target = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`${base}.analysis.${format}`),
      filters: format === 'json' ? { JSON: ['json'] } : { Markdown: ['md'] }
    });
    if (!target) {
      return;
    }
    try {
      fs.writeFileSync(target.fsPath, content, 'utf-8');
      const open = await vscode.window.showInformationMessage(`Report saved: ${path.basename(target.fsPath)}`, 'Open');
      if (open === 'Open') {
        void vscode.window.showTextDocument(await vscode.workspace.openTextDocument(target));
      }
    } catch (err: any) {
      this.deps.logger.error(`export: ${err?.message}`);
      vscode.window.showErrorMessage(`Could not save report: ${err?.message}`);
    }
  }

  /** Prompts for a second log and re-renders in side-by-side compare mode. */
  private async compareWith(): Promise<void> {
    const other = await this.deps.pickCompareLog();
    if (!other || !this.analysis) {
      return;
    }
    try {
      const otherAnalysis = analyzeLog(fs.readFileSync(other, 'utf-8'), readAnalyzeOptions());
      this.panel.webview.html = this.compareHtml(
        { file: this.logFile, a: this.analysis },
        { file: other, a: otherAnalysis }
      );
    } catch (err: any) {
      this.deps.logger.error(`compare: ${err?.message}`);
      vscode.window.showErrorMessage(`Could not compare: ${err?.message}`);
    }
  }

  private html(a: LogAnalysis, logFile: string): string {
    const ms = (n: number) => (n >= 0 ? n.toFixed(n < 10 ? 2 : 1) : '');
    const warnLevel = !a.isFinest
      ? `<div class="banner warn">Log level is APEX_CODE=${escapeHtml(a.apexCodeLevel ?? 'unknown')}, not FINEST — timings and details are approximate.</div>`
      : '';
    const truncBanner = a.truncated
      ? `<div class="banner err">⚠ This log was cut off at MAXIMUM DEBUG LOG SIZE — the analysis is INCOMPLETE. A governor exception (e.g. CPU-time limit) may have ended the run without appearing in the log. Counts, timings, and limits below are partial.</div>`
      : '';

    // --- Governor limits (bars; flag ≥75% / ≥90%) --------------------------
    const limitRows = a.limits.length
      ? a.limits.map((l) => {
          const pct = Math.min(100, l.percent);
          const sev = l.percent >= 90 ? 'err' : l.percent >= 75 ? 'warn' : 'ok';
          return `<tr>
            <td>${escapeHtml(l.name)}</td>
            <td class="num">${l.used} / ${l.limit}</td>
            <td class="barcell"><div class="bar"><div class="bar-fill ${sev}" style="width:${pct}%"></div></div></td>
            <td class="num ${sev}">${l.percent.toFixed(l.percent < 10 ? 1 : 0)}%</td>
          </tr>`;
        }).join('')
      : `<tr><td colspan="4" class="muted">No CUMULATIVE_LIMIT_USAGE block in this log.</td></tr>`;

    // --- Hot methods (self-time desc) --------------------------------------
    // Aggregated across call sites, so there's no single line — link to the
    // method's own class (opens the file; the user scans to the method).
    const hotRows = a.hotMethods.slice(0, 40).map((mth) => {
      const src = mth.className ? this.lineLink(mth.className, 1, mth.name) : escapeHtml(mth.name);
      return `<tr>
        <td>${src}</td>
        <td class="num">${ms(mth.selfMs)}</td>
        <td class="num muted">${ms(mth.totalMs)}</td>
        <td class="num">${mth.count}</td>
      </tr>`;
    }).join('') || `<tr><td colspan="4" class="muted">No user methods recorded.</td></tr>`;

    // --- SOQL / DML (searchable, paginated) --------------------------------
    const opRows = a.dataOps.map((op) => {
      const cls = op.kind === 'DML' ? 'kind-dml' : 'kind-soql';
      // Line jumps to CODE via the class link; the ⤓ jumps to the raw log line.
      const line = op.line != null
        ? `${this.lineLink(op.className, op.line, String(op.line))}${op.logLine != null ? ' ' + this.rawJump(op.logLine) : ''}`
        : '';
      const search = escapeHtml((op.kind + ' ' + op.detail).toLowerCase());
      return `<tr class="op-row" data-search="${search}">
        <td><span class="tag ${cls}">${op.kind}</span></td>
        <td class="num">${line}</td>
        <td class="num">${op.ms != null ? ms(op.ms) : ''}</td>
        <td class="num">${op.rows != null ? op.rows : ''}</td>
        <td><code>${escapeHtml(truncate(op.detail, 200))}</code></td>
      </tr>`;
    }).join('') || `<tr><td colspan="5" class="muted">No SOQL/SOSL/DML in this log.</td></tr>`;

    // --- Errors ------------------------------------------------------------
    const errBlocks = a.errors.map((e) => `
      <div class="card err-card">
        <h3><span class="tag kind-err">${e.kind}</span> ${escapeHtml(e.message)}</h3>
        ${e.stack.length ? `<pre class="stack">${e.stack.map(escapeHtml).join('\n')}</pre>` : ''}
      </div>`).join('');

    // --- Insights (loop/recursion/limit warnings) --------------------------
    const insightBlocks = a.insights.length
      ? `<div class="section"><h2>Insights</h2>${a.insights.map((i) => `
          <div class="insight ${i.severity}">
            <span class="tag ${i.severity === 'error' ? 'kind-err' : 'kind-warn'}">${i.severity === 'error' ? 'HIGH' : 'WARN'}</span>
            <span>${escapeHtml(i.message)}${i.detail ? ` <code class="muted">${escapeHtml(truncate(i.detail, 90))}</code>` : ''}</span>
          </div>`).join('')}</div>`
      : '';

    // --- Callouts ----------------------------------------------------------
    const calloutSection = a.callouts.length
      ? `<div class="section"><h2>Callouts</h2>
          <table><thead><tr><th class="num">Line</th><th class="num">ms</th><th>Request</th><th>Response / Status</th></tr></thead><tbody>
          ${a.callouts.map((c) => `<tr>
            <td class="num">${c.line != null ? this.lineLink(c.className, c.line, String(c.line)) : ''}</td>
            <td class="num">${c.ms != null ? ms(c.ms) : ''}</td>
            <td><code>${escapeHtml(truncate(c.request, 160))}</code></td>
            <td><code>${escapeHtml(truncate(c.response ?? '', 100))}</code></td>
          </tr>`).join('')}</tbody></table></div>`
      : '';

    // --- Flows -------------------------------------------------------------
    // Flows report DB work as aggregates (no per-op events), so group identical
    // interviews and show their totals — otherwise this SOQL/DML is invisible.
    const flowGroups = new Map<string, { count: number; soql: number; dml: number; cpuMs: number; elements: string[] }>();
    for (const f of a.flows) {
      const g = flowGroups.get(f.name) ?? { count: 0, soql: 0, dml: 0, cpuMs: 0, elements: [] };
      g.count++;
      g.soql = Math.max(g.soql, f.soql ?? 0);
      g.dml = Math.max(g.dml, f.dml ?? 0);
      g.cpuMs = Math.max(g.cpuMs, f.cpuMs ?? 0);
      for (const el of f.elements) { if (!g.elements.includes(el.name)) { g.elements.push(el.name); } }
      flowGroups.set(f.name, g);
    }
    // Per-element timing (real flow execution analysis), slowest first.
    const flowElemRows = a.flowElements.map((e) => `<tr>
      <td>${escapeHtml(e.name)}</td>
      <td class="muted">${escapeHtml(e.type.replace(/^Flow/, ''))}${e.isQuery ? ' <span class="tag kind-soql">SOQL</span>' : ''}${e.isDml ? ' <span class="tag kind-dml">DML</span>' : ''}</td>
      <td class="num">${ms(e.totalMs)}</td>
      <td class="num muted">${e.cpuMs || ''}</td>
      <td class="num">${e.count}</td>
    </tr>`).join('');
    const flowSection = flowGroups.size
      ? `<div class="section"><h2>Flows <span class="muted">(DB work is flow-reported, not in the SOQL/DML table)</span></h2>
          <table><thead><tr><th>Flow</th><th class="num">Runs</th><th class="num">SOQL</th><th class="num">DML</th><th class="num">CPU ms</th><th>Elements</th></tr></thead><tbody>
          ${[...flowGroups].map(([name, g]) => `<tr>
            <td>${escapeHtml(name)}</td>
            <td class="num">${g.count}</td>
            <td class="num">${g.soql || ''}</td>
            <td class="num">${g.dml || ''}</td>
            <td class="num">${g.cpuMs || ''}</td>
            <td><code>${escapeHtml(g.elements.join(', '))}</code></td>
          </tr>`).join('')}</tbody></table>
          ${flowElemRows ? `<h3 style="margin:12px 0 6px;color:var(--forge-purple)">Flow elements <span class="muted">(by wall time)</span></h3>
          <table><thead><tr><th>Element</th><th>Type</th><th class="num">Wall ms</th><th class="num">CPU ms</th><th class="num">Runs</th></tr></thead>
          <tbody>${flowElemRows}</tbody></table>` : ''}
          </div>`
      : '';

    // --- Debug (level filter + text search) --------------------------------
    const levels = [...new Set(a.debug.map((d) => d.level).filter(Boolean))] as string[];
    const debugRows = a.debug.slice(0, 2000).map((d) => `
      <tr data-level="${escapeHtml(d.level ?? '')}" data-search="${escapeHtml(d.message.toLowerCase())}">
        <td class="num muted">${d.line != null ? this.lineLink(d.className, d.line, String(d.line)) : ''}${d.logLine != null ? ' ' + this.rawJump(d.logLine) : ''}</td>
        <td class="muted">${escapeHtml(d.level ?? '')}</td>
        <td><code>${escapeHtml(d.message)}</code></td>
      </tr>`).join('') || `<tr><td colspan="3" class="muted">No USER_DEBUG output.</td></tr>`;
    const debugToolbar = a.debug.length
      ? `<div class="toolbar">
          ${levels.length ? `<label style="text-transform:none">Level:</label>
          <select id="levelFilter"><option value="">All</option>${levels.map((l) => `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join('')}</select>` : ''}
          <input type="text" id="debugSearch" placeholder="Search message text…" style="min-width:240px">
        </div>`
      : '';

    // --- Call tree (collapsible + folded ×N) -------------------------------
    const tree = a.tree.map((n) => this.treeNode(n, 0)).join('');

    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      ${FORGE_STYLES}
      .banner { padding: 8px 12px; border-radius: 6px; margin: 0 0 12px; }
      .banner.warn { background: #3a3413; color: var(--forge-warn); border: 1px solid var(--forge-warn); }
      .banner.err { background: rgba(244,135,113,0.12); color: var(--forge-err); border: 1px solid var(--forge-err); }
      .summary { display: flex; gap: 18px; flex-wrap: wrap; margin-bottom: 8px; }
      .stat { display: flex; flex-direction: column; }
      .stat .v { font-size: 18px; font-weight: 600; color: var(--forge-purple-bright); }
      .stat .l { font-size: 11px; color: var(--forge-muted); text-transform: uppercase; letter-spacing: .03em; }
      .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
      .bar { background: var(--forge-input-bg); border-radius: 4px; height: 10px; overflow: hidden; min-width: 120px; }
      .bar-fill { height: 100%; }
      .bar-fill.ok { background: var(--forge-ok); }
      .bar-fill.warn { background: var(--forge-warn); }
      .bar-fill.err { background: var(--forge-err); }
      .barcell { width: 40%; }
      .tag { display: inline-block; font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 4px; }
      .kind-soql { background: #10324a; color: #6cc0ff; }
      .kind-dml { background: #3a2a10; color: #ffb454; }
      .kind-err { background: #3d1717; color: var(--forge-err); }
      .kind-warn { background: #3a3413; color: var(--forge-warn); }
      .stack { background: var(--forge-input-bg); padding: 8px 10px; border-radius: 6px; overflow-x: auto; font-size: 12px; }
      .err-card { border-color: var(--forge-err); }
      /* Insights */
      .insight { display: flex; gap: 10px; align-items: center; padding: 7px 12px; border-radius: 6px; margin: 6px 0; border: 1px solid transparent; }
      .insight.warn { background: rgba(204,167,0,0.10); border-color: var(--forge-warn); }
      .insight.error { background: rgba(244,135,113,0.10); border-color: var(--forge-err); }
      /* Call tree */
      .treeline { font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; padding: 1px 0; white-space: nowrap; }
      .treeline .nm { color: var(--forge-fg); }
      .treeline .t { color: var(--forge-muted); }
      .repeat { background: var(--forge-orange); color: #fff; font-size: 10px; font-weight: 600; padding: 0 6px; border-radius: 8px; margin: 0 6px; }
      details.treenode { }
      details.treenode > summary { cursor: pointer; list-style-position: outside; }
      .treekids { margin-left: 14px; border-left: 1px solid var(--forge-border); padding-left: 6px; }
      .treeline.leaf { margin-left: 14px; }
      .tree-wrap { max-height: 420px; overflow: auto; border: 1px solid var(--forge-border); border-radius: 6px; padding: 8px 10px; background: var(--forge-card); }
      .clickable { color: var(--forge-link); cursor: pointer; }
      .clickable:hover { text-decoration: underline; }
      .rawjump { color: var(--forge-muted); cursor: pointer; margin-left: 4px; font-size: 12px; }
      .rawjump:hover { color: var(--forge-orange); }
      /* Severity summary bar */
      .sevbar { margin: 4px 0 12px; display: flex; gap: 8px; align-items: center; }
      .sevbar.ok { color: var(--forge-ok); }
      .sev { font-size: 12px; font-weight: 600; padding: 2px 10px; border-radius: 10px; }
      .sev.high { background: #3d1717; color: var(--forge-err); }
      .sev.warn { background: #3a3413; color: var(--forge-warn); }
      /* Charts (inline SVG) */
      .chart-wrap { border: 1px solid var(--forge-border); border-radius: 6px; padding: 6px; background: var(--forge-card); overflow-x: auto; }
      svg.timeline, svg.heapchart { width: 100%; height: auto; display: block; }
      .tl-bar { fill: var(--forge-purple-bright); opacity: .55; }
      .tl-bar.clickable { cursor: pointer; }
      .tl-bar.clickable:hover { opacity: .9; }
      .tl-label { fill: var(--forge-fg); font-size: 10px; font-family: var(--vscode-editor-font-family, monospace); pointer-events: none; }
      .heap-area { fill: rgba(168,82,255,0.18); }
      .heap-line { fill: none; stroke: var(--forge-purple-bright); stroke-width: 1.5; }
      /* Compare */
      .cmp { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
      .cmp .delta.up { color: var(--forge-err); }
      .cmp .delta.down { color: var(--forge-ok); }
    </style></head><body>
      <div class="row" style="justify-content:space-between;align-items:flex-start">
        <div>
          <h1>Apex Log Analysis</h1>
          <div class="muted" style="margin-bottom:10px">${escapeHtml(path.basename(logFile))}</div>
        </div>
        <div class="row">
          <button class="secondary" id="openRaw">Open raw log</button>
          <button class="secondary" id="compare">Compare…</button>
          <button class="secondary" id="exportMd">Export .md</button>
          <button class="secondary" id="exportJson">Export .json</button>
        </div>
      </div>
      ${truncBanner}
      ${warnLevel}

      ${this.severityBadge(a)}

      <div class="summary card">
        <div class="stat"><span class="v">${ms(a.durationMs)} ms</span><span class="l">Wall time</span></div>
        <div class="stat"><span class="v">${a.cpuMs != null ? a.cpuMs + ' ms' : '—'}</span><span class="l">CPU time (limit 10k)</span></div>
        <div class="stat"><span class="v">${a.counts.soql}</span><span class="l">SOQL</span></div>
        <div class="stat"><span class="v">${a.counts.dml}</span><span class="l">DML</span></div>
        <div class="stat"><span class="v">${a.counts.dbRows}</span><span class="l">DB rows</span></div>
        <div class="stat"><span class="v">${a.counts.methods}</span><span class="l">Methods</span></div>
        <div class="stat"><span class="v">${a.counts.callouts}</span><span class="l">Callouts</span></div>
        ${a.flows.length ? `<div class="stat"><span class="v">${a.flows.length}</span><span class="l">Flow runs</span></div>` : ''}
        <div class="stat"><span class="v">${fmtBytes(a.peakHeapBytes)}</span><span class="l">Peak heap</span></div>
        <div class="stat"><span class="v">${a.errors.length}</span><span class="l">Errors</span></div>
      </div>
      ${a.entryPoint ? `<div class="muted">Entry point: <code>${escapeHtml(a.entryPoint)}</code></div>` : ''}
      ${a.cpuMs != null && a.durationMs > 0 ? `<div class="muted">CPU ${a.cpuMs}ms of ${ms(a.durationMs)}ms wall — the 10s governor limit is on CPU time, not wall time (which includes DB/callout waits).</div>` : ''}

      ${insightBlocks}

      ${this.timelineSvg(a)}

      ${errBlocks ? `<div class="section"><h2>Errors</h2>${errBlocks}</div>` : ''}

      <div class="section">
        <h2>Governor limits</h2>
        <table><thead><tr><th>Limit</th><th class="num">Used</th><th>Usage</th><th class="num">%</th></tr></thead>
        <tbody>${limitRows}</tbody></table>
      </div>

      <div class="section">
        <h2>Hot methods <span class="muted">(by self time)</span></h2>
        <table><thead><tr><th>Method</th><th class="num">Self ms</th><th class="num">Total ms</th><th class="num">Calls</th></tr></thead>
        <tbody>${hotRows}</tbody></table>
      </div>

      <div class="section">
        <div class="row" style="justify-content:space-between">
          <h2 style="margin:0">SOQL &amp; DML <span class="muted">(${a.dataOps.length})</span></h2>
          <input type="text" id="opSearch" placeholder="Search query / DML text…" style="min-width:260px">
        </div>
        <table><thead><tr><th>Type</th><th class="num">Line</th><th class="num">ms</th><th class="num">Rows</th><th>Detail</th></tr></thead>
        <tbody id="opBody">${opRows}</tbody></table>
        ${a.dataOps.length > 50 ? `<div class="row" style="margin-top:6px"><button class="secondary" id="opMore">Show all ${a.dataOps.length}</button><span class="muted" id="opCount"></span></div>` : ''}
      </div>

      ${calloutSection}

      ${flowSection}

      ${this.heapSvg(a)}

      <div class="section">
        <div class="row" style="justify-content:space-between">
          <h2 style="margin:0">Call tree</h2>
          <div class="row"><button class="secondary" id="expandAll">Expand all</button><button class="secondary" id="collapseAll">Collapse all</button></div>
        </div>
        <div class="tree-wrap" id="tree">${tree || '<span class="muted">No frames recorded.</span>'}</div>
      </div>

      <div class="section">
        <h2>Debug output <span class="muted">(${a.debug.length})</span></h2>
        ${debugToolbar}
        <table><thead><tr><th class="num">Line</th><th>Level</th><th>Message</th></tr></thead>
        <tbody id="debugBody">${debugRows}</tbody></table>
      </div>

      <script>
        const vscode = acquireVsCodeApi();
        document.addEventListener('click', (e) => {
          // A source ref anywhere (tree, tables, timeline bars).
          const el = e.target.closest('.clickable');
          if (el) {
            e.stopPropagation();
            vscode.postMessage({ command: 'openLine', className: el.getAttribute('data-cls') || undefined, line: +el.getAttribute('data-line') || undefined });
            return;
          }
          // A raw-log jump (timeline/table → open .log at line).
          const raw = e.target.closest('.rawjump');
          if (raw) {
            e.stopPropagation();
            vscode.postMessage({ command: 'openRaw', line: +raw.getAttribute('data-rawline') || undefined });
          }
        });
        const btn = (id, msg) => { const b = document.getElementById(id); if (b) b.addEventListener('click', () => vscode.postMessage(msg)); };
        btn('openRaw', { command: 'openRaw' });
        btn('compare', { command: 'compare' });
        btn('exportMd', { command: 'export', format: 'md' });
        btn('exportJson', { command: 'export', format: 'json' });
        // Call-tree expand / collapse all.
        const tree = document.getElementById('tree');
        const setAll = (open) => tree && tree.querySelectorAll('details').forEach((d) => (d.open = open));
        const ea = document.getElementById('expandAll'); if (ea) ea.addEventListener('click', () => setAll(true));
        const ca = document.getElementById('collapseAll'); if (ca) ca.addEventListener('click', () => setAll(false));
        // Debug: combined level filter + text search.
        const lf = document.getElementById('levelFilter');
        const ds = document.getElementById('debugSearch');
        const applyDebug = () => {
          const lv = lf ? lf.value : '';
          const q = ds ? ds.value.trim().toLowerCase() : '';
          document.querySelectorAll('#debugBody tr').forEach((tr) => {
            const okLevel = !lv || tr.getAttribute('data-level') === lv;
            const okText = !q || (tr.getAttribute('data-search') || '').includes(q);
            tr.style.display = (okLevel && okText) ? '' : 'none';
          });
        };
        if (lf) lf.addEventListener('change', applyDebug);
        if (ds) ds.addEventListener('input', debounce(applyDebug, 120));

        // SOQL/DML text search.
        const os = document.getElementById('opSearch');
        const opRows = () => document.querySelectorAll('#opBody tr.op-row');
        let opLimit = 50; // pagination: show first 50, "Show all" reveals the rest
        const applyOps = () => {
          const q = os ? os.value.trim().toLowerCase() : '';
          let shown = 0;
          opRows().forEach((tr, i) => {
            const okText = !q || (tr.getAttribute('data-search') || '').includes(q);
            const okPage = q ? true : i < opLimit; // search ignores pagination
            const vis = okText && okPage;
            tr.style.display = vis ? '' : 'none';
            if (okText) shown++;
          });
          const cnt = document.getElementById('opCount');
          if (cnt) cnt.textContent = q ? (shown + ' match(es)') : '';
        };
        if (os) os.addEventListener('input', debounce(applyOps, 120));
        const opMore = document.getElementById('opMore');
        if (opMore) opMore.addEventListener('click', () => { opLimit = 1e9; opMore.style.display = 'none'; applyOps(); });
        applyOps();

        function debounce(fn, ms) { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; }
      </script>
    </body></html>`;
  }

  /** A one-line severity summary ("3 HIGH · 1 WARN") from the insights. */
  private severityBadge(a: LogAnalysis): string {
    const high = a.insights.filter((i) => i.severity === 'error').length;
    const warn = a.insights.filter((i) => i.severity === 'warn').length;
    if (!high && !warn && !a.errors.length) {
      return `<div class="sevbar ok">No issues detected.</div>`;
    }
    const parts: string[] = [];
    if (high) { parts.push(`<span class="sev high">${high} HIGH</span>`); }
    if (warn) { parts.push(`<span class="sev warn">${warn} WARN</span>`); }
    if (a.errors.length) { parts.push(`<span class="sev high">${a.errors.length} error${a.errors.length > 1 ? 's' : ''}</span>`); }
    return `<div class="sevbar">${parts.join(' ')}</div>`;
  }

  /**
   * A timeline/waterfall: horizontal time-bars for the top-level frames plus
   * SOQL/DML/callout markers, drawn as inline SVG (self-contained, no CDN).
   * X is wall-clock time; each root method is a bar; data ops are tick marks.
   */
  private timelineSvg(a: LogAnalysis): string {
    const total = a.durationMs || 1;
    const W = 900, rowH = 18, pad = 4;
    const rows = a.tree.slice(0, 30);
    if (!rows.length) {
      return '';
    }
    const H = rows.length * rowH + 30;
    const x = (t: number) => (t / total) * W;
    // Root frames are sequential; approximate each start by cumulative totalMs.
    let cursor = 0;
    const bars = rows.map((n, i) => {
      const start = cursor;
      cursor += n.totalMs;
      const w = Math.max(1, x(n.totalMs));
      const y = i * rowH + pad;
      const label = escapeHtml(truncate(n.name, 40));
      const cls = n.className ? ` clickable" data-cls="${escapeHtml(n.className)}" data-line="${n.line ?? 1}` : '';
      return `<g><rect x="${x(start).toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="${rowH - 4}" rx="2" class="tl-bar${cls}"></rect>`
        + `<text x="${(x(start) + 3).toFixed(1)}" y="${y + rowH - 8}" class="tl-label">${label} · ${n.totalMs.toFixed(1)}ms</text></g>`;
    }).join('');
    return `<div class="section"><h2>Timeline <span class="muted">(top-level frames)</span></h2>
      <div class="chart-wrap"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="timeline">${bars}</svg></div></div>`;
  }

  /** A cumulative-heap-over-time area chart as inline SVG. */
  private heapSvg(a: LogAnalysis): string {
    if (a.heap.length < 2) {
      return '';
    }
    const W = 900, H = 120, pad = 4;
    const maxMs = a.heap[a.heap.length - 1].atMs || 1;
    const maxB = a.peakHeapBytes || 1;
    const pts = a.heap.map((s) => `${((s.atMs / maxMs) * W).toFixed(1)},${(H - pad - (s.bytes / maxB) * (H - 2 * pad)).toFixed(1)}`);
    const area = `0,${H} ${pts.join(' ')} ${W},${H}`;
    return `<div class="section"><h2>Heap over time <span class="muted">(peak ${fmtBytes(a.peakHeapBytes)})</span></h2>
      <div class="chart-wrap"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="heapchart">
        <polygon points="${area}" class="heap-area"></polygon>
        <polyline points="${pts.join(' ')}" class="heap-line"></polyline>
      </svg></div></div>`;
  }

  /**
   * Side-by-side comparison of two logs: key metrics with deltas, and each log's
   * governor limits + hot methods. Read-only (no jump-to-source), so it's a
   * self-contained snapshot for spotting a regression between two runs.
   */
  private compareHtml(left: { file: string; a: LogAnalysis }, right: { file: string; a: LogAnalysis }): string {
    const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
    const metric = (label: string, l: number, r: number, unit = '') => {
      const d = r - l;
      const dir = d > 0 ? 'up' : d < 0 ? 'down' : '';
      const sign = d > 0 ? '+' : '';
      return `<tr><td>${label}</td><td class="num">${num(l)}${unit}</td><td class="num">${num(r)}${unit}</td>
        <td class="num delta ${dir}">${d === 0 ? '—' : sign + num(d) + unit}</td></tr>`;
    };
    const side = (s: { file: string; a: LogAnalysis }) => `
      <div>
        <h3>${escapeHtml(path.basename(s.file))}</h3>
        <table><thead><tr><th>Limit</th><th class="num">Used/Cap</th></tr></thead><tbody>
          ${s.a.limits.filter((l) => l.used > 0).map((l) => `<tr><td>${escapeHtml(l.name)}</td><td class="num">${l.used}/${l.limit}</td></tr>`).join('') || '<tr><td colspan="2" class="muted">no usage</td></tr>'}
        </tbody></table>
        <h3 style="margin-top:12px">Top methods</h3>
        <table><thead><tr><th>Method</th><th class="num">Self ms</th></tr></thead><tbody>
          ${s.a.hotMethods.slice(0, 8).map((m) => `<tr><td>${escapeHtml(truncate(m.name, 40))}</td><td class="num">${m.selfMs.toFixed(1)}</td></tr>`).join('')}
        </tbody></table>
      </div>`;
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${FORGE_STYLES}
      .num { text-align: right; font-variant-numeric: tabular-nums; }
      .cmp { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
      .delta.up { color: var(--forge-err); } .delta.down { color: var(--forge-ok); }
    </style></head><body>
      <h1>Compare logs</h1>
      <div class="muted">A: ${escapeHtml(path.basename(left.file))} · B: ${escapeHtml(path.basename(right.file))}</div>
      <div class="section"><h2>Key metrics</h2>
        <table><thead><tr><th>Metric</th><th class="num">A</th><th class="num">B</th><th class="num">Δ (B−A)</th></tr></thead><tbody>
          ${metric('Duration', left.a.durationMs, right.a.durationMs, ' ms')}
          ${metric('SOQL', left.a.counts.soql, right.a.counts.soql)}
          ${metric('DML', left.a.counts.dml, right.a.counts.dml)}
          ${metric('DB rows', left.a.counts.dbRows, right.a.counts.dbRows)}
          ${metric('Callouts', left.a.counts.callouts, right.a.counts.callouts)}
          ${metric('Methods', left.a.counts.methods, right.a.counts.methods)}
          ${metric('Peak heap (KB)', left.a.peakHeapBytes / 1024, right.a.peakHeapBytes / 1024)}
          ${metric('Errors', left.a.errors.length, right.a.errors.length)}
        </tbody></table>
      </div>
      <div class="section cmp">${side(left)}${side(right)}</div>
    </body></html>`;
  }

  /** A clickable source reference (falls back to plain text when no class). */
  private lineLink(className: string | undefined, line: number | undefined, label: string): string {
    if (!className || line == null) {
      return escapeHtml(label);
    }
    return `<span class="clickable" data-cls="${escapeHtml(className)}" data-line="${line}">${escapeHtml(label)}</span>`;
  }

  /** A ⤓ icon that opens the RAW log and scrolls to a given source line. */
  private rawJump(line: number): string {
    return `<span class="rawjump" data-rawline="${line}" title="Open raw log at line ${line}">⤓</span>`;
  }

  /**
   * Renders one call-tree node as a collapsible `<details>` (when it has
   * children) or a leaf line. A node's `line` is the CALL SITE — the line in the
   * CALLER (parent) — so the clickable target uses the parent's class; roots link
   * to their own. Folded loop bodies show a "×N" badge (see `foldTree`).
   */
  private treeNode(n: MethodNode, depth: number, parentClass?: string): string {
    const linkClass = parentClass ?? n.className;
    const label = this.lineLink(linkClass, n.line, n.name);
    const rep = n.repeat && n.repeat > 1 ? `<span class="repeat">×${n.repeat}</span>` : '';
    const timing = `<span class="t"> — ${n.selfMs.toFixed(2)}ms self / ${n.totalMs.toFixed(2)}ms total</span>`;
    const head = `<span class="nm">${label}</span>${rep}${timing}`;
    if (!n.children.length) {
      return `<div class="treeline leaf">${head}</div>`;
    }
    // Auto-collapse deep/heavy subtrees so the tree opens readable; the user
    // expands what they care about (or clicks "Expand all").
    const open = depth < 1 ? ' open' : '';
    const kids = n.children.map((c) => this.treeNode(c, depth + 1, n.className)).join('');
    return `<details class="treenode"${open}><summary class="treeline">${head}</summary><div class="treekids">${kids}</div></details>`;
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

/** Reads the user's Log Analyzer thresholds from settings. */
function readAnalyzeOptions(): AnalyzeOptions {
  const cfg = vscode.workspace.getConfiguration('siid-forge.logAnalyzer');
  return {
    loopThreshold: cfg.get<number>('loopThreshold'),
    recursionThreshold: cfg.get<number>('recursionThreshold')
  };
}

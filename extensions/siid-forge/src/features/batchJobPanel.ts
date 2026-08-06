/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { BatchJobAnalysis, BatchPhaseAnalysis, batchAnalysisToMarkdown } from '../core/replay/batchAnalyzer';
import { Logger } from '../core/logger';
import { escapeHtml, FORGE_STYLES } from '../ui/webview';

/**
 * Visual Batch Job Analyzer — ONE view of a whole async job, over the headless
 * `analyzeBatchJob` service. Shows job status, aggregated totals, per-phase
 * breakdown (start → each execute chunk → finish), the peak per-chunk limit
 * usage, and job-level insights. Each phase row opens that transaction's own log
 * in the single-log analyzer, so the rollup is a starting point, not a dead end.
 * Presentation only — all extraction lives in `core/replay/batchAnalyzer.ts`.
 */

interface InMessage {
  command: 'openPhase' | 'export';
  /** For 'openPhase': index into `analysis.phases`. */
  index?: number;
  format?: 'md' | 'json';
}

interface PanelDeps {
  logger: Logger;
}

export class BatchJobPanel {
  private static current: BatchJobPanel | undefined;
  private readonly panel: vscode.WebviewPanel;

  static show(deps: PanelDeps, analysis: BatchJobAnalysis): void {
    if (BatchJobPanel.current) {
      BatchJobPanel.current.panel.reveal(vscode.ViewColumn.Active);
      BatchJobPanel.current.render(analysis);
      return;
    }
    BatchJobPanel.current = new BatchJobPanel(deps, analysis);
  }

  private constructor(private readonly deps: PanelDeps, private analysis: BatchJobAnalysis) {
    this.panel = vscode.window.createWebviewPanel(
      'siidForgeBatchJob',
      `Batch Job — ${analysis.className ?? analysis.jobId}`,
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    this.panel.onDidDispose(() => (BatchJobPanel.current = undefined));
    this.panel.webview.onDidReceiveMessage((m: InMessage) => this.onMessage(m));
    this.render(analysis);
  }

  private render(analysis: BatchJobAnalysis): void {
    this.analysis = analysis;
    this.panel.title = `Batch Job — ${analysis.className ?? analysis.jobId}`;
    this.panel.webview.html = this.html(analysis);
  }

  private async onMessage(m: InMessage): Promise<void> {
    if (m.command === 'openPhase' && m.index !== undefined) {
      const phase = this.analysis.phases[m.index];
      if (phase) {
        // Hand the phase's raw log to the single-log analyzer.
        await vscode.commands.executeCommand('siid-forge.analyzeLog', phase.file);
      }
      return;
    }
    if (m.command === 'export') {
      const text =
        m.format === 'json' ? JSON.stringify(this.analysis, null, 2) : batchAnalysisToMarkdown(this.analysis);
      const doc = await vscode.workspace.openTextDocument({
        content: text,
        language: m.format === 'json' ? 'json' : 'markdown'
      });
      await vscode.window.showTextDocument(doc, { preview: false });
    }
  }

  private html(a: BatchJobAnalysis): string {
    const errors = a.insights.filter((i) => i.severity === 'error').length;
    const warns = a.insights.filter((i) => i.severity === 'warn').length;

    const badges = [
      errors ? `<span class="badge err">${errors} HIGH</span>` : '',
      warns ? `<span class="badge warn">${warns} WARN</span>` : '',
      !errors && !warns ? `<span class="badge ok">No issues found</span>` : ''
    ].join(' ');

    // CPU is shown only when the logs actually measured it. Async logs report all
    // limits as 0, so a bare "0 ms" would read as "used no CPU" — the opposite of
    // the truth ("not measured"). Say which it is.
    const cpuTile = a.limitsUsable
      ? tile(`${a.totals.cpuMs}`, 'CPU MS (SUMMED)')
      : tile('—', 'CPU NOT REPORTED');

    const stats = [
      tile(a.status, 'JOB STATUS'),
      tile(`${a.itemsProcessed ?? '?'}/${a.totalItems ?? '?'}`, 'CHUNKS'),
      tile(a.jobDurationMs !== undefined ? `${(a.jobDurationMs / 1000).toFixed(1)}s` : '—', 'JOB WALL TIME'),
      tile(`${a.totals.soql}`, 'SOQL (ALL PHASES)'),
      tile(`${a.totals.dml}`, 'DML (ALL PHASES)'),
      tile(`${a.totals.dbRows}`, 'DB ROWS'),
      cpuTile,
      tile(`${a.numberOfErrors ?? 0}`, 'CHUNK ERRORS')
    ].join('');

    const insights = a.insights.length
      ? a.insights
          .map(
            (i) => `<div class="insight ${i.severity}">
              <span class="tag">${i.severity === 'error' ? 'HIGH' : 'WARN'}</span>
              <span>${escapeHtml(i.message)}${i.detail ? ` <code>${escapeHtml(i.detail)}</code>` : ''}</span>
            </div>`
          )
          .join('')
      : `<p class="muted">No insights — every phase of this job looks clean.</p>`;

    const phaseRows = a.phases
      .map((p, idx) => {
        const an = p.analysis;
        const name = p.phase + (p.chunkIndex ? ` #${p.chunkIndex}` : '');
        const cpu = a.limitsUsable && an.cpuMs !== undefined ? `${an.cpuMs}` : '—';
        const insightCount = an.insights.filter((i) => i.kind !== 'not-finest').length;
        return `<tr class="clickable" data-index="${idx}" title="Open this transaction's log in the analyzer">
          <td><span class="phase ${p.phase}">${escapeHtml(name)}</span></td>
          <td class="num">${an.counts.soql}</td>
          <td class="num">${an.counts.dml}</td>
          <td class="num">${an.counts.dbRows}</td>
          <td class="num">${cpu}</td>
          <td class="num">${an.durationMs.toFixed(0)}</td>
          <td class="num">${an.errors.length ? `<span class="bad">${an.errors.length}</span>` : '0'}</td>
          <td class="num">${insightCount || ''}</td>
        </tr>`;
      })
      .join('');

    const limitRows = a.peakLimits
      .filter((l) => l.percent > 0)
      .map((l) => {
        const cls = l.percent >= 90 ? 'red' : l.percent >= 75 ? 'amber' : 'green';
        const where = l.phase + (l.chunkIndex ? ` #${l.chunkIndex}` : '');
        return `<tr>
          <td>${escapeHtml(l.name)}</td>
          <td class="bar"><span class="fill ${cls}" style="width:${Math.min(100, l.percent).toFixed(0)}%"></span></td>
          <td class="num">${l.used}/${l.limit}</td>
          <td class="num">${l.percent.toFixed(0)}%</td>
          <td>${escapeHtml(where)}</td>
        </tr>`;
      })
      .join('');

    const limitsSection = a.limitsUsable && limitRows
      ? `<h2>Peak limit usage <span class="muted">(worst chunk per limit — a batch is healthy only if EVERY chunk is)</span></h2>
         <table class="grid">
           <thead><tr><th>Limit</th><th></th><th>Used</th><th>%</th><th>Worst in</th></tr></thead>
           <tbody>${limitRows}</tbody>
         </table>`
      : `<h2>Peak limit usage</h2>
         <p class="muted">Not reported. Async Apex logs list every governor limit as <code>0 out of &lt;cap&gt;</code>
         — Salesforce writes that block before the transaction does its work. The SOQL/DML counts above are
         counted from the log events instead and are reliable; CPU and limit bars are not available for batch jobs.</p>`;

    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      ${FORGE_STYLES}
      .badge{padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;margin-right:6px}
      .badge.err{background:#a1260d;color:#fff}
      .badge.warn{background:#b58900;color:#fff}
      .badge.ok{background:#2d7d2d;color:#fff}
      .tiles{display:flex;flex-wrap:wrap;gap:14px;margin:14px 0;padding:12px;border:1px solid var(--vscode-panel-border);border-radius:6px}
      .tile{min-width:96px}
      .tile .v{font-size:20px;font-weight:600;color:#a874e3}
      .tile .k{font-size:10px;letter-spacing:.5px;opacity:.7}
      .insight{display:flex;gap:8px;align-items:flex-start;padding:8px 10px;margin:6px 0;border-radius:4px;border-left:3px solid}
      .insight.error{border-color:#a1260d;background:rgba(161,38,13,.12)}
      .insight.warn{border-color:#b58900;background:rgba(181,137,0,.12)}
      .insight .tag{font-size:10px;font-weight:700;padding:1px 6px;border-radius:3px;background:rgba(255,255,255,.12)}
      table.grid{width:100%;border-collapse:collapse;margin:8px 0}
      table.grid th,table.grid td{padding:5px 8px;border-bottom:1px solid var(--vscode-panel-border);text-align:left}
      table.grid th{font-size:11px;opacity:.75;font-weight:600}
      td.num{text-align:right;font-variant-numeric:tabular-nums}
      tr.clickable{cursor:pointer}
      tr.clickable:hover{background:var(--vscode-list-hoverBackground)}
      .phase{padding:1px 7px;border-radius:3px;font-size:11px;font-weight:600}
      .phase.start{background:#264f78;color:#fff}
      .phase.execute{background:#432264;color:#d9b8ff}
      .phase.finish{background:#2d7d2d;color:#fff}
      .phase.unknown{background:#555;color:#fff}
      .bar{width:40%}
      .bar .fill{display:block;height:9px;border-radius:4px}
      .fill.green{background:#2d7d2d}.fill.amber{background:#b58900}.fill.red{background:#a1260d}
      .bad{color:#f14c4c;font-weight:600}
      .muted{opacity:.7;font-size:12px}
      .actions{float:right}
      button{margin-left:6px}
    </style></head><body>
      <div class="actions">
        <button onclick="send({command:'export',format:'md'})">Export .md</button>
        <button onclick="send({command:'export',format:'json'})">Export .json</button>
      </div>
      <h1>Batch Job Analysis</h1>
      <p class="muted">${escapeHtml(a.className ?? a.jobType ?? 'Async Apex')} · <code>${escapeHtml(a.jobId)}</code></p>
      <p>${badges}</p>
      <div class="tiles">${stats}</div>

      <h2>Insights <span class="muted">(rolled up across every transaction of the job)</span></h2>
      ${insights}

      <h2>Phases <span class="muted">(each is its OWN transaction — governor limits reset between them. Click a row to open its log.)</span></h2>
      <table class="grid">
        <thead><tr><th>Phase</th><th>SOQL</th><th>DML</th><th>Rows</th><th>CPU ms</th><th>Wall ms</th><th>Errors</th><th>Insights</th></tr></thead>
        <tbody>${phaseRows}</tbody>
      </table>

      ${limitsSection}

      <script>
        const vscode = acquireVsCodeApi();
        function send(m){ vscode.postMessage(m); }
        document.querySelectorAll('tr.clickable').forEach(function(tr){
          tr.addEventListener('click', function(){
            send({ command:'openPhase', index: parseInt(tr.dataset.index, 10) });
          });
        });
      </script>
    </body></html>`;
  }
}

function tile(value: string, key: string): string {
  return `<div class="tile"><div class="v">${escapeHtml(value)}</div><div class="k">${escapeHtml(key)}</div></div>`;
}

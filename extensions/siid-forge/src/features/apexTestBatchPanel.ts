/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as path from 'path';
import * as vscode from 'vscode';
import { Commands } from '../commands';
import { findProjectRoot } from '../core/workspace';
import { generateApexTestsBatch, BatchEvent } from '../core/apexTestBatch';
import { AiConfig } from '../core/aiConfig';
import { SchemaManager } from '../core/schemaManager';
import { SfExecutor } from '../core/sfExecutor';
import { OrgManager } from '../core/orgManager';
import { TraceManager } from '../core/traceManager';
import { Logger } from '../core/logger';
import { escapeHtml, FORGE_STYLES } from '../ui/webview';

/**
 * Live webview for BATCH AI Apex test generation (plan §18.F): a sequential queue
 * of classes, each row showing pending → running → pass/fail + coverage + tokens,
 * with a grand total (tokens/credits/succeeded) and a Stop that halts after the
 * current class. The loop itself is headless in `core/apexTestBatch`.
 */
export interface ApexBatchDeps {
  sf: SfExecutor;
  orgs: OrgManager;
  trace: TraceManager;
  schema: SchemaManager;
  logger: Logger;
}

export class ApexTestBatchPanel {
  private panel: vscode.WebviewPanel | undefined;
  private abort: AbortController | undefined;
  private clsPaths: string[] = [];
  private running = false;

  constructor(private readonly ai: AiConfig, private readonly deps: ApexBatchDeps) { }

  async open(clsPaths: string[]): Promise<void> {
    this.clsPaths = clsPaths;

    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        'siidForgeApexTestBatch',
        `AI Tests (batch): ${clsPaths.length} classes`,
        vscode.ViewColumn.Beside,
        { enableScripts: true, retainContextWhenHidden: true }
      );
      this.panel.onDidDispose(() => { this.abort?.abort(); this.panel = undefined; });
      this.panel.webview.onDidReceiveMessage((m) => this.onMessage(m));
    } else {
      this.panel.reveal(vscode.ViewColumn.Beside);
    }

    this.panel.webview.html = this.shellHtml();
    void this.run();
  }

  private async onMessage(m: any): Promise<void> {
    switch (m?.command) {
      case 'stop': this.abort?.abort(); this.post({ type: 'stopped' }); return;
      case 'rerun': return void this.run();
      case 'openTest': {
        const clsPath = this.clsPaths.find((p) => path.basename(p, '.cls') === m.className);
        if (clsPath) {
          const testPath = path.join(path.dirname(clsPath), `${m.className}Test.cls`);
          await vscode.window.showTextDocument(vscode.Uri.file(testPath), { viewColumn: vscode.ViewColumn.One });
        }
        return;
      }
    }
  }

  private async run(): Promise<void> {
    if (this.running) {
      return;
    }
    const apiKey = await this.ai.getApiKey();
    if (!apiKey) {
      this.post({ type: 'needKey' });
      return;
    }
    this.running = true;
    this.abort = new AbortController();
    this.post({ type: 'run-start' });

    try {
      await generateApexTestsBatch({
        sf: this.deps.sf,
        orgs: this.deps.orgs,
        trace: this.deps.trace,
        schema: this.deps.schema,
        logger: this.deps.logger,
        projectRoot: findProjectRoot(this.clsPaths[0]),
        clsPaths: this.clsPaths,
        apiKey,
        model: this.ai.getModel(),
        signal: this.abort.signal,
        onEvent: (e: BatchEvent) => {
          this.post(e);
          // Repaint coverage highlights + "% covered" CodeLens as each class completes.
          if (e.type === 'item-done') {
            void vscode.commands.executeCommand(Commands.refreshCoverage);
            void vscode.commands.executeCommand(Commands.refreshCoverageLens);
          }
        }
      });
    } catch (err: any) {
      this.deps.logger.error(`[apex-test-batch] ${err.message}`);
      this.post({ type: 'error', message: err.message });
    } finally {
      this.running = false;
    }
  }

  private post(msg: unknown): void {
    this.panel?.webview.postMessage(msg);
  }

  private shellHtml(): string {
    const rows = this.clsPaths
      .map((p, i) => {
        const name = escapeHtml(path.basename(p, '.cls'));
        return `<tr id="row${i}"><td class="st" id="st${i}">⏳ pending</td><td class="nm">${name}</td>` +
          `<td class="rs" id="rs${i}"></td><td class="tk" id="tk${i}"></td>` +
          `<td><button class="link" data-name="${name}">open</button></td></tr>`;
      })
      .join('');

    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${FORGE_STYLES}
      table { width: 100%; border-collapse: collapse; font-size: 13px; }
      th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--forge-border); }
      th { color: var(--forge-muted); font-weight: 600; font-size: 11px; text-transform: uppercase; }
      .nm { font-family: var(--vscode-editor-font-family, monospace); }
      .st { white-space: nowrap; }
      .rs .pass { color: var(--forge-ok, #4ec9b0); } .rs .fail { color: var(--forge-err, #f48771); }
      .tk { color: var(--forge-muted); font-size: 11px; white-space: nowrap; }
      .running { color: var(--forge-orange); }
      .link { background: none; border: none; color: var(--vscode-textLink-foreground); cursor: pointer; padding: 0; }
      #total { margin: 12px 0; font-size: 13px; }
      #total b { color: var(--forge-fg, inherit); }
      .bar { margin-bottom: 12px; }
    </style></head><body>
      <h1>AI Apex Tests — Batch (${this.clsPaths.length} classes)</h1>
      <div class="bar row">
        <span class="grow"></span>
        <button class="accent" id="rerun" disabled>Re-run all</button>
        <button class="secondary" id="stop" disabled>Stop after current</button>
      </div>
      <div id="warn"></div>
      <div id="total">Queued ${this.clsPaths.length} classes.</div>
      <table>
        <thead><tr><th>Status</th><th>Class</th><th>Result</th><th>Tokens</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <script>
        const vscode = acquireVsCodeApi();
        const $ = (id) => document.getElementById(id);
        let done = 0, succeeded = 0;
        const totalCount = ${this.clsPaths.length};

        $('stop').onclick = () => vscode.postMessage({ command:'stop' });
        $('rerun').onclick = () => { reset(); vscode.postMessage({ command:'rerun' }); };
        document.querySelectorAll('.link').forEach(b => b.onclick = () => vscode.postMessage({ command:'openTest', className: b.dataset.name }));

        function reset() {
          done = 0; succeeded = 0;
          for (let i=0;i<totalCount;i++){ $('st'+i).textContent='⏳ pending'; $('st'+i).className='st'; $('rs'+i).innerHTML=''; $('tk'+i).textContent=''; }
          $('total').textContent = 'Re-running '+totalCount+' classes…';
        }
        function setRunning(on) { $('stop').disabled = !on; $('rerun').disabled = on; }
        function fmtTok(n){ n=Number(n)||0; return n>=1000 ? (n/1000).toFixed(1)+'k' : String(n); }

        window.addEventListener('message', (e) => {
          const m = e.data;
          if (m.type === 'needKey') { $('warn').textContent = 'Set an OpenRouter API key first (SIID Forge: Set OpenRouter API Key).'; return; }
          if (m.type === 'run-start') { setRunning(true); return; }
          if (m.type === 'stopped') { $('total').innerHTML += ' <span class="fail">■ stopping after current class…</span>'; return; }
          if (m.type === 'error') { $('warn').textContent = '❌ '+m.message; setRunning(false); return; }
          if (m.type === 'batch-start') { $('total').textContent = 'Running '+m.total+' classes (sequential)…'; return; }
          if (m.type === 'item-start') {
            $('st'+m.index).textContent = '▸ running'; $('st'+m.index).className = 'st running';
            return;
          }
          if (m.type === 'item-event') {
            const ev = m.event;
            if (ev.type === 'phase') { $('st'+m.index).textContent = '▸ '+ev.phase; }
            if (ev.type === 'usage') { $('tk'+m.index).textContent = fmtTok(ev.cumulativeTokens)+' tok'+(ev.cumulativeCost?' · $'+ev.cumulativeCost.toFixed(4):''); }
            return;
          }
          if (m.type === 'item-done') {
            const r = m.result; done++;
            if (r.success) succeeded++;
            const ok = r.success;
            $('st'+m.index).textContent = ok ? '✅ done' : (r.blockedReason ? '🚫 blocked' : '⚠️ partial');
            $('st'+m.index).className = 'st';
            const cov = (r.coverage!=null) ? ' · '+r.coverage+'%' : '';
            $('rs'+m.index).innerHTML = r.error
              ? '<span class="fail">'+esc(r.error)+'</span>'
              : '<span class="'+(ok?'pass':'fail')+'">'+r.passed+'/'+r.total+' passed'+cov+'</span>';
            $('tk'+m.index).textContent = fmtTok(r.tokens)+' tok'+(r.cost?' · $'+r.cost.toFixed(4):'');
            $('total').innerHTML = '<b>'+done+'/'+totalCount+'</b> done · <b>'+succeeded+'</b> succeeded · '
              + '<b>'+fmtTok(m.cumulativeTokens)+'</b> tokens'+(m.cumulativeCost?' · <b>$'+m.cumulativeCost.toFixed(4)+'</b> credits':'');
            return;
          }
          if (m.type === 'batch-done') {
            setRunning(false);
            $('total').innerHTML = '✅ Finished: <b>'+m.succeeded+'/'+m.results.length+'</b> succeeded · '
              + '<b>'+fmtTok(m.totalTokens)+'</b> tokens'+(m.totalCost?' · <b>$'+m.totalCost.toFixed(4)+'</b> credits':'')
              + (m.stopped ? ' <span class="fail">(stopped early)</span>' : '');
            return;
          }
        });
        function esc(s){ const d=document.createElement('div'); d.textContent=s||''; return d.innerHTML; }
      </script>
    </body></html>`;
  }
}

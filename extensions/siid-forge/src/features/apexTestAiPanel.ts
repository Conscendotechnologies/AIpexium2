/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as path from 'path';
import * as vscode from 'vscode';
import { Commands } from '../commands';
import { findProjectRoot } from '../core/workspace';
import { generateApexTest, ApexGenerateEvent } from '../core/apexTestGenerator';
import { ChatMessage } from '../core/openRouterClient';
import { AiConfig, SUGGESTED_MODELS } from '../core/aiConfig';
import { SchemaManager } from '../core/schemaManager';
import { SfExecutor } from '../core/sfExecutor';
import { OrgManager } from '../core/orgManager';
import { TraceManager } from '../core/traceManager';
import { Logger } from '../core/logger';
import { escapeHtml, FORGE_STYLES } from '../ui/webview';

/**
 * Live webview for AI Apex test generation (plan §18.E): streams each attempt
 * (generating → deploying → running → pass/fail + coverage) with model picker,
 * Set-Key / Regenerate / Retry / "Cover more" / Feedback / Stop. The coverage-
 * driven loop + deploy guardrails live in `core/apexTestGenerator`.
 */
export interface ApexAiDeps {
  sf: SfExecutor;
  orgs: OrgManager;
  trace: TraceManager;
  schema: SchemaManager;
  logger: Logger;
}

export class ApexTestAiPanel {
  private panel: vscode.WebviewPanel | undefined;
  private abort: AbortController | undefined;
  private clsPath = '';
  private running = false;
  private model = '';
  private conversation: ChatMessage[] | undefined;

  constructor(private readonly ai: AiConfig, private readonly deps: ApexAiDeps) { }

  private async applyModel(model: unknown): Promise<void> {
    if (typeof model === 'string' && model.trim()) {
      this.model = model.trim();
      await this.ai.setModel(this.model);
    }
  }

  async open(clsPath: string): Promise<void> {
    this.clsPath = clsPath;
    const name = path.basename(clsPath, '.cls');

    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        'siidForgeApexTestAi',
        `AI Tests: ${name}`,
        vscode.ViewColumn.Beside,
        { enableScripts: true, retainContextWhenHidden: true }
      );
      this.panel.onDidDispose(() => { this.abort?.abort(); this.panel = undefined; });
      this.panel.webview.onDidReceiveMessage((m) => this.onMessage(m));
    } else {
      this.panel.title = `AI Tests: ${name}`;
      this.panel.reveal(vscode.ViewColumn.Beside);
    }

    this.panel.webview.html = await this.shellHtml(name);
    void this.run('generate');
  }

  private async onMessage(m: any): Promise<void> {
    switch (m?.command) {
      case 'generate': await this.applyModel(m.model); return void this.run('generate');
      case 'retry': await this.applyModel(m.model); return void this.run('retry');
      case 'more': await this.applyModel(m.model); return void this.run('more');
      case 'feedback': await this.applyModel(m.model); return void this.run('feedback', String(m.text ?? ''));
      case 'stop': this.abort?.abort(); this.post({ type: 'stopped' }); return;
      case 'setKey': {
        const saved = await this.ai.promptAndStoreApiKey();
        this.post({ type: 'key', hasKey: saved || await this.ai.hasApiKey() });
        return;
      }
      case 'setModel': await this.applyModel(m.model); return;
      case 'openTest': {
        await vscode.window.showTextDocument(vscode.Uri.file(this.testPath()), { viewColumn: vscode.ViewColumn.One });
        return;
      }
    }
  }

  private testPath(): string {
    const name = path.basename(this.clsPath, '.cls');
    return path.join(path.dirname(this.clsPath), `${name}Test.cls`);
  }

  /**
   * Runs a generation pass and streams events.
   *  - generate: fresh start (discards conversation; keeps any file for overwrite)
   *  - retry/more/feedback: continue the conversation
   */
  private async run(mode: 'generate' | 'retry' | 'more' | 'feedback', feedback?: string): Promise<void> {
    if (this.running) {
      return;
    }
    const apiKey = await this.ai.getApiKey();
    if (!apiKey) {
      this.post({ type: 'needKey' });
      return;
    }
    if (mode === 'generate') {
      this.conversation = undefined;
    }
    const continuing = mode !== 'generate' && !!this.conversation?.length;

    this.running = true;
    this.abort = new AbortController();
    this.post({ type: 'start', mode });

    try {
      const result = await generateApexTest({
        sf: this.deps.sf,
        orgs: this.deps.orgs,
        trace: this.deps.trace,
        schema: this.deps.schema,
        logger: this.deps.logger,
        projectRoot: findProjectRoot(this.clsPath),
        clsPath: this.clsPath,
        apiKey,
        model: this.model || this.ai.getModel(),
        signal: this.abort.signal,
        onEvent: (e: ApexGenerateEvent) => this.post(e),
        conversation: continuing ? this.conversation : undefined,
        feedback: mode === 'feedback' ? feedback : undefined
      });
      this.conversation = result.conversation;
      const name = path.basename(this.clsPath, '.cls');
      // The generator's run persisted coverage to the store — repaint the file's
      // coverage highlights (gutter) + the "% covered" CodeLens, same as the
      // "Run All Tests" button does.
      void vscode.commands.executeCommand(Commands.refreshCoverage);
      void vscode.commands.executeCommand(Commands.refreshCoverageLens);
      this.deps.logger.info(
        `[apex-test-ai] ${name}: ${mode} → ${result.success ? 'PASSED' : (result.blockedReason ? 'BLOCKED' : 'PARTIAL')} ` +
        `${result.passed}/${result.total} cov=${result.coverage ?? '?'}% in ${result.attempts} attempt(s)`
      );
    } catch (err: any) {
      this.deps.logger.error(`[apex-test-ai] ${err.message}`);
      this.post({ type: 'error', message: err.message });
    } finally {
      this.running = false;
    }
  }

  private post(msg: unknown): void {
    this.panel?.webview.postMessage(msg);
  }

  private async shellHtml(name: string): Promise<string> {
    const hasKey = await this.ai.hasApiKey();
    const model = this.ai.getModel();
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${FORGE_STYLES}
      .bar { margin-bottom: 12px; }
      .model { font-size: 12px; color: var(--forge-muted); }
      #model { min-width: 220px; font-family: var(--vscode-editor-font-family, monospace); }
      .phase { font-size: 12px; color: var(--forge-muted); }
      .fail-list { margin: 6px 0 0; padding: 0; list-style: none; }
      .fail-list li { font-size: 12px; padding: 4px 0; border-top: 1px solid var(--forge-border); color: var(--forge-err); }
      .spin { color: var(--forge-orange); }
      #warn { color: var(--forge-warn); font-size: 12px; margin: 8px 0; }
      .cov { font-size: 12px; }
      .usage { font-size: 12px; color: var(--forge-muted); margin: 4px 0 8px; }
      .usage b { color: var(--forge-fg, inherit); font-weight: 600; }
      .tok { font-size: 11px; color: var(--forge-muted); }
      .feedback { margin-top: 16px; border-top: 1px solid var(--forge-border); padding-top: 12px; }
      .feedback textarea { width: 100%; min-height: 60px; resize: vertical; margin-top: 6px; }
      .hint { color: var(--forge-muted); font-size: 11px; }
    </style></head><body>
      <h1>AI Apex Tests: <code>${escapeHtml(name)}</code></h1>
      <div class="bar row">
        <span class="model">Model:</span>
        <input list="models" id="model" value="${escapeHtml(model)}" spellcheck="false" title="OpenRouter model id (editable)" />
        <datalist id="models">
          ${SUGGESTED_MODELS.map((mm) => `<option value="${escapeHtml(mm)}"></option>`).join('')}
        </datalist>
        <span class="grow"></span>
        <button class="secondary" id="setKey">${hasKey ? 'Change Key' : 'Set API Key'}</button>
        <button class="accent" id="gen">Regenerate</button>
        <button class="secondary" id="retry" disabled>Retry failed</button>
        <button class="secondary" id="open">Open test</button>
        <button class="secondary" id="stop" disabled>Stop</button>
      </div>
      <div id="warn"></div>
      <div id="status"></div>
      <div id="usage" class="usage"></div>
      <div id="attempts"></div>

      <div class="feedback">
        <label for="fb">Feedback — tell the AI what to add or fix (e.g. "cover the null-id error path", "add a bulk test of 200 records"):</label>
        <textarea id="fb" placeholder="Add a test for…"></textarea>
        <div class="row">
          <button class="accent" id="send" disabled>Send feedback</button>
          <button class="secondary" id="more">Cover more lines</button>
          <span class="hint">Continues the same conversation — keeps passing tests.</span>
        </div>
      </div>
      <script>
        const vscode = acquireVsCodeApi();
        const $ = (id) => document.getElementById(id);
        let hasKey = ${hasKey};
        let attempts = {};
        const model = () => $('model').value;
        const setModel = () => vscode.postMessage({ command:'setModel', model: model() });
        $('model').addEventListener('change', setModel);

        $('setKey').onclick = () => vscode.postMessage({ command:'setKey' });
        $('gen').onclick = () => { resetAttempts(); setModel(); vscode.postMessage({ command:'generate' }); };
        $('retry').onclick = () => { resetAttempts(); setModel(); vscode.postMessage({ command:'retry' }); };
        $('more').onclick = () => { resetAttempts(); setModel(); vscode.postMessage({ command:'more' }); };
        $('send').onclick = () => {
          const text = $('fb').value.trim(); if (!text) return;
          resetAttempts(); setModel(); vscode.postMessage({ command:'feedback', text });
          $('fb').value = ''; $('send').disabled = true;
        };
        $('open').onclick = () => vscode.postMessage({ command:'openTest' });
        $('stop').onclick = () => vscode.postMessage({ command:'stop' });
        $('fb').addEventListener('input', () => { $('send').disabled = !$('fb').value.trim(); });

        function resetAttempts() { attempts = {}; $('attempts').innerHTML = ''; }
        function setRunning(on) {
          $('gen').disabled = on; $('retry').disabled = on; $('stop').disabled = !on;
          $('more').disabled = on; $('send').disabled = on || !$('fb').value.trim();
        }
        function attemptEl(n) {
          if (!attempts[n]) {
            const d = document.createElement('div'); d.className='attempt card'; d.id='att'+n;
            d.innerHTML = '<h3>Attempt '+n+' <span class="phase spin" id="ph'+n+'">…</span> <span id="bdg'+n+'"></span></h3><div class="tok" id="tk'+n+'"></div><ul class="fail-list" id="fl'+n+'"></ul>';
            $('attempts').prepend(d); attempts[n]=true;
          }
          return n;
        }

        window.addEventListener('message', (e) => {
          const m = e.data;
          if (m.type === 'needKey') { $('warn').textContent = 'Set an OpenRouter API key to generate.'; return; }
          if (m.type === 'key') { hasKey = m.hasKey; $('setKey').textContent = hasKey ? 'Change Key' : 'Set API Key'; $('warn').textContent=''; if (hasKey) vscode.postMessage({command:'generate'}); return; }
          if (m.type === 'blocked') { $('status').innerHTML = '<span class="err">🚫 '+esc(m.reason)+'</span>'; setRunning(false); return; }
          if (m.type === 'start') {
            const label = m.mode==='retry'?'Retrying…':(m.mode==='more'?'Raising coverage…':(m.mode==='feedback'?'Applying your feedback…':'Generating…'));
            $('status').innerHTML = '<span class="spin">▸ '+label+'</span>'; setRunning(true); return;
          }
          if (m.type === 'stopped') { $('status').innerHTML = '<span class="err">■ Stopped.</span>'; setRunning(false); return; }
          if (m.type === 'error') { $('status').innerHTML = '<span class="err">❌ '+esc(m.message)+'</span>'; setRunning(false); return; }
          if (m.type === 'phase') { attemptEl(m.attempt); $('ph'+m.attempt).textContent = m.message || (m.phase+' …'); return; }
          if (m.type === 'usage') {
            attemptEl(m.attempt);
            const per = fmtTok(m.totalTokens)+' tok'+(m.cost!=null ? ' · $'+m.cost.toFixed(5) : '');
            $('tk'+m.attempt).textContent = '🔢 '+per+' (prompt '+fmtTok(m.promptTokens)+' + out '+fmtTok(m.completionTokens)+')';
            $('usage').innerHTML = 'Session: <b>'+fmtTok(m.cumulativeTokens)+'</b> tokens'
              + (m.cumulativeCost ? ' · <b>$'+m.cumulativeCost.toFixed(5)+'</b> credits' : '');
            return;
          }
          if (m.type === 'attempt-result') {
            attemptEl(m.attempt);
            $('ph'+m.attempt).classList.remove('spin'); $('ph'+m.attempt).textContent = 'done';
            const pass = m.failed===0 && m.total>0;
            const cov = (m.coverage!=null) ? ' <span class="cov">· '+m.coverage+'% cov</span>' : '';
            $('bdg'+m.attempt).innerHTML = '<span class="badge '+(pass?'pass':'fail')+'">'+m.passed+'/'+m.total+' passed</span>'+cov;
            $('fl'+m.attempt).innerHTML = (m.failures||[]).map(f => '<li>✗ '+esc(f)+'</li>').join('');
            return;
          }
          if (m.type === 'done') {
            setRunning(false);
            const cov = (m.coverage!=null) ? ' · '+m.coverage+'% coverage' : '';
            $('status').innerHTML = m.success
              ? '<span class="ok">✅ Passed ('+m.passed+'/'+m.total+')'+cov+' in '+m.attempts+' attempt(s).</span>'
              : '<span class="err">⚠️ '+m.passed+'/'+m.total+' passing'+cov+' after '+m.attempts+' attempt(s). Use Retry / Cover more.</span>';
            if (m.totalTokens) {
              $('usage').innerHTML = 'Total: <b>'+fmtTok(m.totalTokens)+'</b> tokens'
                + (m.totalCost ? ' · <b>$'+m.totalCost.toFixed(5)+'</b> credits' : '')
                + ' over '+m.attempts+' call(s)';
            }
            return;
          }
        });
        function esc(s){ const d=document.createElement('div'); d.textContent=s||''; return d.innerHTML; }
        function fmtTok(n){ n=Number(n)||0; return n>=1000 ? (n/1000).toFixed(1)+'k' : String(n); }
      </script>
    </body></html>`;
  }
}

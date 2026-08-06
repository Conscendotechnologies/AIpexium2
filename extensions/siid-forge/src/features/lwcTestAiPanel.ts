/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Commands } from '../commands';
import { findProjectRoot } from '../core/workspace';
import { scaffoldLwcTest } from '../core/lwcTestScaffold';
import { generateLwcTest, GenerateEvent } from '../core/lwcTestGenerator';
import { ChatMessage } from '../core/openRouterClient';
import { AiConfig, SUGGESTED_MODELS } from '../core/aiConfig';
import { escapeHtml, FORGE_STYLES } from '../ui/webview';

/**
 * Live webview for AI LWC test generation: streams each generation attempt
 * (generating → running → pass/fail + failing tests) with Set-Key / Generate /
 * Retry / Regenerate / Stop controls. Replaces the one-shot toast so the
 * multi-attempt loop is transparent.
 */
export class LwcTestAiPanel {
  private panel: vscode.WebviewPanel | undefined;
  private abort: AbortController | undefined;
  private jsPath = '';
  private running = false;
  private model = '';
  /** The ongoing LLM conversation, so feedback/retry continue the same thread. */
  private conversation: ChatMessage[] | undefined;

  /** Records (and persists) the model chosen in the webview for the next run. */
  private async applyModel(model: unknown): Promise<void> {
    if (typeof model === 'string' && model.trim()) {
      this.model = model.trim();
      await this.ai.setModel(this.model);
    }
  }

  constructor(
    private readonly ai: AiConfig,
    private readonly logger: { info(m: string): void; error(m: string): void }
  ) { }

  async open(jsPath: string): Promise<void> {
    this.jsPath = jsPath;
    const name = path.basename(jsPath, '.js');

    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        'siidForgeLwcTestAi',
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
    // Auto-start generation on open.
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
        this.post({ type: 'key', hasKey: saved || await this.ai.hasApiKey(), model: this.ai.getModel() });
        return;
      }
      case 'setModel': await this.applyModel(m.model); return;
      case 'openTest': {
        const p = scaffoldLwcTest(this.jsPath).testPath;
        await vscode.window.showTextDocument(vscode.Uri.file(p), { viewColumn: vscode.ViewColumn.One });
        return;
      }
    }
  }

  /**
   * Runs a generation pass and streams events to the webview.
   *  - generate: fresh start (discards file + conversation)
   *  - retry:    continue the conversation to fix failures
   *  - more:     continue the conversation asking for additional scenarios
   *  - feedback: continue the conversation with the user's instruction
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
    // A fresh "generate" discards the existing test + conversation.
    if (mode === 'generate') {
      const p = scaffoldLwcTest(this.jsPath).testPath;
      try { fs.rmSync(p, { force: true }); } catch { /* ignore */ }
      this.conversation = undefined;
    }
    // 'more'/'feedback'/'retry' need an existing conversation to continue.
    const continuing = mode !== 'generate' && !!this.conversation?.length;

    this.running = true;
    this.abort = new AbortController();
    this.post({ type: 'start', mode });

    try {
      const result = await generateLwcTest({
        projectRoot: findProjectRoot(this.jsPath),
        jsFilePath: this.jsPath,
        apiKey,
        model: this.model || this.ai.getModel(),
        signal: this.abort.signal,
        onEvent: (e: GenerateEvent) => this.post(e),
        conversation: continuing ? this.conversation : undefined,
        feedback: mode === 'feedback' ? feedback : undefined
      });
      this.conversation = result.conversation;
      const name = path.basename(this.jsPath, '.js');
      this.logger.info(`[lwc-test-ai] ${name}: ${mode} → ${result.success ? 'PASSED' : 'PARTIAL'} ${result.finalRun.numPassed}/${result.finalRun.numTotal} in ${result.attempts} attempt(s)`);
    } catch (err: any) {
      this.logger.error(`[lwc-test-ai] ${err.message}`);
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
      .attempt { /* uses .card */ }
      .phase { font-size: 12px; color: var(--forge-muted); }
      .fail-list { margin: 6px 0 0; padding: 0; list-style: none; }
      .fail-list li { font-size: 12px; padding: 4px 0; border-top: 1px solid var(--forge-border); }
      .fail-list .t { color: var(--forge-err); }
      .fail-list .m { color: var(--forge-muted); }
      .spin { color: var(--forge-orange); }
      #warn { color: var(--forge-warn); font-size: 12px; margin: 8px 0; }
      .feedback { margin-top: 16px; border-top: 1px solid var(--forge-border); padding-top: 12px; }
      .feedback textarea { width: 100%; min-height: 60px; resize: vertical; margin-top: 6px; }
      .hint { color: var(--forge-muted); font-size: 11px; }
    </style></head><body>
      <h1>AI LWC Tests: <code>${escapeHtml(name)}</code></h1>
      <div class="bar row">
        <span class="model">Model:</span>
        <input list="models" id="model" value="${escapeHtml(model)}" spellcheck="false"
               title="OpenRouter model id (editable)" />
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
      <div id="attempts"></div>

      <div class="feedback">
        <label for="fb">Feedback — tell the AI what to add or fix (e.g. "test the delete button error path", "cover the empty-config case"):</label>
        <textarea id="fb" placeholder="Add a test for…"></textarea>
        <div class="row">
          <button class="accent" id="send" disabled>Send feedback</button>
          <button class="secondary" id="more">Add more tests</button>
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

        // Persist model edits as you change them (used by the next run).
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
            d.innerHTML = '<h3>Attempt '+n+' <span class="phase spin" id="ph'+n+'">…</span> <span id="bdg'+n+'"></span></h3><ul class="fail-list" id="fl'+n+'"></ul>';
            $('attempts').prepend(d); attempts[n]=true;
          }
          return n;
        }

        window.addEventListener('message', (e) => {
          const m = e.data;
          if (m.type === 'needKey') { $('warn').textContent = 'Set an OpenRouter API key to generate.'; return; }
          if (m.type === 'key') { hasKey = m.hasKey; $('setKey').textContent = hasKey ? 'Change Key' : 'Set API Key'; $('warn').textContent=''; if (hasKey) vscode.postMessage({command:'generate'}); return; }
          if (m.type === 'start') {
            const label = m.mode==='retry'?'Retrying…':(m.mode==='more'?'Adding more tests…':(m.mode==='feedback'?'Applying your feedback…':'Generating…'));
            $('status').innerHTML = '<span class="spin">▸ '+label+'</span>'; setRunning(true); return;
          }
          if (m.type === 'stopped') { $('status').innerHTML = '<span class="err">■ Stopped.</span>'; setRunning(false); return; }
          if (m.type === 'error') { $('status').innerHTML = '<span class="err">❌ '+m.message+'</span>'; setRunning(false); return; }
          if (m.type === 'phase') { attemptEl(m.attempt); $('ph'+m.attempt).textContent = m.message || (m.phase+' …'); return; }
          if (m.type === 'attempt-result') {
            attemptEl(m.attempt);
            $('ph'+m.attempt).classList.remove('spin'); $('ph'+m.attempt).textContent = 'done';
            const pass = m.failed===0 && m.total>0;
            $('bdg'+m.attempt).innerHTML = '<span class="badge '+(pass?'pass':'fail')+'">'+m.passed+'/'+m.total+' passed</span>';
            $('fl'+m.attempt).innerHTML = (m.failures||[]).map(f => '<li><span class="t">✗ '+esc(f.title)+'</span><br><span class="m">'+esc(f.message)+'</span></li>').join('');
            return;
          }
          if (m.type === 'done') {
            setRunning(false);
            $('status').innerHTML = m.success
              ? '<span class="ok">✅ Passed ('+m.passed+'/'+m.total+') in '+m.attempts+' attempt(s).</span>'
              : '<span class="err">⚠️ '+m.passed+'/'+m.total+' passing after '+m.attempts+' attempt(s). Use Retry or Regenerate.</span>';
            return;
          }
        });
        function esc(s){ const d=document.createElement('div'); d.textContent=s||''; return d.innerHTML; }
      </script>
    </body></html>`;
  }
}

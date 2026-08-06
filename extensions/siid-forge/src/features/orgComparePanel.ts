/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as fs from 'fs';
import { SfExecutor } from '../core/sfExecutor';
import { OrgManager } from '../core/orgManager';
import { Logger } from '../core/logger';
import { ComponentRef, listLocalComponents } from '../core/deployDiff';
import {
  CompareSide,
  CompareRow,
  compareOrgs,
  syncComponents,
  sideLabel
} from '../core/orgCompare';
import { openDiffFiles } from './diffReview';
import { escapeHtml, FORGE_STYLES } from '../ui/webview';

/**
 * Org Compare panel (§19 revised): compare metadata between two sides — each the
 * local project or an authorized org — and sync one → the other. The panel owns
 * the UI + message loop; the diff/sync mechanics live in `core/orgCompare`.
 */
export class OrgComparePanel {
  private panel: vscode.WebviewPanel | undefined;
  private rows: CompareRow[] = [];
  private lastCompare?: { a: CompareSide; b: CompareSide };
  private busy = false;

  constructor(
    private readonly sf: SfExecutor,
    private readonly orgs: OrgManager,
    private readonly logger: Logger,
    private readonly cwd: string
  ) { }

  async open(): Promise<void> {
    const [orgList, components] = await Promise.all([
      this.orgs.listOrgs(),
      Promise.resolve(listLocalComponents(this.cwd))
    ]);
    const orgNames = orgList.map((o) => o.alias || o.username);

    this.panel = vscode.window.createWebviewPanel(
      'siidForgeOrgCompare',
      'SIID Forge: Org Compare',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    this.panel.onDidDispose(() => { this.panel = undefined; });
    this.panel.webview.onDidReceiveMessage((m) => this.onMessage(m, components));
    this.panel.webview.html = this.html(orgNames, components);
  }

  private async onMessage(m: any, components: ComponentRef[]): Promise<void> {
    switch (m?.command) {
      case 'compare':
        return this.doCompare(parseSide(m.a), parseSide(m.b), pickComponents(components, m.names));
      case 'openDiff':
        return this.doOpenDiff(m.index);
      case 'sync':
        return this.doSync(m.direction, m.scope, components);
    }
  }

  /** Runs the two-side comparison and posts the result table. */
  private async doCompare(a: CompareSide, b: CompareSide, components: ComponentRef[]): Promise<void> {
    if (this.busy) {
      return;
    }
    if (sameSide(a, b)) {
      this.post({ type: 'error', message: 'Pick two different sides to compare.' });
      return;
    }
    if (!components.length) {
      this.post({ type: 'error', message: 'Select at least one component to compare.' });
      return;
    }
    this.busy = true;
    this.post({ type: 'busy', on: true, label: `Comparing ${sideLabel(a)} ↔ ${sideLabel(b)}…` });
    try {
      this.rows = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `SIID Forge: comparing ${sideLabel(a)} ↔ ${sideLabel(b)}…`, cancellable: true },
        (_p, token) => compareOrgs(this.sf, a, b, components, this.cwd, token)
      );
      this.lastCompare = { a, b };
      this.post({ type: 'result', rows: this.rows, aLabel: sideLabel(a), bLabel: sideLabel(b) });
    } catch (err: any) {
      this.logger.error(`[org-compare] ${err.message}`);
      this.post({ type: 'error', message: err.message });
    } finally {
      this.busy = false;
      this.post({ type: 'busy', on: false });
    }
  }

  /** Opens the native diff editor for a compared row (A on the left, B on the right). */
  private async doOpenDiff(index: number): Promise<void> {
    const row = this.rows[index];
    if (!row || !this.lastCompare) {
      return;
    }
    const { a, b } = this.lastCompare;
    await openDiffFiles(
      { path: row.pathA, label: sideLabel(a) },
      { path: row.pathB, label: sideLabel(b) },
      `${row.fullName}: ${sideLabel(a)} ↔ ${sideLabel(b)}`
    );
  }

  /** Syncs components in a direction, either all compared or only differing. */
  private async doSync(direction: 'ab' | 'ba', scope: 'all' | 'differing', components: ComponentRef[]): Promise<void> {
    if (this.busy || !this.lastCompare) {
      return;
    }
    const { a, b } = this.lastCompare;
    const from = direction === 'ab' ? a : b;
    const to = direction === 'ab' ? b : a;

    // Which components to push: for "differing" include rows that differ or are
    // only present on the SOURCE side (they'd be created on the destination).
    const wanted = scope === 'all'
      ? this.rows
      : this.rows.filter((r) => r.status === 'differs' || r.status === (direction === 'ab' ? 'onlyA' : 'onlyB'));
    const refs = components.filter((c) => wanted.some((r) => r.type === c.type && r.fullName === c.fullName));
    if (!refs.length) {
      this.post({ type: 'error', message: 'Nothing to sync for that choice.' });
      return;
    }

    const verb = `${sideLabel(from)} → ${sideLabel(to)}`;
    const confirm = await vscode.window.showWarningMessage(
      `Sync ${refs.length} component${refs.length === 1 ? '' : 's'} ${verb}? This ${to.kind === 'org' ? `deploys to "${sideLabel(to)}"` : 'overwrites your local files'}.`,
      { modal: true },
      'Sync'
    );
    if (confirm !== 'Sync') {
      return;
    }

    this.busy = true;
    this.post({ type: 'busy', on: true, label: `Syncing ${verb}…` });
    try {
      const n = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `SIID Forge: syncing ${verb}…`, cancellable: true },
        (_p, token) => syncComponents(this.sf, from, to, refs, this.cwd, token)
      );
      this.post({ type: 'synced', message: `✅ Synced ${n} component${n === 1 ? '' : 's'} ${verb}. Re-compare to refresh.` });
    } catch (err: any) {
      this.logger.error(`[org-compare sync] ${err.message}`);
      this.post({ type: 'error', message: err.message });
    } finally {
      this.busy = false;
      this.post({ type: 'busy', on: false });
    }
  }

  private post(msg: unknown): void {
    this.panel?.webview.postMessage(msg);
  }

  private html(orgNames: string[], components: ComponentRef[]): string {
    // Side A defaults to Local; Side B defaults to the first org (a sensible
    // "local vs my sandbox" starting point). `preselectOrg` marks B's default.
    const sideOptions = (id: string, preselectFirstOrg: boolean): string => {
      const localSel = preselectFirstOrg ? '' : ' selected';
      const opts = [`<option value="local"${localSel}>Local (project files)</option>`]
        .concat(orgNames.map((n, i) => {
          const sel = preselectFirstOrg && i === 0 ? ' selected' : '';
          return `<option value="org:${escapeHtml(n)}"${sel}>${escapeHtml(n)}</option>`;
        }))
        .join('');
      return `<select id="${id}">${opts}</select>`;
    };

    const compRows = components
      .map((c, i) => `<label class="cmp"><input type="checkbox" value="${i}" data-type="${escapeHtml(c.type)}" data-name="${escapeHtml(c.fullName)}"> <span class="nm">${escapeHtml(c.fullName)}</span> <span class="kind">${escapeHtml(c.type)}</span></label>`)
      .join('');

    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${FORGE_STYLES}
      .sides { display: flex; gap: 16px; align-items: flex-end; flex-wrap: wrap; margin-bottom: 12px; }
      .side { display: flex; flex-direction: column; gap: 4px; }
      select { min-width: 200px; }
      .filter { margin: 8px 0; }
      .cmplist { max-height: 220px; overflow: auto; border: 1px solid var(--forge-border); border-radius: 6px; padding: 6px 10px; }
      .cmp { display: flex; gap: 8px; align-items: center; padding: 2px 0; font-size: 13px; cursor: pointer; }
      .cmp .nm { font-family: var(--vscode-editor-font-family, monospace); }
      .cmp.hidden { display: none; }
      table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px; }
      th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--forge-border); }
      th { color: var(--forge-muted); font-weight: 600; font-size: 11px; text-transform: uppercase; }
      .s-diff { color: var(--forge-orange); font-weight: 600; }
      .s-same { color: var(--forge-muted); }
      .s-only { color: var(--forge-link); }
      tr.clickable { cursor: pointer; } tr.clickable:hover td { background: var(--forge-sel); }
      .bar { position: sticky; bottom: 0; background: var(--forge-bg); padding: 12px 0 4px; margin-top: 12px; border-top: 1px solid var(--forge-border); display: flex; gap: 8px; flex-wrap: wrap; }
      #status { margin: 8px 0; min-height: 18px; }
      .busy { color: var(--forge-orange); } .err { color: var(--forge-err); }
      .link { background: none; border: none; color: var(--vscode-textLink-foreground); cursor: pointer; padding: 0; font-size: 12px; }
    </style></head><body>
      <h1>Org Compare</h1>
      <div class="sides">
        <div class="side"><label>Side A</label>${sideOptions('sideA', false)}</div>
        <div class="side"><label>Side B</label>${sideOptions('sideB', orgNames.length > 0)}</div>
        <button class="accent" id="compareBtn">Compare</button>
      </div>

      <label>Components (${components.length})</label>
      <div class="filter"><input type="text" id="filter" placeholder="Filter by name or type…" style="width:100%"></div>
      <div class="row" style="margin-bottom:6px">
        <button class="secondary" id="selAll">Select all shown</button>
        <button class="secondary" id="selNone">Clear</button>
      </div>
      <div class="cmplist" id="cmplist">${compRows}</div>

      <div id="status"></div>
      <div id="results"></div>

      <div class="bar" id="syncbar" style="display:none">
        <span class="grow"></span>
        <button class="secondary" id="ab_diff">Sync A→B (differing)</button>
        <button class="secondary" id="ab_all">Sync A→B (all)</button>
        <button class="secondary" id="ba_diff">Sync B→A (differing)</button>
        <button class="secondary" id="ba_all">Sync B→A (all)</button>
      </div>

      <script>
        const vscode = acquireVsCodeApi();
        const $ = (id) => document.getElementById(id);
        let rows = [], aLabel = 'A', bLabel = 'B';

        function checkedNames() {
          return [...document.querySelectorAll('#cmplist input:checked')].map(c => ({ type: c.dataset.type, name: c.dataset.name }));
        }
        $('compareBtn').onclick = () => {
          vscode.postMessage({ command: 'compare', a: $('sideA').value, b: $('sideB').value, names: checkedNames() });
        };
        $('filter').oninput = () => {
          const q = $('filter').value.toLowerCase();
          document.querySelectorAll('#cmplist .cmp').forEach(l => {
            const t = (l.querySelector('.nm').textContent + ' ' + l.querySelector('.kind').textContent).toLowerCase();
            l.classList.toggle('hidden', q && !t.includes(q));
          });
        };
        $('selAll').onclick = () => document.querySelectorAll('#cmplist .cmp:not(.hidden) input').forEach(c => c.checked = true);
        $('selNone').onclick = () => document.querySelectorAll('#cmplist input').forEach(c => c.checked = false);

        $('ab_diff').onclick = () => vscode.postMessage({ command:'sync', direction:'ab', scope:'differing' });
        $('ab_all').onclick  = () => vscode.postMessage({ command:'sync', direction:'ab', scope:'all' });
        $('ba_diff').onclick = () => vscode.postMessage({ command:'sync', direction:'ba', scope:'differing' });
        $('ba_all').onclick  = () => vscode.postMessage({ command:'sync', direction:'ba', scope:'all' });

        function statusCell(s) {
          if (s === 'differs') return '<span class="s-diff">⬤ differs</span>';
          if (s === 'identical') return '<span class="s-same">◯ identical</span>';
          if (s === 'onlyA') return '<span class="s-only">only in '+esc(aLabel)+'</span>';
          if (s === 'onlyB') return '<span class="s-only">only in '+esc(bLabel)+'</span>';
          return s;
        }
        function renderResults() {
          if (!rows.length) { $('results').innerHTML = ''; $('syncbar').style.display='none'; return; }
          const diff = rows.filter(r=>r.status==='differs').length;
          const only = rows.filter(r=>r.status==='onlyA'||r.status==='onlyB').length;
          const same = rows.length - diff - only;
          let h = '<div class="muted" style="margin:8px 0">'+diff+' differ · '+only+' only-one-side · '+same+' identical — click a row to open its diff</div>';
          h += '<table><thead><tr><th>Status</th><th>Type</th><th>Component</th><th></th></tr></thead><tbody>';
          rows.forEach((r,i) => {
            const clickable = (r.status==='differs') ? 'clickable' : '';
            const open = (r.status==='differs') ? '<button class="link" data-i="'+i+'">open diff</button>' : '';
            h += '<tr class="'+clickable+'" data-i="'+i+'"><td>'+statusCell(r.status)+'</td><td class="kind">'+esc(r.type)+'</td><td class="nm">'+esc(r.fullName)+'</td><td>'+open+'</td></tr>';
          });
          h += '</tbody></table>';
          $('results').innerHTML = h;
          $('syncbar').style.display = 'flex';
          document.querySelectorAll('#results tr.clickable').forEach(tr => tr.onclick = () => vscode.postMessage({ command:'openDiff', index:Number(tr.dataset.i) }));
          document.querySelectorAll('#results .link').forEach(b => b.onclick = (e) => { e.stopPropagation(); vscode.postMessage({ command:'openDiff', index:Number(b.dataset.i) }); });
        }

        window.addEventListener('message', (e) => {
          const m = e.data;
          if (m.type === 'busy') { $('status').innerHTML = m.on ? '<span class="busy">'+esc(m.label||'Working…')+'</span>' : ''; setDisabled(m.on); return; }
          if (m.type === 'error') { $('status').innerHTML = '<span class="err">❌ '+esc(m.message)+'</span>'; return; }
          if (m.type === 'result') { rows = m.rows; aLabel = m.aLabel; bLabel = m.bLabel; renderResults(); return; }
          if (m.type === 'synced') { $('status').innerHTML = esc(m.message); return; }
        });
        function setDisabled(on){ ['compareBtn','ab_diff','ab_all','ba_diff','ba_all'].forEach(id => $(id).disabled = on); }
        function esc(s){ const d=document.createElement('div'); d.textContent=s==null?'':s; return d.innerHTML; }
      </script>
    </body></html>`;
  }
}

/** Parses a side value from the webview ('local' or 'org:<name>'). */
function parseSide(v: string): CompareSide {
  return v === 'local' ? { kind: 'local' } : { kind: 'org', org: v.replace(/^org:/, '') };
}

/** Two sides are the same when both local, or both the same org. */
function sameSide(a: CompareSide, b: CompareSide): boolean {
  if (a.kind === 'local' && b.kind === 'local') {
    return true;
  }
  return a.kind === 'org' && b.kind === 'org' && a.org === b.org;
}

/** Resolves checkbox {type,name} pairs back to their ComponentRefs. */
function pickComponents(all: ComponentRef[], names: Array<{ type: string; name: string }>): ComponentRef[] {
  const want = new Set(names.map((n) => `${n.type}:${n.name}`));
  return all.filter((c) => want.has(`${c.type}:${c.fullName}`));
}

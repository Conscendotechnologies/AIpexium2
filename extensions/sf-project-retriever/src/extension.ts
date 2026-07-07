/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getForge } from './forge';
import type { SiidForgeApi, TypeDiffGroup, TypeDiffRow } from './siid-forge';

/** Display label -> metadata API name(s). */
const METADATA_MAPPING: { [key: string]: string | string[] } = {
  'Apex Classes': 'ApexClass',
  'Triggers': 'ApexTrigger',
  'Assignment Rules': 'AssignmentRules',
  'Aura Components': 'AuraDefinitionBundle',
  'LWC': 'LightningComponentBundle',
  'Objects': 'CustomObject',
  'Tabs': 'CustomTab',
  'Paths': 'BusinessProcess',
  'Permission Sets': 'PermissionSet',
  'Permission Set Groups': 'PermissionSetGroup',
  'Profiles': 'Profile',
  'Queues': 'Queue',
  'Reports': 'Report',
  'Sharing Rules': 'SharingRules',
  'Static Resources': 'StaticResource',
  'Visualforce Pages': 'ApexPage',
  'Layouts': 'Layout',
  'Sites': 'customSite',
  'Flows': 'Flow',
  'Email Templates': 'EmailTemplate',
  'Agentforce Agents': ['GenAiFunction', 'GenAiPlugin', 'GenAiPlannerBundle', 'Bot']
};

const METADATA_OPTIONS = Object.keys(METADATA_MAPPING);

let statusBarButton: vscode.StatusBarItem;

export async function activate(context: vscode.ExtensionContext) {
  console.log('SF Project Retriever extension activated');

  statusBarButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarButton.command = 'sf-project-retriever.openRetriever';
  statusBarButton.text = '$(cloud-download) Retrieve from Org';
  statusBarButton.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  statusBarButton.tooltip = 'Retrieve metadata from the default org (with diff)';
  statusBarButton.show();
  context.subscriptions.push(statusBarButton);

  context.subscriptions.push(
    vscode.commands.registerCommand('sf-project-retriever.openRetriever', async () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        vscode.window.showErrorMessage('No workspace folder opened.');
        return;
      }
      const forge = await getForge();
      if (!forge) {
        return;
      }
      const org = await forge.orgs.getDefault();
      if (!org) {
        vscode.window.showErrorMessage('⚠️ No default org set. Select a default org first.');
        return;
      }
      await openRetrieveModal(folder, forge);
    })
  );
}

/** Opens the metadata-type picker webview. */
async function openRetrieveModal(folder: vscode.WorkspaceFolder, forge: SiidForgeApi) {
  const panel = vscode.window.createWebviewPanel(
    'retrieveModal',
    'Select Metadata to Retrieve',
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: false }
  );

  const lastRetrievedMetadata = getLastRetrievedMetadata(folder.uri.fsPath);
  panel.webview.html = renderPickerHtml(lastRetrievedMetadata);
  panel.onDidDispose(() => {
    // Release the temp org files backing the diff editors before dropping state.
    if (reviewState) {
      forge.diff.dispose(reviewState.groups);
      reviewState = undefined;
    }
  });

  // One handler for the panel's whole lifecycle (picker → review). Review state
  // (the last diff groups) is stashed in `reviewState` so row actions resolve.
  panel.webview.onDidReceiveMessage(async (msg) => {
    switch (msg.command) {
      case 'cancel':
      case 'close':
        panel.dispose();
        return;
      case 'diff': {
        const labels: string[] = msg.selected ?? [];
        saveLastRetrievedMetadata(folder.uri.fsPath, labels);
        await runDiffAndReview(folder, forge, labels, panel);
        return;
      }
      case 'openDiff':
        await openRowDiff(msg.type, msg.fullName);
        return;
      case 'applyAll':
        if (reviewState) {
          const conflicts = collectByStatus(reviewState.groups, ['changed']);
          if (conflicts.length) {
            const ok = await vscode.window.showWarningMessage(
              `Overwrite ${conflicts.length} locally-modified component(s) with the org version? This replaces your local changes.`,
              { modal: true },
              'Take all from org'
            );
            if (ok !== 'Take all from org') {
              return;
            }
          }
          await applyRows(folder, forge, panel, collectByStatus(reviewState.groups, ['new-in-org', 'changed']));
        }
        return;
      case 'applyAllNew':
        if (reviewState) {
          await applyRows(folder, forge, panel, collectByStatus(reviewState.groups, ['new-in-org']));
        }
        return;
      case 'applyRow':
        await applyRows(folder, forge, panel, [{ type: msg.type, fullName: msg.fullName }]);
        return;
    }
  });
}

/** Metadata API names for a set of display labels. */
function apiNamesFor(labels: string[]): string[] {
  const names = new Set<string>();
  for (const label of labels) {
    const api = METADATA_MAPPING[label];
    if (Array.isArray(api)) {
      api.forEach((n) => names.add(n));
    } else if (api) {
      names.add(api);
    }
  }
  return [...names];
}

/**
 * Handles the "Retrieve" click. Splits the selected types:
 * - **Retrieve-only** types (Objects, Reports, Sites, …) are pulled DIRECTLY and
 *   wholesale (`--metadata <Type>`, one arg) — no member list, no diff. Listing
 *   their members would overflow the command line and isn't useful (they can't be
 *   content-diffed anyway).
 * - **Diffable** types (Apex, LWC, Tabs, Layouts, …) go through the compare +
 *   review panel as before.
 *
 * If only retrieve-only types were selected, we retrieve them and close.
 */
async function runDiffAndReview(
  folder: vscode.WorkspaceFolder,
  forge: SiidForgeApi,
  labels: string[],
  panel: vscode.WebviewPanel
) {
  const cwd = folder.uri.fsPath;
  const types = apiNamesFor(labels);
  if (!types.length) {
    return;
  }

  const diffable = types.filter((t) => forge.diff.isDiffable(t));
  const retrieveOnly = types.filter((t) => !forge.diff.isDiffable(t));

  panel.webview.postMessage({ command: 'status', state: 'diffing' });

  try {
    // 1. Retrieve-only types: pull wholesale up front (one --metadata arg each).
    if (retrieveOnly.length) {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `SF Retriever: retrieving ${retrieveOnly.join(', ')}…`, cancellable: true },
        (_p, token) => forge.diff.retrieveTypes(retrieveOnly, { projectRoot: cwd, token, onStatus: panelStatus(panel, `Retrieving ${retrieveOnly.join(', ')}`) })
      );
      vscode.window.showInformationMessage(`✅ Retrieved ${retrieveOnly.join(', ')} from org.`);
    }

    // 2. Diffable types: compare + open the review panel.
    if (!diffable.length) {
      // Nothing to review — the retrieve-only work is done.
      panel.dispose();
      return;
    }

    // Live per-type label: `onType` updates which type is in flight + progress,
    // and the shared holder feeds that label into every `onStatus` heartbeat so
    // the panel reads "Comparing LWC (3 of 7)…" instead of a static line.
    const label = { text: 'Comparing with org' };
    const groups = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'SF Retriever: comparing org against local…', cancellable: true },
      (_p, token) => forge.diff.byMetadataTypes(diffable, {
        projectRoot: cwd,
        token,
        onType: ({ type, index, total }) => { label.text = `Comparing ${displayLabelFor(type)} (${index + 1} of ${total})`; },
        onStatus: panelStatus(panel, label)
      })
    );

    // Release any prior diff's temp files before replacing the stashed groups.
    if (reviewState) {
      forge.diff.dispose(reviewState.groups);
    }
    reviewState = { cwd, groups };
    panel.webview.html = renderReviewHtml(groups);
  } catch (err: any) {
    panel.webview.postMessage({ command: 'status', state: 'error', message: err?.message ?? 'Retrieve failed' });
    vscode.window.showErrorMessage(`❌ ${err?.message ?? 'Retrieve failed'}`);
  }
}

/** In-flight review state (single active panel at a time). */
let reviewState: { cwd: string; groups: TypeDiffGroup[] } | undefined;

interface RowId { type: string; fullName: string; }

/** All rows across groups whose status is in `statuses`. */
function collectByStatus(groups: TypeDiffGroup[], statuses: TypeDiffRow['status'][]): RowId[] {
  const out: RowId[] = [];
  for (const g of groups) {
    for (const r of g.rows) {
      if (statuses.includes(r.status)) {
        out.push({ type: g.type, fullName: r.fullName });
      }
    }
  }
  return out;
}

/** Opens a VS Code diff (org ← → local) for one row, from the stashed diff paths. */
async function openRowDiff(type: string, fullName: string) {
  const row = findRow(type, fullName);
  if (!row) {
    return;
  }
  if (row.orgPath && row.localPath) {
    await vscode.commands.executeCommand(
      'vscode.diff',
      vscode.Uri.file(row.orgPath),
      vscode.Uri.file(row.localPath),
      `${fullName} (Org ↔ Local)`
    );
  } else if (row.localPath) {
    await vscode.window.showTextDocument(vscode.Uri.file(row.localPath));
  } else if (row.orgPath) {
    await vscode.window.showTextDocument(vscode.Uri.file(row.orgPath));
  }
}

function findRow(type: string, fullName: string): TypeDiffRow | undefined {
  return reviewState?.groups.find((g) => g.type === type)?.rows.find((r) => r.fullName === fullName);
}

/**
 * Builds an `onStatus` callback that streams Forge's `sf` lifecycle into the
 * webview status line (running / elapsed / done). Panel-only — Forge shows its
 * own status-bar indicator, so we don't duplicate that here.
 */
function panelStatus(
  panel: vscode.WebviewPanel,
  label: string | { text: string }
): (s: { phase: string; elapsedMs: number; message?: string }) => void {
  // A `{text}` holder lets a caller mutate the label between heartbeats (e.g.
  // `onType` advancing "Comparing LWC (3 of 7)…"); a plain string is read once.
  return (s) => {
    const secs = Math.round(s.elapsedMs / 1000);
    const text = typeof label === 'string' ? label : label.text;
    panel.webview.postMessage({ command: 'run', phase: s.phase, secs, label: text, message: s.message });
  };
}

/** Metadata API name -> friendly display label (reverse of METADATA_MAPPING). */
function displayLabelFor(apiName: string): string {
  for (const [display, api] of Object.entries(METADATA_MAPPING)) {
    if (Array.isArray(api) ? api.includes(apiName) : api === apiName) {
      return display;
    }
  }
  return apiName; // unmapped — show the raw API name rather than nothing
}

/**
 * Applies picked components into the project (overwriting local) by COPYING from
 * the diff's already-retrieved org tree — no second org round-trip (the compare
 * step paid it). Forge falls back to a fresh orphan-immune retrieve only for
 * anything not in a live tree.
 */
async function applyRows(
  folder: vscode.WorkspaceFolder,
  forge: SiidForgeApi,
  panel: vscode.WebviewPanel,
  rows: RowId[]
) {
  if (!rows.length || !reviewState) {
    return;
  }
  const cwd = folder.uri.fsPath;
  const groups = reviewState.groups;
  panel.webview.postMessage({ command: 'status', state: 'applying' });
  try {
    const res = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `SF Retriever: applying ${rows.length} component(s)…`, cancellable: true },
      (_p, token) => forge.diff.applyFromDiff(groups, rows, { projectRoot: cwd, token, onStatus: panelStatus(panel, `Applying ${rows.length} component(s)`) })
    );
    for (const r of res.applied) {
      panel.webview.postMessage({ command: 'applied', type: r.type, fullName: r.fullName });
    }
    if (res.missing.length) {
      vscode.window.showWarningMessage(`⚠️ ${res.missing.length} not found in org: ${res.missing.map((m) => m.fullName).join(', ')}`);
    }
    vscode.window.showInformationMessage(`✅ Retrieved ${res.applied.length} component(s) from org.`);
  } catch (err: any) {
    panel.webview.postMessage({ command: 'status', state: 'error', message: err?.message ?? 'Retrieve failed' });
    vscode.window.showErrorMessage(`❌ Retrieve failed: ${err?.message ?? 'Unknown error'}`);
  }
}

// ─────────────────────────────── Webview HTML ───────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

const BASE_STYLES = `
  body { font-family: 'Segoe UI', sans-serif; margin: 0; padding: 20px; background: #1e1e1e; color: #fff; }
  .container { max-width: 900px; margin: 0 auto; }
  h1 { color: #a874e3; font-size: 1.3em; font-weight: 600; margin-bottom: 16px; text-align: center; }
  button { padding: 8px 16px; border: none; border-radius: 6px; font-size: 13px; cursor: pointer; font-weight: 500; transition: all .15s; }
  .accent { background: #432264; color: #fff; }
  .accent:hover:not(:disabled) { background: #5c3791; }
  .secondary { background: #3c3c3c; color: #fff; }
  .secondary:hover { background: #4c4c4c; }
  button:disabled { opacity: .5; cursor: not-allowed; }
  .bar { display: flex; gap: 10px; justify-content: center; margin: 14px 0; }
  #status { margin-top: 14px; text-align: center; font-size: 13px; min-height: 18px; }
`;

function renderPickerHtml(preselected: string[]): string {
  const checkboxes = METADATA_OPTIONS.map((option) => {
    const checked = preselected.includes(option) ? 'checked' : '';
    return `<label class="item"><input type="checkbox" value="${escapeHtml(option)}" ${checked}><span>${escapeHtml(option)}</span></label>`;
  }).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${BASE_STYLES}
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; background: #2a2a2a; border: 1px solid rgba(255,255,255,.1); border-radius: 6px; padding: 20px; margin: 12px 0; }
    .item { display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 14px; }
    .item input { width: 16px; height: 16px; accent-color: #a874e3; }
  </style></head><body><div class="container">
    <h1>Select Metadata to Retrieve</h1>
    <div class="bar"><button class="secondary" id="toggle">Select All</button></div>
    <div class="grid">${checkboxes}</div>
    <div class="bar">
      <button class="accent" id="diffBtn">Retrieve</button>
      <button class="secondary" id="cancelBtn">Cancel</button>
    </div>
    <div id="status"></div>
  </div><script>
    const vscode = acquireVsCodeApi();
    const boxes = Array.from(document.querySelectorAll('input[type=checkbox]'));
    const status = document.getElementById('status');
    const toggle = document.getElementById('toggle');
    toggle.addEventListener('click', () => {
      const all = boxes.every(b => b.checked);
      boxes.forEach(b => b.checked = !all);
      toggle.textContent = all ? 'Select All' : 'Deselect All';
    });
    document.getElementById('diffBtn').addEventListener('click', () => {
      const selected = boxes.filter(b => b.checked).map(b => b.value);
      if (!selected.length) { status.textContent = 'Select at least one type.'; return; }
      vscode.postMessage({ command: 'diff', selected });
    });
    document.getElementById('cancelBtn').addEventListener('click', () => vscode.postMessage({ command: 'cancel' }));
    window.addEventListener('message', e => {
      const m = e.data;
      if (m.command === 'status' && m.state === 'diffing') { status.textContent = '⏳ Comparing with org…'; }
      else if (m.command === 'status' && m.state === 'error') { status.textContent = '❌ ' + (m.message || 'Failed'); }
      else if (m.command === 'run') {
        if (m.phase === 'running') status.textContent = '⏳ ' + m.label + '… ' + m.secs + 's';
        else if (m.phase === 'started') status.textContent = '⏳ ' + m.label + '…';
        else if (m.phase === 'failed') status.textContent = '❌ ' + (m.message || 'Failed');
      }
    });
  </script></body></html>`;
}

const STATUS_META: Record<TypeDiffRow['status'], { label: string; color: string }> = {
  'changed': { label: 'Conflict — local differs', color: '#e5a04b' },
  'new-in-org': { label: 'New in org', color: '#6ab04c' },
  'only-local': { label: 'Only local', color: '#7a7a7a' },
  'identical': { label: 'Identical', color: '#4a4a4a' },
  'retrieved-not-compared': { label: 'Not compared', color: '#5a7fa0' }
};

function renderReviewHtml(groups: TypeDiffGroup[]): string {
  const newCount = collectByStatus(groups, ['new-in-org']).length;
  const conflictCount = collectByStatus(groups, ['changed']).length;
  const allCount = newCount + conflictCount;

  const sections = groups.map((g) => {
    // Show actionable rows first; hide identical to keep the review focused.
    const rows = g.rows.filter((r) => r.status !== 'identical');
    if (!rows.length) {
      return '';
    }
    const rowsHtml = rows.map((r) => {
      const meta = STATUS_META[r.status];
      const canDiff = r.status === 'changed' || (!!r.orgPath && !!r.localPath);
      const conflict = r.status === 'changed';
      const rowId = `${escapeHtml(g.type)}||${escapeHtml(r.fullName)}`;
      const actionable = r.status === 'changed' || r.status === 'new-in-org';
      const actions = [
        canDiff ? `<button class="secondary sm" data-act="openDiff" data-id="${rowId}">Diff</button>` : '',
        conflict ? `<button class="accent sm" data-act="applyRow" data-id="${rowId}">Take org</button>` : ''
      ].join('');
      return `<div class="row"${actionable ? ' data-actionable="1"' : ''} data-rowkey="${rowId}">
        <span class="dot" style="background:${meta.color}"></span>
        <span class="name">${escapeHtml(r.fullName)}</span>
        <span class="tag" style="color:${meta.color}">${meta.label}</span>
        <span class="acts">${actions}</span>
      </div>`;
    }).join('');
    return `<div class="group"><div class="ghead">${escapeHtml(g.type)}</div>${rowsHtml}</div>`;
  }).join('');

  const topBar = [
    allCount ? `<button class="accent" id="applyAll">Take all ${allCount} from org${conflictCount ? ` (incl. ${conflictCount} conflict${conflictCount > 1 ? 's' : ''})` : ''}</button>` : '',
    newCount && conflictCount ? `<button class="secondary" id="applyAllNew">Retrieve ${newCount} new only</button>` : '',
    `<button class="secondary" id="closeBtn">Close</button>`
  ].join('');

  const empty = !sections.trim() ? `<div class="muted" style="text-align:center;margin:30px 0">Local is up to date with the org for the selected types. 🎉</div>` : '';

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${BASE_STYLES}
    .group { background: #2a2a2a; border: 1px solid rgba(255,255,255,.1); border-radius: 6px; margin: 12px 0; overflow: hidden; }
    .ghead { background: #332a42; padding: 8px 14px; font-weight: 600; }
    .row { display: flex; align-items: center; gap: 10px; padding: 7px 14px; border-top: 1px solid rgba(255,255,255,.05); }
    .row.done { opacity: .5; }
    .dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
    .name { font-family: monospace; font-size: 13px; }
    .tag { font-size: 12px; margin-left: 4px; }
    .acts { margin-left: auto; display: flex; gap: 6px; }
    .sm { padding: 3px 10px; font-size: 12px; }
    .muted { color: #999; font-weight: 400; font-size: 12px; }
    .legend { text-align: center; font-size: 12px; color: #aaa; margin-bottom: 8px; }
  </style></head><body><div class="container">
    <h1>Review Org ↔ Local Changes</h1>
    <div class="legend">New-in-org is safe to pull. Conflicts (local differs) are per-file — diff, then take org.</div>
    <div class="bar">${topBar}</div>
    ${empty}
    ${sections}
    <div id="status"></div>
  </div><script>
    const vscode = acquireVsCodeApi();
    const status = document.getElementById('status');
    function parseId(id) { const i = id.split('||'); return { type: i[0], fullName: i[1] }; }
    function refreshBulkButtons() {
      const remaining = document.querySelectorAll('.row[data-actionable]:not(.done)').length;
      if (remaining > 0) return;
      const applyAll = document.getElementById('applyAll');
      if (applyAll) { applyAll.textContent = '✓ All retrieved'; applyAll.disabled = true; applyAll.classList.remove('accent'); applyAll.classList.add('secondary'); }
      const applyAllNew = document.getElementById('applyAllNew');
      if (applyAllNew) applyAllNew.disabled = true;
    }
    document.body.addEventListener('click', e => {
      const btn = e.target.closest('button'); if (!btn) return;
      if (btn.id === 'applyAll') vscode.postMessage({ command: 'applyAll' });
      else if (btn.id === 'applyAllNew') vscode.postMessage({ command: 'applyAllNew' });
      else if (btn.id === 'closeBtn') vscode.postMessage({ command: 'close' });
      else if (btn.dataset.act) { const { type, fullName } = parseId(btn.dataset.id); vscode.postMessage({ command: btn.dataset.act, type, fullName }); }
    });
    window.addEventListener('message', e => {
      const m = e.data;
      if (m.command === 'status') {
        if (m.state === 'applying') status.textContent = '⏳ Retrieving…';
        else if (m.state === 'error') status.textContent = '❌ ' + (m.message || 'Failed');
      } else if (m.command === 'run') {
        if (m.phase === 'started') status.textContent = '⏳ ' + m.label + '…';
        else if (m.phase === 'running') status.textContent = '⏳ ' + m.label + '… ' + m.secs + 's';
        else if (m.phase === 'succeeded') status.textContent = '✅ ' + m.label + ' (' + m.secs + 's)';
        else if (m.phase === 'failed') status.textContent = '❌ ' + (m.message || m.label + ' failed');
        else if (m.phase === 'cancelled') status.textContent = '⊘ Cancelled';
      } else if (m.command === 'applied') {
        const key = m.type + '||' + m.fullName;
        const row = document.querySelector('[data-rowkey="' + CSS.escape(key) + '"]');
        if (row) { row.classList.add('done'); row.querySelector('.acts').innerHTML = '✓ retrieved'; }
        status.textContent = '';
        refreshBulkButtons();
      } else if (m.command === 'appliedTypes') {
        status.textContent = '✅ Retrieved ' + m.types.join(', ');
      }
    });
  </script></body></html>`;
}

// ─────────────────────── Last-selection persistence ─────────────────────────

function getLastRetrievedMetadata(workspaceFolder: string): string[] {
  try {
    const storagePath = path.join(workspaceFolder, '.siid', 'sf-retriever-metadata.json');
    if (fs.existsSync(storagePath)) {
      const data = JSON.parse(fs.readFileSync(storagePath, 'utf-8'));
      return data.lastRetrieved || [];
    }
  } catch {
    /* no previous selection */
  }
  return [];
}

function saveLastRetrievedMetadata(workspaceFolder: string, metadata: string[]): void {
  try {
    const siidDir = path.join(workspaceFolder, '.siid');
    if (!fs.existsSync(siidDir)) {
      fs.mkdirSync(siidDir, { recursive: true });
    }
    const storagePath = path.join(siidDir, 'sf-retriever-metadata.json');
    fs.writeFileSync(storagePath, JSON.stringify({ lastRetrieved: metadata, lastRetrievalTime: new Date().toISOString() }, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving metadata selection:', err);
  }
}

export function deactivate() { /* nothing to clean up */ }

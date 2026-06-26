/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { Commands } from '../commands';
import { getWorkspaceCwd } from '../core/workspace';
import { SfExecutor } from '../core/sfExecutor';
import { findDependencies, DependencyRef } from '../core/dependencyFinder';
import { probeField, FieldFacts } from '../core/describeProbe';
import { findOrgRefs, OrgRefResult } from '../core/orgDeps';
import { escapeHtml, FORGE_STYLES } from '../ui/webview';
import { Feature } from './types';

/**
 * Field / Object Impact & Usage report — a self-contained webview. The search
 * form (object + field) lives IN the panel; submitting runs the analysis and
 * renders the result without leaving the webview. Combines:
 *  - FACTS: live org describe via anonymous Apex (`describeProbe`)
 *  - LOCAL: typed references across the project (`dependencyFinder`)
 *  - ORG:   Dependency API refs (`orgDeps`) + optional Flow XML scan (`flowScan`)
 *
 * Data services are headless/agent-consumable; this is the UI wrapper.
 */
export const registerFieldImpact: Feature = ({ context, sf, logger }) => {
  context.subscriptions.push(
    vscode.commands.registerCommand(Commands.fieldImpact, () => {
      const cwd = getWorkspaceCwd();
      if (!cwd) {
        return;
      }

      const panel = vscode.window.createWebviewPanel(
        'siidForgeImpact',
        'Field / Object Impact',
        // Open beside the editor so opening a reference doesn't replace the panel.
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          // Keep the DOM (analyzed results) alive when the panel is hidden, so
          // switching editor tabs / opening a reference doesn't wipe the report.
          retainContextWhenHidden: true
        }
      );
      panel.webview.html = shellHtml();

      panel.webview.onDidReceiveMessage(async (msg) => {
        if (msg?.command === 'open' && typeof msg.file === 'string') {
          await openRef(msg.file, msg.line, msg.column);
          return;
        }
        if (msg?.command === 'openOrg') {
          await openOrgComponent(sf, cwd, String(msg.refType ?? ''), String(msg.id ?? ''), logger);
          return;
        }
        if (msg?.command === 'analyze') {
          const object = String(msg.object ?? '').trim();
          const field = String(msg.field ?? '').trim();
          if (!object || !field) {
            return;
          }
          panel.title = `Impact: ${object}.${field}`;
          panel.webview.postMessage({ command: 'status', text: '⏳ Analyzing…' });

          try {
            const local = findDependencies(cwd, { name: field, symbol: 'field', object });
            const facts = await probeField(sf, object, field, cwd);
            const org = await findOrgRefs(sf, field, object, cwd);
            panel.webview.postMessage({ command: 'result', html: reportHtml(object, field, facts, local, org) });
          } catch (err: any) {
            logger.error(err.message);
            panel.webview.postMessage({ command: 'result', html: `<div class="err">❌ ${escapeHtml(err.message)}</div>` });
          }
        }
      });
    })
  );
};

/** Opens an org component in the browser (Flow → Flow Builder; else by Id). */
async function openOrgComponent(sf: SfExecutor, cwd: string, refType: string, id: string, logger: { error(m: string): void }): Promise<void> {
  if (!id) {
    vscode.window.showInformationMessage('SIID Forge: no org Id available to open this component.');
    return;
  }
  const path = refType === 'Flow'
    ? `/builder_platform_interaction/flowBuilder.app?flowId=${id}`
    : `/${id}`;
  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'SIID Forge: opening in org…' },
      () => sf.run(['org', 'open', '--path', path], { cwd })
    );
  } catch (err: any) {
    logger.error(err.message);
    vscode.window.showErrorMessage(`❌ Could not open in org: ${err.message}`);
  }
}

async function openRef(file: string, line?: number, column?: number): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
  if (typeof line === 'number' && line >= 0) {
    const pos = new vscode.Position(line, Math.max(0, column ?? 0));
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
  }
}

/** The persistent panel shell: search form + results container. */
function shellHtml(): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${FORGE_STYLES}
    .form { display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap; margin-bottom: 8px; }
    .form input[type=text] { min-width: 200px; }
    .ref { cursor: pointer; }
    .orgref { cursor: pointer; }
    .orgref:hover { background: var(--forge-sel); border-color: var(--forge-purple); color: var(--vscode-list-activeSelectionForeground, #fff); }
    #status { margin: 8px 0; font-size: 13px; color: var(--forge-muted); }
  </style></head>
  <body>
    <h1>Field / Object Impact</h1>
    <div class="muted">Find everywhere a field is used — live org facts, local source, and org components.</div>
    <div class="form">
      <div class="field"><label>Object API name</label><input type="text" id="object" placeholder="e.g. Account" /></div>
      <div class="field"><label>Field API name</label><input type="text" id="field" placeholder="e.g. Industry or My_Field__c" /></div>
      <button class="accent" id="go">Analyze</button>
    </div>
    <div id="status"></div>
    <div id="results"></div>
    <script>
      const vscode = acquireVsCodeApi();
      const $ = (id) => document.getElementById(id);
      function analyze() {
        const object = $('object').value.trim();
        const field = $('field').value.trim();
        if (!object || !field) { $('status').textContent = 'Enter both object and field.'; return; }
        vscode.postMessage({ command: 'analyze', object, field });
      }
      $('go').addEventListener('click', analyze);
      ['object','field'].forEach(id => $(id).addEventListener('keydown', e => { if (e.key === 'Enter') analyze(); }));

      window.addEventListener('message', (e) => {
        const m = e.data;
        if (m.command === 'status') { $('status').textContent = m.text; }
        else if (m.command === 'result') {
          $('status').textContent = ''; $('results').innerHTML = m.html; bindRefs();
          // Persist so a hard reload (not just hide) restores the last report.
          vscode.setState({ object: $('object').value, field: $('field').value, html: m.html });
        }
      });
      function bindRefs() {
        document.querySelectorAll('tr.ref').forEach((row) => {
          row.addEventListener('click', () => vscode.postMessage({
            command: 'open', file: row.dataset.file, line: Number(row.dataset.line), column: Number(row.dataset.column)
          }));
        });
        document.querySelectorAll('.orgref').forEach((chip) => {
          chip.addEventListener('click', () => vscode.postMessage({
            command: 'openOrg', refType: chip.dataset.reftype, id: chip.dataset.id
          }));
        });
      }
      // Restore last report on reload.
      const prev = vscode.getState();
      if (prev && prev.html) {
        $('object').value = prev.object || '';
        $('field').value = prev.field || '';
        $('results').innerHTML = prev.html;
        bindRefs();
      } else {
        $('object').focus();
      }
    </script>
  </body></html>`;
}

function reportHtml(
  object: string,
  field: string,
  facts: FieldFacts,
  local: DependencyRef[],
  org: OrgRefResult
): string {
  return `
    <h1 style="font-size:1.05em; margin-top:6px">${escapeHtml(object)}.${escapeHtml(field)}</h1>
    ${factsSection(facts)}
    ${localSection(local)}
    ${orgSection(org)}
  `;
}

function factsSection(f: FieldFacts): string {
  if (f.error && !f.exists) {
    return `<div class="section"><h1 style="font-size:1em">Facts</h1><div class="err">❌ ${escapeHtml(f.error)}</div></div>`;
  }
  const pills: string[] = [];
  if (f.type) { pills.push(pill('Type', f.type)); }
  pills.push(pill('Custom', f.custom ? 'yes' : 'no'));
  if (f.calculated) { pills.push(pill('Formula', 'yes')); }
  if (f.required) { pills.push(pill('Required', 'yes')); }
  if (f.unique) { pills.push(pill('Unique', 'yes')); }
  if (f.externalId) { pills.push(pill('External Id', 'yes')); }
  if (f.referenceTo?.length) { pills.push(pill('References', f.referenceTo.join(', '))); }
  if (typeof f.populated === 'number') { pills.push(pill('Populated', `${f.populated}${typeof f.totalRecords === 'number' ? ' / ' + f.totalRecords : ''}`)); }

  const picks = f.picklistValues?.length
    ? `<div style="margin-top:8px"><span class="muted">Picklist:</span> ${f.picklistValues.map((p) => `<span class="pill">${escapeHtml(p)}</span>`).join('')}</div>`
    : '';

  return `<div class="section">
    <h1 style="font-size:1em">Facts <span class="ok">(live org)</span></h1>
    <div><b>${escapeHtml(f.label ?? f.field)}</b> &nbsp; ${pills.join(' ')}</div>
    ${picks}
  </div>`;
}

function pill(k: string, v: string): string {
  return `<span class="pill"><span class="muted">${escapeHtml(k)}:</span> ${escapeHtml(v)}</span>`;
}

function localSection(local: DependencyRef[]): string {
  if (!local.length) {
    return `<div class="section"><h1 style="font-size:1em">Local references (0)</h1><div class="muted">No references found in project source.</div></div>`;
  }
  const rows = local.map((r) => {
    const rel = vscode.workspace.asRelativePath(r.filePath);
    const loc = r.line >= 0 ? `${r.line + 1}:${r.column + 1}` : '(file)';
    return `<tr class="ref" data-file="${escapeHtml(r.filePath)}" data-line="${r.line}" data-column="${r.column}">
      <td><code>${escapeHtml(rel)}</code></td><td>${escapeHtml(loc)}</td><td class="kind">${escapeHtml(r.kind)}</td>
    </tr>`;
  }).join('');
  return `<div class="section">
    <h1 style="font-size:1em">Local references (${local.length})</h1>
    <table><thead><tr><th>File</th><th>Line</th><th>Kind</th></tr></thead><tbody>${rows}</tbody></table>
  </div>`;
}

function orgSection(org: OrgRefResult): string {
  if (!org.available) {
    return `<div class="section"><h1 style="font-size:1em">Org references</h1>
      <div class="muted">Dependency API unavailable${org.message ? ` — ${escapeHtml(org.message)}` : ''}.</div></div>`;
  }
  if (!org.refs.length) {
    return `<div class="section"><h1 style="font-size:1em">Org references (0)</h1>
      <div class="muted">No org components reference this (per the Dependency API).</div></div>`;
  }
  const byType = new Map<string, OrgRefResult['refs']>();
  for (const r of org.refs) {
    (byType.get(r.type) ?? byType.set(r.type, []).get(r.type)!).push(r);
  }
  const groups = [...byType.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([type, refs]) => {
    const chips = refs.sort((a, b) => a.name.localeCompare(b.name)).map((r) => {
      // Components with an Id are clickable → open in org.
      if (r.id) {
        return `<span class="pill orgref" title="Open in org" data-reftype="${escapeHtml(r.type)}" data-id="${escapeHtml(r.id)}">$(link-external) ${escapeHtml(r.name)}</span>`
          .replace('$(link-external) ', '↗ ');
      }
      return `<span class="pill">${escapeHtml(r.name)}</span>`;
    }).join(' ');
    return `<tr><td><span class="kind">${escapeHtml(type)}</span></td><td>${chips}</td></tr>`;
  }).join('');
  return `<div class="section">
    <h1 style="font-size:1em">Org references (${org.refs.length}) <span class="ok">(live org)</span></h1>
    <div class="muted" style="margin-bottom:6px">Click a component to open it in the org.</div>
    <table><thead><tr><th>Type</th><th>Components</th></tr></thead><tbody>${groups}</tbody></table>
  </div>`;
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { Commands } from '../commands';
import { CancellationError } from '../core/sfExecutor';
import { Feature } from './types';
import { escapeHtml, FORGE_STYLES } from '../ui/webview';

/** Display label -> metadata API name(s). */
const METADATA_TYPES: Record<string, string[]> = {
  'Apex Classes': ['ApexClass'],
  'Apex Triggers': ['ApexTrigger'],
  'Aura Components': ['AuraDefinitionBundle'],
  'Lightning Web Components': ['LightningComponentBundle'],
  'Objects': ['CustomObject'],
  'Tabs': ['CustomTab'],
  'Permission Sets': ['PermissionSet'],
  'Permission Set Groups': ['PermissionSetGroup'],
  'Profiles': ['Profile'],
  'Flows': ['Flow'],
  'Static Resources': ['StaticResource'],
  'Visualforce Pages': ['ApexPage'],
  'Layouts': ['Layout'],
  'Reports': ['Report'],
  'Queues': ['Queue'],
  'Custom Labels': ['CustomLabels'],
  'Email Templates': ['EmailTemplate']
};

/**
 * Opens a webview to pick metadata types and retrieves them from the default
 * org via `sf project retrieve start --metadata <Type>`.
 */
export const registerRetrieveMetadata: Feature = ({ context, sf, logger }) => {
  context.subscriptions.push(
    vscode.commands.registerCommand(Commands.retrieveMetadata, () => {
      const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!cwd) {
        vscode.window.showErrorMessage('SIID Forge: open a Salesforce project folder first.');
        return;
      }

      const panel = vscode.window.createWebviewPanel(
        'siidForgeRetrieve',
        'Retrieve Metadata',
        vscode.ViewColumn.Active,
        { enableScripts: true }
      );
      panel.webview.html = renderHtml();

      panel.webview.onDidReceiveMessage(async (msg) => {
        if (msg?.command !== 'retrieve') {
          return;
        }
        const labels: string[] = msg.selected ?? [];
        const metadataArgs = labels.flatMap((label) => METADATA_TYPES[label] ?? []);
        if (!metadataArgs.length) {
          return;
        }

        const args = ['project', 'retrieve', 'start'];
        for (const m of metadataArgs) {
          args.push('--metadata', m);
        }

        panel.webview.postMessage({ command: 'status', state: 'running' });
        try {
          await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'SIID Forge: retrieving metadata…', cancellable: true },
            (_progress, token) => sf.run(args, { cwd, token })
          );
          panel.webview.postMessage({ command: 'status', state: 'success' });
          vscode.window.showInformationMessage(`✅ Retrieved ${metadataArgs.length} metadata type(s).`);
        } catch (err: any) {
          if (err instanceof CancellationError) {
            panel.webview.postMessage({ command: 'status', state: 'error', message: 'Cancelled.' });
            vscode.window.showInformationMessage('Retrieve cancelled.');
            return;
          }
          logger.error(err.message);
          panel.webview.postMessage({ command: 'status', state: 'error', message: err.message });
          vscode.window.showErrorMessage(`❌ Retrieve failed: ${err.message}`);
        }
      });
    })
  );
};

function renderHtml(): string {
  const checkboxes = Object.keys(METADATA_TYPES)
    .map(
      (label) => `
        <label class="item">
          <input type="checkbox" value="${escapeHtml(label)}" />
          <span>${escapeHtml(label)}</span>
        </label>`
    )
    .join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${FORGE_STYLES}
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; margin: 12px 0; }
    .item { display: flex; align-items: center; gap: 8px; cursor: pointer; }
    .item input { width: 16px; height: 16px; accent-color: #a874e3; }
    .bar { display: flex; gap: 10px; margin-top: 12px; }
    #status { margin-top: 14px; font-size: 13px; }
  </style></head>
  <body>
    <h1>Retrieve Metadata</h1>
    <div class="muted">Select metadata types to retrieve from the default org.</div>
    <div class="bar"><button class="secondary" id="toggle">Select All</button></div>
    <div class="grid">${checkboxes}</div>
    <div class="bar">
      <button id="retrieve" class="accent">Retrieve Selected</button>
    </div>
    <div id="status"></div>
    <script>
      const vscode = acquireVsCodeApi();
      const boxes = Array.from(document.querySelectorAll('input[type=checkbox]'));
      const status = document.getElementById('status');
      const toggle = document.getElementById('toggle');

      toggle.addEventListener('click', () => {
        const allChecked = boxes.every(b => b.checked);
        boxes.forEach(b => b.checked = !allChecked);
        toggle.textContent = allChecked ? 'Select All' : 'Deselect All';
      });

      document.getElementById('retrieve').addEventListener('click', () => {
        const selected = boxes.filter(b => b.checked).map(b => b.value);
        if (!selected.length) { status.textContent = 'Select at least one type.'; return; }
        vscode.postMessage({ command: 'retrieve', selected });
      });

      window.addEventListener('message', (e) => {
        const m = e.data;
        if (m.command !== 'status') return;
        if (m.state === 'running') status.textContent = '⏳ Retrieving…';
        else if (m.state === 'success') status.textContent = '✅ Retrieve complete.';
        else if (m.state === 'error') status.textContent = '❌ ' + (m.message || 'Retrieve failed.');
      });
    </script>
  </body></html>`;
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { exec } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

const METADATA_OPTIONS = [
  'Apex Classes',
  'Triggers',
  'Assignment Rules',
  'Aura Components',
  'LWC',
  'Objects',
  'Tabs',
  'Paths',
  'Permission Sets',
  'Permission Set Groups',
  'Queues',
  'Reports',
  'Sharing Rules',
  'Static Resources',
  'Visualforce Pages'
];

const METADATA_MAPPING: { [key: string]: string } = {
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
  'Queues': 'Queue',
  'Reports': 'Report',
  'Sharing Rules': 'SharingRules',
  'Static Resources': 'StaticResource',
  'Visualforce Pages': 'ApexPage'
};

let statusBarButton: vscode.StatusBarItem;

export async function activate(context: vscode.ExtensionContext) {
  console.log('SF Project Retriever extension activated');

  // Create a status bar button to open the retrieve modal
  statusBarButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarButton.command = 'sf-project-retriever.openRetriever';
  statusBarButton.text = '$(cloud-download) Retrieve from Org';

  // Update tooltip with last retrieval time
  function updateStatusBarTooltip() {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (folder) {
      const lastRetrievalTime = getLastRetrievalTime(folder.uri.fsPath);
      if (lastRetrievalTime) {
        statusBarButton.tooltip = `Last retrieved: ${lastRetrievalTime}`;
      } else {
        statusBarButton.tooltip = 'Open Salesforce Retrieve Modal';
      }
    }
  }

  updateStatusBarTooltip();
  statusBarButton.show();
  context.subscriptions.push(statusBarButton);

  // Register the command that opens the retrieve modal on button click
  const openRetriever = vscode.commands.registerCommand('sf-project-retriever.openRetriever', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      vscode.window.showErrorMessage('No workspace folder opened.');
      return;
    }

    // Check if org is selected
    const targetOrg = await getWorkspaceTargetOrg(folder.uri.fsPath);
    if (!targetOrg) {
      vscode.window.showErrorMessage('⚠️ No default org set');
      return;
    }

    await openRetrieveModal(folder);
  });
  context.subscriptions.push(openRetriever);
}

/**
 * Opens a webview for metadata selection
 */
async function openRetrieveModal(folder: vscode.WorkspaceFolder) {
  const panel = vscode.window.createWebviewPanel(
    'retrieveModal',
    'Select Metadata to Retrieve',
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: false }
  );

  // Load last retrieved metadata
  const lastRetrievedMetadata = getLastRetrievedMetadata(folder.uri.fsPath);

  const updateHtml = (selectedItems: string[] = lastRetrievedMetadata) => {
    const checkboxesHtml = METADATA_OPTIONS.map((option, index) => {
      const isChecked = selectedItems.includes(option);
      return `
        <div class="checkbox-item">
          <label>
            <input type="checkbox" value="${option}" ${isChecked ? 'checked' : ''}>
            <span>${option}</span>
          </label>
        </div>
      `;
    }).join('');

    panel.webview.html = `
    <html>
      <head>
        <style>
          body {
            font-family: 'Segoe UI', sans-serif;
            margin: 0;
            padding: 20px;
            background-color: #1e1e1e;
            color: #fff;
          }
          .container {
            max-width: 800px;
            margin: 0 auto;
          }
          h1 {
            color: #a874e3;
            font-size: 1.3em;
            font-weight: 600;
            margin-bottom: 20px;
            text-align: center;
          }
          .metadata-list {
            background-color: #2a2a2a;
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 6px;
            padding: 20px;
            margin-bottom: 20px;
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
          }
          .checkbox-item {
            display: flex;
          }
          .checkbox-item label {
            display: flex;
            align-items: center;
            cursor: pointer;
            font-size: 14px;
            gap: 8px;
          }
          .checkbox-item input[type="checkbox"] {
            width: 16px;
            height: 16px;
            accent-color: #a874e3;
            cursor: pointer;
            margin: 0;
          }
          .button-group {
            display: flex;
            gap: 10px;
            justify-content: center;
          }
          button {
            padding: 8px 16px;
            border: none;
            border-radius: 6px;
            font-size: 13px;
            cursor: pointer;
            transition: all 0.2s ease-in-out;
            font-weight: 500;
          }
          #retrieveBtn {
            background-color: #432264;
            color: white;
            min-width: 120px;
            padding: 8px 16px;
          }
          #retrieveBtn:hover:not(:disabled) {
            background-color: #5c3791;
          }
          #retrieveBtn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }
          #cancelBtn {
            background-color: #ff7800;
            color: white;
            min-width: 100px;
            padding: 8px 16px;
          }
          #cancelBtn:hover {
            background-color: #ff9540;
          }
          .select-buttons {
            display: flex;
            gap: 10px;
            margin-bottom: 15px;
            justify-content: center;
          }
          .select-buttons button {
            padding: 6px 12px;
            font-size: 12px;
            background-color: #3c3c3c;
            color: #fff;
            min-width: 80px;
            flex: none;
          }
          .select-buttons button:hover {
            background-color: #4c4c4c;
          }
          #status {
            margin-top: 15px;
            padding: 10px;
            border-radius: 6px;
            text-align: center;
            font-size: 13px;
            font-weight: 500;
            display: none;
          }
          #status.success {
            background-color: #2d5d3f;
            color: #90ee90;
            display: block;
          }
          #status.error {
            background-color: #5d2d2d;
            color: #ff6b6b;
            display: block;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Select Metadata to Retrieve</h1>

          <div class="select-buttons">
            <button id="toggleSelectBtn">Select All</button>
          </div>

          <div class="metadata-list">
            ${checkboxesHtml}
          </div>

          <div class="button-group">
            <button id="retrieveBtn">Retrieve Selected</button>
            <button id="cancelBtn">Cancel</button>
          </div>

          <div id="status"></div>
        </div>

        <script>
          const vscode = acquireVsCodeApi();
          const checkboxes = document.querySelectorAll('input[type="checkbox"]');
          const retrieveBtn = document.getElementById('retrieveBtn');
          const statusDiv = document.getElementById('status');

          function updateRetrieveButtonState() {
            const anyChecked = Array.from(checkboxes).some(cb => cb.checked);
            retrieveBtn.disabled = !anyChecked;
          }

          checkboxes.forEach(checkbox => {
            checkbox.addEventListener('change', updateRetrieveButtonState);
          });

          const toggleSelectBtn = document.getElementById('toggleSelectBtn');

          function updateToggleButtonText() {
            const allChecked = Array.from(checkboxes).every(cb => cb.checked);
            const anyChecked = Array.from(checkboxes).some(cb => cb.checked);

            if (allChecked && anyChecked) {
              toggleSelectBtn.textContent = 'Deselect All';
            } else {
              toggleSelectBtn.textContent = 'Select All';
            }
          }

          toggleSelectBtn.addEventListener('click', () => {
            const allChecked = Array.from(checkboxes).every(cb => cb.checked);
            checkboxes.forEach(cb => cb.checked = !allChecked);
            updateRetrieveButtonState();
            updateToggleButtonText();
          });

          checkboxes.forEach(checkbox => {
            checkbox.addEventListener('change', updateToggleButtonText);
          });

          retrieveBtn.addEventListener('click', () => {
            const selected = Array.from(checkboxes)
              .filter(cb => cb.checked)
              .map(cb => cb.value);
            vscode.postMessage({ command: 'retrieve', selected });
          });

          document.getElementById('cancelBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'cancel' });
          });

          updateRetrieveButtonState();
        </script>
      </body>
    </html>`;
  };

  updateHtml();

  panel.webview.onDidReceiveMessage(async (msg) => {
    if (msg.command === 'retrieve') {
      panel.dispose();
      await runRetrieveForFolder(folder, msg.selected);
    } else if (msg.command === 'cancel') {
      panel.dispose();
    }
  });
}

/**
 * Executes the retrieve logic with selected metadata
 */
async function runRetrieveForFolder(
  folder: vscode.WorkspaceFolder,
  selectedMetadata: string[]
): Promise<void> {
  const cwd = folder.uri.fsPath;
  const targetOrg = await getWorkspaceTargetOrg(cwd);

  if (!targetOrg) {
    vscode.window.showErrorMessage('No default org set.');
    return;
  }

  // Show loading status in status bar
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
  statusBarItem.text = '$(sync~spin) Retrieving metadata...';
  statusBarItem.show();

  try {
    // Save the selected metadata first
    saveLastRetrievedMetadata(cwd, selectedMetadata);

    // Create manifest folder if it doesn't exist
    const manifestDir = path.join(cwd, 'manifest');
    const manifestPath = path.join(manifestDir, 'package.xml');

    if (!fs.existsSync(manifestDir)) {
      fs.mkdirSync(manifestDir, { recursive: true });
    }

    // Update package.xml with merged metadata (keep existing + add new)
    const packageXmlContent = generatePackageXml(selectedMetadata, manifestPath);
    fs.writeFileSync(manifestPath, packageXmlContent, 'utf-8');

    // Create a temporary manifest for retrieval with ONLY selected metadata types
    const tempManifestDir = path.join(cwd, '.sf', 'temp-manifest');
    if (!fs.existsSync(tempManifestDir)) {
      fs.mkdirSync(tempManifestDir, { recursive: true });
    }

    const tempManifestPath = path.join(tempManifestDir, 'package.xml');
    const retrievePackageXmlContent = generateRetrievePackageXml(selectedMetadata);
    fs.writeFileSync(tempManifestPath, retrievePackageXmlContent, 'utf-8');

    // Run retrieve command using the temporary manifest with only selected metadata
    const cmd = `sf project retrieve start --manifest .sf/temp-manifest/package.xml --target-org ${targetOrg}`;
    await execPromise(cmd, cwd);

    // Clean up temporary manifest folder
    fs.rmSync(tempManifestDir, { recursive: true, force: true });

    statusBarItem.text = '$(check) Retrieval completed successfully!';
    statusBarItem.tooltip = 'Metadata retrieved from org';

    // Update the main status bar button tooltip
    const lastRetrievalTime = getLastRetrievalTime(cwd);
    if (lastRetrievalTime) {
      statusBarButton.tooltip = `Last retrieved: ${lastRetrievalTime}`;
    }

    // Auto-hide after 5 seconds
    setTimeout(() => statusBarItem.dispose(), 5000);

    vscode.window.showInformationMessage('✅ Metadata retrieval completed successfully!');
  } catch (err: any) {
    statusBarItem.text = '$(error) Retrieval failed';
    statusBarItem.tooltip = err.message || 'Unknown error';
    statusBarItem.dispose();
    vscode.window.showErrorMessage(`❌ Retrieval failed: ${err.message || 'Unknown error'}`);
  }
}

/**
 * Generates package.xml content by merging selected metadata with existing types
 */
function generatePackageXml(selectedMetadata: string[], existingPath: string): string {
  const metadataTypes = new Set<string>();

  // Read existing package.xml and preserve existing metadata types
  if (fs.existsSync(existingPath)) {
    try {
      const existingContent = fs.readFileSync(existingPath, 'utf-8');
      // Extract existing metadata type names using regex
      const typeMatches = existingContent.match(/<name>([^<]+)<\/name>/g);
      if (typeMatches) {
        typeMatches.forEach(match => {
          const name = match.replace(/<name>|<\/name>/g, '');
          metadataTypes.add(name);
        });
      }
    } catch {
      // If error reading existing file, just proceed with new metadata
    }
  }

  // Add newly selected metadata types (won't duplicate if already present)
  selectedMetadata.forEach(item => {
    const apiName = METADATA_MAPPING[item];
    metadataTypes.add(apiName);
  });

  // Build the metadata types section with merged items
  const metadataTypesXml = Array.from(metadataTypes)
    .sort()
    .map(apiName => `
  <types>
    <members>*</members>
    <name>${apiName}</name>
  </types>`)
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
${metadataTypesXml}
  <version>59.0</version>
</Package>`;
}

/**
 * Generates package.xml with ONLY selected metadata types for retrieval
 */
function generateRetrievePackageXml(selectedMetadata: string[]): string {
  const metadataTypes = new Set<string>();

  // Add only the selected metadata types
  selectedMetadata.forEach(item => {
    const apiName = METADATA_MAPPING[item];
    metadataTypes.add(apiName);
  });

  // Build the metadata types section with only selected items
  const metadataTypesXml = Array.from(metadataTypes)
    .sort()
    .map(apiName => `
  <types>
    <members>*</members>
    <name>${apiName}</name>
  </types>`)
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
${metadataTypesXml}
  <version>59.0</version>
</Package>`;
}

/**
 * Reads workspace-level .sf/config.json for target-org
 */
async function getWorkspaceTargetOrg(workspaceFolder: string): Promise<string | undefined> {
  try {
    const configPath = path.join(workspaceFolder, '.sf', 'config.json');
    const content = await vscode.workspace.fs.readFile(vscode.Uri.file(configPath));
    const config = JSON.parse(content.toString());
    return config['target-org'];
  } catch {
    return undefined;
  }
}

/**
 * Executes CLI command
 */
function execPromise(cmd: string, cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || stdout || err.message));
      } else {
        console.log(stdout);
        resolve();
      }
    });
  });
}

/**
 * Get last retrieved metadata from workspace storage
 */
function getLastRetrievedMetadata(workspaceFolder: string): string[] {
  try {
    const storagePath = path.join(workspaceFolder, '.sf', 'sf-retriever-metadata.json');
    if (fs.existsSync(storagePath)) {
      const content = fs.readFileSync(storagePath, 'utf-8');
      const data = JSON.parse(content);
      return data.lastRetrieved || [];
    }
  } catch (err) {
    console.log('No previous metadata retrieval found');
  }
  return [];
}

/**
 * Save last retrieved metadata
 */
function saveLastRetrievedMetadata(workspaceFolder: string, metadata: string[]): void {
  try {
    const sfDir = path.join(workspaceFolder, '.sf');
    if (!fs.existsSync(sfDir)) {
      fs.mkdirSync(sfDir, { recursive: true });
    }
    const storagePath = path.join(sfDir, 'sf-retriever-metadata.json');
    const data = {
      lastRetrieved: metadata,
      lastRetrievalTime: new Date().toISOString()
    };
    fs.writeFileSync(storagePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving metadata:', err);
  }
}

/**
 * Get formatted last retrieval time
 */
function getLastRetrievalTime(workspaceFolder: string): string | undefined {
  try {
    const storagePath = path.join(workspaceFolder, '.sf', 'sf-retriever-metadata.json');
    if (fs.existsSync(storagePath)) {
      const content = fs.readFileSync(storagePath, 'utf-8');
      const data = JSON.parse(content);
      if (data.lastRetrievalTime) {
        const lastTime = new Date(data.lastRetrievalTime);
        const now = new Date();
        const diffMs = now.getTime() - lastTime.getTime();
        const diffMins = Math.floor(diffMs / (1000 * 60));
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
        if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
        return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
      }
    }
  } catch (err) {
    console.log('Error reading retrieval time');
  }
  return undefined;
}

export function deactivate() { }

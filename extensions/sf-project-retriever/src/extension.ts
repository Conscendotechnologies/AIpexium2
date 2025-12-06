/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { SfCliService } from './sfCli';
import { ConfigManager } from './configManager';
import { StatusBarManager } from './statusBarManager';

let outputChannel: vscode.OutputChannel;
let sfCli: SfCliService;
let configManager: ConfigManager;
let statusBarManager: StatusBarManager;

export async function activate(context: vscode.ExtensionContext) {
  // Initialize services
  outputChannel = vscode.window.createOutputChannel('SF Project Retriever');
  sfCli = new SfCliService(outputChannel);
  configManager = new ConfigManager();
  statusBarManager = new StatusBarManager();

  context.subscriptions.push(outputChannel);
  context.subscriptions.push(statusBarManager);

  outputChannel.appendLine(vscode.l10n.t('SF Project Retriever extension activated'));

  // Check if workspace is a Salesforce project
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    outputChannel.appendLine(vscode.l10n.t('No workspace folder opened.'));
    return;
  }

  // Initialize status bar
  await initializeStatusBar(folder, context);

  // Register commands
  registerCommands(context, folder);

  // Auto-retrieve if enabled
  if (configManager.isAutoRetrieveEnabled()) {
    await performRetrieve(folder, context);
  }
}

/**
 * Initializes the status bar with current org info
 */
async function initializeStatusBar(folder: vscode.WorkspaceFolder, context: vscode.ExtensionContext): Promise<void> {
  const hasManifest = await configManager.hasManifest(folder);

  if (!hasManifest) {
    outputChannel.appendLine(vscode.l10n.t('No manifest found. Status bar will not be shown.'));
    return;
  }

  const targetOrg = await configManager.getWorkspaceTargetOrg(folder);
  statusBarManager.setOrg(targetOrg);

  // Set tooltip with additional info
  const lastRetrieve = configManager.formatLastRetrieveTime(context);
  const tooltip = targetOrg
    ? vscode.l10n.t('Click to retrieve from {0}\nLast retrieve: {1}', targetOrg, lastRetrieve)
    : vscode.l10n.t('No default org set\nClick to configure');

  statusBarManager.setTooltip(tooltip);
  statusBarManager.show();
}

/**
 * Registers all extension commands
 */
function registerCommands(context: vscode.ExtensionContext, folder: vscode.WorkspaceFolder): void {
  // Main retrieve command
  const retrieveCommand = vscode.commands.registerCommand('sf-project-retriever.retrieveNow', async () => {
    await performRetrieve(folder, context);
  });

  // Show output channel command
  const showOutputCommand = vscode.commands.registerCommand('sf-project-retriever.showOutput', () => {
    outputChannel.show();
  });

  // Change org command
  const changeOrgCommand = vscode.commands.registerCommand('sf-project-retriever.changeOrg', async () => {
    await changeTargetOrg(folder, context);
  });

  context.subscriptions.push(retrieveCommand, showOutputCommand, changeOrgCommand);
}

/**
 * Performs the retrieve operation with progress and error handling
 */
async function performRetrieve(folder: vscode.WorkspaceFolder, context: vscode.ExtensionContext): Promise<void> {
  // // Validate CLI is installed
  // const cliInstalled = await sfCli.validateCliInstalled();
  // if (!cliInstalled) {
  //   const action = await vscode.window.showErrorMessage(
  //     vscode.l10n.t('Salesforce CLI is not installed. Please install it to use this extension.'),
  //     vscode.l10n.t('Open Installation Guide')
  //   );
  //   if (action) {
  //     vscode.env.openExternal(vscode.Uri.parse('https://developer.salesforce.com/tools/sfdxcli'));
  //   }
  //   return;
  // }

  // Check for manifest
  const hasManifest = await configManager.hasManifest(folder);
  if (!hasManifest) {
    vscode.window.showErrorMessage(
      vscode.l10n.t('No manifest/package.xml found in the workspace.')
    );
    outputChannel.appendLine(vscode.l10n.t('Error: manifest/package.xml not found'));
    return;
  }

  // Get target org
  const targetOrg = await configManager.getWorkspaceTargetOrg(folder);
  if (!targetOrg) {
    const action = await vscode.window.showWarningMessage(
      vscode.l10n.t('No default org set. Please authorize an org or set a default org.'),
      vscode.l10n.t('Authorize Org'),
      vscode.l10n.t('Set Default Org')
    );

    if (action === vscode.l10n.t('Authorize Org')) {
      vscode.window.showInformationMessage(
        vscode.l10n.t('Run "sf org login web" in the terminal to authorize an org.')
      );
      outputChannel.show();
    }
    return;
  }

  // Log the target org for debugging
  outputChannel.appendLine(vscode.l10n.t('Using target org: {0}', targetOrg));

  // Update status bar to retrieving
  statusBarManager.setRetrieving();

  // Perform retrieve with progress and cancellation support
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: vscode.l10n.t('SF: Retrieving from {0}', targetOrg),
      cancellable: true
    },
    async (progress, token) => {
      const manifestPath = configManager.getManifestPath(folder);
      const result = await sfCli.retrieveSource(targetOrg, manifestPath, folder.uri.fsPath, token);

      if (token.isCancellationRequested) {
        statusBarManager.resetToIdle();
        if (configManager.shouldShowNotifications()) {
          vscode.window.showWarningMessage(vscode.l10n.t('Retrieve operation was cancelled.'));
        }
        return;
      }

      if (result.success) {
        statusBarManager.setSuccess();
        await configManager.saveLastRetrieveTime(context);

        if (configManager.shouldShowNotifications()) {
          vscode.window.showInformationMessage(
            vscode.l10n.t('Successfully retrieved source from {0}', targetOrg)
          );
        }

        // Update tooltip with new last retrieve time
        const lastRetrieve = configManager.formatLastRetrieveTime(context);
        statusBarManager.setTooltip(
          vscode.l10n.t('Click to retrieve from {0}\nLast retrieve: {1}', targetOrg, lastRetrieve)
        );
      } else {
        statusBarManager.setError();

        const action = await vscode.window.showErrorMessage(
          vscode.l10n.t('Failed to retrieve source from {0}. Check output for details.', targetOrg),
          vscode.l10n.t('Show Output'),
          vscode.l10n.t('Retry')
        );

        if (action === vscode.l10n.t('Show Output')) {
          outputChannel.show();
        } else if (action === vscode.l10n.t('Retry')) {
          // Retry after a short delay
          setTimeout(() => performRetrieve(folder, context), 1000);
        }
      }
    }
  );
}

/**
 * Allows user to change the target org
 */
async function changeTargetOrg(folder: vscode.WorkspaceFolder, context: vscode.ExtensionContext): Promise<void> {
  const orgs = await sfCli.getAuthorizedOrgs();

  if (orgs.length === 0) {
    vscode.window.showWarningMessage(
      vscode.l10n.t('No authorized orgs found. Please authorize an org first.')
    );
    return;
  }

  const selected = await vscode.window.showQuickPick(orgs, {
    placeHolder: vscode.l10n.t('Select an org to set as default')
  });

  if (selected) {
    // Update status bar
    statusBarManager.setOrg(selected);

    const lastRetrieve = configManager.formatLastRetrieveTime(context);
    statusBarManager.setTooltip(
      vscode.l10n.t('Click to retrieve from {0}\nLast retrieve: {1}', selected, lastRetrieve)
    );

    vscode.window.showInformationMessage(
      vscode.l10n.t('Note: Update .sf/config.json to persist this change.')
    );
  }
}

export function deactivate(): void {
  if (outputChannel) {
    outputChannel.dispose();
  }
  if (statusBarManager) {
    statusBarManager.dispose();
  }
}

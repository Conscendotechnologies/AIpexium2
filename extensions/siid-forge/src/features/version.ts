/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { Commands } from '../commands';
import { CliManager } from '../core/cliManager';
import { CancellationError } from '../core/sfExecutor';
import { Feature } from './types';

const UPDATE = 'Update';
const DISMISS = 'Dismiss';

/**
 * Shows the installed `sf` CLI version, checks for updates, and updates the CLI.
 * Also runs a one-time background update check on activation.
 */
const DISMISSED_KEY = 'siid-forge.dismissedCliUpdate';

export const registerVersion: Feature = ({ context, cli, logger }) => {
  context.subscriptions.push(
    vscode.commands.registerCommand(Commands.checkVersion, () => checkVersion(cli)),
    vscode.commands.registerCommand(Commands.updateCli, () => updateCli(cli, logger))
  );

  // Non-blocking startup check.
  void backgroundCheck(context, cli, logger);
};

/** Shows current version and offers an update if one is available. */
async function checkVersion(cli: CliManager): Promise<void> {
  try {
    const info = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'SIID Forge: checking sf version…' },
      () => cli.checkForUpdate()
    );

    if (!info.current) {
      vscode.window.showErrorMessage('❌ Could not run sf CLI. Make sure the Salesforce CLI is installed.');
      return;
    }

    if (info.updateAvailable) {
      const choice = await vscode.window.showInformationMessage(
        `sf CLI ${info.current} — update available to ${info.latest}.`,
        UPDATE
      );
      if (choice === UPDATE) {
        await vscode.commands.executeCommand(Commands.updateCli);
      }
    } else {
      vscode.window.showInformationMessage(`✅ sf CLI ${info.current} (up to date).`);
    }
  } catch (err: any) {
    vscode.window.showErrorMessage(`❌ Version check failed: ${err.message}`);
  }
}

/** Runs `sf update`. */
async function updateCli(cli: CliManager, logger: { error(m: string): void }): Promise<void> {
  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'SIID Forge: updating sf CLI…', cancellable: true },
      (_progress, token) => cli.update(token)
    );
    vscode.window.showInformationMessage('✅ sf CLI updated.');
  } catch (err: any) {
    if (err instanceof CancellationError) {
      vscode.window.showInformationMessage('CLI update cancelled.');
      return;
    }
    logger.error(err.message);
    // `sf update` (standalone installer) can fail with EPERM when it cannot
    // replace its own node.exe (in use / needs elevation).
    const permIssue = /EPERM|not permitted|cannot be found|EACCES/i.test(err.message);
    const guidance = permIssue
      ? 'Close other SIID/sf processes and run as Administrator, or update manually: "npm install -g @salesforce/cli@latest".'
      : 'If you installed via npm, run "npm install -g @salesforce/cli@latest".';
    vscode.window.showErrorMessage(`❌ CLI update failed. ${guidance}`);
  }
}

/**
 * One-time, quiet update check; only notifies when an update exists and the user
 * hasn't already dismissed that specific version.
 */
async function backgroundCheck(
  context: vscode.ExtensionContext,
  cli: CliManager,
  logger: { error(m: string): void }
): Promise<void> {
  try {
    const info = await cli.checkForUpdate();
    if (!info.updateAvailable || !info.latest) {
      return;
    }
    if (context.globalState.get<string>(DISMISSED_KEY) === info.latest) {
      return; // already dismissed this version
    }
    const choice = await vscode.window.showInformationMessage(
      `Salesforce CLI update available: ${info.current} → ${info.latest}.`,
      UPDATE,
      DISMISS
    );
    if (choice === UPDATE) {
      await vscode.commands.executeCommand(Commands.updateCli);
    } else if (choice === DISMISS) {
      await context.globalState.update(DISMISSED_KEY, info.latest);
    }
  } catch (err: any) {
    logger.error(`backgroundCheck: ${err.message}`);
  }
}

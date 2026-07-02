/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { Commands } from '../commands';
import { CliManager } from '../core/cliManager';
import { CancellationError } from '../core/sfExecutor';
import { notify } from '../ui/notify';
import { Feature } from './types';

const UPDATE = 'Update';
const DISMISS = 'Dismiss';

/**
 * Shows the installed `sf` CLI version, checks for updates, and updates the CLI.
 * Also runs a one-time background update check on activation.
 */
const DISMISSED_KEY = 'siid-forge.dismissedCliUpdate';
const LAST_CHECKED_KEY = 'siid-forge.cliUpdateLastChecked';
/** Only run the background update check once per this window (ms). */
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
/** Wait this long after activation before the (deferred) update check runs. */
const STARTUP_CHECK_DELAY_MS = 15_000;

export const registerVersion: Feature = ({ context, cli, logger }) => {
  context.subscriptions.push(
    vscode.commands.registerCommand(Commands.checkVersion, () => checkVersion(cli)),
    vscode.commands.registerCommand(Commands.updateCli, () => updateCli(cli, logger))
  );

  // Startup update check — deferred and rate-limited so it never competes with
  // org resolution at activation (that contention was pinning the CLI status
  // bar for 60-80s). We wait out the activation burst, then check at most once
  // a day. Fully non-blocking; the timer is cleaned up on deactivate.
  const lastChecked = context.globalState.get<number>(LAST_CHECKED_KEY) ?? 0;
  if (Date.now() - lastChecked >= UPDATE_CHECK_INTERVAL_MS) {
    const timer = setTimeout(() => { void backgroundCheck(context, cli, logger); }, STARTUP_CHECK_DELAY_MS);
    if (typeof timer.unref === 'function') { timer.unref(); }
    context.subscriptions.push({ dispose: () => clearTimeout(timer) });
  }
};

/** Shows current version and offers an update if one is available. */
async function checkVersion(cli: CliManager): Promise<void> {
  try {
    const info = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'SIID Forge: checking sf version…' },
      () => cli.checkForUpdate()
    );

    if (!info.current) {
      notify.err('Could not run sf CLI. Make sure the Salesforce CLI is installed.');
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
      notify.ok(`sf CLI ${info.current} (up to date).`);
    }
  } catch (err: any) {
    notify.err(`Version check failed: ${err.message}`);
  }
}

/** Runs `sf update`. */
async function updateCli(cli: CliManager, logger: { error(m: string): void }): Promise<void> {
  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'SIID Forge: updating sf CLI…', cancellable: true },
      (_progress, token) => cli.update(token)
    );
    notify.ok('sf CLI updated.');
  } catch (err: any) {
    if (err instanceof CancellationError) {
      notify.cancelled('CLI update');
      return;
    }
    logger.error(err.message);
    // `sf update` (standalone installer) can fail with EPERM when it cannot
    // replace its own node.exe (in use / needs elevation).
    const permIssue = /EPERM|not permitted|cannot be found|EACCES/i.test(err.message);
    const guidance = permIssue
      ? 'Close other SIID/sf processes and run as Administrator, or update manually: "npm install -g @salesforce/cli@latest".'
      : 'If you installed via npm, run "npm install -g @salesforce/cli@latest".';
    notify.err(`CLI update failed. ${guidance}`);
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
  // Stamp the attempt up front so the daily cap holds even if this check hangs
  // or fails — we don't want a wedged CLI re-triggering the check every startup.
  void context.globalState.update(LAST_CHECKED_KEY, Date.now());
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

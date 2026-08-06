/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { Commands } from '../commands';
import { SfExecutor } from '../core/sfExecutor';
import { getWorkspaceCwd } from '../core/workspace';
import { ensureDefaultOrg } from '../ui/orgGuard';
import { notify } from '../ui/notify';
import { Feature } from './types';

/**
 * Opens the default org home page in the browser via `sf org open`, explicitly
 * targeting the org SIID shows as default (not the CLI's ambient default).
 * `openOrgAt(sf, org, cwd, relPath?)` is the headless service (agent-consumable).
 */
export const registerOpenOrg: Feature = ({ context, sf, logger, orgs }) => {
  context.subscriptions.push(
    vscode.commands.registerCommand(Commands.openOrg, async () => {
      const def = await ensureDefaultOrg(orgs);
      if (!def) {
        return;
      }

      try {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `SIID Forge: opening "${def}"…` },
          () => openOrgAt(sf, def, getWorkspaceCwd())
        );
      } catch (err: any) {
        logger.error(err.message);
        notify.err(`Could not open org: ${err.message}`);
      }
    })
  );
};

/**
 * Headless: open a specific org in the browser. `org` is the alias/username to
 * target — always pass it so we open the org SIID shows as default, not the
 * CLI's ambient default (which can differ). `relPath` optionally deep-links.
 */
export function openOrgAt(sf: SfExecutor, org?: string, cwd?: string, relPath?: string) {
  const args = ['org', 'open'];
  if (org) {
    args.push('--target-org', org);
  }
  if (relPath) {
    args.push('--path', relPath);
  }
  return sf.run(args, { cwd });
}

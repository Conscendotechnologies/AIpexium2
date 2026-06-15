/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { Commands } from '../commands';
import { Feature } from './types';

/**
 * Opens the default org in the browser via `sf org open`.
 */
export const registerOpenOrg: Feature = ({ context, sf, logger, orgs }) => {
  context.subscriptions.push(
    vscode.commands.registerCommand(Commands.openOrg, async () => {
      const def = await orgs.getDefaultOrg();
      if (!def) {
        vscode.window.showErrorMessage('SIID Forge: no default org set. Authorize or select one first.');
        return;
      }

      try {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `SIID Forge: opening "${def}"…` },
          () => sf.run(['org', 'open'])
        );
      } catch (err: any) {
        logger.error(err.message);
        vscode.window.showErrorMessage(`❌ Could not open org: ${err.message}`);
      }
    })
  );
};

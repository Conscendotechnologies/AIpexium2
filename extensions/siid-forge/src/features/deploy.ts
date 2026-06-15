/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as path from 'path';
import { Commands } from '../commands';
import { CancellationError } from '../core/sfExecutor';
import { findProjectRoot, resolveResourceUri } from '../core/workspace';
import { Feature } from './types';

/**
 * Deploys a file or folder to the default org via `sf project deploy start`.
 * Invoked from the explorer or editor context menu.
 */
export const registerDeploy: Feature = ({ context, sf, logger }) => {
  context.subscriptions.push(
    vscode.commands.registerCommand(Commands.deploySource, async (uri?: vscode.Uri) => {
      const resource = resolveResourceUri(uri);
      if (!resource) {
        return;
      }

      const cwd = findProjectRoot(resource.fsPath);
      const label = path.basename(resource.fsPath);

      try {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `SIID Forge: deploying "${label}"…`, cancellable: true },
          (_progress, token) => sf.run(['project', 'deploy', 'start', '--source-dir', resource.fsPath], { cwd, token })
        );
        vscode.window.showInformationMessage(`✅ Deployed "${label}" to org.`);
      } catch (err: any) {
        if (err instanceof CancellationError) {
          vscode.window.showInformationMessage('Deploy cancelled.');
          return;
        }
        logger.error(err.message);
        vscode.window.showErrorMessage(`❌ Deploy failed: ${err.message}`);
      }
    })
  );
};

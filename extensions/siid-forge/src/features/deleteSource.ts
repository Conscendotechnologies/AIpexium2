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
 * Deletes a file/component from the org AND locally via
 * `sf project delete source`. Prompts for confirmation (destructive).
 */
export const registerDeleteSource: Feature = ({ context, sf, logger }) => {
  context.subscriptions.push(
    vscode.commands.registerCommand(Commands.deleteSource, async (uri?: vscode.Uri) => {
      const resource = resolveResourceUri(uri);
      if (!resource) {
        return;
      }

      const label = path.basename(resource.fsPath);
      const confirm = await vscode.window.showWarningMessage(
        `Delete "${label}" from the org and your project? This cannot be undone.`,
        { modal: true },
        'Delete'
      );
      if (confirm !== 'Delete') {
        return;
      }

      const cwd = findProjectRoot(resource.fsPath);
      try {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `SIID Forge: deleting "${label}"…`, cancellable: true },
          (_progress, token) =>
            sf.run(['project', 'delete', 'source', '--source-dir', resource.fsPath, '--no-prompt'], { cwd, token })
        );
        vscode.window.showInformationMessage(`✅ Deleted "${label}" from org and project.`);
      } catch (err: any) {
        if (err instanceof CancellationError) {
          vscode.window.showInformationMessage('Delete cancelled.');
          return;
        }
        logger.error(err.message);
        vscode.window.showErrorMessage(`❌ Delete failed: ${err.message}`);
      }
    })
  );
};

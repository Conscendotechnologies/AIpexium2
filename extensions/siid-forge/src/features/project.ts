/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { Commands } from '../commands';
import { Feature } from './types';

/**
 * Scaffolds a new SFDX project that includes a manifest (package.xml).
 */
export const registerProject: Feature = ({ context, sf, logger }) => {
  context.subscriptions.push(
    vscode.commands.registerCommand(Commands.createProject, async () => {
      const name = await vscode.window.showInputBox({
        prompt: 'Project name',
        placeHolder: 'MySalesforceProject',
        validateInput: (value) =>
          /^[A-Za-z0-9_-]+$/.test(value.trim()) ? undefined : 'Use letters, numbers, dashes or underscores only.'
      });
      if (!name) {
        return;
      }

      const picked = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Create project here'
      });
      if (!picked || picked.length === 0) {
        return;
      }
      const parentDir = picked[0].fsPath;

      try {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `SIID Forge: creating project "${name}"…` },
          () => sf.run(['project', 'generate', '--name', name.trim(), '--manifest'], { cwd: parentDir })
        );

        const projectUri = vscode.Uri.joinPath(picked[0], name.trim());
        const open = await vscode.window.showInformationMessage(
          `✅ Project "${name}" created with a manifest.`,
          'Open Project'
        );
        if (open === 'Open Project') {
          await vscode.commands.executeCommand('vscode.openFolder', projectUri, { forceNewWindow: false });
        }
      } catch (err: any) {
        logger.error(err.message);
        vscode.window.showErrorMessage(`❌ Project creation failed: ${err.message}`);
      }
    })
  );
};

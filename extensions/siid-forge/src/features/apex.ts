/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { Commands } from '../commands';
import { resolveOutputTarget } from '../core/workspace';
import { Feature } from './types';

const DEFAULT_DIR = 'force-app/main/default/classes';

/**
 * Creates an Apex class via `sf apex generate class`.
 *
 * When invoked from the explorer context menu, `folderUri` is the clicked
 * folder and is used directly as the output directory. From the palette/menu it
 * prompts for the output directory instead.
 */
export const registerApex: Feature = ({ context, sf, logger }) => {
  context.subscriptions.push(
    vscode.commands.registerCommand(Commands.createApexClass, async (folderUri?: vscode.Uri) => {
      const target = await resolveOutputTarget(folderUri, DEFAULT_DIR);
      if (!target) {
        return;
      }

      const name = await vscode.window.showInputBox({
        prompt: 'Apex class name',
        placeHolder: 'MyApexClass',
        validateInput: (value) =>
          /^[A-Za-z_]\w*$/.test(value.trim()) ? undefined : 'Must start with a letter/underscore; letters, numbers, underscores only.'
      });
      if (!name) {
        return;
      }

      try {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `SIID Forge: creating Apex class "${name}"…` },
          () => sf.run(['apex', 'generate', 'class', '--name', name.trim(), '--output-dir', target.outputDir], { cwd: target.cwd })
        );

        const fileUri = vscode.Uri.file(`${target.outputDir}/${name.trim()}.cls`);
        vscode.window.showInformationMessage(`✅ Apex class "${name}" created.`);
        try {
          await vscode.window.showTextDocument(fileUri);
        } catch {
          // File may live elsewhere depending on CLI behavior; ignore open failure.
        }
      } catch (err: any) {
        logger.error(err.message);
        vscode.window.showErrorMessage(`❌ Apex class creation failed: ${err.message}`);
      }
    })
  );
};

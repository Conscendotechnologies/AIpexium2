/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { Commands } from '../commands';
import { resolveOutputTarget } from '../core/workspace';
import { Feature } from './types';

const DEFAULT_DIR = 'force-app/main/default/lwc';

/**
 * Creates a Lightning Web Component via `sf lightning generate component --type lwc`.
 *
 * When invoked from the explorer context menu, `folderUri` (the clicked `lwc`
 * folder) is used as the output directory; otherwise the user is prompted.
 */
export const registerLwc: Feature = ({ context, sf, logger }) => {
  context.subscriptions.push(
    vscode.commands.registerCommand(Commands.createLwc, async (folderUri?: vscode.Uri) => {
      const target = await resolveOutputTarget(folderUri, DEFAULT_DIR);
      if (!target) {
        return;
      }

      const name = await vscode.window.showInputBox({
        prompt: 'LWC component name (camelCase)',
        placeHolder: 'myComponent',
        validateInput: (value) =>
          /^[a-z][a-zA-Z0-9]*$/.test(value.trim()) ? undefined : 'Use camelCase: start lowercase, letters and numbers only.'
      });
      if (!name) {
        return;
      }

      try {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `SIID Forge: creating LWC "${name}"…` },
          () => sf.run(
            ['lightning', 'generate', 'component', '--name', name.trim(), '--type', 'lwc', '--output-dir', target.outputDir],
            { cwd: target.cwd }
          )
        );

        const jsUri = vscode.Uri.file(`${target.outputDir}/${name.trim()}/${name.trim()}.js`);
        vscode.window.showInformationMessage(`✅ LWC component "${name}" created.`);
        try {
          await vscode.window.showTextDocument(jsUri);
        } catch {
          // Ignore open failure if the path differs.
        }
      } catch (err: any) {
        logger.error(err.message);
        vscode.window.showErrorMessage(`❌ LWC creation failed: ${err.message}`);
      }
    })
  );
};

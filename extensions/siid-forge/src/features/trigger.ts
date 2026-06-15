/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { Commands } from '../commands';
import { resolveOutputTarget } from '../core/workspace';
import { Feature } from './types';

const DEFAULT_DIR = 'force-app/main/default/triggers';

/**
 * Creates an Apex trigger via `sf apex generate trigger`.
 */
export const registerTrigger: Feature = ({ context, sf, logger }) => {
  context.subscriptions.push(
    vscode.commands.registerCommand(Commands.createTrigger, async (folderUri?: vscode.Uri) => {
      const target = await resolveOutputTarget(folderUri, DEFAULT_DIR);
      if (!target) {
        return;
      }

      const name = await vscode.window.showInputBox({
        prompt: 'Trigger name',
        placeHolder: 'AccountTrigger',
        validateInput: (v) => (/^[A-Za-z_]\w*$/.test(v.trim()) ? undefined : 'Letters, numbers, underscores; must start with a letter/underscore.')
      });
      if (!name) {
        return;
      }

      const sobject = await vscode.window.showInputBox({
        prompt: 'SObject the trigger runs on',
        placeHolder: 'Account',
        validateInput: (v) => (v.trim() ? undefined : 'SObject is required.')
      });
      if (!sobject) {
        return;
      }

      try {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `SIID Forge: creating trigger "${name}"…` },
          () => sf.run(
            ['apex', 'generate', 'trigger', '--name', name.trim(), '--sobject', sobject.trim(), '--output-dir', target.outputDir],
            { cwd: target.cwd }
          )
        );

        const fileUri = vscode.Uri.file(`${target.outputDir}/${name.trim()}.trigger`);
        vscode.window.showInformationMessage(`✅ Trigger "${name}" created.`);
        try { await vscode.window.showTextDocument(fileUri); } catch { /* ignore */ }
      } catch (err: any) {
        logger.error(err.message);
        vscode.window.showErrorMessage(`❌ Trigger creation failed: ${err.message}`);
      }
    })
  );
};

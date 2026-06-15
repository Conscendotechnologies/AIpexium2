/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { Commands } from '../commands';
import { resolveOutputTarget } from '../core/workspace';
import { Feature } from './types';

const DEFAULT_DIR = 'force-app/main/default/aura';

/**
 * Creates an Aura component via `sf lightning generate component --type aura`.
 */
export const registerAura: Feature = ({ context, sf, logger }) => {
  context.subscriptions.push(
    vscode.commands.registerCommand(Commands.createAura, async (folderUri?: vscode.Uri) => {
      const target = await resolveOutputTarget(folderUri, DEFAULT_DIR);
      if (!target) {
        return;
      }

      const name = await vscode.window.showInputBox({
        prompt: 'Aura component name',
        placeHolder: 'myAuraComponent',
        validateInput: (v) => (/^[A-Za-z]\w*$/.test(v.trim()) ? undefined : 'Letters, numbers, underscores; must start with a letter.')
      });
      if (!name) {
        return;
      }

      try {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `SIID Forge: creating Aura component "${name}"…` },
          () => sf.run(
            ['lightning', 'generate', 'component', '--name', name.trim(), '--type', 'aura', '--output-dir', target.outputDir],
            { cwd: target.cwd }
          )
        );

        const cmpUri = vscode.Uri.file(`${target.outputDir}/${name.trim()}/${name.trim()}.cmp`);
        vscode.window.showInformationMessage(`✅ Aura component "${name}" created.`);
        try { await vscode.window.showTextDocument(cmpUri); } catch { /* ignore */ }
      } catch (err: any) {
        logger.error(err.message);
        vscode.window.showErrorMessage(`❌ Aura creation failed: ${err.message}`);
      }
    })
  );
};

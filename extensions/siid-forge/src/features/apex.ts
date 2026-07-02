/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { Commands } from '../commands';
import { resolveOutputTarget, validateApexName, resolveApiVersion } from '../core/workspace';
import { apexClassScaffold, writeScaffold } from '../core/scaffolds';
import { notify } from '../ui/notify';
import { Feature } from './types';

const DEFAULT_DIR = 'force-app/main/default/classes';

/**
 * Creates an Apex class from a local template (no `sf` CLI — the CLI's cold-start
 * made this take seconds to write two tiny files, and required a working install
 * just to make an empty class).
 *
 * When invoked from the explorer context menu, `folderUri` is the clicked
 * folder and is used directly as the output directory. From the palette/menu it
 * prompts for the output directory instead.
 */
export const registerApex: Feature = ({ context, logger, orgs }) => {
  context.subscriptions.push(
    vscode.commands.registerCommand(Commands.createApexClass, async (folderUri?: vscode.Uri) => {
      const target = await resolveOutputTarget(folderUri, DEFAULT_DIR);
      if (!target) {
        return;
      }

      const name = await vscode.window.showInputBox({
        prompt: 'Apex class name',
        placeHolder: 'MyApexClass',
        validateInput: validateApexName
      });
      if (!name) {
        return;
      }

      try {
        const scaffold = apexClassScaffold(name.trim(), await resolveApiVersion(target.cwd, orgs));
        const primary = writeScaffold(target.outputDir, scaffold);
        notify.ok(`Apex class "${name}" created.`);
        await vscode.window.showTextDocument(vscode.Uri.file(primary));
      } catch (err: any) {
        logger.error(err.message);
        notify.err(`Apex class creation failed: ${err.message}`);
      }
    })
  );
};

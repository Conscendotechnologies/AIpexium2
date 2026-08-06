/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { Commands } from '../commands';
import { resolveOutputTarget, validateApexName, resolveApiVersion } from '../core/workspace';
import { apexTriggerScaffold, writeScaffold } from '../core/scaffolds';
import { notify } from '../ui/notify';
import { Feature } from './types';

const DEFAULT_DIR = 'force-app/main/default/triggers';

/**
 * Creates an Apex trigger from a local template (no `sf` CLI — see apex.ts).
 */
export const registerTrigger: Feature = ({ context, logger, orgs }) => {
  context.subscriptions.push(
    vscode.commands.registerCommand(Commands.createTrigger, async (folderUri?: vscode.Uri) => {
      const target = await resolveOutputTarget(folderUri, DEFAULT_DIR);
      if (!target) {
        return;
      }

      const name = await vscode.window.showInputBox({
        prompt: 'Trigger name',
        placeHolder: 'AccountTrigger',
        validateInput: validateApexName
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
        const scaffold = apexTriggerScaffold(name.trim(), sobject.trim(), await resolveApiVersion(target.cwd, orgs));
        const primary = writeScaffold(target.outputDir, scaffold);
        notify.ok(`Trigger "${name}" created.`);
        await vscode.window.showTextDocument(vscode.Uri.file(primary));
      } catch (err: any) {
        logger.error(err.message);
        notify.err(`Trigger creation failed: ${err.message}`);
      }
    })
  );
};

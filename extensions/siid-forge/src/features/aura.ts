/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { Commands } from '../commands';
import { resolveOutputTarget, resolveApiVersion, SF_API_NAME_MAX_LEN } from '../core/workspace';
import { auraScaffold, writeScaffold } from '../core/scaffolds';
import { notify } from '../ui/notify';
import { Feature } from './types';

const DEFAULT_DIR = 'force-app/main/default/aura';

/**
 * Creates an Aura component from local templates (no `sf` CLI — see apex.ts).
 */
export const registerAura: Feature = ({ context, logger, orgs }) => {
  context.subscriptions.push(
    vscode.commands.registerCommand(Commands.createAura, async (folderUri?: vscode.Uri) => {
      const target = await resolveOutputTarget(folderUri, DEFAULT_DIR);
      if (!target) {
        return;
      }

      const name = await vscode.window.showInputBox({
        prompt: 'Aura component name',
        placeHolder: 'myAuraComponent',
        validateInput: (v) => {
          const n = v.trim();
          if (!/^[A-Za-z]\w*$/.test(n)) { return 'Letters, numbers, underscores; must start with a letter.'; }
          if (n.length > SF_API_NAME_MAX_LEN) { return `Too long: ${n.length}/${SF_API_NAME_MAX_LEN} characters.`; }
          return undefined;
        }
      });
      if (!name) {
        return;
      }

      try {
        const scaffold = auraScaffold(name.trim(), await resolveApiVersion(target.cwd, orgs));
        const primary = writeScaffold(target.outputDir, scaffold);
        notify.ok(`Aura component "${name}" created.`);
        await vscode.window.showTextDocument(vscode.Uri.file(primary));
      } catch (err: any) {
        logger.error(err.message);
        notify.err(`Aura creation failed: ${err.message}`);
      }
    })
  );
};

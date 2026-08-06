/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { Commands } from '../commands';
import { resolveOutputTarget, resolveApiVersion, SF_API_NAME_MAX_LEN } from '../core/workspace';
import { lwcScaffold, writeScaffold } from '../core/scaffolds';
import { notify } from '../ui/notify';
import { Feature } from './types';

const DEFAULT_DIR = 'force-app/main/default/lwc';

/**
 * Creates a Lightning Web Component from local templates (no `sf` CLI — see apex.ts).
 *
 * When invoked from the explorer context menu, `folderUri` (the clicked `lwc`
 * folder) is used as the output directory; otherwise the user is prompted.
 */
export const registerLwc: Feature = ({ context, logger, orgs }) => {
  context.subscriptions.push(
    vscode.commands.registerCommand(Commands.createLwc, async (folderUri?: vscode.Uri) => {
      const target = await resolveOutputTarget(folderUri, DEFAULT_DIR);
      if (!target) {
        return;
      }

      const name = await vscode.window.showInputBox({
        prompt: 'LWC component name (camelCase)',
        placeHolder: 'myComponent',
        validateInput: (value) => {
          const n = value.trim();
          if (!/^[a-z][a-zA-Z0-9]*$/.test(n)) { return 'Use camelCase: start lowercase, letters and numbers only.'; }
          if (n.length > SF_API_NAME_MAX_LEN) { return `Too long: ${n.length}/${SF_API_NAME_MAX_LEN} characters.`; }
          return undefined;
        }
      });
      if (!name) {
        return;
      }

      try {
        const scaffold = lwcScaffold(name.trim(), await resolveApiVersion(target.cwd, orgs));
        const primary = writeScaffold(target.outputDir, scaffold);
        notify.ok(`LWC component "${name}" created.`);
        await vscode.window.showTextDocument(vscode.Uri.file(primary));
      } catch (err: any) {
        logger.error(err.message);
        notify.err(`LWC creation failed: ${err.message}`);
      }
    })
  );
};

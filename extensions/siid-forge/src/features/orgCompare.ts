/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { Commands } from '../commands';
import { registerDiffReview } from './diffReview';
import { OrgComparePanel } from './orgComparePanel';
import { getWorkspaceCwd } from '../core/workspace';
import { Feature } from './types';

/**
 * Registers the Org Compare command (§19 revised): opens a panel to compare
 * metadata between two sides (Local or any authorized org) and sync one → the
 * other. The heavy lifting lives in `core/orgCompare` + `orgComparePanel`.
 */
export const registerOrgCompare: Feature = ({ context, sf, orgs, logger }) => {
  registerDiffReview(context); // the panel opens diffs via the shared provider

  context.subscriptions.push(
    vscode.commands.registerCommand(Commands.orgCompare, async () => {
      const cwd = getWorkspaceCwd();
      if (!cwd) {
        return; // getWorkspaceCwd already showed the "open a project" error
      }
      await new OrgComparePanel(sf, orgs, logger, cwd).open();
    })
  );
};

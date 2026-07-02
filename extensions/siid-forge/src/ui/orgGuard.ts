/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { Commands } from '../commands';
import { OrgManager } from '../core/orgManager';

/**
 * Guards org-facing commands: if no default org is set, shows an actionable
 * prompt (Authorize / Select) instead of letting the command run and fail deep
 * inside a progress toast with a raw CLI error. Returns the resolved default org
 * on success, or `undefined` when the user has no org and declines to set one
 * (callers should abort quietly in that case).
 *
 * On authorize/select, the user's just-chosen org is re-read and returned, so a
 * command can guard-then-continue in a single click.
 */
export async function ensureDefaultOrg(orgs: OrgManager): Promise<string | undefined> {
  const current = await orgs.getDefaultOrg();
  if (current) {
    return current;
  }

  const AUTHORIZE = 'Authorize Org…';
  const SELECT = 'Select Org…';
  const choice = await vscode.window.showWarningMessage(
    'No default Salesforce org is set. Authorize or select one to continue.',
    AUTHORIZE,
    SELECT
  );
  if (choice === AUTHORIZE) {
    await vscode.commands.executeCommand(Commands.authorizeOrg);
  } else if (choice === SELECT) {
    await vscode.commands.executeCommand(Commands.selectOrg);
  } else {
    return undefined; // dismissed — caller aborts quietly
  }

  // Re-read: the authorize/select flow fires onDidChangeDefaultOrg and
  // invalidates the cache, so this reflects the user's choice (or still-none if
  // they backed out of the picker too).
  return orgs.getDefaultOrg();
}

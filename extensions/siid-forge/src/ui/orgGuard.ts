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

interface TargetOrgPick extends vscode.QuickPickItem {
  /** The alias or username to pass to `--target-org`. */
  value: string;
}

/**
 * Prompts the user to pick ANY authorized org as a one-off deploy/retrieve
 * target — WITHOUT changing the project's default (primary) org. Used by the
 * "Deploy to Org…" / "Retrieve from Org…" commands (§19 phase 2): the picked org
 * is passed through `--target-org` for that single operation only.
 *
 * The current default is labelled so the user can tell it apart, but picking it
 * here still does NOT set it as default (it already is). Returns the chosen
 * alias/username, or undefined if cancelled / no orgs are authorized.
 */
export async function pickTargetOrg(orgs: OrgManager, verb: 'Deploy to' | 'Retrieve from'): Promise<string | undefined> {
  const [list, currentDefault] = await Promise.all([orgs.listOrgs(), orgs.getDefaultOrg()]);
  if (!list.length) {
    const AUTHORIZE = 'Authorize Org…';
    const choice = await vscode.window.showWarningMessage(
      'No authorized Salesforce orgs found. Authorize one to continue.',
      AUTHORIZE
    );
    if (choice === AUTHORIZE) {
      await vscode.commands.executeCommand(Commands.authorizeOrg);
    }
    return undefined;
  }

  const items: TargetOrgPick[] = list.map((o) => {
    const value = o.alias || o.username;
    const isDefault = !!currentDefault && (o.alias === currentDefault || o.username === currentDefault);
    return {
      label: value,
      description: o.alias ? o.username : undefined,
      detail: isDefault ? '$(check) current default org' : undefined,
      value
    };
  });

  const pick = await vscode.window.showQuickPick(items, {
    title: `${verb} which org?`,
    placeHolder: 'The primary/default org is NOT changed — this targets the chosen org for this operation only'
  });
  return pick?.value;
}

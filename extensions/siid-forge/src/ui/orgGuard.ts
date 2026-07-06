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

/** Memento key for the last secondary org targeted in this workspace. */
const LAST_TARGET_ORG_KEY = 'siidForge.lastTargetOrg';

/**
 * Prompts the user to pick ANY authorized org as a one-off deploy/retrieve
 * target — WITHOUT changing the project's default (primary) org. Used by the
 * "Deploy to Org…" / "Retrieve from Org…" commands (§19 phase 2): the picked org
 * is passed through `--target-org` for that single operation only.
 *
 * The current default is labelled so the user can tell it apart, but picking it
 * here still does NOT set it as default (it already is).
 *
 * To cut the "select from scratch every time" friction, the last org targeted in
 * this workspace (persisted in `memento`) is sorted to the top and marked, so
 * reusing it is a single Enter — while the pick still appears, keeping the
 * confirm-before-deploy safety (no silent wrong-org). Returns the chosen
 * alias/username, or undefined if cancelled / no orgs are authorized.
 */
export async function pickTargetOrg(
  orgs: OrgManager,
  verb: 'Deploy to' | 'Retrieve from',
  memento?: vscode.Memento
): Promise<string | undefined> {
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

  const lastTarget = memento?.get<string>(LAST_TARGET_ORG_KEY);
  const items: TargetOrgPick[] = list.map((o) => {
    const value = o.alias || o.username;
    const isDefault = !!currentDefault && (o.alias === currentDefault || o.username === currentDefault);
    const isLast = !!lastTarget && (o.alias === lastTarget || o.username === lastTarget);
    // Detail merges both markers so an org that is BOTH last-used and default reads clearly.
    const marks = [
      isLast ? '$(history) last used' : undefined,
      isDefault ? '$(check) current default org' : undefined
    ].filter(Boolean);
    return {
      label: value,
      description: o.alias ? o.username : undefined,
      detail: marks.length ? marks.join(' · ') : undefined,
      value
    };
  });

  // Float the last-used org to the top so reusing it is one Enter (showQuickPick
  // can't pre-highlight an arbitrary item; ordering is the closest we get).
  items.sort((a, b) => Number(b.value === lastTarget) - Number(a.value === lastTarget));

  const pick = await vscode.window.showQuickPick(items, {
    title: `${verb} which org?`,
    placeHolder: 'The primary/default org is NOT changed — this targets the chosen org for this operation only'
  });
  if (pick && memento) {
    await memento.update(LAST_TARGET_ORG_KEY, pick.value);
  }
  return pick?.value;
}

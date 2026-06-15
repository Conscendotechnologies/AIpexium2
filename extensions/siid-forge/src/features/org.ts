/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { Commands } from '../commands';
import { OrgManager } from '../core/orgManager';
import { Logger } from '../core/logger';
import { Feature } from './types';

const AUTHORIZE_PICK = '$(add) Authorize New Org…';

interface OrgPickItem extends vscode.QuickPickItem {
  isCurrent?: boolean;
  isAuthorize?: boolean;
}

interface OrgTypePick extends vscode.QuickPickItem {
  /** Login URL; 'custom' means prompt, undefined means project default. */
  url?: string | 'custom';
}

const ORG_TYPES: OrgTypePick[] = [
  { label: 'Production', detail: 'Production or Developer org (login.salesforce.com)', url: 'https://login.salesforce.com' },
  { label: 'Sandbox', detail: 'Sandbox org (test.salesforce.com)', url: 'https://test.salesforce.com' },
  { label: 'Custom', detail: 'Enter a custom login URL', url: 'custom' },
  { label: 'Project Default', detail: 'Use the login URL defined in sfdx-project.json', url: undefined }
];

/**
 * Shows the default org in the status bar (left) and lets the user switch or
 * authorize orgs — mirroring the official Salesforce extensions.
 */
export const registerOrg: Feature = ({ context, orgs, logger }) => {
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.command = Commands.selectOrg;
  context.subscriptions.push(statusBar);

  async function refreshStatusBar(): Promise<void> {
    const def = await orgs.getDefaultOrg();
    if (def) {
      statusBar.text = `$(cloud) ${def}`;
      statusBar.tooltip = `Default Salesforce org: ${def}\nClick to change or authorize an org`;
      statusBar.backgroundColor = undefined;
    } else {
      statusBar.text = '$(plug) No Default Org';
      statusBar.tooltip = 'No default Salesforce org set. Click to authorize or select one.';
      statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    }
    statusBar.show();
  }

  context.subscriptions.push(orgs.onDidChangeDefaultOrg(() => refreshStatusBar()));

  // React when target-org is changed elsewhere (e.g. other extensions writing .sf/config.json).
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder) {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(folder, '.sf/config.json')
    );
    watcher.onDidChange(() => refreshStatusBar());
    watcher.onDidCreate(() => refreshStatusBar());
    watcher.onDidDelete(() => refreshStatusBar());
    context.subscriptions.push(watcher);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand(Commands.selectOrg, () => selectOrg(orgs, refreshStatusBar)),
    vscode.commands.registerCommand(Commands.authorizeOrg, () => authorizeOrg(orgs, logger, refreshStatusBar))
  );

  refreshStatusBar();
};

/**
 * Quick pick: choose a default org (current default pre-selected), or authorize a new one.
 */
async function selectOrg(orgs: OrgManager, refresh: () => Promise<void>): Promise<void> {
  const [list, currentDefault] = await Promise.all([orgs.listOrgs(), orgs.getDefaultOrg()]);

  const orgItems: OrgPickItem[] = list.map((o) => {
    const isCurrent = !!currentDefault && (o.alias === currentDefault || o.username === currentDefault);
    return {
      label: o.alias || o.username,
      description: o.alias ? o.username : undefined,
      detail: isCurrent ? '$(check) current default' : undefined,
      isCurrent
    };
  });

  const items: OrgPickItem[] = [
    ...orgItems,
    { label: '', kind: vscode.QuickPickItemKind.Separator },
    { label: AUTHORIZE_PICK, isAuthorize: true }
  ];

  const choice = await showQuickPickWithActive(items, orgItems.find((i) => i.isCurrent), 'Select default org or authorize a new one');
  if (!choice) {
    return;
  }

  if (choice.isAuthorize) {
    await vscode.commands.executeCommand(Commands.authorizeOrg);
    return;
  }

  try {
    await orgs.setDefaultOrg(choice.label);
    vscode.window.showInformationMessage(`✅ Default org set to "${choice.label}".`);
  } catch (err: any) {
    vscode.window.showErrorMessage(`❌ Could not set default org: ${err.message}`);
  }
  await refresh();
}

/** Web login flow: pick org type, optional alias, then authorize. */
async function authorizeOrg(orgs: OrgManager, logger: Logger, refresh: () => Promise<void>): Promise<void> {
  const type = await vscode.window.showQuickPick(ORG_TYPES, { placeHolder: 'Select the type of org to authorize' });
  if (!type) {
    return;
  }

  let instanceUrl: string | undefined;
  if (type.url === 'custom') {
    const custom = await vscode.window.showInputBox({
      prompt: 'Custom login URL',
      placeHolder: 'https://my-domain.my.salesforce.com',
      validateInput: (v) => (/^https?:\/\/.+/.test(v.trim()) ? undefined : 'Enter a valid URL starting with http(s)://')
    });
    if (!custom) {
      return;
    }
    instanceUrl = custom.trim();
  } else {
    instanceUrl = type.url;
  }

  const alias = await vscode.window.showInputBox({
    prompt: 'Alias for the new org (optional)',
    placeHolder: 'my-org'
  });
  if (alias === undefined) {
    return; // Escape cancels; empty string proceeds without alias.
  }

  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'SIID Forge: authorizing org in your browser…' },
      () => orgs.authorizeOrg(alias.trim() || undefined, true, instanceUrl)
    );
    vscode.window.showInformationMessage(`✅ Org authorized${alias.trim() ? ` as "${alias.trim()}"` : ''} and set as default.`);
  } catch (err: any) {
    logger.error(err.message);
    vscode.window.showErrorMessage(`❌ Authorization failed: ${err.message}`);
  }
  await refresh();
}

/**
 * Like showQuickPick, but pre-highlights `active` so the current default org is
 * the focused row when the picker opens.
 */
function showQuickPickWithActive<T extends vscode.QuickPickItem>(
  items: T[],
  active: T | undefined,
  placeholder: string
): Promise<T | undefined> {
  return new Promise((resolve) => {
    const qp = vscode.window.createQuickPick<T>();
    qp.items = items;
    qp.placeholder = placeholder;
    if (active) {
      qp.activeItems = [active];
    }
    let accepted: T | undefined;
    qp.onDidAccept(() => {
      accepted = qp.selectedItems[0];
      qp.hide();
    });
    qp.onDidHide(() => {
      resolve(accepted);
      qp.dispose();
    });
    qp.show();
  });
}

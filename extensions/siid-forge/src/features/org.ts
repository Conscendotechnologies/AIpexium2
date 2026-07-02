/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { Commands } from '../commands';
import { OrgManager } from '../core/orgManager';
import { Logger } from '../core/logger';
import { notify } from '../ui/notify';
import {
  getWorkspaceCwd,
  readProjectApiVersion,
  writeProjectApiVersion,
  apiVersionIsNewer
} from '../core/workspace';
import { Feature } from './types';

const AUTHORIZE_PICK = '$(add) Authorize New Org…';
const REFRESH_PICK = '$(refresh) Refresh org list';

interface OrgPickItem extends vscode.QuickPickItem {
  isCurrent?: boolean;
  isAuthorize?: boolean;
  isRefresh?: boolean;
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
  statusBar.command = Commands.orgActions;
  context.subscriptions.push(statusBar);

  // Show immediately (loading state) so the item is always visible, then update
  // once we've resolved the default org. A failed/slow CLI call must never leave
  // the status bar item hidden.
  statusBar.text = '$(cloud) Salesforce: …';
  statusBar.tooltip = 'SIID Forge — click for org actions';
  statusBar.show();

  async function refreshStatusBar(): Promise<void> {
    let def: string | undefined;
    try {
      def = await orgs.getDefaultOrg();
    } catch (err: any) {
      logger.error(`org status bar: ${err.message}`);
    }
    if (def) {
      statusBar.text = `$(cloud) ${def}`;
      statusBar.tooltip = `Default Salesforce org: ${def}\nClick for org actions (open in browser, change, authorize)`;
      statusBar.backgroundColor = undefined;
      // Refresh the org's API version into the .siid/forge.json mirror so it's
      // cached and kept in sync with the default org (on startup + every org
      // change), then offer to bump the project's sourceApiVersion if it lags.
      // Fire-and-forget — never block the status bar on `org display`.
      void orgs.refreshApiVersion()
        .then((orgVersion) => { if (orgVersion) { void maybePromptApiVersionBump(context, orgVersion, logger); } })
        .catch((err) => logger.error(`refresh apiVersion: ${err.message}`));
    } else {
      statusBar.text = '$(plug) No Default Org';
      statusBar.tooltip = 'No default Salesforce org set. Click to authorize or select one.';
      statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    }
    statusBar.show();
  }

  context.subscriptions.push(orgs.onDidChangeDefaultOrg(() => refreshStatusBar()));

  // React when target-org is changed elsewhere (e.g. other extensions writing
  // .sf/config.json). Invalidate the cached default org first so the refresh
  // reads the new value rather than the stale cache.
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder) {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(folder, '.sf/config.json')
    );
    const onConfigChange = () => { orgs.invalidate(); refreshStatusBar(); };
    watcher.onDidChange(onConfigChange);
    watcher.onDidCreate(onConfigChange);
    watcher.onDidDelete(onConfigChange);
    context.subscriptions.push(watcher);

    // Also watch OUR OWN state file (.siid/forge.json) — a Forge/agent write to
    // the mirrored defaultOrg should refresh the UI without depending on the sf
    // CLI's .sf/ file. Both are our own VS Code watchers (no SF-extension dep).
    const siidWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(folder, '.siid/forge.json')
    );
    siidWatcher.onDidChange(onConfigChange);
    siidWatcher.onDidCreate(onConfigChange);
    context.subscriptions.push(siidWatcher);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand(Commands.selectOrg, () => selectOrg(orgs, refreshStatusBar)),
    vscode.commands.registerCommand(Commands.authorizeOrg, () => authorizeOrg(orgs, logger, refreshStatusBar)),
    vscode.commands.registerCommand(Commands.authorizeOrgWithToken, () => authorizeOrgWithToken(orgs, logger, refreshStatusBar)),
    vscode.commands.registerCommand(Commands.orgActions, () => orgActions(orgs))
  );

  refreshStatusBar();
};

const API_BUMP_DISMISS_KEY = 'siid-forge.dismissedApiVersionBump';

/**
 * When the default org's API version is newer than the project's
 * `sourceApiVersion`, offers a one-time prompt to bump the project file so new
 * metadata scaffolds at the org's latest version. Never writes silently — the
 * project file is user/CLI-owned. Dismissals are remembered per org-version so
 * the toast doesn't nag; it re-appears only when the org moves to a newer
 * version the user hasn't dismissed.
 */
async function maybePromptApiVersionBump(
  context: vscode.ExtensionContext,
  orgVersion: string,
  logger: Logger
): Promise<void> {
  const root = getWorkspaceCwd();
  if (!root) {
    return;
  }
  const projectVersion = readProjectApiVersion(root);
  // Only prompt when the project pins a version AND it lags the org. A project
  // with no sourceApiVersion already scaffolds at the org version (the fallback),
  // so there's nothing to bump.
  if (!projectVersion || !apiVersionIsNewer(orgVersion, projectVersion)) {
    return;
  }
  // Suppress if the user already dismissed THIS org version.
  if (context.globalState.get<string>(API_BUMP_DISMISS_KEY) === orgVersion) {
    return;
  }

  const UPDATE = `Update to ${orgVersion}`;
  const DISMISS = 'Dismiss';
  const choice = await vscode.window.showInformationMessage(
    `Your org's API version (${orgVersion}) is newer than this project's sourceApiVersion (${projectVersion}). Update sfdx-project.json so new metadata uses ${orgVersion}?`,
    UPDATE,
    DISMISS
  );
  if (choice === UPDATE) {
    if (writeProjectApiVersion(root, orgVersion)) {
      notify.ok(`sfdx-project.json updated to API ${orgVersion}.`);
    } else {
      notify.err('Could not update sfdx-project.json.');
    }
  } else if (choice === DISMISS) {
    await context.globalState.update(API_BUMP_DISMISS_KEY, orgVersion);
  }
}

/**
 * Status-bar action menu: open the org in the browser, switch the default org,
 * or authorize a new one.
 */
async function orgActions(orgs: OrgManager): Promise<void> {
  const def = await orgs.getDefaultOrg();
  const actions: Array<vscode.QuickPickItem & { id: 'open' | 'select' | 'authorize' | 'authorizeToken' }> = [];
  if (def) {
    actions.push({ label: '$(globe) Open Org in Browser', description: def, id: 'open' });
  }
  actions.push(
    { label: '$(cloud) Change Default Org', id: 'select' },
    { label: '$(add) Authorize New Org…', description: 'Web login', id: 'authorize' },
    { label: '$(key) Authorize with Session ID…', description: 'Paste a session id / access token', id: 'authorizeToken' }
  );

  const pick = await vscode.window.showQuickPick(actions, {
    placeHolder: def ? `Default org: ${def}` : 'No default org set'
  });
  if (!pick) {
    return;
  }
  switch (pick.id) {
    case 'open':
      await vscode.commands.executeCommand(Commands.openOrg);
      break;
    case 'select':
      await vscode.commands.executeCommand(Commands.selectOrg);
      break;
    case 'authorize':
      await vscode.commands.executeCommand(Commands.authorizeOrg);
      break;
    case 'authorizeToken':
      await vscode.commands.executeCommand(Commands.authorizeOrgWithToken);
      break;
  }
}

/**
 * Quick pick: choose a default org (current default pre-selected), or authorize a new one.
 */
async function selectOrg(orgs: OrgManager, refresh: () => Promise<void>, force = false): Promise<void> {
  // Cached by default (instant); `force` re-fetches when the user asks to refresh.
  const [list, currentDefault] = await Promise.all([orgs.listOrgs(force), orgs.getDefaultOrg()]);

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
    { label: AUTHORIZE_PICK, isAuthorize: true },
    { label: REFRESH_PICK, isRefresh: true }
  ];

  const choice = await showQuickPickWithActive(items, orgItems.find((i) => i.isCurrent), 'Select default org or authorize a new one');
  if (!choice) {
    return;
  }

  if (choice.isRefresh) {
    // Force a fresh `org list` and re-open the picker.
    await selectOrg(orgs, refresh, true);
    return;
  }

  if (choice.isAuthorize) {
    await vscode.commands.executeCommand(Commands.authorizeOrg);
    return;
  }

  try {
    await orgs.setDefaultOrg(choice.label);
    notify.ok(`Default org set to "${choice.label}".`);
  } catch (err: any) {
    notify.err(`Could not set default org: ${err.message}`);
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
    notify.ok(`Org authorized${alias.trim() ? ` as "${alias.trim()}"` : ''} and set as default.`);
  } catch (err: any) {
    logger.error(err.message);
    notify.err(`Authorization failed: ${err.message}`);
  }
  await refresh();
}

/**
 * Session-ID / access-token login flow (no browser): prompt for the instance
 * URL, the session id (masked), and an optional alias, then authorize via
 * `sf org login access-token`. The token is passed to the CLI through an env
 * var, never logged.
 */
async function authorizeOrgWithToken(orgs: OrgManager, logger: Logger, refresh: () => Promise<void>): Promise<void> {
  const instanceUrl = await vscode.window.showInputBox({
    prompt: 'Instance URL of the org this session id belongs to',
    placeHolder: 'https://my-domain.my.salesforce.com',
    ignoreFocusOut: true,
    validateInput: (v) => (/^https?:\/\/.+/.test(v.trim()) ? undefined : 'Enter a valid URL starting with http(s)://')
  });
  if (!instanceUrl) {
    return;
  }

  const token = await vscode.window.showInputBox({
    prompt: 'Session ID / access token — format: <orgId>!<token> (e.g. 00Dxx0000001gPF!AQ…)',
    placeHolder: '00Dxx0000001gPF!AQwAQE...',
    password: true,          // masked input — the value is a live credential
    ignoreFocusOut: true,
    validateInput: (v) => {
      const t = v.trim();
      if (t.length < 15) {
        return 'Paste a valid session id / access token.';
      }
      // The CLI requires the "<orgId>!<token>" shape; catch the common miss early.
      if (!/^00D\w{12,15}!/.test(t)) {
        return 'Expected format "<orgId>!<token>" — it should start with an org id (00D…) followed by "!".';
      }
      return undefined;
    }
  });
  if (!token) {
    return;
  }

  const alias = await vscode.window.showInputBox({
    prompt: 'Alias for the new org (optional)',
    placeHolder: 'my-org',
    ignoreFocusOut: true
  });
  if (alias === undefined) {
    return; // Escape cancels; empty proceeds without alias.
  }

  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'SIID Forge: authorizing org from session id…' },
      () => orgs.authorizeWithAccessToken(token.trim(), instanceUrl.trim(), alias.trim() || undefined, true)
    );
    notify.ok(`Org authorized${alias.trim() ? ` as "${alias.trim()}"` : ''} and set as default.`);
  } catch (err: any) {
    logger.error(`authorizeWithAccessToken: ${err.message}`);
    notify.err(`Session-id authorization failed: ${err.message}`);
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

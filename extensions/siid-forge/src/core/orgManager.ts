/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { SfExecutor } from './sfExecutor';
import { Logger } from './logger';
import { getWorkspaceCwd } from './workspace';

export interface OrgInfo {
  alias?: string;
  username: string;
  orgId?: string;
  isDefault?: boolean;
}

/**
 * Tracks Salesforce orgs and the default (target) org via the `sf` CLI.
 * This is the single source of truth other features (and later the SDK) read.
 */
export class OrgManager {
  private readonly _onDidChangeDefaultOrg = new vscode.EventEmitter<string | undefined>();
  readonly onDidChangeDefaultOrg = this._onDidChangeDefaultOrg.event;

  /**
   * Cached identity for the current default org — cleared on org change.
   * NOTE: `org display`'s `id` is the ORG id (00D…), not a User id. The running
   * User id (005…) must be queried separately and is cached here too.
   */
  private displayCache?: { username?: string; orgId?: string };
  private userIdCache?: string;

  constructor(private readonly sf: SfExecutor, private readonly logger: Logger) {
    // Any default-org change invalidates the cached identity.
    this.onDidChangeDefaultOrg(() => { this.invalidate(); });
  }

  /** Forget cached org identity (e.g. after re-auth). */
  invalidate(): void {
    this.displayCache = undefined;
    this.userIdCache = undefined;
  }

  /** `org display` result, cached for the session (until the org changes). */
  private async orgDisplay(): Promise<{ username?: string; orgId?: string }> {
    if (this.displayCache) {
      return this.displayCache;
    }
    try {
      const { result } = await this.sf.run<{ username?: string; id?: string }>(['org', 'display'], { cwd: this.cwd() });
      this.displayCache = { username: result?.username, orgId: result?.id };
    } catch (err: any) {
      this.logger.error(`orgDisplay: ${err.message}`);
      this.displayCache = {};
    }
    return this.displayCache;
  }

  /** The cwd used for org config — the project root, or global when none open. */
  private cwd(): string | undefined {
    return vscode.workspace.workspaceFolders?.length ? getWorkspaceCwd() : undefined;
  }

  /** Returns the default (target) org alias/username, or undefined when none is set. */
  async getDefaultOrg(): Promise<string | undefined> {
    try {
      const { result } = await this.sf.run<Array<{ value?: string }>>(['config', 'get', 'target-org'], { cwd: this.cwd() });
      return result?.[0]?.value || undefined;
    } catch (err: any) {
      this.logger.error(`getDefaultOrg: ${err.message}`);
      return undefined;
    }
  }

  /** Returns the username of the default org's connected user, or undefined. */
  async getUsername(): Promise<string | undefined> {
    return (await this.orgDisplay()).username;
  }

  /**
   * Returns the running User's 18-char Id (005…), cached for the session.
   * `org display` only exposes the Org id, so this queries the User by username.
   */
  async getUserId(): Promise<string | undefined> {
    if (this.userIdCache) {
      return this.userIdCache;
    }
    const username = await this.getUsername();
    if (!username) {
      return undefined;
    }
    try {
      const { result } = await this.sf.run<{ records: Array<{ Id: string }> }>(
        ['data', 'query', '--query', `SELECT Id FROM User WHERE Username = '${username.replace(/'/g, "\\'")}'`],
        { cwd: this.cwd() }
      );
      this.userIdCache = result?.records?.[0]?.Id;
    } catch (err: any) {
      this.logger.error(`getUserId: ${err.message}`);
    }
    return this.userIdCache;
  }

  /** Lists all authorized (non-scratch + scratch) orgs. */
  async listOrgs(): Promise<OrgInfo[]> {
    try {
      const { result } = await this.sf.run<any>(['org', 'list'], { cwd: this.cwd() });
      const groups: any[] = [
        ...(result?.nonScratchOrgs ?? []),
        ...(result?.scratchOrgs ?? [])
      ];
      return groups.map((o) => ({
        alias: o.alias,
        username: o.username,
        orgId: o.orgId,
        isDefault: !!o.isDefaultUsername
      }));
    } catch (err: any) {
      this.logger.error(`listOrgs: ${err.message}`);
      return [];
    }
  }

  /** Sets the default (target) org for the current project. */
  async setDefaultOrg(aliasOrUsername: string): Promise<void> {
    await this.sf.run(['config', 'set', `target-org=${aliasOrUsername}`], { cwd: this.cwd() });
    this._onDidChangeDefaultOrg.fire(aliasOrUsername);
  }

  /**
   * Authorizes a new org via the web login flow (`sf org login web`).
   * Opens the system browser and resolves when auth completes.
   *
   * @param instanceUrl Login URL (e.g. https://test.salesforce.com for sandbox).
   *                    Omit to use the project's default login URL.
   */
  async authorizeOrg(alias: string | undefined, setDefault: boolean, instanceUrl?: string): Promise<void> {
    const args = ['org', 'login', 'web'];
    if (instanceUrl) {
      args.push('--instance-url', instanceUrl);
    }
    if (alias) {
      args.push('--alias', alias);
    }
    if (setDefault) {
      args.push('--set-default');
    }
    await this.sf.run(args, { cwd: this.cwd() });
    if (setDefault && alias) {
      this._onDidChangeDefaultOrg.fire(alias);
    } else {
      this._onDidChangeDefaultOrg.fire(await this.getDefaultOrg());
    }
  }
}

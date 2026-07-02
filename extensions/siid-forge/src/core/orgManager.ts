/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { SfExecutor } from './sfExecutor';
import { Logger } from './logger';
import { getWorkspaceCwd } from './workspace';
import { readForgeConfig, writeForgeConfig } from './forgeConfig';

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

  /** Cached `org list` result + when it was captured (ms epoch). */
  private orgListCache?: { orgs: OrgInfo[]; at: number };
  /** Cached default-org alias. `undefined` = not resolved; `''` = resolved to none. */
  private defaultOrgCache?: string;
  /** How long a cached org list stays fresh. Org membership changes rarely, so
   *  a generous TTL makes the picker feel instant; mutations invalidate early. */
  private static readonly ORG_LIST_TTL_MS = 30_000;

  constructor(private readonly sf: SfExecutor, private readonly logger: Logger) {
    // Any default-org change invalidates the cached identity.
    this.onDidChangeDefaultOrg(() => { this.invalidate(); });
  }

  /** Forget cached org identity + list (e.g. after re-auth or an org change). */
  invalidate(): void {
    this.displayCache = undefined;
    this.userIdCache = undefined;
    this.orgListCache = undefined;
    this.defaultOrgCache = undefined;
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

  /**
   * Returns the default (target) org alias/username, or undefined when none is
   * set. Resolves from LOCAL files first (instant, no `sf` process), in order:
   * `.sf/config.json` (source of truth) → legacy `.sfdx/sfdx-config.json` →
   * our own `.siid/forge.json` mirror → finally the CLI (global default). The
   * result — including "none" — is cached so a project with no local config
   * never re-spawns the CLI on every call. Watchers + org mutations invalidate.
   */
  async getDefaultOrg(): Promise<string | undefined> {
    if (this.defaultOrgCache !== undefined) {
      return this.defaultOrgCache || undefined;
    }
    const root = this.cwd();

    // 1. Source of truth: the sf CLI's own `.sf/config.json` (what commands use).
    const fromSf = this.readLocalConfigOrg(root, '.sf', 'config.json', 'target-org');
    if (fromSf) {
      this.setDefaultOrgCache(root, fromSf);
      return fromSf;
    }

    // 2. Legacy `.sfdx/sfdx-config.json` (old sfdx CLI, `defaultusername`) — for
    //    projects that predate `.sf/`.
    const fromSfdx = this.readLocalConfigOrg(root, '.sfdx', 'sfdx-config.json', 'defaultusername');
    if (fromSfdx) {
      this.setDefaultOrgCache(root, fromSfdx);
      return fromSfdx;
    }

    // 3. Our owned mirror: `.siid/forge.json` (survives if NEITHER CLI folder is
    //    present). Not authoritative, but a fine fallback.
    if (root) {
      const mirrored = readForgeConfig(root).defaultOrg;
      if (mirrored) {
        this.defaultOrgCache = mirrored;
        return mirrored;
      }
    }

    // 4. Last resort: ask the CLI (covers a GLOBAL default with no project
    //    override). Cache the result — even '' (none) — so this runs at MOST
    //    once, never on every call, even with no local config present.
    try {
      const { result } = await this.sf.run<Array<{ value?: string }>>(['config', 'get', 'target-org'], { cwd: root });
      const value = result?.[0]?.value || '';
      this.setDefaultOrgCache(root, value);
      return value || undefined;
    } catch (err: any) {
      this.logger.error(`getDefaultOrg: ${err.message}`);
      this.defaultOrgCache = ''; // cache the failure too — don't re-spawn every call
      return undefined;
    }
  }

  /** Caches the resolved default org and mirrors it into `.siid/forge.json`. */
  private setDefaultOrgCache(root: string | undefined, value: string): void {
    this.defaultOrgCache = value;
    if (root && value) {
      try {
        const cfg = readForgeConfig(root);
        if (cfg.defaultOrg !== value) {
          writeForgeConfig(root, { ...cfg, defaultOrg: value });
        }
      } catch {
        /* mirror is best-effort — never fail a read because the mirror write did */
      }
    }
  }

  /** Reads an org alias from a local CLI config file (`.sf` or legacy `.sfdx`). */
  private readLocalConfigOrg(root: string | undefined, dir: string, file: string, key: string): string | undefined {
    if (!root) {
      return undefined;
    }
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(root, dir, file), 'utf-8'));
      const value = cfg?.[key];
      return typeof value === 'string' && value ? value : undefined;
    } catch {
      return undefined; // no file / not readable → fall back
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

  /**
   * Lists all authorized (non-scratch + scratch) orgs. Cached for a short TTL so
   * the org picker opens instantly on repeat calls; pass `force` to bypass the
   * cache (e.g. an explicit "refresh"). The cache is cleared on any org mutation
   * (authorize / set-default) via `invalidate()`.
   */
  async listOrgs(force = false): Promise<OrgInfo[]> {
    const cached = this.orgListCache;
    if (!force && cached && Date.now() - cached.at < OrgManager.ORG_LIST_TTL_MS) {
      return cached.orgs;
    }
    try {
      const { result } = await this.sf.run<any>(['org', 'list'], { cwd: this.cwd() });
      const groups: any[] = [
        ...(result?.nonScratchOrgs ?? []),
        ...(result?.scratchOrgs ?? [])
      ];
      const orgs = groups.map((o) => ({
        alias: o.alias,
        username: o.username,
        orgId: o.orgId,
        isDefault: !!o.isDefaultUsername
      }));
      this.orgListCache = { orgs, at: Date.now() };
      return orgs;
    } catch (err: any) {
      this.logger.error(`listOrgs: ${err.message}`);
      // On failure, fall back to a stale cache if we have one — better than empty.
      return cached?.orgs ?? [];
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

  /**
   * Authorizes an org from an existing **session ID / access token** (no browser)
   * via `sf org login access-token`. The token is passed through the
   * `SF_ACCESS_TOKEN` env var — NOT on the command line — so it never lands in
   * logs or the process list. Used for headless/CI-style auth or when only a
   * session id (e.g. from browser cookies) is available.
   *
   * @param instanceUrl The org's instance URL (e.g. https://x.my.salesforce.com).
   *                    Required — the CLI cannot infer it from a bare token.
   */
  async authorizeWithAccessToken(
    accessToken: string,
    instanceUrl: string,
    alias: string | undefined,
    setDefault: boolean
  ): Promise<void> {
    const args = ['org', 'login', 'access-token', '--instance-url', instanceUrl, '--no-prompt'];
    if (alias) {
      args.push('--alias', alias);
    }
    if (setDefault) {
      args.push('--set-default');
    }
    // Token goes via env (SF_ACCESS_TOKEN), never as an arg — keeps it out of logs.
    await this.sf.run(args, { cwd: this.cwd(), env: { SF_ACCESS_TOKEN: accessToken } });
    if (setDefault && alias) {
      this._onDidChangeDefaultOrg.fire(alias);
    } else {
      this._onDidChangeDefaultOrg.fire(await this.getDefaultOrg());
    }
  }
}

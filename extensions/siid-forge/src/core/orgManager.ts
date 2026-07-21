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
 * Minimal persistence slice (a `vscode.Memento`) used to survive cached org
 * state — the org list, `org display` identity, and org kind — across IDE
 * opens. Kept as a narrow interface so OrgManager stays decoupled from the full
 * ExtensionContext (and is trivially fakeable in tests).
 */
export interface OrgListStore {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
}

/** globalState key under which the last `org list` result is persisted. */
const ORG_LIST_STORE_KEY = 'siidForge.orgListCache';
/**
 * Max age of a persisted list before we treat it as stale and revalidate in the
 * background. Serving it instantly regardless keeps the UI fast; this only gates
 * whether we bother re-running `org list`.
 */
const ORG_LIST_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** globalState key under which the last `org display` identity is persisted. */
const ORG_DISPLAY_STORE_KEY = 'siidForge.orgDisplayCache';
/** globalState key under which the resolved org kind is persisted. */
const ORG_KIND_STORE_KEY = 'siidForge.orgKindCache';

/** Identity fields resolved from `sf org display`, cached per default org. */
interface OrgDisplay {
  username?: string;
  orgId?: string;
  apiVersion?: string;
  instanceUrl?: string;
}

/**
 * Persisted identity/kind entry. Both are keyed by the default-org `alias` so a
 * seeded value is only trusted when it matches the CURRENT default org — never
 * serving one org's identity for another after a switch. `at` gates the
 * stale-while-revalidate refresh for identity.
 */
interface OrgDisplayStoreEntry { alias: string; display: OrgDisplay; at: number; }
interface OrgKindStoreEntry { alias: string; kind: OrgKind; }

/**
 * Max age of persisted identity before a background revalidate. Identity
 * (username/orgId/instanceUrl) is effectively immutable for a given org, so this
 * is generous — it only guards against a re-auth changing the running user.
 */
const ORG_DISPLAY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Edition/kind of the default org — drives the "never deploy to production" guard. */
export type OrgKind = 'sandbox' | 'developer' | 'scratch' | 'production' | 'unknown';

interface OrganizationRow {
  OrganizationType?: string;
  IsSandbox?: boolean;
  TrialExpirationDate?: string | null;
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
  private displayCache?: OrgDisplay;
  private userIdCache?: string;
  /** Guards `healLocalConfig` so a re-entrant call doesn't stack `config set` writes. */
  private healingConfig = false;
  /** Cached org edition/kind — immutable for a given org, cleared on org change. */
  private orgKindCache?: OrgKind;

  /** Cached `org list` result + when it was captured (ms epoch). */
  private orgListCache?: { orgs: OrgInfo[]; at: number };
  /** Cached default-org alias. `undefined` = not resolved; `''` = resolved to none. */
  private defaultOrgCache?: string;

  constructor(
    private readonly sf: SfExecutor,
    private readonly logger: Logger,
    /** Optional persistence (globalState) so the org list survives IDE opens. */
    private readonly store?: OrgListStore
  ) {
    // Any default-org change invalidates the cached identity.
    this.onDidChangeDefaultOrg(() => { this.invalidate(); });
    // Seed the in-memory cache from the last persisted list so the first
    // picker/status open after an IDE reload is instant (no "Listing orgs…").
    const persisted = this.store?.get<{ orgs: OrgInfo[]; at: number }>(ORG_LIST_STORE_KEY);
    if (persisted?.orgs) {
      this.orgListCache = persisted;
    }
  }

  /**
   * Forget cached org IDENTITY (e.g. after re-auth or a default-org change).
   * In-memory only — deliberately does NOT touch `.siid/forge.json`. Writing to
   * the mirror here would trip our own config watcher (which calls `invalidate`),
   * causing a write→watch→invalidate loop. The mirrored apiVersion is instead
   * OVERWRITTEN with the current org's value by `refreshApiVersion()`, which the
   * org status refresh calls after a change.
   *
   * NOTE: this deliberately does NOT clear the org LIST. Switching the default
   * org (which fires this on every change, plus the .sf/config.json watcher)
   * doesn't change org MEMBERSHIP, so re-running the slow `org list` each time is
   * wasteful. The list is cleared only when an org is actually added/removed —
   * see `invalidateOrgList()`.
   */
  invalidate(): void {
    this.displayCache = undefined;
    this.userIdCache = undefined;
    this.defaultOrgCache = undefined;
    this.orgKindCache = undefined;
  }

  /**
   * Forget the cached org LIST — call only when org membership actually changes
   * (authorize a new org, or log out / remove one). Kept separate from
   * `invalidate()` so a mere default-org switch doesn't force a fresh, slow
   * `org list` on the next picker open. Also clears the persisted copy so a
   * following IDE open doesn't resurrect the stale list.
   */
  invalidateOrgList(): void {
    this.orgListCache = undefined;
    void this.store?.update(ORG_LIST_STORE_KEY, undefined);
  }

  /** In-flight `org display` fetch, so concurrent callers share one CLI spawn. */
  private orgDisplayInflight?: Promise<OrgDisplay>;

  /**
   * `org display` identity for the default org. Cached for the session AND
   * persisted to globalState (keyed by the default-org alias) so username/orgId/
   * instanceUrl survive an IDE reopen — those have no `.siid/forge.json` mirror,
   * so without this the first record-link / user-id lookup re-spawns the slow
   * `org display` on every window. Uses stale-while-revalidate: a persisted
   * entry for the CURRENT org is served instantly and refreshed in the
   * background once past the TTL, so the caller never waits on "Reading org
   * info". A persisted entry for a DIFFERENT org is ignored (fetched fresh).
   */
  private async orgDisplay(): Promise<OrgDisplay> {
    if (this.displayCache) {
      return this.displayCache;
    }
    const target = await this.getDefaultOrg();
    // Seed from persistence when it matches the current default org.
    const persisted = this.store?.get<OrgDisplayStoreEntry>(ORG_DISPLAY_STORE_KEY);
    if (persisted && target && persisted.alias === target) {
      this.displayCache = persisted.display;
      if (Date.now() - persisted.at > ORG_DISPLAY_TTL_MS) {
        void this.fetchOrgDisplay(target).catch(() => { /* background refresh — ignore */ });
      }
      return this.displayCache;
    }
    try {
      return await this.fetchOrgDisplay(target);
    } catch (err: any) {
      this.logger.error(`orgDisplay: ${err.message}`);
      this.displayCache = {};
      return this.displayCache;
    }
  }

  /**
   * Runs `sf org display`, updates the in-memory + persisted identity cache, and
   * mirrors the org's API version into `.siid/forge.json`. Coalesces concurrent
   * calls onto one CLI spawn (a foreground read and a background revalidate).
   */
  private fetchOrgDisplay(target: string | undefined): Promise<OrgDisplay> {
    if (this.orgDisplayInflight) {
      return this.orgDisplayInflight;
    }
    this.orgDisplayInflight = (async () => {
      try {
        // Target SIID Forge's default org EXPLICITLY — not the CLI's ambient
        // default, which can differ (SIID lets you pick a default that isn't the
        // CLI's). Otherwise `instanceUrl`/`username` here would describe a
        // different org than the one queries actually run against, and record
        // deep-links would open the wrong org ("Page not found").
        const args = target ? ['org', 'display', '--target-org', target] : ['org', 'display'];
        const { result } = await this.sf.run<{ username?: string; id?: string; apiVersion?: string; instanceUrl?: string }>(args, { cwd: this.cwd() });
        const display: OrgDisplay = { username: result?.username, orgId: result?.id, apiVersion: result?.apiVersion, instanceUrl: result?.instanceUrl };
        this.displayCache = display;
        // Persist keyed by the resolved org so a reopen serves it instantly, and
        // a later org switch (different alias) won't match / mis-serve it.
        if (target) {
          void this.store?.update(ORG_DISPLAY_STORE_KEY, { alias: target, display, at: Date.now() } satisfies OrgDisplayStoreEntry);
        }
        // Mirror the org's API version into our config so scaffolds have a CLI-free
        // fallback (and it refreshes with the rest on the next org change).
        const root = this.cwd();
        if (root && result?.apiVersion) {
          try {
            const cfg = readForgeConfig(root);
            if (cfg.apiVersion !== result.apiVersion) {
              writeForgeConfig(root, { ...cfg, apiVersion: result.apiVersion });
            }
          } catch { /* mirror is best-effort */ }
        }
        return display;
      } finally {
        this.orgDisplayInflight = undefined;
      }
    })();
    return this.orgDisplayInflight;
  }

  /**
   * Metadata API version of the default org (e.g. "67.0"), from `sf org display`
   * — cached for the session and mirrored into `.siid/forge.json`. Reads the
   * mirror first so it resolves instantly (and CLI-free) on repeat calls; only
   * hits the CLI when neither the session cache nor the mirror has it. Returns
   * undefined when there's no org / it can't be determined.
   */
  async getApiVersion(): Promise<string | undefined> {
    if (this.displayCache?.apiVersion) {
      return this.displayCache.apiVersion;
    }
    const root = this.cwd();
    if (root) {
      const mirrored = readForgeConfig(root).apiVersion;
      if (mirrored) {
        return mirrored;
      }
    }
    return (await this.orgDisplay()).apiVersion;
  }

  /**
   * The default org's instance URL (e.g. `https://x.my.salesforce.com`), from
   * `sf org display` — cached for the session. Used to build direct record links
   * (`<instanceUrl>/<recordId>`), which Salesforce's classic redirect resolves to
   * the right Lightning page regardless of object type. Returns undefined when
   * there's no org / it can't be determined.
   */
  async getInstanceUrl(): Promise<string | undefined> {
    if (this.displayCache?.instanceUrl) {
      return this.displayCache.instanceUrl;
    }
    return (await this.orgDisplay()).instanceUrl;
  }

  /**
   * Forces a fresh `org display` (bypassing the mirror) to re-cache the current
   * org's API version and overwrite the `.siid/forge.json` mirror. Called by the
   * org status refresh after a change, so the mirror tracks the CURRENT org
   * rather than serving the previous org's stale value. The write-guard in
   * `orgDisplay()` means an unchanged version writes nothing (no watcher churn).
   */
  async refreshApiVersion(): Promise<string | undefined> {
    // `invalidate()` (fired on org change) has already cleared displayCache.
    // Force a real `org display` (bypassing the persisted-identity seed) so the
    // mirror tracks the CURRENT org's live version rather than a possibly-stale
    // persisted value — this is the one caller that explicitly wants freshness.
    try {
      return (await this.fetchOrgDisplay(await this.getDefaultOrg())).apiVersion;
    } catch (err: any) {
      this.logger.error(`refreshApiVersion: ${err.message}`);
      return this.displayCache?.apiVersion;
    }
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

    // 3. Our owned mirror: `.siid/forge.json`. Reaching here means the CLI's own
    //    project config (`.sf/config.json`) has NO target-org, yet SIID has a
    //    remembered selection. That's a DIVERGENCE: SIID would show this org, but
    //    CLI commands (query/update/deploy) would fall back to the CLI's *global*
    //    default — a DIFFERENT org. Heal it by writing the mirror's org into
    //    `.sf/config.json` so the CLI and SIID always agree, and no command needs
    //    a per-call `--target-org`. Best-effort + fire-and-forget so a read never
    //    blocks on (or fails because of) the CLI write.
    if (root) {
      const mirrored = readForgeConfig(root).defaultOrg;
      if (mirrored) {
        this.defaultOrgCache = mirrored;
        void this.healLocalConfig(root, mirrored);
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
   * Edition/kind of the default org (production / sandbox / developer / scratch),
   * cached for the session and cleared on org change. Drives the "never deploy to
   * production" guard for AI test generation. FAILS CLOSED to 'unknown' on any
   * doubt — the caller still warns before deploying. The underlying value is
   * immutable for a given org, so caching removes a repeated ~3-5s query that
   * previously ran on every generate + retry.
   */
  async getOrgKind(): Promise<OrgKind> {
    if (this.orgKindCache) {
      return this.orgKindCache;
    }
    // Org kind is immutable for a given org, so a persisted value for the CURRENT
    // default org is served directly — no revalidate, no TTL. This removes the
    // ~3-5s Organization query on the first generate/deploy after an IDE reopen.
    const target = await this.getDefaultOrg();
    const persisted = this.store?.get<OrgKindStoreEntry>(ORG_KIND_STORE_KEY);
    if (persisted && target && persisted.alias === target) {
      this.orgKindCache = persisted.kind;
      return persisted.kind;
    }
    let kind: OrgKind = 'unknown';
    try {
      const { result } = await this.sf.run<{ records?: OrganizationRow[] }>(
        ['data', 'query', '--query', 'SELECT OrganizationType, IsSandbox, TrialExpirationDate FROM Organization LIMIT 1'],
        { cwd: this.cwd(), acceptNonZeroStatus: true }
      );
      const row = result?.records?.[0];
      if (row) {
        const type = (row.OrganizationType ?? '').toLowerCase();
        if (row.IsSandbox) {
          kind = 'sandbox';
        } else if (type.includes('developer')) {
          kind = 'developer';
        } else if (row.TrialExpirationDate) {
          kind = 'scratch'; // trial/scratch orgs carry an expiration date
        } else if (type) {
          kind = 'production'; // a real edition, not sandbox, no trial
        }
      }
    } catch (err: any) {
      this.logger.error(`getOrgKind: ${err.message}`);
    }
    this.orgKindCache = kind;
    // Persist only a DEFINITE kind — never 'unknown' (the fail-closed fallback),
    // so a transient query failure doesn't get cached across sessions and keep
    // the deploy guard needlessly cautious.
    if (target && kind !== 'unknown') {
      void this.store?.update(ORG_KIND_STORE_KEY, { alias: target, kind } satisfies OrgKindStoreEntry);
    }
    return kind;
  }

  /** In-flight `org list` fetch, so concurrent callers share one CLI spawn. */
  private orgListInflight?: Promise<OrgInfo[]>;

  /**
   * Lists all authorized (non-scratch + scratch) orgs. Cached for the SESSION —
   * org membership only changes when the user authorizes or removes an org — and
   * PERSISTED to globalState so the cache also survives an IDE reload (the
   * in-memory `OrgManager` is recreated each activation, but its cache is seeded
   * from the persisted copy). Uses stale-while-revalidate: a cached list is
   * returned INSTANTLY, and if it's older than the TTL a background refresh is
   * kicked off so the next open is fresh — the caller never waits on
   * "Listing orgs…". The cache is cleared solely by `invalidateOrgList()` (the
   * authorize/logout flows). Pass `force` for an explicit "refresh org list"
   * action, which awaits a fresh fetch.
   */
  async listOrgs(force = false): Promise<OrgInfo[]> {
    const cached = this.orgListCache;
    if (!force && cached) {
      // Stale-while-revalidate: hand back the cache now, refresh in the
      // background if it's aged past the TTL (best-effort; errors are swallowed).
      if (Date.now() - cached.at > ORG_LIST_TTL_MS) {
        void this.fetchOrgs().catch(() => { /* background refresh — ignore */ });
      }
      return cached.orgs;
    }
    try {
      return await this.fetchOrgs();
    } catch (err: any) {
      this.logger.error(`listOrgs: ${err.message}`);
      // On failure, fall back to a stale cache if we have one — better than empty.
      return cached?.orgs ?? [];
    }
  }

  /**
   * Runs `sf org list`, updates the in-memory + persisted cache, and returns the
   * normalized orgs. Coalesces concurrent calls onto one CLI spawn so a
   * foreground `force` and a background revalidate don't both shell out.
   */
  private fetchOrgs(): Promise<OrgInfo[]> {
    if (this.orgListInflight) {
      return this.orgListInflight;
    }
    this.orgListInflight = (async () => {
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
        const entry = { orgs, at: Date.now() };
        this.orgListCache = entry;
        void this.store?.update(ORG_LIST_STORE_KEY, entry);
        return orgs;
      } finally {
        this.orgListInflight = undefined;
      }
    })();
    return this.orgListInflight;
  }

  /** Sets the default (target) org for the current project. */
  async setDefaultOrg(aliasOrUsername: string): Promise<void> {
    await this.sf.run(['config', 'set', `target-org=${aliasOrUsername}`], { cwd: this.cwd() });
    this._onDidChangeDefaultOrg.fire(aliasOrUsername);
  }

  /**
   * Persists SIID's remembered default org (from the `.siid/forge.json` mirror)
   * into the CLI's project config (`.sf/config.json`) when the CLI has none —
   * closing the drift where SIID shows one org but CLI commands would use the
   * global default. Idempotent and guarded: re-reads the live CLI config and only
   * writes when it's still missing (so it doesn't overwrite an org the user set
   * out-of-band, and doesn't churn on repeat calls). Does NOT fire
   * `onDidChangeDefaultOrg` — nothing changed from SIID's perspective; we're only
   * making the CLI agree with what SIID already resolved. Best-effort: any failure
   * is logged and swallowed (the org is still returned to the caller).
   */
  private async healLocalConfig(root: string, org: string): Promise<void> {
    if (this.healingConfig) {
      return; // a heal is already in flight — don't stack writes
    }
    this.healingConfig = true;
    try {
      // Re-check the LIVE file: getDefaultOrg read it a moment ago, but re-reading
      // right before the write avoids clobbering a value written in between.
      const current = this.readLocalConfigOrg(root, '.sf', 'config.json', 'target-org');
      if (current) {
        return; // CLI already has a project org — nothing to heal
      }
      await this.sf.run(['config', 'set', `target-org=${org}`], { cwd: root });
      this.logger.info(`Healed .sf/config.json target-org → ${org} (matched SIID's selection).`);
    } catch (err: any) {
      this.logger.error(`healLocalConfig: ${err?.message}`);
    } finally {
      this.healingConfig = false;
    }
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
    this.invalidateOrgList(); // a new org was added — refresh the list next open
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
    this.invalidateOrgList(); // a new org was added — refresh the list next open
    if (setDefault && alias) {
      this._onDidChangeDefaultOrg.fire(alias);
    } else {
      this._onDidChangeDefaultOrg.fire(await this.getDefaultOrg());
    }
  }
}

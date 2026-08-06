/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { SfExecutor } from './sfExecutor';
import { Logger } from './logger';
import { readForgeConfig, writeForgeConfig } from './forgeConfig';

const DEBUG_LEVEL_NAME = 'SIIDForge';
/** TraceFlag lifetime — Salesforce caps user trace flags at 24 hours. */
const TRACE_HOURS = 24;
/** Re-create when less than this remains, so a run isn't left without logging. */
const RENEW_BUFFER_MS = 5 * 60 * 1000;

/**
 * Ensures an active debug TraceFlag (with a DebugLevel) exists for the org's
 * running user so that Apex runs produce debug logs. The flag's ids/expiry are
 * cached in `.siid/forge.json`; the org is consulted before creating a new one.
 */
export class TraceManager {
  constructor(private readonly sf: SfExecutor, private readonly logger: Logger) { }

  /**
   * Guarantees a usable trace flag for `username`, creating one if needed.
   * Returns silently on success; throws with a readable message on failure.
   */
  async ensureTraceFlag(projectRoot: string, username: string, knownUserId?: string): Promise<void> {
    const cwd = projectRoot;

    // 1. Cached and still valid for this user? Nothing to do.
    const cfg = readForgeConfig(projectRoot);
    if (cfg.trace && cfg.trace.username === username && this.isValid(cfg.trace.expirationDate)) {
      this.logger.info('Trace flag: using cached active flag.');
      return;
    }

    // Prefer the caller's user id (from `org display`) to avoid an extra query.
    const userId = knownUserId ?? await this.getUserId(cwd, username);

    // 2. An active flag may already exist in the org (e.g. cache was cleared).
    const existing = await this.findActiveTraceFlag(cwd, userId);
    if (existing) {
      this.logger.info('Trace flag: reusing existing active flag from org.');
      writeForgeConfig(projectRoot, {
        ...cfg,
        trace: { username, debugLevelId: existing.debugLevelId, traceFlagId: existing.id, expirationDate: existing.expirationDate }
      });
      return;
    }

    // 3. Create (reuse our DebugLevel if present) a fresh trace flag. A cached
    //    DebugLevel id skips the lookup + per-run update entirely.
    const debugLevelId = await this.ensureDebugLevel(cwd, cfg.trace?.debugLevelId);
    const now = new Date();
    const expiration = new Date(now.getTime() + TRACE_HOURS * 60 * 60 * 1000);
    const traceFlagId = await this.createTraceFlag(cwd, userId, debugLevelId, now, expiration);

    writeForgeConfig(projectRoot, {
      ...cfg,
      trace: { username, debugLevelId, traceFlagId, expirationDate: expiration.toISOString() }
    });
    this.logger.info('Trace flag: created new flag.');
  }

  private isValid(expirationDate: string): boolean {
    const exp = Date.parse(expirationDate);
    return !isNaN(exp) && exp - Date.now() > RENEW_BUFFER_MS;
  }

  private async getUserId(cwd: string, username: string): Promise<string> {
    const { result } = await this.sf.run<{ records: Array<{ Id: string }> }>(
      ['data', 'query', '--query', `SELECT Id FROM User WHERE Username = '${username}'`],
      { cwd }
    );
    const id = result?.records?.[0]?.Id;
    if (!id) {
      throw new Error(`Could not resolve user id for ${username}.`);
    }
    return id;
  }

  private async findActiveTraceFlag(
    cwd: string,
    userId: string
  ): Promise<{ id: string; debugLevelId: string; expirationDate: string } | undefined> {
    try {
      const { result } = await this.sf.run<{ records: Array<{ Id: string; DebugLevelId: string; ExpirationDate: string }> }>(
        [
          'data', 'query', '--use-tooling-api', '--query',
          `SELECT Id, DebugLevelId, ExpirationDate FROM TraceFlag WHERE TracedEntityId = '${userId}' AND LogType = 'USER_DEBUG' ORDER BY ExpirationDate DESC LIMIT 1`
        ],
        { cwd }
      );
      const rec = result?.records?.[0];
      if (rec && this.isValid(rec.ExpirationDate)) {
        return { id: rec.Id, debugLevelId: rec.DebugLevelId, expirationDate: rec.ExpirationDate };
      }
    } catch (err: any) {
      this.logger.error(`findActiveTraceFlag: ${err.message}`);
    }
    return undefined;
  }

  /**
   * Replay-grade log levels. ApexCode=FINEST is what emits STATEMENT_EXECUTE,
   * VARIABLE_ASSIGNMENT and METHOD_ENTRY/EXIT that the replay debugger needs.
   */
  private readonly levelValues = [
    'ApexCode=FINEST',
    'ApexProfiling=FINEST',
    'Callout=FINEST',
    'Database=FINEST',
    'System=FINEST',
    'Validation=INFO',
    'Visualforce=FINEST',
    'Workflow=FINEST'
  ].join(' ');

  /**
   * Ensures our uniquely-named DebugLevel (`SIIDForge`) exists in the org with
   * the replay-grade levels, then returns its id for the TraceFlag. If it
   * already exists it is updated so level changes always take effect.
   */
  private async ensureDebugLevel(cwd: string, cachedId?: string): Promise<string> {
    // Already created once — its levels don't change, so reuse without querying
    // or updating. (Drop the cache via the org if it was deleted server-side.)
    if (cachedId) {
      return cachedId;
    }

    let existingId: string | undefined;
    try {
      const { result } = await this.sf.run<{ records: Array<{ Id: string }> }>(
        ['data', 'query', '--use-tooling-api', '--query', `SELECT Id FROM DebugLevel WHERE DeveloperName = '${DEBUG_LEVEL_NAME}' LIMIT 1`],
        { cwd }
      );
      existingId = result?.records?.[0]?.Id;
    } catch (err: any) {
      this.logger.error(`ensureDebugLevel query: ${err.message}`);
    }

    // Update the existing level so our desired categories are applied.
    if (existingId) {
      try {
        await this.sf.run(
          ['data', 'update', 'record', '--use-tooling-api', '--sobject', 'DebugLevel', '--record-id', existingId, '--values', this.levelValues],
          { cwd }
        );
      } catch (err: any) {
        this.logger.error(`ensureDebugLevel update: ${err.message}`);
      }
      return existingId;
    }

    // Create a fresh DebugLevel with our unique name + levels.
    const values = `DeveloperName=${DEBUG_LEVEL_NAME} MasterLabel=${DEBUG_LEVEL_NAME} ${this.levelValues}`;
    const { result } = await this.sf.run<{ id: string }>(
      ['data', 'create', 'record', '--use-tooling-api', '--sobject', 'DebugLevel', '--values', values],
      { cwd }
    );
    if (!result?.id) {
      throw new Error('Failed to create DebugLevel.');
    }
    return result.id;
  }

  private async createTraceFlag(
    cwd: string,
    userId: string,
    debugLevelId: string,
    start: Date,
    expiration: Date
  ): Promise<string> {
    const values = [
      `TracedEntityId=${userId}`,
      `DebugLevelId=${debugLevelId}`,
      'LogType=USER_DEBUG',
      `StartDate=${start.toISOString()}`,
      `ExpirationDate=${expiration.toISOString()}`
    ].join(' ');

    const { result } = await this.sf.run<{ id: string }>(
      ['data', 'create', 'record', '--use-tooling-api', '--sobject', 'TraceFlag', '--values', values],
      { cwd }
    );
    if (!result?.id) {
      throw new Error('Failed to create TraceFlag.');
    }
    return result.id;
  }
}

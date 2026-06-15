/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as fs from 'fs';
import * as path from 'path';
import { SfExecutor } from './sfExecutor';
import { Logger } from './logger';
import { ensureSiidSubdir } from './forgeConfig';

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/**
 * Lists logs produced during/after `runStart` and saves them under `.siid/logs/`.
 * Returns the saved file paths (newest first). Shared by test + anonymous runs.
 *
 * `limit` caps how many logs are downloaded (each is a separate, sequential
 * `sf apex get log` call). The replay debugger only ever opens the newest, so
 * pass `1` there to keep a debug run snappy.
 */
export async function saveApexLogs(
  sf: SfExecutor,
  projectRoot: string,
  label: string,
  runStart: Date,
  limit = Infinity,
  logger?: Logger
): Promise<string[]> {
  const log = (m: string) => logger?.info(`[saveApexLogs] ${m}`);
  try {
    log('list log start');
    const t0 = Date.now();
    const { result } = await sf.run<Array<{ Id: string; StartTime?: string }>>(['apex', 'list', 'log'], { cwd: projectRoot });
    const logs = Array.isArray(result) ? result : [];
    log(`list log done in ${Date.now() - t0}ms (${logs.length} total)`);
    // Only logs produced by THIS run (small clock buffer). Never fall back to an
    // older, unrelated log — that would replay the wrong execution.
    const cutoff = runStart.getTime() - 30 * 1000;
    const target = logs
      .filter((l) => (l.StartTime ? Date.parse(l.StartTime) >= cutoff : false))
      .sort((a, b) => Date.parse(b.StartTime ?? '') - Date.parse(a.StartTime ?? '')) // newest first
      .slice(0, limit);
    log(`${target.length} log(s) match this run (limit=${limit})`);
    if (!target.length) {
      return [];
    }

    const dir = ensureSiidSubdir(projectRoot, 'logs');
    const saved: string[] = [];
    for (const entry of target) {
      const tg = Date.now();
      log(`get log ${entry.Id} start`);
      const { result: body } = await sf.run<string>(['apex', 'get', 'log', '--log-id', entry.Id], { cwd: projectRoot, json: false });
      log(`get log ${entry.Id} done in ${Date.now() - tg}ms`);
      const file = path.join(dir, `${label}-${timestamp()}-${entry.Id}.log`);
      fs.writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body, null, 2), 'utf-8');
      saved.push(file);
    }
    return saved;
  } catch (err: any) {
    log(`ERROR: ${err?.message ?? err}`);
    return [];
  }
}

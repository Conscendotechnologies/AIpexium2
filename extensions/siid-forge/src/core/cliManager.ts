/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as https from 'https';
import * as vscode from 'vscode';
import { SfExecutor } from './sfExecutor';
import { Logger } from './logger';

export interface CliVersionInfo {
  current?: string;
  latest?: string;
  updateAvailable: boolean;
}

/** Compares two dotted semver strings. Returns >0 if a is newer than b. */
function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) {
      return 1;
    }
    if ((pa[i] || 0) < (pb[i] || 0)) {
      return -1;
    }
  }
  return 0;
}

/**
 * Tracks the installed `sf` CLI version, checks the npm registry for the latest,
 * and updates the CLI. The seam other code reads for CLI version state.
 */
export class CliManager {
  constructor(private readonly sf: SfExecutor, private readonly logger: Logger) { }

  /**
   * Installed CLI version, e.g. "2.128.5". Bounded by `timeoutMs` (default 10s):
   * `sf --version` cold-starts a Node process and can hang on a wedged CLI, and
   * this runs at activation, so we cancel it rather than let it pin the status
   * bar. A timeout/failure yields `undefined` (no version) — the caller degrades
   * gracefully (no update prompt), it does not error.
   */
  async getCurrentVersion(timeoutMs = 10_000): Promise<string | undefined> {
    const cts = new vscode.CancellationTokenSource();
    const timer = setTimeout(() => cts.cancel(), timeoutMs);
    try {
      const { result } = await this.sf.run<string>(['--version'], { json: false, token: cts.token });
      const m = result.match(/@salesforce\/cli\/([0-9.]+)/i);
      return m?.[1];
    } catch (err: any) {
      this.logger.error(`getCurrentVersion: ${err.message}`);
      return undefined;
    } finally {
      clearTimeout(timer);
      cts.dispose();
    }
  }

  /** Latest published version from the npm registry. */
  getLatestVersion(): Promise<string | undefined> {
    return new Promise((resolve) => {
      const req = https.get('https://registry.npmjs.org/@salesforce/cli/latest', (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data).version);
          } catch {
            resolve(undefined);
          }
        });
      });
      req.on('error', () => resolve(undefined));
      req.setTimeout(8000, () => {
        req.destroy();
        resolve(undefined);
      });
    });
  }

  /** Compares current vs latest. */
  async checkForUpdate(): Promise<CliVersionInfo> {
    const [current, latest] = await Promise.all([this.getCurrentVersion(), this.getLatestVersion()]);
    return {
      current,
      latest,
      updateAvailable: !!current && !!latest && compareSemver(latest, current) > 0
    };
  }

  /** Updates the CLI via `sf update` (standalone installer flow). */
  async update(token?: vscode.CancellationToken): Promise<void> {
    await this.sf.run(['update'], { json: false, token });
  }
}

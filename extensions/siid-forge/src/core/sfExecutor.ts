/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { exec, spawn } from 'child_process';
import * as vscode from 'vscode';
import { Logger } from './logger';

const SF_BIN = process.platform === 'win32' ? 'sf.cmd' : 'sf';

/**
 * Environment flags that silence the CLI's "update available" notice and
 * auto-update prompts, so warnings never pollute command output.
 */
const SF_ENV: NodeJS.ProcessEnv = {
  SF_AUTOUPDATE_DISABLE: 'true',
  SFDX_AUTOUPDATE_DISABLE: 'true',
  SF_SKIP_NEW_VERSION_CHECK: 'true',
  SFDX_SKIP_NEW_VERSION_CHECK: 'true'
};

/** Thrown when an sf command is cancelled by the user. */
export class CancellationError extends Error {
  constructor() {
    super('Operation cancelled.');
    this.name = 'CancellationError';
  }
}

/**
 * Extracts the JSON envelope from CLI output. The `sf` CLI sometimes prints
 * warnings (e.g. "update available") around the JSON, which would otherwise
 * break JSON.parse. Returns the substring from the first `{` to the last `}`.
 */
function extractJson(raw: string): string {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  return start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
}

/**
 * Builds a readable error message from a failed `sf --json` envelope, digging
 * into deploy/test component failures so the user sees the real problem
 * (e.g. an Apex compile error) instead of a generic "command failed".
 */
function buildSfErrorMessage(parsed: any, stderr?: string): string {
  const parts: string[] = [];
  if (parsed?.message) {
    parts.push(String(parsed.message));
  }

  // Deploy (legacy mdapi shape).
  const componentFailures = parsed?.result?.details?.componentFailures;
  const failures = Array.isArray(componentFailures)
    ? componentFailures
    : componentFailures
      ? [componentFailures]
      : [];

  // Deploy (sf project deploy start shape).
  const failedFiles = Array.isArray(parsed?.result?.files)
    ? parsed.result.files.filter((f: any) => f.state === 'Failed')
    : [];

  for (const f of [...failures, ...failedFiles].slice(0, 15)) {
    const name = f.fullName ?? f.filePath ?? f.componentType ?? '';
    const problem = f.problem ?? f.error ?? '';
    const where = f.lineNumber ? ` (line ${f.lineNumber}${f.columnNumber ? `, col ${f.columnNumber}` : ''})` : '';
    if (problem) {
      parts.push(`• ${name}: ${problem}${where}`);
    }
  }

  if (parts.length === 0) {
    parts.push(parsed?.name || stderr?.trim() || 'sf command failed.');
  }
  return parts.join('\n');
}

/** Kills a process and its children (the shell + the sf node process). */
function killTree(pid: number | undefined): void {
  if (!pid) {
    return;
  }
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore' });
  } else {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
    }
  }
}

/**
 * Quotes a single argument for the shell so values with spaces (SOQL queries,
 * `--values`, paths) are passed as ONE argument. We run through a shell because
 * the Windows `sf.cmd` launcher requires it.
 */
function shellQuote(arg: string): string {
  if (arg.length === 0) {
    return '""';
  }
  if (process.platform === 'win32') {
    // Quote when the arg contains characters cmd.exe treats specially.
    if (!/[\s"&|<>^()]/.test(arg)) {
      return arg;
    }
    return '"' + arg.replace(/"/g, '""') + '"';
  }
  // POSIX: single-quote and escape embedded single quotes.
  if (!/[^A-Za-z0-9_./:=@-]/.test(arg)) {
    return arg;
  }
  return "'" + arg.replace(/'/g, `'\\''`) + "'";
}

export interface SfRunOptions {
  /** Working directory for the command. */
  cwd?: string;
  /** Append `--json` and parse the output. Defaults to true. */
  json?: boolean;
  /** Max stdout buffer (CLI JSON can be large). Defaults to 50MB. */
  maxBuffer?: number;
  /** Cancel the running command (kills the process tree). */
  token?: vscode.CancellationToken;
  /**
   * Resolve (instead of reject) when the CLI returns a non-zero status, so the
   * caller can inspect the envelope — e.g. test runs that "fail" because some
   * tests failed but still produced results.
   */
  acceptNonZeroStatus?: boolean;
}

export interface SfResult<T = unknown> {
  /** sf status/exit code (0 on success). */
  status: number;
  /** Parsed `result` field when json is requested, else raw stdout. */
  result: T;
  /** Warnings reported by the CLI, if any. */
  warnings?: string[];
  /** Raw stdout, kept for debugging schema surprises. */
  raw: string;
  /** Error message from the envelope when status != 0 (with acceptNonZeroStatus). */
  message?: string;
}

/**
 * The single chokepoint for invoking the `sf` CLI. Every feature goes through
 * this so CLI handling (args, json parsing, errors, buffering) lives in one place.
 *
 * NOTE: this is intentionally the seam the framework grows around — cancellation,
 * caching and streaming long operations get added here, not in features.
 */
export class SfExecutor {
  constructor(private readonly logger: Logger) { }

  /**
   * Runs `sf` with the given args. Rejects with a readable error on failure.
   */
  run<T = unknown>(args: string[], opts: SfRunOptions = {}): Promise<SfResult<T>> {
    const json = opts.json !== false;
    const fullArgs = json ? [...args, '--json'] : args;
    const maxBuffer = opts.maxBuffer ?? 50 * 1024 * 1024;
    const command = [SF_BIN, ...fullArgs.map(shellQuote)].join(' ');

    this.logger.info(`$ ${command}${opts.cwd ? `  (cwd: ${opts.cwd})` : ''}`);

    return new Promise((resolve, reject) => {
      if (opts.token?.isCancellationRequested) {
        reject(new CancellationError());
        return;
      }

      let settled = false;
      let cancelSub: vscode.Disposable | undefined;
      const finish = (fn: () => void) => {
        if (!settled) {
          settled = true;
          cancelSub?.dispose();
          fn();
        }
      };

      const child = exec(command, { cwd: opts.cwd, maxBuffer, env: { ...process.env, ...SF_ENV } }, (err, stdout, stderr) => {
        if (settled) {
          return;
        }
        const raw = stdout?.toString() ?? '';

        if (!json) {
          if (err) {
            finish(() => reject(new Error(stderr?.trim() || raw.trim() || err.message)));
            return;
          }
          finish(() => resolve({ status: 0, result: raw as unknown as T, raw }));
          return;
        }

        // JSON mode: the CLI prints a JSON envelope on both success and failure.
        let parsed: any;
        try {
          parsed = JSON.parse(extractJson(raw));
        } catch {
          finish(() => reject(new Error(stderr?.trim() || raw.trim() || err?.message || 'Failed to parse sf output.')));
          return;
        }

        // The JSON envelope's status is authoritative: a status of 0 is success
        // even if the process emitted warnings to stderr (e.g. update notices).
        if (typeof parsed.status === 'number') {
          if (parsed.status !== 0) {
            if (opts.acceptNonZeroStatus) {
              finish(() => resolve({ status: parsed.status, result: parsed.result as T, warnings: parsed.warnings, raw, message: buildSfErrorMessage(parsed, stderr) }));
            } else {
              finish(() => reject(new Error(buildSfErrorMessage(parsed, stderr))));
            }
            return;
          }
        } else if (err) {
          finish(() => reject(new Error(parsed.message || stderr?.trim() || err.message)));
          return;
        }

        finish(() => resolve({
          status: parsed.status ?? 0,
          result: parsed.result as T,
          warnings: parsed.warnings,
          raw
        }));
      });

      cancelSub = opts.token?.onCancellationRequested(() => {
        killTree(child.pid);
        finish(() => reject(new CancellationError()));
      });
    });
  }
}

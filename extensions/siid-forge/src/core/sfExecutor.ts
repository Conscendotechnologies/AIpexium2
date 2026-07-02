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

/** Lifecycle phase of a running `sf` command, for live UI status. */
export type SfCommandPhase = 'started' | 'running' | 'succeeded' | 'failed' | 'cancelled';

/**
 * A real-time status update for a single `sf` invocation, delivered via
 * `SfRunOptions.onStatus`. `started` fires immediately, `running` fires on a
 * heartbeat while the command is in flight (so a UI can show elapsed time /
 * keep a spinner alive), and exactly one terminal phase fires at the end.
 */
export interface SfCommandStatus {
  phase: SfCommandPhase;
  /** The full command line being run (for display). */
  command: string;
  /** Milliseconds since the command started. */
  elapsedMs: number;
  /** The `sf` status/exit code — only on `succeeded`/`failed`. */
  status?: number;
  /** A short error summary — only on `failed`. */
  message?: string;
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
   * Extra environment variables for the child process, merged over the inherited
   * env. Use this to pass secrets (e.g. `SF_ACCESS_TOKEN`) that must NOT appear
   * on the command line / in logs — the executor logs only the args, never env.
   */
  env?: NodeJS.ProcessEnv;
  /**
   * Resolve (instead of reject) when the CLI returns a non-zero status, so the
   * caller can inspect the envelope — e.g. test runs that "fail" because some
   * tests failed but still produced results.
   */
  acceptNonZeroStatus?: boolean;
  /**
   * Real-time lifecycle callback: `started` → periodic `running` (heartbeat) →
   * one terminal `succeeded`/`failed`/`cancelled`. Lets a caller drive a live
   * "running… (Ns)" indicator. Optional and side-effect free — a throwing
   * callback never affects the command.
   */
  onStatus?: (status: SfCommandStatus) => void;
  /**
   * Heartbeat interval (ms) for `running` ticks. Default 1000. Ignored when
   * `onStatus` is not provided.
   */
  statusHeartbeatMs?: number;
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
   * Fires the lifecycle status of EVERY `sf` command (regardless of whether the
   * caller passed a per-call `onStatus`). This is the seam the built-in status
   * bar subscribes to for a global "sf running…" indicator. It is an in-process
   * event — headless/agent callers simply don't subscribe, so it never adds to
   * command output or model context.
   */
  private readonly _onDidChangeActivity = new vscode.EventEmitter<SfCommandStatus>();
  readonly onDidChangeActivity = this._onDidChangeActivity.event;

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

      // --- Real-time status plumbing --------------------------------------
      // Fires the per-call `onStatus` (opt-in) AND the global activity event
      // (for the status bar). Both are in-process; neither touches command
      // output, so a headless caller that ignores them pays nothing.
      const startedAt = Date.now();
      const elapsed = () => Date.now() - startedAt;
      const emit = (phase: SfCommandPhase, extra?: { status?: number; message?: string }) => {
        const status: SfCommandStatus = { phase, command, elapsedMs: elapsed(), ...extra };
        try {
          opts.onStatus?.(status);
        } catch {
          /* a caller's UI callback must never break the command */
        }
        this._onDidChangeActivity.fire(status);
      };
      emit('started');
      const heartbeat = setInterval(() => emit('running'), Math.max(200, opts.statusHeartbeatMs ?? 1000));
      if (typeof heartbeat.unref === 'function') {
        heartbeat.unref(); // don't keep the event loop alive on our account
      }

      let settled = false;
      let cancelSub: vscode.Disposable | undefined;
      const finish = (fn: () => void) => {
        if (!settled) {
          settled = true;
          if (heartbeat) {
            clearInterval(heartbeat);
          }
          cancelSub?.dispose();
          fn();
        }
      };
      /** Resolve + emit the succeeded/failed terminal status (status drives which). */
      const settleResolve = (value: SfResult<T>) => finish(() => {
        emit(value.status === 0 ? 'succeeded' : 'failed', { status: value.status, message: value.message });
        resolve(value);
      });
      /** Reject + emit `cancelled` (CancellationError) or `failed`. */
      const settleReject = (error: Error) => finish(() => {
        if (error instanceof CancellationError) {
          emit('cancelled');
        } else {
          emit('failed', { message: error.message });
        }
        reject(error);
      });

      const child = exec(command, { cwd: opts.cwd, maxBuffer, env: { ...process.env, ...SF_ENV, ...opts.env } }, (err, stdout, stderr) => {
        if (settled) {
          return;
        }
        const raw = stdout?.toString() ?? '';

        if (!json) {
          if (err) {
            settleReject(new Error(stderr?.trim() || raw.trim() || err.message));
            return;
          }
          settleResolve({ status: 0, result: raw as unknown as T, raw });
          return;
        }

        // JSON mode: the CLI prints a JSON envelope on both success and failure.
        let parsed: any;
        try {
          parsed = JSON.parse(extractJson(raw));
        } catch {
          settleReject(new Error(stderr?.trim() || raw.trim() || err?.message || 'Failed to parse sf output.'));
          return;
        }

        // The JSON envelope's status is authoritative: a status of 0 is success
        // even if the process emitted warnings to stderr (e.g. update notices).
        if (typeof parsed.status === 'number') {
          if (parsed.status !== 0) {
            if (opts.acceptNonZeroStatus) {
              settleResolve({ status: parsed.status, result: parsed.result as T, warnings: parsed.warnings, raw, message: buildSfErrorMessage(parsed, stderr) });
            } else {
              settleReject(new Error(buildSfErrorMessage(parsed, stderr)));
            }
            return;
          }
        } else if (err) {
          settleReject(new Error(parsed.message || stderr?.trim() || err.message));
          return;
        }

        settleResolve({
          status: parsed.status ?? 0,
          result: parsed.result as T,
          warnings: parsed.warnings,
          raw
        });
      });

      cancelSub = opts.token?.onCancellationRequested(() => {
        killTree(child.pid);
        settleReject(new CancellationError());
      });
    });
  }
}

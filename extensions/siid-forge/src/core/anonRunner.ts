/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { SfExecutor } from './sfExecutor';

/** The outcome of an anonymous-Apex execution (sans log — the log is fetched
 *  separately via `saveApexLogs`). Matches the Tooling executeAnonymous result. */
export interface AnonRunResult {
  success?: boolean;
  compiled?: boolean;
  compileProblem?: string | null;
  exceptionMessage?: string | null;
  exceptionStackTrace?: string | null;
}

/** Default API version when sfdx-project.json has no sourceApiVersion. */
const DEFAULT_API_VERSION = '62.0';

/** Reads sourceApiVersion from sfdx-project.json, with a sane default. */
function resolveApiVersion(projectRoot: string): string {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sfdx-project.json'), 'utf-8'));
    if (cfg.sourceApiVersion) {
      return String(cfg.sourceApiVersion);
    }
  } catch { /* ignore — fall through to default */ }
  return DEFAULT_API_VERSION;
}

/** Extracts the JSON object from CLI stdout that may carry a beta warning etc. */
function extractJson(raw: string): string {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  return start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
}

/**
 * Executes anonymous Apex via the Tooling API `executeAnonymous` endpoint
 * (authenticated by the `sf` CLI — no token handling here). Unlike `sf apex run`,
 * this endpoint honors the active USER_DEBUG TraceFlag, so the resulting ApexLog
 * is captured at the trace flag's level (FINEST when Forge's flag is active),
 * which is what gives the replay debugger its STATEMENT_EXECUTE events. Ensure
 * the FINEST trace flag is in place (TraceManager.ensureTraceFlag) BEFORE calling.
 *
 * The log itself is NOT returned here; fetch it with `saveApexLogs` after this
 * resolves (the trace flag governs that asynchronously-collected ApexLog).
 */
export async function runAnonymousApex(
  sf: SfExecutor,
  projectRoot: string,
  code: string,
  token?: vscode.CancellationToken
): Promise<AnonRunResult> {
  const apiVersion = resolveApiVersion(projectRoot);
  const encoded = encodeURIComponent(code);
  const url = `/services/data/v${apiVersion}/tooling/executeAnonymous/?anonymousBody=${encoded}`;

  // `sf api request rest` takes the request spec from a JSON file, which avoids
  // all shell-escaping of the (potentially large, multi-line) Apex body.
  const reqFile = path.join(os.tmpdir(), `siid-anonreq-${Date.now()}.json`);
  fs.writeFileSync(reqFile, JSON.stringify({ url, method: 'GET' }), 'utf-8');

  try {
    // This command has no --json flag; it prints the raw API response. Read it
    // as raw stdout (json:false) and parse the envelope ourselves.
    const { result: raw } = await sf.run<string>(
      ['api', 'request', 'rest', '--file', reqFile],
      { cwd: projectRoot, json: false, token }
    );
    try {
      return JSON.parse(extractJson(String(raw))) as AnonRunResult;
    } catch {
      throw new Error('Could not parse the executeAnonymous response.');
    }
  } finally {
    try { fs.unlinkSync(reqFile); } catch { /* ignore */ }
  }
}

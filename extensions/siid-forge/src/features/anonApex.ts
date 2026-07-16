/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Commands } from '../commands';
import { CancellationError } from '../core/sfExecutor';
import { saveApexLogs } from '../core/apexLogs';
import { runAnonymousApex } from '../core/anonRunner';
import { getWorkspaceCwd } from '../core/workspace';
import { ensureDefaultOrg } from '../ui/orgGuard';
import { notify } from '../ui/notify';
import { Feature } from './types';

/** Options carried by the Execute/Debug CodeLens actions. */
export interface AnonApexOptions {
  /**
   * Debug mode. Today both Execute and Debug run + open the log; this flag is
   * reserved for the future interactive replay debugger.
   */
  debug?: boolean;
}

/**
 * Result of an anon run plus the log file(s) saved for it. We use the Tooling
 * `executeAnonymous` endpoint (via `runAnonymousApex`) rather than `sf apex run`
 * because the endpoint honors the active FINEST TraceFlag — so the saved ApexLog
 * carries STATEMENT_EXECUTE events the replay debugger needs. (`sf apex run`
 * always returns an APEX_CODE=DEBUG log, which replay can't bind breakpoints to.)
 */
interface AnonResult {
  success?: boolean;
  compiled?: boolean;
  compileProblem?: string | null;
  exceptionMessage?: string | null;
  exceptionStackTrace?: string | null;
  _logFiles?: string[];
}

/**
 * Executes Anonymous Apex from the active editor selection or whole file via the
 * Tooling executeAnonymous API. Saves the debug log under `.siid/logs/`; in debug
 * mode launches the replay debugger on it.
 */
export const registerAnonApex: Feature = ({ context, sf, logger, orgs, trace }) => {
  // Dedicated output channel for anonymous-Apex runs. The execution's USER_DEBUG
  // lines and any compile/exception errors are printed here, so the result is
  // visible even when the raw ApexLog is slow to fetch or empty.
  const output = vscode.window.createOutputChannel('SIID Forge: Apex');
  context.subscriptions.push(output);

  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ language: 'apex-anon', scheme: 'file' }, new AnonApexCodeLensProvider())
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(Commands.executeAnonApex, async (arg?: vscode.Uri | AnonApexOptions) => {
      // From a context menu arg is a Uri; from a CodeLens it's our options.
      const opts: AnonApexOptions = arg && !(arg instanceof vscode.Uri) ? arg : {};

      const code = resolveApexCode();
      if (!code) {
        return;
      }
      const cwd = getWorkspaceCwd();
      if (!cwd) {
        return;
      }
      if (!(await ensureDefaultOrg(orgs))) {
        return;
      }

      try {
        const title = opts.debug ? 'SIID Forge: debugging anonymous Apex…' : 'SIID Forge: executing anonymous Apex…';
        const result = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title, cancellable: true },
          async (progress, token): Promise<AnonResult> => {
            // FINEST trace flag so the log has STATEMENT_EXECUTE / VARIABLE_ASSIGNMENT
            // (required for replay debugging + variable values). The Tooling
            // executeAnonymous endpoint (unlike `sf apex run`) honors this flag,
            // so the ApexLog we fetch below is captured at FINEST.
            progress.report({ message: 'preparing debug trace…' });
            const username = await orgs.getUsername();
            if (username) {
              try { await trace.ensureTraceFlag(cwd, username); } catch (e: any) { logger.error(`trace: ${e.message}`); }
            }
            if (token.isCancellationRequested) {
              throw new CancellationError();
            }

            progress.report({ message: 'executing…' });
            const runStart = new Date();
            const r: AnonResult = await runAnonymousApex(sf, cwd, code, token);

            // Fetch the FINEST ApexLog generated under the trace flag.
            progress.report({ message: 'fetching log…' });
            r._logFiles = await saveApexLogs(sf, cwd, 'anonymous', runStart, 1);
            return r;
          }
        );

        const logFile: string | undefined = result._logFiles?.[0];
        const relLog = logFile ? path.relative(cwd, logFile).replace(/\\/g, '/') : undefined;

        // Surface the run in the output channel: the USER_DEBUG lines (from the
        // fetched log) plus the compile/exception status. This is the primary
        // visible result — it doesn't depend on the log opening in an editor.
        printAnonResult(output, result, logFile, relLog);

        // Debug -> launch the replay debugger on the produced log.
        // Execute -> the output channel already shows the result; only open the
        // raw log when debugging (replay needs it), not on every execute.
        if (logFile && opts.debug) {
          const sourceFile = vscode.window.activeTextEditor?.document.fileName;
          await vscode.commands.executeCommand(Commands.replayLog, logFile, sourceFile);
        }

        // Offer to jump straight into the Log Analyzer from the result toast
        // (both success AND failure — a failed run is exactly when you want to
        // analyze the log). Only when a log was actually captured.
        const analyzeAction = 'Analyze Log';
        const onPick = (pick?: string) => {
          if (pick === analyzeAction && logFile) {
            void vscode.commands.executeCommand(Commands.analyzeLog, logFile);
          }
        };
        if (result.success && result.compiled) {
          const msg = `✅ Anonymous Apex executed.${relLog ? ` Log: ${relLog}` : ''}`;
          if (logFile) {
            void vscode.window.showInformationMessage(msg, analyzeAction).then(onPick);
          } else {
            notify.ok(`Anonymous Apex executed.${relLog ? ` Log: ${relLog}` : ''}`);
          }
        } else {
          const reason = result.compileProblem || result.exceptionMessage || 'Execution failed.';
          const msg = `❌ Anonymous Apex failed: ${reason}${relLog ? ` (log: ${relLog})` : ''}`;
          if (logFile) {
            void vscode.window.showErrorMessage(msg, analyzeAction).then(onPick);
          } else {
            notify.err(`Anonymous Apex failed: ${reason}`);
          }
        }
      } catch (err: any) {
        if (err instanceof CancellationError) {
          notify.cancelled('Execution');
          return;
        }
        logger.error(err.message);
        notify.err(`Anonymous Apex failed: ${err.message}`);
      }
    })
  );
};

/**
 * Prints an anon-Apex run to the output channel: the debug output (USER_DEBUG
 * lines parsed from the fetched log) plus the compile/exception status. Reveals
 * the channel so the result is immediately visible.
 */
function printAnonResult(
  output: vscode.OutputChannel,
  result: AnonResult,
  logFile: string | undefined,
  relLog: string | undefined
): void {
  const ts = new Date().toLocaleTimeString();
  output.appendLine(`\n──────── ${ts} — Execute Anonymous Apex ────────`);

  const debugLines = logFile ? extractDebugLines(logFile) : [];
  if (debugLines.length) {
    for (const line of debugLines) {
      output.appendLine(line);
    }
  } else {
    output.appendLine('(no debug output)');
  }

  if (result.success && result.compiled) {
    output.appendLine('✅ Success');
  } else if (result.compiled === false) {
    output.appendLine(`❌ Compile error: ${result.compileProblem ?? 'unknown'}`);
  } else {
    output.appendLine(`❌ Runtime error: ${result.exceptionMessage ?? 'unknown'}`);
    if (result.exceptionStackTrace) {
      output.appendLine(result.exceptionStackTrace);
    }
  }
  if (relLog) {
    output.appendLine(`Log: ${relLog}`);
  }
  output.show(true); // reveal but keep editor focus
}

/**
 * Extracts the message of each `USER_DEBUG` line from a debug log, formatted as
 * `DEBUG | <message>`. Matches the standard log shape
 * `…|USER_DEBUG|[N]|DEBUG|<message>` used across the codebase.
 */
function extractDebugLines(logFile: string): string[] {
  let text: string;
  try {
    text = fs.readFileSync(logFile, 'utf-8');
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/\|USER_DEBUG\|[^|]*\|DEBUG\|(.*)$/);
    if (m) {
      out.push(`DEBUG | ${m[1]}`);
    }
  }
  return out;
}

/** The editor selection if any, otherwise the whole active document. */
function resolveApexCode(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('SIID Forge: open an Apex file or select code to execute.');
    return undefined;
  }
  const selection = editor.document.getText(editor.selection).trim();
  const code = selection || editor.document.getText().trim();
  if (!code) {
    vscode.window.showErrorMessage('SIID Forge: nothing to execute.');
    return undefined;
  }
  return code;
}

/** Adds "Execute / Debug" CodeLenses at the top of an anonymous Apex file. */
class AnonApexCodeLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(): vscode.CodeLens[] {
    const range = new vscode.Range(0, 0, 0, 0);
    return [
      new vscode.CodeLens(range, { title: '$(run) Execute', command: Commands.executeAnonApex, arguments: [{}] }),
      new vscode.CodeLens(range, { title: '$(debug-alt) Debug', command: Commands.executeAnonApex, arguments: [{ debug: true }] })
    ];
  }
}

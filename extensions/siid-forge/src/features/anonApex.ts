/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Commands } from '../commands';
import { CancellationError } from '../core/sfExecutor';
import { ensureSiidSubdir } from '../core/forgeConfig';
import { saveApexLogs } from '../core/apexLogs';
import { getWorkspaceCwd } from '../core/workspace';
import { Feature } from './types';

/** Options carried by the Execute/Debug CodeLens actions. */
export interface AnonApexOptions {
  /**
   * Debug mode. Today both Execute and Debug run + open the log; this flag is
   * reserved for the future interactive replay debugger.
   */
  debug?: boolean;
}

interface AnonResult {
  success?: boolean;
  compiled?: boolean;
  compileProblem?: string | null;
  exceptionMessage?: string | null;
  exceptionStackTrace?: string | null;
  logs?: string;
}

/**
 * Executes Anonymous Apex from the active editor selection or whole file via
 * `sf apex run`. Saves the debug log under `.siid/logs/`; in debug mode opens it.
 */
export const registerAnonApex: Feature = ({ context, sf, logger, orgs, trace }) => {
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

      // `sf apex run` reads code from a file; write the snippet to a temp file.
      const tmpFile = path.join(os.tmpdir(), `siid-anon-${Date.now()}.apex`);
      fs.writeFileSync(tmpFile, code, 'utf-8');

      try {
        const title = opts.debug ? 'SIID Forge: debugging anonymous Apex…' : 'SIID Forge: executing anonymous Apex…';
        const result = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title, cancellable: true },
          async (progress, token): Promise<AnonResult> => {
            // FINEST trace flag so the log has STATEMENT_EXECUTE / VARIABLE_ASSIGNMENT
            // (required for replay debugging + variable values).
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
            const { result: r } = await sf.run<AnonResult>(['apex', 'run', '--file', tmpFile], { cwd, token });

            // Prefer the FINEST ApexLog generated under the trace flag.
            progress.report({ message: 'fetching log…' });
            (r as any)._logFiles = await saveApexLogs(sf, cwd, 'anonymous', runStart, 1);
            return r;
          }
        );

        let logFile: string | undefined = (result as any)._logFiles?.[0];
        // Fall back to the inline (lower-detail) log if no ApexLog was fetched.
        if (!logFile && result.logs) {
          const dir = ensureSiidSubdir(cwd, 'logs');
          logFile = path.join(dir, `anonymous-${timestamp()}.log`);
          fs.writeFileSync(logFile, result.logs, 'utf-8');
        }

        // Debug -> launch the replay debugger on the produced log;
        // Execute -> just open the log for inspection.
        if (logFile) {
          if (opts.debug) {
            const sourceFile = vscode.window.activeTextEditor?.document.fileName;
            await vscode.commands.executeCommand(Commands.replayLog, logFile, sourceFile);
          } else {
            await vscode.window.showTextDocument(vscode.Uri.file(logFile), { preview: false });
          }
        }
        const relLog = logFile ? path.relative(cwd, logFile).replace(/\\/g, '/') : undefined;

        if (result.success && result.compiled) {
          vscode.window.showInformationMessage(
            `✅ Anonymous Apex executed.${relLog ? ` Log: ${relLog}` : ''}`
          );
        } else {
          const reason = result.compileProblem || result.exceptionMessage || 'Execution failed.';
          vscode.window.showErrorMessage(
            `❌ Anonymous Apex failed: ${reason}${relLog ? ` (log: ${relLog})` : ''}`
          );
        }
      } catch (err: any) {
        if (err instanceof CancellationError) {
          vscode.window.showInformationMessage('Execution cancelled.');
          return;
        }
        logger.error(err.message);
        vscode.window.showErrorMessage(`❌ Anonymous Apex failed: ${err.message}`);
      } finally {
        try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
      }
    })
  );
};

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

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
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

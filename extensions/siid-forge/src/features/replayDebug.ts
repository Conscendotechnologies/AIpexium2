/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Commands } from '../commands';
import { SchemaManager } from '../core/schemaManager';
import { parseLog } from '../core/replay/logParser';
import { ReplayDebugAdapter } from '../core/replay/replayAdapter';
import { Feature } from './types';

const DEBUG_TYPE = 'siid-apex-replay';

/**
 * Registers the SIID Apex Replay Debugger: a debug type backed by an inline
 * adapter that replays a captured `.siid/logs/*.log`, plus a command to launch it.
 */
export const registerReplayDebug: Feature = ({ context, schema, logger }) => {
  // Build the inline adapter for each session from its `logFile`.
  context.subscriptions.push(
    vscode.debug.registerDebugAdapterDescriptorFactory(DEBUG_TYPE, {
      createDebugAdapterDescriptor: (session) => {
        const logFile: string | undefined = session.configuration.logFile;
        const sourceFile: string | undefined = session.configuration.sourceFile;
        const parsed = logFile && fs.existsSync(logFile)
          ? parseLog(fs.readFileSync(logFile, 'utf-8'))
          : { steps: [], isFinest: true, apexCodeLevel: undefined, apiVersion: undefined };
        logger.info(`[replay] session start: logFile=${logFile} steps=${parsed.steps.length} api=${parsed.apiVersion} apexCode=${parsed.apexCodeLevel}`);
        if (!parsed.isFinest && parsed.steps.length) {
          vscode.window.showWarningMessage(
            `SIID Replay: this log was captured at APEX_CODE=${parsed.apexCodeLevel ?? 'unknown'}, not FINEST. ` +
            `Variables and stepping will be limited. (Anonymous Apex can't be raised above DEBUG.)`
          );
        }
        return new vscode.DebugAdapterInlineImplementation(new ReplayDebugAdapter(parsed.steps, makeResolver(schema), sourceFile, logger));
      }
    })
  );

  // Fill in a log file if the launch config didn't specify one.
  context.subscriptions.push(
    vscode.debug.registerDebugConfigurationProvider(DEBUG_TYPE, {
      resolveDebugConfiguration: async (_folder, config) => {
        if (!config.type) {
          config.type = DEBUG_TYPE;
          config.name = 'Replay Apex Log';
          config.request = 'launch';
        }
        if (!config.logFile) {
          const picked = await pickLogFile();
          if (!picked) {
            return undefined; // abort launch
          }
          config.logFile = picked;
        }
        return config;
      }
    })
  );

  // Command: pick a log (or use a provided path) and start replaying.
  context.subscriptions.push(
    vscode.commands.registerCommand(Commands.replayLog, async (logPath?: string, sourceFile?: string) => {
      const file = logPath ?? (await pickLogFile());
      if (!file) {
        return;
      }
      const folder = vscode.workspace.workspaceFolders?.[0];
      await vscode.debug.startDebugging(folder, {
        type: DEBUG_TYPE,
        name: `Replay: ${path.basename(file)}`,
        request: 'launch',
        logFile: file,
        sourceFile
      });
    })
  );
};

/** className -> source file path, via the apex schema cache. */
function makeResolver(schema: SchemaManager) {
  return (className?: string): string | undefined => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root || !className) {
      return undefined;
    }
    return schema.readApex(root, className)?.filePath;
  };
}

/** Quick pick of `.siid/logs/*.log`, newest first. */
async function pickLogFile(): Promise<string | undefined> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) {
    vscode.window.showErrorMessage('SIID Forge: open a project folder first.');
    return undefined;
  }
  const logsDir = path.join(root, '.siid', 'logs');
  let files: string[] = [];
  try {
    files = fs.readdirSync(logsDir)
      .filter((f) => f.endsWith('.log'))
      .map((f) => path.join(logsDir, f))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  } catch {
    // no logs dir
  }
  if (!files.length) {
    vscode.window.showWarningMessage('SIID Forge: no logs in .siid/logs. Run a test or anonymous Apex first.');
    return undefined;
  }
  const pick = await vscode.window.showQuickPick(
    files.map((f) => ({ label: path.basename(f), description: f, file: f })),
    { placeHolder: 'Select an Apex log to replay' }
  );
  return pick?.file;
}

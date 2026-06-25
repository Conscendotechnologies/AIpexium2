/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Commands } from '../commands';
import { resolveResourceUri } from '../core/workspace';
import { scaffoldLwcTest } from '../core/lwcTestScaffold';
import { buildLwcTestPrompt } from '../core/lwcTestContext';
import { handToAgent } from '../core/aiAgent';
import { Feature } from './types';

/**
 * Generate LWC test bodies with AI (layer C of LWC test automation). SIID Forge
 * does the deterministic work — scaffold the skeleton (reusing B) and assemble a
 * rich, source-grounded prompt (`core/lwcTestContext`) — then hands it to the
 * SIID-Code agent (`core/aiAgent`) to write meaningful assertions. Clipboard
 * fallback when the agent isn't available.
 */
export const registerLwcTestAi: Feature = ({ context, logger }) => {
  context.subscriptions.push(
    vscode.commands.registerCommand(Commands.generateLwcTestAi, async (uri?: vscode.Uri) => {
      const resource = resolveResourceUri(uri);
      if (!resource) {
        return;
      }
      const jsPath = resolveComponentJs(resource.fsPath);
      if (!jsPath) {
        vscode.window.showErrorMessage('SIID Forge: select a Lightning Web Component (its folder or a file inside it).');
        return;
      }

      try {
        // 1. Ensure a scaffold exists (don't overwrite an existing test).
        const scaffold = scaffoldLwcTest(jsPath);
        if (!scaffold.exists) {
          fs.mkdirSync(path.dirname(scaffold.testPath), { recursive: true });
          fs.writeFileSync(scaffold.testPath, scaffold.content, 'utf-8');
        }
        const skeleton = fs.readFileSync(scaffold.testPath, 'utf-8');

        // 2. Build the source-grounded prompt.
        const prompt = buildLwcTestPrompt(jsPath, skeleton);

        // 3. Open the test so the user sees where the agent will write.
        await vscode.window.showTextDocument(vscode.Uri.file(scaffold.testPath));

        // 4. Hand off to the SIID-Code agent (clipboard fallback).
        const outcome = await handToAgent(prompt.text);
        logger.info(`[lwc-test-ai] ${prompt.facts.name}: handoff=${outcome} (api:${prompt.facts.apiProps.length} events:${prompt.facts.events.length} wires:${prompt.facts.wires.length})`);

        if (outcome === 'started') {
          vscode.window.showInformationMessage(`🤖 Asked SIID-Code to write tests for "${prompt.facts.name}".`);
        } else {
          vscode.window.showInformationMessage(`📋 Prompt copied. Paste it into SIID-Code chat to generate tests for "${prompt.facts.name}".`);
        }
      } catch (err: any) {
        logger.error(err.message);
        vscode.window.showErrorMessage(`❌ Could not start AI test generation: ${err.message}`);
      }
    })
  );
};

/** Resolves the component's main `.js` from any path inside its LWC bundle. */
function resolveComponentJs(fsPath: string): string | undefined {
  const norm = fsPath.replace(/\\/g, '/');
  if (!/\/lwc\//.test(norm)) {
    return undefined;
  }
  let dir = fsPath;
  if (fs.existsSync(fsPath) && fs.statSync(fsPath).isFile()) {
    dir = path.dirname(fsPath);
  }
  if (path.basename(dir) === '__tests__') {
    dir = path.dirname(dir);
  }
  const cmp = path.basename(dir);
  const candidate = path.join(dir, `${cmp}.js`);
  if (fs.existsSync(candidate)) {
    return candidate;
  }
  if (fsPath.endsWith('.js') && !fsPath.endsWith('.test.js')) {
    return fsPath;
  }
  return undefined;
}

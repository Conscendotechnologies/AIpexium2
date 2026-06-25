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
import { AiConfig } from '../core/aiConfig';
import { LwcTestAiPanel } from './lwcTestAiPanel';
import { Feature } from './types';

/**
 * Generate LWC test bodies with AI (layer C of LWC test automation).
 *
 * Preferred path — INDEPENDENT & deterministic: if Forge has its own OpenRouter
 * key, it calls the LLM directly, writes the test, runs sfdx-lwc-jest, and feeds
 * failures back for bounded self-correction. Reliable, no agent routing.
 *
 * Fallback path: if no key is configured, hand the prompt to the SIID-Code
 * agent (clipboard if that's unavailable).
 */
export const registerLwcTestAi: Feature = ({ context, logger }) => {
  const ai = new AiConfig(context);

  context.subscriptions.push(
    vscode.commands.registerCommand(Commands.setOpenRouterKey, async () => {
      const saved = await ai.promptAndStoreApiKey();
      if (saved) {
        vscode.window.showInformationMessage('✅ SIID Forge: OpenRouter key saved. AI test generation now runs directly.');
      }
    })
  );

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

      const apiKey = await ai.getApiKey();
      if (apiKey) {
        // Independent path: live webview that generates → runs → retries.
        await new LwcTestAiPanel(ai, logger).open(jsPath);
      } else {
        await generateViaAgent(jsPath, logger);
      }
    })
  );
};

/** Fallback path: hand the prompt to the SIID-Code agent / clipboard. */
async function generateViaAgent(jsPath: string, logger: { info(m: string): void; error(m: string): void }): Promise<void> {
  try {
    const scaffold = scaffoldLwcTest(jsPath);
    if (!scaffold.exists) {
      fs.mkdirSync(path.dirname(scaffold.testPath), { recursive: true });
      fs.writeFileSync(scaffold.testPath, scaffold.content, 'utf-8');
    }
    const prompt = buildLwcTestPrompt(jsPath, fs.readFileSync(scaffold.testPath, 'utf-8'));
    await vscode.window.showTextDocument(vscode.Uri.file(scaffold.testPath));

    const outcome = await handToAgent(prompt.text);
    logger.info(`[lwc-test-ai] ${prompt.facts.name}: no key → agent handoff=${outcome}`);
    if (outcome === 'started') {
      vscode.window.showInformationMessage(`🤖 No OpenRouter key set — asked SIID-Code to write tests for "${prompt.facts.name}". (Set a key for reliable direct generation.)`);
    } else {
      vscode.window.showInformationMessage(`📋 Prompt copied for "${prompt.facts.name}". Set an OpenRouter key (SIID Forge: Set OpenRouter API Key) for direct generation.`);
    }
  } catch (err: any) {
    logger.error(err.message);
    vscode.window.showErrorMessage(`❌ Could not start AI test generation: ${err.message}`);
  }
}

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

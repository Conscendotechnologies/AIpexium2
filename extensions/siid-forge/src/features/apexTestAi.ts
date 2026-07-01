/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Commands } from '../commands';
import { findProjectRoot, resolveResourceUri } from '../core/workspace';
import { scaffoldApexTestFromFile } from '../core/apexTestScaffold';
import { collectApexTestContext, buildApexTestPrompt } from '../core/apexTestContext';
import { handToAgent } from '../core/aiAgent';
import { AiConfig } from '../core/aiConfig';
import { ApexTestAiPanel } from './apexTestAiPanel';
import { ApexTestBatchPanel } from './apexTestBatchPanel';
import { Feature } from './types';

/**
 * Generate Apex test bodies with AI (plan §18.E).
 *
 * Preferred path — INDEPENDENT & coverage-driven: if Forge has its own OpenRouter
 * key, it opens the live panel that generates → deploys (sandbox/dev only) → runs
 * → feeds coverage + failures back for bounded self-correction.
 *
 * Fallback path: no key → scaffold + hand the prompt to the SIID-Code agent.
 */
export const registerApexTestAi: Feature = (deps) => {
  const { context, schema, logger } = deps;
  const ai = new AiConfig(context);

  context.subscriptions.push(
    vscode.commands.registerCommand(Commands.generateApexTestAi, async (uri?: vscode.Uri) => {
      const resource = resolveResourceUri(uri);
      if (!resource) {
        return;
      }
      if (!resource.fsPath.endsWith('.cls')) {
        vscode.window.showErrorMessage('SIID Forge: select an Apex class (.cls) to generate tests for.');
        return;
      }
      const className = path.basename(resource.fsPath, '.cls');
      if (className.endsWith('Test')) {
        vscode.window.showInformationMessage(`${className} looks like a test class already.`);
        return;
      }

      const apiKey = await ai.getApiKey();
      if (apiKey) {
        await new ApexTestAiPanel(ai, { sf: deps.sf, orgs: deps.orgs, trace: deps.trace, schema, logger }).open(resource.fsPath);
      } else {
        await generateViaAgent(deps, resource.fsPath, className);
      }
    })
  );

  // Batch: pick many classes → sequential queue in one panel.
  context.subscriptions.push(
    vscode.commands.registerCommand(Commands.generateApexTestsBatch, async (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
      const apiKey = await ai.getApiKey();
      if (!apiKey) {
        vscode.window.showWarningMessage('SIID Forge: set an OpenRouter API key first (SIID Forge: Set OpenRouter API Key) — batch generation needs the direct LLM path.');
        return;
      }

      // Explorer multi-select passes (uri, uris[]); otherwise show a picker.
      const explicit = collectClsFromSelection(uris ?? (uri ? [uri] : []));
      const clsPaths = explicit.length ? explicit : await pickClasses(schema);
      if (!clsPaths || !clsPaths.length) {
        return;
      }

      await new ApexTestBatchPanel(ai, { sf: deps.sf, orgs: deps.orgs, trace: deps.trace, schema, logger }).open(clsPaths);
    })
  );
};

/** Filters a selection to source `.cls` files that are not themselves tests. */
function collectClsFromSelection(uris: vscode.Uri[]): string[] {
  return uris
    .map((u) => u.fsPath)
    .filter((p) => p.endsWith('.cls') && !path.basename(p, '.cls').endsWith('Test'));
}

/**
 * Multi-select QuickPick of local classes lacking a `*Test`. Classes that
 * already have a test are shown (picked-off by default) so the user can still
 * regenerate them deliberately.
 */
async function pickClasses(schema: import('../core/schemaManager').SchemaManager): Promise<string[] | undefined> {
  const root = getWorkspaceRoot();
  if (!root) {
    return undefined;
  }
  const names = schema.apexClassNames(root).filter((n) => !n.endsWith('Test'));
  const testSet = new Set(schema.apexClassNames(root).filter((n) => n.endsWith('Test')));

  const items = names
    .map((n) => {
      const cls = schema.readApex(root, n);
      return cls?.filePath ? { label: n, description: testSet.has(`${n}Test`) ? '$(check) has test' : '', clsPath: cls.filePath } : undefined;
    })
    .filter((x): x is { label: string; description: string; clsPath: string } => !!x)
    // Classes without a test first (the common case), then the rest.
    .sort((a, b) => (a.description ? 1 : 0) - (b.description ? 1 : 0) || a.label.localeCompare(b.label));

  if (!items.length) {
    vscode.window.showInformationMessage('SIID Forge: no local Apex classes found to test.');
    return undefined;
  }

  const picked = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    title: 'Select Apex classes to generate tests for (runs sequentially)',
    placeHolder: 'Space to toggle · classes without a test are listed first'
  });
  return picked?.map((p) => p.clsPath);
}

function getWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/** Fallback: scaffold + hand the built prompt to the SIID-Code agent / clipboard. */
async function generateViaAgent(
  deps: Parameters<Feature>[0],
  clsPath: string,
  className: string
): Promise<void> {
  const { sf, schema, logger } = deps;
  const projectRoot = findProjectRoot(clsPath);
  try {
    // Ensure a scaffold exists so the agent has a starting file + project style.
    const apiVersion = readSourceApiVersion(projectRoot);
    const scaffold = scaffoldApexTestFromFile(schema, projectRoot, clsPath, apiVersion);
    if (scaffold && !scaffold.exists) {
      fs.mkdirSync(path.dirname(scaffold.testPath), { recursive: true });
      fs.writeFileSync(scaffold.testPath, scaffold.content, 'utf-8');
      fs.writeFileSync(scaffold.metaPath, scaffold.meta, 'utf-8');
    }
    if (scaffold) {
      await vscode.window.showTextDocument(vscode.Uri.file(scaffold.testPath));
    }

    const ctx = await collectApexTestContext(sf, schema, projectRoot, className);
    const prompt = buildApexTestPrompt(ctx, 75);
    const outcome = await handToAgent(prompt.text);
    logger.info(`[apex-test-ai] ${className}: no key → agent handoff=${outcome}`);
    if (outcome === 'started') {
      vscode.window.showInformationMessage(`🤖 No OpenRouter key set — asked SIID-Code to write tests for "${className}". (Set a key for reliable coverage-driven generation.)`);
    } else {
      vscode.window.showInformationMessage(`📋 Prompt copied for "${className}". Set an OpenRouter key (SIID Forge: Set OpenRouter API Key) for direct generation.`);
    }
  } catch (err: any) {
    logger.error(err.message);
    vscode.window.showErrorMessage(`❌ Could not start AI test generation: ${err.message}`);
  }
}

/** Reads sourceApiVersion from sfdx-project.json, with a sane default. */
function readSourceApiVersion(root: string): string {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(root, 'sfdx-project.json'), 'utf-8'));
    if (cfg.sourceApiVersion) {
      return String(cfg.sourceApiVersion);
    }
  } catch {
    // ignore
  }
  return '62.0';
}

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
import { notify } from '../ui/notify';
import { Feature } from './types';

/**
 * Generates a CLASS-AWARE Apex test skeleton (plan §18.B) — the "smart" sibling
 * of `createTestClass` (which emits a fixed stub). The scaffolding logic is
 * headless (`core/apexTestScaffold`); this is the editor command. Invoked on a
 * `.cls`; writes `<Class>Test.cls` (+ meta) next to it and opens it.
 */
export const registerApexTestScaffold: Feature = ({ context, schema, logger }) => {
  context.subscriptions.push(
    vscode.commands.registerCommand(Commands.scaffoldApexTest, async (uri?: vscode.Uri) => {
      const resource = resolveResourceUri(uri);
      if (!resource) {
        return;
      }
      if (!resource.fsPath.endsWith('.cls')) {
        vscode.window.showErrorMessage('SIID Forge: select an Apex class (.cls) to scaffold a test for.');
        return;
      }

      const className = path.basename(resource.fsPath, '.cls');
      if (className.endsWith('Test')) {
        notify.info(`${className} looks like a test class already.`);
        await vscode.window.showTextDocument(resource);
        return;
      }

      const projectRoot = findProjectRoot(resource.fsPath);

      try {
        const apiVersion = readSourceApiVersion(projectRoot);
        const result = scaffoldApexTestFromFile(schema, projectRoot, resource.fsPath, apiVersion);
        if (!result) {
          notify.err(`Could not read/parse ${className}.`);
          return;
        }

        if (result.facts.isTestClass) {
          notify.info(`${className} is itself a test class — nothing to scaffold.`);
          return;
        }

        if (result.exists) {
          const choice = await vscode.window.showWarningMessage(
            `A test "${result.facts.testName}" already exists. Overwrite it?`,
            { modal: true },
            'Overwrite'
          );
          if (choice !== 'Overwrite') {
            await vscode.window.showTextDocument(vscode.Uri.file(result.testPath));
            return;
          }
        }

        fs.mkdirSync(path.dirname(result.testPath), { recursive: true });
        fs.writeFileSync(result.testPath, result.content, 'utf-8');
        fs.writeFileSync(result.metaPath, result.meta, 'utf-8');

        const f = result.facts;
        logger.info(
          `[apex-test] scaffolded ${f.testName} (kind: ${f.kind}, methods: ${f.methods.length})`
        );
        await vscode.window.showTextDocument(vscode.Uri.file(result.testPath));
        notify.ok(
          `Scaffolded ${f.testName} (${f.methods.length} method test${f.methods.length === 1 ? '' : 's'}). Fill in the assertions + makeData(), then run it.`
        );
      } catch (err: any) {
        logger.error(err.message);
        notify.err(`Could not scaffold Apex test: ${err.message}`);
      }
    })
  );
};

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

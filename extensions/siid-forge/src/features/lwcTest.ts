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
import { notify } from '../ui/notify';
import { Feature } from './types';

/**
 * Generates a Jest test skeleton for an LWC component (feature B of LWC test
 * automation). The scaffolding logic is headless (`core/lwcTestScaffold`); this
 * is the editor command. Invoked from an LWC file/folder; writes
 * `__tests__/<cmp>.test.js` and opens it.
 */
export const registerLwcTest: Feature = ({ context, logger }) => {
  context.subscriptions.push(
    vscode.commands.registerCommand(Commands.scaffoldLwcTest, async (uri?: vscode.Uri) => {
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
        const result = scaffoldLwcTest(jsPath);

        if (result.exists) {
          const choice = await vscode.window.showWarningMessage(
            `A test already exists for "${result.facts.name}". Overwrite it?`,
            { modal: true },
            'Overwrite'
          );
          if (choice !== 'Overwrite') {
            // Just open the existing test instead.
            await vscode.window.showTextDocument(vscode.Uri.file(result.testPath));
            return;
          }
        }

        fs.mkdirSync(path.dirname(result.testPath), { recursive: true });
        fs.writeFileSync(result.testPath, result.content, 'utf-8');

        const f = result.facts;
        logger.info(`[lwc-test] scaffolded ${path.basename(result.testPath)} (api: ${f.apiProps.length}, wires: ${f.wires.length}, events: ${f.events.length})`);
        await vscode.window.showTextDocument(vscode.Uri.file(result.testPath));
        notify.ok(`Test scaffolded for "${f.name}". Fill in the assertions, then run with the Jest test feature.`);
      } catch (err: any) {
        logger.error(err.message);
        notify.err(`Could not scaffold LWC test: ${err.message}`);
      }
    })
  );
};

/**
 * Resolves the component's main `.js` file from any path inside an LWC bundle:
 *  - the `.js` itself,
 *  - the component folder `lwc/<cmp>` → `lwc/<cmp>/<cmp>.js`,
 *  - any sibling file (`.html`, `.css`, meta xml) → the bundle's `<cmp>.js`.
 * Skips test files and non-LWC paths.
 */
function resolveComponentJs(fsPath: string): string | undefined {
  // Inside a __tests__ dir → step up to the component folder.
  const norm = fsPath.replace(/\\/g, '/');
  if (!/\/lwc\//.test(norm)) {
    return undefined;
  }

  let dir = fsPath;
  if (fs.existsSync(fsPath) && fs.statSync(fsPath).isFile()) {
    dir = path.dirname(fsPath);
  }
  // If we're in __tests__, go up to the bundle folder.
  if (path.basename(dir) === '__tests__') {
    dir = path.dirname(dir);
  }
  const cmp = path.basename(dir);
  const candidate = path.join(dir, `${cmp}.js`);
  if (fs.existsSync(candidate)) {
    return candidate;
  }
  // If a .js file was passed directly (e.g. a service module), use it.
  if (fsPath.endsWith('.js') && !fsPath.endsWith('.test.js')) {
    return fsPath;
  }
  return undefined;
}

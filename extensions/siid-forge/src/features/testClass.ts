/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Commands } from '../commands';
import { SfExecutor, SfResult, CancellationError } from '../core/sfExecutor';
import { SchemaManager } from '../core/schemaManager';
import { getWorkspaceCwd } from '../core/workspace';
import { Feature } from './types';

const DEFAULT_CLASSES_DIR = 'force-app/main/default/classes';

/**
 * Creates a test class for a main Apex class:
 *  - From a `.cls` (editor/explorer) -> `<Class>Test`, opening it if it exists.
 *  - Elsewhere -> pick a main class (local or org; retrieved if not local).
 */
export const registerTestClass: Feature = ({ context, sf, schema, logger }) => {
  context.subscriptions.push(
    vscode.commands.registerCommand(Commands.createTestClass, async (uri?: vscode.Uri) => {
      const root = getWorkspaceCwd();
      if (!root) {
        return;
      }

      try {
        // 1. Resolve the main class + the folder to create the test in.
        let mainClass: string | undefined;
        let classesDir: string | undefined;

        if (uri?.fsPath.endsWith('.cls')) {
          mainClass = path.basename(uri.fsPath, '.cls');
          classesDir = path.dirname(uri.fsPath);
          if (mainClass.endsWith('Test')) {
            await vscode.window.showTextDocument(uri);
            return;
          }
        } else {
          const picked = await pickMainClass(sf, schema, root);
          if (!picked) {
            return;
          }
          mainClass = picked.name;
          classesDir = picked.dir;
        }

        // 2. Test class name + path.
        const testName = `${mainClass}Test`;
        const dir = classesDir ?? path.join(root, DEFAULT_CLASSES_DIR);
        const testFile = path.join(dir, `${testName}.cls`);

        // 3. Already exists? Just open it.
        if (fs.existsSync(testFile)) {
          await vscode.window.showTextDocument(vscode.Uri.file(testFile));
          vscode.window.showInformationMessage(`${testName} already exists — opened.`);
          return;
        }

        // 4. Create from template.
        fs.mkdirSync(dir, { recursive: true });
        const apiVersion = readSourceApiVersion(root);
        fs.writeFileSync(testFile, testTemplate(mainClass, testName), 'utf-8');
        fs.writeFileSync(`${testFile}-meta.xml`, metaTemplate(apiVersion), 'utf-8');

        await vscode.window.showTextDocument(vscode.Uri.file(testFile));
        vscode.window.showInformationMessage(`✅ Created ${testName}.`);
      } catch (err: any) {
        if (err instanceof CancellationError) {
          return;
        }
        logger.error(err.message);
        vscode.window.showErrorMessage(`❌ Could not create test class: ${err.message}`);
      }
    })
  );
};

/** Lets the user pick a main class (local or org); retrieves it if not local. */
async function pickMainClass(
  sf: SfExecutor,
  schema: SchemaManager,
  root: string
): Promise<{ name: string; dir: string } | undefined> {
  const local = new Set(schema.apexClassNames(root));
  let orgNames: string[] = [];
  try {
    type QueryResult = SfResult<{ records: Array<{ Name: string }> }>;
    const { result } = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'SIID Forge: loading classes…' },
      (): Promise<QueryResult> => sf.run<{ records: Array<{ Name: string }> }>(['data', 'query', '--use-tooling-api', '--query', "SELECT Name FROM ApexClass WHERE NamespacePrefix = null ORDER BY Name"], { cwd: root })
    );
    orgNames = (result?.records ?? []).map((r) => r.Name);
  } catch {
    // org unavailable — fall back to local only
  }

  const names = [...new Set([...local, ...orgNames])]
    .filter((n) => !n.endsWith('Test'))
    .sort();
  if (!names.length) {
    vscode.window.showErrorMessage('SIID Forge: no Apex classes found.');
    return undefined;
  }

  const pick = await vscode.window.showQuickPick(
    names.map((n) => ({ label: n, description: local.has(n) ? '(local)' : '(org)' })),
    { placeHolder: 'Select the class to create a test for' }
  );
  if (!pick) {
    return undefined;
  }

  // Retrieve from org if not local, then locate its folder.
  if (!local.has(pick.label)) {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `SIID Forge: retrieving ${pick.label}…`, cancellable: true },
      (_p: any, token: vscode.CancellationToken) => sf.run(['project', 'retrieve', 'start', '--metadata', `ApexClass:${pick.label}`], { cwd: root, token })
    );
  }

  const file = findClassFile(root, pick.label);
  return { name: pick.label, dir: file ? path.dirname(file) : path.join(root, DEFAULT_CLASSES_DIR) };
}

/** Recursively finds <name>.cls under the project. */
function findClassFile(root: string, name: string): string | undefined {
  const target = `${name}.cls`;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: string[] = [];
    try { entries = fs.readdirSync(dir); } catch { continue; }
    for (const entry of entries) {
      if (entry === 'node_modules' || entry === '.siid' || entry === '.git') {
        continue;
      }
      const full = path.join(dir, entry);
      let isDir = false;
      try { isDir = fs.statSync(full).isDirectory(); } catch { continue; }
      if (isDir) {
        stack.push(full);
      } else if (entry === target) {
        return full;
      }
    }
  }
  return undefined;
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

function testTemplate(mainClass: string, testName: string): string {
  return `@isTest
private class ${testName} {

    @TestSetup
    static void makeData() {
        // TODO: create common test data for ${mainClass}
    }

    @isTest
    static void test${mainClass}() {
        // Arrange
        // TODO: set up inputs / mocks

        // Act
        Test.startTest();
        // TODO: call ${mainClass} method(s)
        Test.stopTest();

        // Assert
        // TODO: assert expected results
        System.assert(true, 'TODO: replace with real assertion');
    }
}
`;
}

function metaTemplate(apiVersion: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ApexClass xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>${apiVersion}</apiVersion>
    <status>Active</status>
</ApexClass>
`;
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Commands } from '../commands';
import { hasSalesforceProject } from '../core/workspace';
import { notify } from '../ui/notify';
import { Feature } from './types';

/**
 * Builds the Salesforce StandardApexLibrary cache (System.*, ConnectApi.*, …)
 * from the bundled Apex LSP jar. The content is identical across projects, so
 * it's extracted/parsed ONCE into the extension's global storage and shared;
 * this feature just triggers that build when a Salesforce project is open.
 *
 * The build is deferred off the activation burst and no-ops when the cache for
 * the current jar already exists (see `ApexStdlibManager.ensure`).
 */
export const registerApexStdlib: Feature = ({ context, stdlib, logger }) => {
  /** Writes the small pointer file into every open SFDX project root. */
  const bindProjects = () => {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const root = folder.uri.fsPath;
      if (fs.existsSync(path.join(root, 'sfdx-project.json'))) {
        stdlib.writeProjectPointer(root);
      }
    }
  };

  const buildIfProject = () => {
    if (!hasSalesforceProject()) {
      return; // not an SFDX workspace — nothing to do
    }
    void stdlib.ensure().then((lib) => {
      if (lib) {
        // Global content is ready — bind each project to it with a pointer file.
        bindProjects();
        vscode.commands.executeCommand(Commands.refreshSchemaTree);
      }
    }).catch((err) => logger.error(`[apex-stdlib] ensure: ${err.message}`));
  };

  // Defer past the activation burst (mirrors the object auto-refresh catch-up).
  const t = setTimeout(buildIfProject, 15_000);
  if (typeof t.unref === 'function') { t.unref(); }
  context.subscriptions.push({ dispose: () => clearTimeout(t) });

  // A project may be added to the workspace after activation.
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(buildIfProject)
  );

  // Manual rebuild (e.g. after a jar update landed via the update-apex-jar
  // workflow and the app was reloaded). Forces a fresh load.
  context.subscriptions.push(
    vscode.commands.registerCommand(Commands.rebuildApexStdlib, async () => {
      const lib = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'SIID Forge: building Apex standard library…' },
        () => stdlib.ensure()
      );
      if (lib) {
        bindProjects();
        const classes = new Set(Object.values(lib.classes).map((c) => c.qualifiedName)).size;
        notify.ok(`Apex standard library cached: ${classes} class(es) across ${Object.keys(lib.namespaces).length} namespace(s).`);
        vscode.commands.executeCommand(Commands.refreshSchemaTree);
      } else {
        notify.err('Could not build the Apex standard library (bundled jar missing or unreadable).');
      }
    })
  );
};

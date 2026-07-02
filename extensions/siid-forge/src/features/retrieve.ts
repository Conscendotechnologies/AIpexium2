/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as path from 'path';
import { Commands } from '../commands';
import { CancellationError } from '../core/sfExecutor';
import { collectDeployFiles, computeDeployDiff, DiffEntry } from '../core/deployDiff';
import { registerDiffReview, reviewDiffs } from './diffReview';
import { findProjectRoot, resolveResourceUri } from '../core/workspace';
import { ensureDefaultOrg } from '../ui/orgGuard';
import { notify } from '../ui/notify';
import { Feature } from './types';

/**
 * Retrieves a file or folder from the default org via `sf project retrieve start`.
 * Before overwriting local files, it shows a diff for anything that differs and
 * warns that local changes will be replaced — the mirror of deploy's safety net.
 * Invoked from the explorer or editor context menu.
 */
export const registerRetrieve: Feature = ({ context, sf, logger, orgs }) => {
  registerDiffReview(context);

  context.subscriptions.push(
    vscode.commands.registerCommand(Commands.retrieveSource, async (uri?: vscode.Uri) => {
      const resource = resolveResourceUri(uri);
      if (!resource) {
        return;
      }
      if (!(await ensureDefaultOrg(orgs))) {
        return;
      }

      const cwd = findProjectRoot(resource.fsPath);
      const label = path.basename(resource.fsPath);

      try {
        // 1. Diff the org against local — retrieve would overwrite local files.
        const files = collectDeployFiles(resource.fsPath);
        let diff: DiffEntry[] = [];
        if (files.length) {
          diff = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `SIID Forge: checking org for changes…`, cancellable: true },
            (_p, token) => computeDeployDiff(sf, files, cwd, token)
          );
        }

        // 2. If local would be overwritten by different org content, resolve it.
        const differing = diff.filter((d) => d.differs);
        if (differing.length) {
          const resolution = await reviewDiffs(differing, 'retrieve');
          if (resolution === 'keep-local') {
            notify.info('Kept your local version — retrieve skipped.');
            return;
          }
          if (resolution !== 'keep-org') {
            // 'fix-conflict' or dismissed: leave the diffs open, run nothing.
            if (resolution === 'fix-conflict') {
              notify.info('Resolve the conflict in the diff (edit & save local), then retrieve again.');
            } else {
              notify.cancelled('Retrieve');
            }
            return;
          }
          // 'keep-org' falls through to retrieve (overwrite local).
        }

        // 3. Retrieve (overwrites local with the org version).
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `SIID Forge: retrieving "${label}"…`, cancellable: true },
          (_progress, token) => sf.run(['project', 'retrieve', 'start', '--source-dir', resource.fsPath], { cwd, token })
        );
        notify.ok(`Retrieved "${label}" from org.`);
      } catch (err: any) {
        if (err instanceof CancellationError) {
          notify.cancelled('Retrieve');
          return;
        }
        logger.error(err.message);
        notify.err(`Retrieve failed: ${err.message}`);
      }
    })
  );
};

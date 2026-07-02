/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as path from 'path';
import { Commands } from '../commands';
import { CancellationError } from '../core/sfExecutor';
import { collectDeployFiles, computeDeployDiff, DiffEntry } from '../core/deployDiff';
import { registerDiffReview, reviewDiffs, applyKeepOrg } from './diffReview';
import { findProjectRoot, resolveResourceUri } from '../core/workspace';
import { ensureDefaultOrg } from '../ui/orgGuard';
import { notify } from '../ui/notify';
import { Feature } from './types';

/**
 * Deploys a file or folder to the default org — but first retrieves the org
 * version, shows a local↔org diff for anything that differs, and lets the user
 * review/edit before confirming. New or identical files deploy without a diff.
 *
 * The diff/deploy decision logic lives in `core/deployDiff` (agent-consumable);
 * this file is the UI wrapper. The diff-review UI is shared with retrieve.
 */
export const registerDeploy: Feature = ({ context, sf, logger, orgs }) => {
  registerDiffReview(context);

  context.subscriptions.push(
    vscode.commands.registerCommand(Commands.deploySource, async (uri?: vscode.Uri) => {
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
        // 1. Which supported components does this deploy touch?
        const files = collectDeployFiles(resource.fsPath);

        // 2. Diff each against the org (skipped for unsupported metadata types).
        let diff: DiffEntry[] = [];
        if (files.length) {
          diff = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `SIID Forge: checking org for changes…`, cancellable: true },
            (_p, token) => computeDeployDiff(sf, files, cwd, token)
          );
        }

        // 3. If something differs, let the user resolve the conflict first.
        const differing = diff.filter((d) => d.differs);
        if (differing.length) {
          const resolution = await reviewDiffs(differing, 'deploy');
          if (resolution === 'keep-org') {
            // Pull the org version into local; do NOT deploy.
            applyKeepOrg(differing);
            notify.info('Kept the org version — pulled it into your local files. Deploy skipped.');
            return;
          }
          if (resolution !== 'keep-local') {
            // 'fix-conflict' or dismissed: leave the diffs open, run nothing.
            if (resolution === 'fix-conflict') {
              notify.info('Resolve the conflict in the diff (edit & save local), then deploy again.');
            } else {
              notify.cancelled('Deploy');
            }
            return;
          }
          // 'keep-local' falls through to deploy.
        }

        // 4. Deploy (local is the source of truth; any edits were saved above).
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `SIID Forge: deploying "${label}"…`, cancellable: true },
          (_progress, token) => sf.run(['project', 'deploy', 'start', '--source-dir', resource.fsPath], { cwd, token })
        );
        notify.ok(`Deployed "${label}" to org.`);
      } catch (err: any) {
        if (err instanceof CancellationError) {
          notify.cancelled('Deploy');
          return;
        }
        logger.error(err.message);
        notify.err(`Deploy failed: ${err.message}`);
      }
    })
  );
};

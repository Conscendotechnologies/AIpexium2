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
import { findProjectRoot } from '../core/workspace';
import { pickTargetOrg } from '../ui/orgGuard';
import { notify } from '../ui/notify';
import { Feature } from './types';

/**
 * Multi-org deploy/retrieve (§19 phase 2). Two commands — "Deploy to Org…" and
 * "Retrieve from Org…" — that target ANY authorized org via `--target-org`
 * WITHOUT changing the project's default (primary) org. Both are multi-select
 * aware (explorer selection or the active editor) and share the same
 * diff-before-overwrite safety net as the primary deploy/retrieve commands.
 *
 * These deliberately do NOT touch schema: schema is tied to the primary org only
 * (§19 locked decision), so a secondary-org deploy/retrieve never refreshes the
 * local `.siid/schema` cache.
 */
export const registerDeployToOrg: Feature = ({ context, sf, logger, orgs }) => {
  registerDiffReview(context);

  context.subscriptions.push(
    vscode.commands.registerCommand(Commands.deployToOrg, (uri?: vscode.Uri, uris?: vscode.Uri[]) =>
      runToOrg('deploy', { sf, logger, orgs }, uri, uris)
    ),
    vscode.commands.registerCommand(Commands.retrieveFromOrg, (uri?: vscode.Uri, uris?: vscode.Uri[]) =>
      runToOrg('retrieve', { sf, logger, orgs }, uri, uris)
    )
  );
};

type Deps = Pick<Parameters<Feature>[0], 'sf' | 'logger' | 'orgs'>;

/**
 * Shared body for both commands. `mode` picks the verb, the `sf` subcommand, and
 * the diff-review wording; everything else (selection, org pick, diff, run) is
 * identical.
 */
async function runToOrg(
  mode: 'deploy' | 'retrieve',
  { sf, logger, orgs }: Deps,
  uri?: vscode.Uri,
  uris?: vscode.Uri[]
): Promise<void> {
  // Explorer multi-select passes (uri, uris[]); a palette/editor invocation
  // passes just the active file's uri (or nothing → use the active editor).
  const selected = resolveSelection(uris, uri);
  if (!selected.length) {
    vscode.window.showErrorMessage('SIID Forge: select one or more files/folders to ' + (mode === 'deploy' ? 'deploy.' : 'retrieve.'));
    return;
  }

  const verb = mode === 'deploy' ? 'Deploy to' : 'Retrieve from';
  const targetOrg = await pickTargetOrg(orgs, verb);
  if (!targetOrg) {
    return; // cancelled or no orgs
  }

  // All selected paths must share a project root (the sf command runs from one cwd).
  const cwd = findProjectRoot(selected[0]);
  const label = selected.length === 1 ? path.basename(selected[0]) : `${selected.length} items`;

  try {
    // 1. Collect every supported component across the whole selection.
    const files = selected.flatMap((p) => collectDeployFiles(p));

    // 2. Diff each against the CHOSEN org (not the primary).
    let diff: DiffEntry[] = [];
    if (files.length) {
      diff = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `SIID Forge: checking "${targetOrg}" for changes…`, cancellable: true },
        (_p, token) => computeDeployDiff(sf, files, cwd, token, targetOrg)
      );
    }

    // 3. Resolve any conflicts before overwriting either side.
    const differing = diff.filter((d) => d.differs);
    if (differing.length) {
      const resolution = await reviewDiffs(differing, mode);
      if (mode === 'deploy') {
        if (resolution === 'keep-org') {
          applyKeepOrg(differing);
          notify.info(`Kept the "${targetOrg}" version — pulled it into your local files. Deploy skipped.`);
          return;
        }
        if (resolution !== 'keep-local') {
          if (resolution === 'fix-conflict') {
            notify.info('Resolve the conflict in the diff (edit & save local), then deploy again.');
          } else {
            notify.cancelled('Deploy');
          }
          return;
        }
      } else {
        if (resolution === 'keep-local') {
          notify.info('Kept your local version — retrieve skipped.');
          return;
        }
        if (resolution !== 'keep-org') {
          if (resolution === 'fix-conflict') {
            notify.info('Resolve the conflict in the diff (edit & save local), then retrieve again.');
          } else {
            notify.cancelled('Retrieve');
          }
          return;
        }
      }
    }

    // 4. Run against the chosen org — primary/default org is untouched.
    const sub = mode === 'deploy' ? 'deploy' : 'retrieve';
    const args = ['project', sub, 'start', ...selected.flatMap((p) => ['--source-dir', p]), '--target-org', targetOrg];
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `SIID Forge: ${mode === 'deploy' ? 'deploying' : 'retrieving'} "${label}" ${mode === 'deploy' ? 'to' : 'from'} "${targetOrg}"…`, cancellable: true },
      (_progress, token) => sf.run(args, { cwd, token })
    );
    notify.ok(`${mode === 'deploy' ? 'Deployed' : 'Retrieved'} "${label}" ${mode === 'deploy' ? 'to' : 'from'} "${targetOrg}".`);
    // No schema sync: schema follows the primary org only (§19).
  } catch (err: any) {
    if (err instanceof CancellationError) {
      notify.cancelled(mode === 'deploy' ? 'Deploy' : 'Retrieve');
      return;
    }
    logger.error(err.message);
    notify.err(`${mode === 'deploy' ? 'Deploy' : 'Retrieve'} failed: ${err.message}`);
  }
}

/**
 * Resolves the target paths. Prefers an explorer multi-selection (`uris`), then a
 * single passed uri, then the active editor's file. Filters to on-disk files so a
 * virtual/diff document never leaks in.
 */
function resolveSelection(uris: vscode.Uri[] | undefined, uri: vscode.Uri | undefined): string[] {
  const fromSelection = (uris?.length ? uris : uri ? [uri] : [])
    .filter((u) => u.scheme === 'file')
    .map((u) => u.fsPath);
  if (fromSelection.length) {
    return fromSelection;
  }
  const active = vscode.window.activeTextEditor?.document.uri;
  return active && active.scheme === 'file' ? [active.fsPath] : [];
}

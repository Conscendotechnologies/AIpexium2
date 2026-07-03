/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as path from 'path';
import { Commands } from '../commands';
import { CancellationError } from '../core/sfExecutor';
import { collectDeployFiles, computeDeployDiff, listLocalComponents, ComponentRef, DiffEntry } from '../core/deployDiff';
import { registerDiffReview, reviewDiffs } from './diffReview';
import { ConflictPanel } from './conflictPanel';
import { getWorkspaceCwd } from '../core/workspace';
import { pickTargetOrg } from '../ui/orgGuard';
import { notify } from '../ui/notify';
import { Feature } from './types';

/**
 * Multi-org deploy/retrieve (§19 phase 2). Two commands — "Deploy to Org…" and
 * "Retrieve from Org…" — that target ANY authorized org via `--target-org`
 * WITHOUT changing the project's default (primary) org.
 *
 * Selection is BY COMPONENT (metadata type), not by folder: the command opens a
 * multi-select picker of local components (labelled `Type · Name`), pre-checking
 * anything the explorer selection / active editor touched. This avoids a folder
 * click silently expanding into dozens of components.
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
 * the review UI (deploy → conflict panel, retrieve → modal). Selection, org pick,
 * and diff are common.
 */
async function runToOrg(
  mode: 'deploy' | 'retrieve',
  { sf, logger, orgs }: Deps,
  uri?: vscode.Uri,
  uris?: vscode.Uri[]
): Promise<void> {
  const cwd = getWorkspaceCwd();
  if (!cwd) {
    return; // getWorkspaceCwd already showed the "open a project" error
  }

  // Component multi-picker, pre-seeded from the explorer/editor selection.
  const seedPaths = resolveSelection(uris, uri);
  const components = await chooseComponents(cwd, seedPaths, mode);
  if (!components || !components.length) {
    return; // cancelled or nothing picked
  }

  const verb = mode === 'deploy' ? 'Deploy to' : 'Retrieve from';
  const targetOrg = await pickTargetOrg(orgs, verb);
  if (!targetOrg) {
    return; // cancelled or no orgs
  }

  const label = components.length === 1 ? `${components[0].type} ${components[0].fullName}` : `${components.length} components`;
  // Every file across the chosen components (one for Apex, many for a bundle).
  const runPathsAll = components.flatMap((c) => c.paths);

  try {
    // 1. Build the DeployFile list from the chosen components (re-collect so the
    //    diff sees exactly what will be deployed — one classifier, one truth).
    const files = runPathsAll.flatMap((p) => collectDeployFiles(p));

    // 2. Diff each against the CHOSEN org (not the primary).
    let diff: DiffEntry[] = [];
    if (files.length) {
      diff = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `SIID Forge: checking "${targetOrg}" for changes…`, cancellable: true },
        (_p, token) => computeDeployDiff(sf, files, cwd, token, targetOrg)
      );
    }

    // 3. Decide what to run.
    //    Deploy: show the conflict-list panel (every component + status) and let
    //    the user deploy all / only differing / cancel (§19 phase 3).
    //    Retrieve: keep the modal keep-local/keep-org review (overwrites local).
    let runPaths: string[];
    if (mode === 'deploy') {
      const decided = await decideDeployPaths(diff, runPathsAll, targetOrg);
      if (!decided) {
        notify.cancelled('Deploy');
        return;
      }
      runPaths = decided;
      if (!runPaths.length) {
        notify.info('Nothing selected to deploy.');
        return;
      }
    } else {
      const differing = diff.filter((d) => d.differs);
      if (differing.length) {
        const resolution = await reviewDiffs(differing, 'retrieve');
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
      runPaths = runPathsAll;
    }

    // 4. Run against the chosen org — primary/default org is untouched.
    const sub = mode === 'deploy' ? 'deploy' : 'retrieve';
    const args = ['project', sub, 'start', ...runPaths.flatMap((p) => ['--source-dir', p]), '--target-org', targetOrg];
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
 * Shows the conflict-list panel and maps the user's choice to the local paths to
 * deploy. Returns the paths, an empty array (nothing to do), or undefined
 * (cancelled). When there are no diffable components (only unsupported metadata),
 * falls straight through to deploying all the chosen components' files.
 */
async function decideDeployPaths(
  diff: DiffEntry[],
  allPaths: string[],
  targetOrg: string
): Promise<string[] | undefined> {
  if (!diff.length) {
    // Nothing was diffable — deploy all chosen files (no panel to show).
    return allPaths;
  }

  const choice = await new ConflictPanel().open(diff, targetOrg);
  if (choice.action === 'cancel') {
    return undefined;
  }

  // Paths the panel chose (per diff entry) + any chosen-component paths that
  // produced no diff entry (unsupported metadata) so a mixed selection still
  // deploys those. A "Deploy differing" choice deliberately excludes the
  // undiffed extras — only what the user saw as differing goes out.
  const chosen = new Set(choice.paths);
  const diffedPaths = new Set(diff.map((d) => d.localPath));
  if (choice.paths.length === diff.length) {
    // "Deploy all" — include undiffed component files too.
    for (const p of allPaths) {
      if (!diffedPaths.has(p)) {
        chosen.add(p);
      }
    }
  }
  return [...chosen];
}

/**
 * Opens a multi-select QuickPick of local components (labelled `Type · Name`),
 * pre-checking the components the explorer/editor selection touched. Selection is
 * BY COMPONENT — a folder click seeds every component under it as pre-checked, but
 * the user still confirms the exact set. Returns the chosen ComponentRefs, or
 * undefined if cancelled.
 */
async function chooseComponents(
  cwd: string,
  seedPaths: string[],
  mode: 'deploy' | 'retrieve'
): Promise<ComponentRef[] | undefined> {
  const all = listLocalComponents(cwd);
  if (!all.length) {
    vscode.window.showErrorMessage('SIID Forge: no deployable components found in this project.');
    return undefined;
  }

  // A component is seeded (pre-checked) when any of its files is under a seed path
  // (a seed can be a file OR a folder the user clicked).
  const seeds = seedPaths.map((p) => path.resolve(p));
  const isSeeded = (c: ComponentRef): boolean =>
    c.paths.some((cp) => {
      const rp = path.resolve(cp);
      return seeds.some((s) => rp === s || rp.startsWith(s + path.sep));
    });

  interface Item extends vscode.QuickPickItem { ref: ComponentRef; }
  const items: Item[] = all.map((c) => ({
    label: c.fullName,
    description: c.type,
    picked: isSeeded(c),
    ref: c
  }));

  const picked = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    matchOnDescription: true, // let the user filter by metadata type too
    title: `${mode === 'deploy' ? 'Deploy to Org' : 'Retrieve from Org'} — select components`,
    placeHolder: 'Space toggles · type to filter by name or metadata type · Enter confirms'
  });
  return picked?.map((p) => p.ref);
}

/**
 * Resolves the seed paths for pre-checking the picker. Prefers an explorer
 * multi-selection (`uris`), then a single passed uri, then the active editor's
 * file. Filters to on-disk paths so a virtual/diff document never leaks in.
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

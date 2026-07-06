/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { DiffEntry } from '../core/deployDiff';

/** Virtual scheme for the read-only "org version" side of every diff. */
const ORG_SCHEME = 'siid-forge-org';

// Module-level store backing the read-only org documents; registered once.
const orgContent = new Map<string, string>();
let registered = false;

/** Registers the read-only org content provider (idempotent). */
export function registerDiffReview(context: vscode.ExtensionContext): void {
  if (registered) {
    return;
  }
  registered = true;
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(ORG_SCHEME, {
      provideTextDocumentContent: (uri) => orgContent.get(uri.path) ?? ''
    })
  );
}

/** Which side of a deploy/retrieve we're confirming — drives wording + result verb. */
export type DiffMode = 'deploy' | 'retrieve';

/**
 * Outcome of the conflict review:
 *  - 'keep-local'    : the local version wins (deploy proceeds / retrieve aborts)
 *  - 'keep-org'      : the org version wins (deploy aborts + local overwritten / retrieve proceeds)
 *  - 'fix-conflict'  : leave the editable diff open; run nothing
 *  - 'dismissed'     : modal dismissed (Esc) — treat as cancel
 */
export type DiffResolution = 'keep-local' | 'keep-org' | 'fix-conflict' | 'dismissed';

const KEEP_ORG = 'Keep Org';
const KEEP_LOCAL = 'Keep Local';
const FIX = 'Fix Conflict';

/**
 * Opens an org↔local diff for each changed component and asks how to resolve.
 * The org side is read-only (virtual doc); the local side is the real editable
 * file, so "Fix Conflict" = edit local in the diff, then re-run.
 */
export async function reviewDiffs(differing: DiffEntry[], mode: DiffMode): Promise<DiffResolution> {
  for (const entry of differing) {
    await openDiff(entry);
  }

  const names = differing.map((d) => d.fullName).join(', ');
  const subject = differing.length === 1 ? `"${differing[0].fullName}"` : `${differing.length} files (${names})`;
  const s = differing.length === 1 ? 's' : '';

  const detail = mode === 'deploy'
    ? `Deploying overwrites the org with your local version.\n\n• ${KEEP_LOCAL}: deploy your local (overwrite org)\n• ${KEEP_ORG}: pull the org version into local (no deploy)\n• ${FIX}: edit the local side in the diff, then deploy again`
    : `Retrieving overwrites your local files with the org version.\n\n• ${KEEP_ORG}: retrieve (overwrite local)\n• ${KEEP_LOCAL}: keep your local (don't retrieve)\n• ${FIX}: edit the local side in the diff, then retrieve again`;

  const choice = await vscode.window.showWarningMessage(
    `${subject} differ${s} from the org.\n\n${detail}`,
    { modal: true },
    KEEP_ORG,
    KEEP_LOCAL,
    FIX
  );

  switch (choice) {
    case KEEP_ORG: return 'keep-org';
    case KEEP_LOCAL: return 'keep-local';
    case FIX: return 'fix-conflict';
    default: return 'dismissed';
  }
}

/**
 * Opens the org↔local diff for a single entry (used by the conflict-list panel,
 * §19 phase 3, when a differing row is clicked). Thin public wrapper over the
 * internal `openDiff` so callers don't have to know the virtual-scheme plumbing.
 */
export async function openEntryDiff(entry: DiffEntry): Promise<void> {
  await openDiff(entry);
}

/** Writes each differing file's org content into the local file (Keep Org for deploy). */
export function applyKeepOrg(differing: DiffEntry[]): void {
  for (const entry of differing) {
    if (entry.orgPath) {
      try {
        fs.copyFileSync(entry.orgPath, entry.localPath);
      } catch {
        // best-effort; skip files we can't write
      }
    }
  }
}

/**
 * Opens the native diff editor. For deploy the org is on the left and local on
 * the right ("what deploys" reads naturally on the right). For retrieve we flip
 * it: local (what you'll lose) on the left, org (what's coming in) on the right.
 */
async function openDiff(entry: DiffEntry): Promise<void> {
  const orgText = entry.orgPath ? safeRead(entry.orgPath) : '';
  const key = `/${entry.type}/${entry.fullName}${path.extname(entry.localPath)}`;
  orgContent.set(key, orgText);

  const orgUri = vscode.Uri.from({ scheme: ORG_SCHEME, path: key });
  const localUri = vscode.Uri.file(entry.localPath);
  const title = `${entry.fullName}: Org ↔ Local`;
  await vscode.commands.executeCommand('vscode.diff', orgUri, localUri, title, { preview: true });
}

let sideCounter = 0;

/**
 * Opens a diff between two arbitrary file paths (org-compare, §19 revised). Both
 * sides are rendered as READ-ONLY virtual documents (each side may be a temp file
 * from a retrieve, or a local working file we don't want edited from here). A
 * missing path shows as empty. Unique keys per call so concurrent compares of the
 * same component don't collide in the content store.
 */
export async function openDiffFiles(
  a: { path?: string; label: string },
  b: { path?: string; label: string },
  title: string
): Promise<void> {
  const n = sideCounter++;
  const keyA = `/cmp/${n}/${a.label}/${a.path ? path.basename(a.path) : 'absent'}`;
  const keyB = `/cmp/${n}/${b.label}/${b.path ? path.basename(b.path) : 'absent'}`;
  orgContent.set(keyA, a.path ? safeRead(a.path) : '');
  orgContent.set(keyB, b.path ? safeRead(b.path) : '');
  const uriA = vscode.Uri.from({ scheme: ORG_SCHEME, path: keyA });
  const uriB = vscode.Uri.from({ scheme: ORG_SCHEME, path: keyB });
  await vscode.commands.executeCommand('vscode.diff', uriA, uriB, title, { preview: true });
}

function safeRead(p: string): string {
  try {
    return fs.readFileSync(p, 'utf-8');
  } catch {
    return '';
  }
}

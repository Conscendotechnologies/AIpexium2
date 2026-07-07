/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import type { SiidForgeApi } from './siid-forge';

const FORGE_ID = 'ConscendoTechInc.siid-forge';
/** The Forge API version this extension needs (diff.retrieveTypes / isDiffable). */
const REQUIRED_VERSION = '2.5.0';

/** Semver-ish compare good enough for our `major.minor.patch` checks. */
function gte(a: string, b: string): boolean {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) {
      return (pa[i] ?? 0) > (pb[i] ?? 0);
    }
  }
  return true;
}

/**
 * Resolves the SIID Forge SDK, activating it if needed. Returns undefined (with a
 * user-facing message) when Forge is missing or too old — every caller should
 * bail on undefined. Because we declare `extensionDependencies` on Forge, it is
 * normally already active by the time we run.
 */
export async function getForge(): Promise<SiidForgeApi | undefined> {
  const ext = vscode.extensions.getExtension(FORGE_ID);
  if (!ext) {
    vscode.window.showErrorMessage('SF Project Retriever requires the SIID Forge extension, which is not installed.');
    return undefined;
  }
  const forge = (await ext.activate()) as SiidForgeApi | undefined;
  if (!forge) {
    vscode.window.showErrorMessage('SIID Forge activated but exposed no API.');
    return undefined;
  }
  if (!gte(forge.version, REQUIRED_VERSION)) {
    vscode.window.showWarningMessage(
      `SIID Forge ${forge.version} is too old — this feature needs ${REQUIRED_VERSION}+. Please update SIID Forge.`
    );
    return undefined;
  }
  return forge;
}

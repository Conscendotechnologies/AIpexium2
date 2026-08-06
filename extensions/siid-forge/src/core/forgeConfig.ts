/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as fs from 'fs';
import * as path from 'path';

export interface TraceConfig {
  username: string;
  debugLevelId: string;
  traceFlagId: string;
  /** ISO date string when the trace flag expires. */
  expirationDate: string;
}

export interface ForgeConfig {
  trace?: TraceConfig;
  /**
   * SIID's own mirror of the default (target) org alias. `.sf/config.json`
   * remains the SOURCE OF TRUTH (the `sf` CLI reads only that); this is a mirror
   * we keep in sync so Forge has an owned, CLI-independent copy to fall back on.
   */
  defaultOrg?: string;
  /**
   * Cached metadata API version of the default org (from `sf org display`), used
   * for local scaffolds when the project's sfdx-project.json doesn't declare a
   * `sourceApiVersion`. Refreshed alongside the other org state on an org change.
   */
  apiVersion?: string;
}

const SIID_DIR = '.siid';
const CONFIG_FILE = 'forge.json';

function configPath(projectRoot: string): string {
  return path.join(projectRoot, SIID_DIR, CONFIG_FILE);
}

/** Reads `.siid/forge.json`, returning an empty config when absent/invalid. */
export function readForgeConfig(projectRoot: string): ForgeConfig {
  try {
    const raw = fs.readFileSync(configPath(projectRoot), 'utf-8');
    return JSON.parse(raw) as ForgeConfig;
  } catch {
    return {};
  }
}

/** Writes `.siid/forge.json`, creating the `.siid` directory if needed. */
export function writeForgeConfig(projectRoot: string, config: ForgeConfig): void {
  const dir = path.join(projectRoot, SIID_DIR);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath(projectRoot), JSON.stringify(config, null, 2), 'utf-8');
}

/** Absolute path to a subfolder under `.siid`, created on demand. */
export function ensureSiidSubdir(projectRoot: string, sub: string): string {
  const dir = path.join(projectRoot, SIID_DIR, sub);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as fs from 'fs';
import * as path from 'path';
import { ensureSiidSubdir } from './forgeConfig';

/** Per-class coverage captured from the most recent test run. */
export interface ClassCoverageEntry {
  name: string;
  totalLines: number;
  totalCovered: number;
  coveredPercent: number;
  /** Sorted line numbers that WERE covered (executed). */
  covered: number[];
  /** Sorted line numbers that were NOT covered. */
  uncovered: number[];
  /** When this coverage was recorded (ISO). */
  capturedAt: string;
}

/** className -> coverage entry. */
type CoverageMap = Record<string, ClassCoverageEntry>;

const FILE = 'coverage.json';

function file(projectRoot: string): string {
  return path.join(ensureSiidSubdir(projectRoot, 'test-results'), FILE);
}

function read(projectRoot: string): CoverageMap {
  try {
    return JSON.parse(fs.readFileSync(file(projectRoot), 'utf-8')) as CoverageMap;
  } catch {
    return {};
  }
}

/**
 * Merges the given coverage entries into the cache (keyed by class name), so the
 * latest run for each class wins while older, untouched classes are preserved.
 */
export function saveCoverage(projectRoot: string, entries: ClassCoverageEntry[]): void {
  if (!entries.length) {
    return;
  }
  const map = read(projectRoot);
  for (const e of entries) {
    map[e.name] = e;
  }
  fs.writeFileSync(file(projectRoot), JSON.stringify(map, null, 2), 'utf-8');
}

/** Returns cached coverage for a class, or undefined if none recorded yet. */
export function getCoverage(projectRoot: string, className: string): ClassCoverageEntry | undefined {
  return read(projectRoot)[className];
}

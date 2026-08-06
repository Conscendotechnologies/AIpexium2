/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @ts-check
'use strict';

/**
 * Fails if the SDK types package version doesn't match the runtime API version.
 *
 * The published `@conscendotech/siid-forge-api@X` is a PROMISE: a consumer that
 * installs version X gets the type surface the running extension actually exposes
 * at `SiidForgeApi.version`. If someone bumps one without the other, that promise
 * is broken silently — a consumer compiles against types the runtime doesn't have,
 * or vice versa. This check turns that into a hard build error.
 *
 * Reads the runtime version from `src/api.ts` by regex (no compile/import needed,
 * so it runs standalone in any build — gulp, npm, or the .bat) and compares it to
 * `api/package.json`.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function fail(msg) {
  console.error(`[check-api-version] ${msg}`);
  process.exit(1);
}

const apiTsPath = path.join(root, 'src', 'api.ts');
const pkgPath = path.join(root, 'api', 'package.json');

if (!fs.existsSync(apiTsPath)) {
  fail(`cannot find ${apiTsPath}`);
}
if (!fs.existsSync(pkgPath)) {
  fail(`cannot find ${pkgPath}`);
}

const apiTs = fs.readFileSync(apiTsPath, 'utf-8');
// Matches: readonly version = '2.14.0';
const m = apiTs.match(/readonly\s+version\s*=\s*['"]([^'"]+)['"]/);
if (!m) {
  fail(`could not find "readonly version = '...'" in src/api.ts`);
}
const runtimeVersion = m[1];

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
const pkgVersion = pkg.version;

if (runtimeVersion !== pkgVersion) {
  fail(
    `SDK version drift: SiidForgeApi.version is ${runtimeVersion} but ` +
    `api/package.json is ${pkgVersion}. Bump BOTH together — the package version ` +
    `is the compile-time contract for the runtime API version.`
  );
}

console.log(`[check-api-version] OK — SDK types and runtime API both at ${runtimeVersion}.`);

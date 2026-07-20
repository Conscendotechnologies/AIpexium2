/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Compile-time conformance guard: proves the runtime `SiidForgeApi` class stays
 * assignable to the hand-authored public contract in the
 * `@conscendotech/siid-forge-api` package (`api/siid-forge.d.ts`). If the two
 * drift (a renamed/removed method, a changed signature), THIS FILE fails to
 * compile — a loud reminder to update the shipped `.d.ts`. No runtime effect.
 *
 * The SEPARATE concern of "package version == runtime API version" is enforced by
 * `scripts/check-api-version.js` (run in the build), not here — this module stays
 * purely type-level and never instantiates anything.
 */
import type { SiidForgeApi as PublicApi } from '../api/siid-forge';
import { SiidForgeApi as RuntimeApi } from './api';

// The runtime class must satisfy the published interface.
const _conforms: (a: RuntimeApi) => PublicApi = (a) => a;
void _conforms;

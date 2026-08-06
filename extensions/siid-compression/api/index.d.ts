/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Package entry point. The full surface lives in `siid-compression.d.ts` beside this
// file; this indirection is the conventional npm `types` entry so consumers write
// `import type { ICompressionApi } from '@conscendotech/siid-compression-api'`.
export * from './siid-compression';

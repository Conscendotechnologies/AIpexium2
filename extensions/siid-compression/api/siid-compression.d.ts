/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 *  SIID Compression — CONSUMER-FACING API TYPES.
 *
 *  The public surface returned from the `ConscendoTechInc.siid-compression` extension's
 *  activate(). Consumers (siid-forge, SIID-Code) bind at runtime and route their OpenRouter
 *  traffic through the local compression proxy:
 *
 *    import type { ICompressionApi } from '@conscendotech/siid-compression-api';
 *    const ext = vscode.extensions.getExtension(SIID_COMPRESSION_EXTENSION_ID);
 *    const api = ext?.isActive ? (ext.exports as ICompressionApi | undefined) : undefined;
 *    const baseUrl = api?.getProxyBaseUrl() || 'https://openrouter.ai/api/v1';
 *
 *  Types only — nothing here runs. The live object comes from the extension host at runtime.
 *  If the extension is absent or its proxy is not healthy, getProxyBaseUrl() returns '' and the
 *  consumer must talk to OpenRouter directly. Compression is optional infra, never a hard dep.
 *
 *  This file MUST stay in sync with the extension's src/types.ts ICompressionApi surface — the
 *  apiConformance guard fails the build if the runtime class no longer satisfies this interface.
 */

/** A chat message in the loosest shape both consumers share (Anthropic MessageParam / OpenAI chat). */
export interface CompressibleMessage {
	role: string;
	content: unknown;
	[key: string]: unknown;
}

export interface CompressOptions {
	/** Model id, forwarded to the backend so it can size/tokenize correctly. */
	model?: string;
	/** Free-form tag for logging/telemetry, e.g. "siid-code" or "forge". */
	source?: string;
	/** If true (default), a backend failure returns the ORIGINAL messages instead of throwing. */
	fallback?: boolean;
}

export interface CompressStats {
	tokensBefore: number;
	tokensAfter: number;
	tokensSaved: number;
	/** 0..1 */
	compressionRatio: number;
	transformsApplied: string[];
	backend: string;
	/** True when messages were left unchanged (passthrough or fallback). */
	passthrough: boolean;
}

export interface CompressResult<T = CompressibleMessage> {
	messages: T[];
	stats: CompressStats;
}

/** Dry run — projected savings without mutating anything or calling an LLM. */
export interface SimResult {
	tokensBefore: number;
	tokensAfter: number;
	tokensSaved: number;
	compressionRatio: number;
	transformsApplied: string[];
	backend: string;
}

/**
 * The public API surface returned from the extension's activate().
 *
 * PRIMARY use (integration model B): call getProxyBaseUrl() and point your OpenAI/OpenRouter
 * client's base URL at it. All traffic then flows through the local compression proxy and is
 * compressed transparently. If it returns '' (proxy not ready), talk to OpenRouter directly.
 */
export interface ICompressionApi {
	readonly version: string;

	// --- Proxy routing (primary) ---
	/**
	 * Base URL to point an OpenAI/OpenRouter-compatible client at, e.g. "http://127.0.0.1:8791/v1".
	 * Returns '' if the proxy is not healthy — the consumer should then use OpenRouter directly.
	 */
	getProxyBaseUrl(): string;
	/** 'stopped' | 'starting' | 'healthy' | 'unavailable'. */
	getProxyState(): string;
	/** Ensure the proxy is running; resolves true when healthy. Safe to call repeatedly. */
	ensureProxy(): Promise<boolean>;

	// --- Inline helpers (optional / diagnostics) ---
	/** Dry run to preview savings on a sample. */
	simulate(messages: CompressibleMessage[], options?: CompressOptions): Promise<SimResult>;
	/** Compress messages inline (kept for diagnostics; the proxy path doesn't need this). */
	compress<T extends CompressibleMessage>(messages: T[], options?: CompressOptions): Promise<CompressResult<T>>;
	/** Which backend is currently active (after health checks). */
	activeBackend(): Promise<string>;
}

/** Stable id to pass to vscode.extensions.getExtension(). */
export declare const SIID_COMPRESSION_EXTENSION_ID = 'ConscendoTechInc.siid-compression';

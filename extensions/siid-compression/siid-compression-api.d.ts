/*---------------------------------------------------------------------------------------------
 *  SIID Compression — CONSUMER-FACING API TYPES.
 *
 *  Copy this file into a consumer (siid-forge, SIID-Code) to get typed binding without
 *  depending on the extension's build. It mirrors src/types.ts (ICompressionApi surface).
 *
 *  Usage in a consumer:
 *    import type { ICompressionApi } from './siid-compression-api';
 *    const ext = vscode.extensions.getExtension('ConscendoTechInc.siid-compression');
 *    const api = ext ? (await ext.activate()) as ICompressionApi : undefined;
 *    const { messages } = api ? await api.compress(msgs, { source: 'forge' }) : { messages: msgs };
 *--------------------------------------------------------------------------------------------*/

export interface CompressibleMessage {
	role: string;
	content: unknown;
	[key: string]: unknown;
}

export interface CompressOptions {
	model?: string;
	source?: string;
	fallback?: boolean;
}

export interface CompressStats {
	tokensBefore: number;
	tokensAfter: number;
	tokensSaved: number;
	compressionRatio: number;
	transformsApplied: string[];
	backend: string;
	passthrough: boolean;
}

export interface CompressResult<T = CompressibleMessage> {
	messages: T[];
	stats: CompressStats;
}

export interface SimResult {
	tokensBefore: number;
	tokensAfter: number;
	tokensSaved: number;
	compressionRatio: number;
	transformsApplied: string[];
	backend: string;
}

export interface ICompressionApi {
	readonly version: string;
	compress<T extends CompressibleMessage>(messages: T[], options?: CompressOptions): Promise<CompressResult<T>>;
	simulate(messages: CompressibleMessage[], options?: CompressOptions): Promise<SimResult>;
	activeBackend(): Promise<string>;
}

/** Stable id to pass to vscode.extensions.getExtension(). */
export declare const SIID_COMPRESSION_EXTENSION_ID = 'ConscendoTechInc.siid-compression';

/*---------------------------------------------------------------------------------------------
 *  Node-proxy provider — the inline diagnostics face of OUR compression strategy.
 *
 *  The PRIMARY path is the proxy (server.js): consumers point their base URL at it and traffic
 *  is compressed transparently. This provider exists only for the inline helpers — `simulate`
 *  (dry-run preview) and `compress` (diagnostics) — exposed on ICompressionApi. It runs the very
 *  same strategy the proxy uses (compressor.js) directly in-process, with NO HTTP and NO LLM
 *  call, so a "what would this save?" check is cheap and offline.
 *
 *  It loads compressor.js LAZILY via require() from the bundled proxy dir (out/proxy in prod,
 *  src/proxy in dev). If it can't be found it reports unhealthy and the manager uses passthrough.
 *--------------------------------------------------------------------------------------------*/
import * as fs from 'fs';
import * as path from 'path';
import { CompressibleMessage, CompressOptions, CompressResult, ICompressionProvider, SimResult } from '../types';

/** Shape of the bits of compressor.js we call. Kept local — no build-time dependency on the JS. */
interface CompressorModule {
	compressRequest(
		body: { messages?: unknown[] },
		ctx?: Record<string, unknown>,
	): {
		body: { messages?: unknown[] };
		stats: { tokensBefore: number; tokensAfter: number; tokensSaved: number; compressionRatio: number; transformsApplied: string[]; passthrough: boolean };
	};
	estimateMessagesTokens(messages: unknown[]): number;
}

export class NodeProxyProvider implements ICompressionProvider {
	readonly id = 'node-proxy';

	private mod: CompressorModule | undefined;
	private modLoadAttempted = false;

	constructor(private readonly log: (msg: string) => void) {}

	/** Lazy-require the bundled compressor; undefined if it can't be located. */
	private getModule(): CompressorModule | undefined {
		if (!this.modLoadAttempted) {
			this.modLoadAttempted = true;
			const candidates = [
				path.join(__dirname, '..', 'proxy', 'compressor.js'), // out/proxy/compressor.js
				path.join(__dirname, '..', '..', 'src', 'proxy', 'compressor.js'), // dev fallback
			];
			const found = candidates.find((c) => fs.existsSync(c));
			try {
				if (!found) {
					throw new Error(`compressor.js not found (looked in ${candidates.join(', ')})`);
				}
				// eslint-disable-next-line @typescript-eslint/no-var-requires
				this.mod = require(found) as CompressorModule;
			} catch (err) {
				const reason = ((err as Error).message || '').split('\n')[0];
				this.log(`node-proxy compressor unavailable (${reason}); using passthrough for diagnostics.`);
				this.mod = undefined;
			}
		}
		return this.mod;
	}

	async isHealthy(): Promise<boolean> {
		return !!this.getModule();
	}

	async compress<T extends CompressibleMessage>(messages: T[], _options?: CompressOptions): Promise<CompressResult<T>> {
		const mod = this.getModule();
		if (!mod) {
			throw new Error('node-proxy compressor module not available');
		}
		const { body, stats } = mod.compressRequest({ messages });
		return {
			messages: (body.messages as T[]) ?? messages,
			stats: {
				tokensBefore: stats.tokensBefore,
				tokensAfter: stats.tokensAfter,
				tokensSaved: stats.tokensSaved,
				compressionRatio: stats.compressionRatio,
				transformsApplied: stats.transformsApplied ?? [],
				backend: this.id,
				passthrough: stats.passthrough,
			},
		};
	}

	async simulate(messages: CompressibleMessage[], _options?: CompressOptions): Promise<SimResult> {
		const mod = this.getModule();
		if (!mod) {
			throw new Error('node-proxy compressor module not available');
		}
		const { stats } = mod.compressRequest({ messages });
		return {
			tokensBefore: stats.tokensBefore,
			tokensAfter: stats.tokensAfter,
			tokensSaved: stats.tokensSaved,
			compressionRatio: stats.compressionRatio,
			transformsApplied: stats.transformsApplied ?? [],
			backend: this.id,
		};
	}
}

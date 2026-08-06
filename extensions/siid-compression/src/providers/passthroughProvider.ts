/*---------------------------------------------------------------------------------------------
 *  Passthrough provider — the always-healthy floor.
 *
 *  Returns messages unchanged. This is what every consumer falls back to when no
 *  real backend is available, so "all AI conversations go through the layer" stays
 *  true even with zero infrastructure. It is intentionally trivial and dependency-free.
 *--------------------------------------------------------------------------------------------*/
import { CompressibleMessage, CompressOptions, CompressResult, ICompressionProvider, SimResult } from '../types';

export class PassthroughProvider implements ICompressionProvider {
	readonly id = 'passthrough';

	async isHealthy(): Promise<boolean> {
		return true;
	}

	async compress<T extends CompressibleMessage>(messages: T[], _options?: CompressOptions): Promise<CompressResult<T>> {
		return {
			messages,
			stats: {
				tokensBefore: 0,
				tokensAfter: 0,
				tokensSaved: 0,
				compressionRatio: 0,
				transformsApplied: [],
				backend: this.id,
				passthrough: true,
			},
		};
	}

	async simulate(_messages: CompressibleMessage[], _options?: CompressOptions): Promise<SimResult> {
		return {
			tokensBefore: 0,
			tokensAfter: 0,
			tokensSaved: 0,
			compressionRatio: 0,
			transformsApplied: [],
			backend: this.id,
		};
	}
}

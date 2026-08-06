/*---------------------------------------------------------------------------------------------
 *  CompressionManager — the "switch".
 *
 *  Owns the ordered list of backends, health-checks them (cached), and picks the best
 *  healthy one per call. PassthroughProvider is always last and always healthy, so there
 *  is ALWAYS a valid backend and a compression outage can never break a conversation.
 *
 *  This runs the INLINE diagnostics path (simulate / compress previews). The real traffic
 *  path is the Node proxy (see ProxyManager); the "node-proxy" provider here runs the same
 *  strategy in-process for offline previews.
 *
 *  Selection:
 *   - config.backend === 'passthrough'  -> always passthrough
 *   - config.backend === 'node-proxy'   -> node-proxy if healthy, else passthrough
 *   - config.backend === 'auto'         -> first healthy in preference order, else passthrough
 *   - config.enabled === false          -> always passthrough
 *--------------------------------------------------------------------------------------------*/
import {
	CompressibleMessage,
	CompressOptions,
	CompressResult,
	ICompressionProvider,
	SimResult,
} from './types';
import { PassthroughProvider } from './providers/passthroughProvider';
import { NodeProxyProvider } from './providers/nodeProxyProvider';

export type Backend = 'auto' | 'node-proxy' | 'passthrough';

export interface ManagerConfig {
	enabled: boolean;
	backend: Backend;
	healthCheckTtlMs: number;
}

interface HealthCacheEntry {
	healthy: boolean;
	checkedAt: number;
}

/** Inline compression helper (diagnostics / simulate). The proxy is the primary path. */
export class CompressionManager {
	readonly version: string;

	private readonly passthrough = new PassthroughProvider();
	private readonly nodeProxy: NodeProxyProvider;
	/** Preference order for 'auto'. Passthrough is the implicit final fallback, not listed here. */
	private readonly preferenceOrder: ICompressionProvider[];
	private readonly healthCache = new Map<string, HealthCacheEntry>();

	constructor(private config: ManagerConfig, version: string, private readonly log: (msg: string) => void) {
		this.version = version;
		this.nodeProxy = new NodeProxyProvider(log);
		this.preferenceOrder = [this.nodeProxy];
	}

	/** Hot-reload config (called when the user changes settings). Clears health cache. */
	updateConfig(config: ManagerConfig): void {
		this.config = config;
		this.healthCache.clear();
	}

	private async isHealthyCached(provider: ICompressionProvider): Promise<boolean> {
		const now = Date.now();
		const cached = this.healthCache.get(provider.id);
		if (cached && now - cached.checkedAt < this.config.healthCheckTtlMs) {
			return cached.healthy;
		}
		let healthy = false;
		try {
			healthy = await provider.isHealthy();
		} catch {
			healthy = false;
		}
		this.healthCache.set(provider.id, { healthy, checkedAt: now });
		return healthy;
	}

	/** Resolve which provider handles this call, honoring config + health. Never returns undefined. */
	private async selectProvider(): Promise<ICompressionProvider> {
		if (!this.config.enabled || this.config.backend === 'passthrough') {
			return this.passthrough;
		}

		if (this.config.backend === 'node-proxy') {
			return (await this.isHealthyCached(this.nodeProxy)) ? this.nodeProxy : this.passthrough;
		}

		// auto: first healthy in preference order, else passthrough.
		for (const provider of this.preferenceOrder) {
			if (await this.isHealthyCached(provider)) {
				return provider;
			}
		}
		return this.passthrough;
	}

	async activeBackend(): Promise<string> {
		return (await this.selectProvider()).id;
	}

	async compress<T extends CompressibleMessage>(messages: T[], options?: CompressOptions): Promise<CompressResult<T>> {
		const provider = await this.selectProvider();
		const useFallback = options?.fallback !== false;
		try {
			return await provider.compress(messages, options);
		} catch (err) {
			this.log(`compress() via ${provider.id} failed: ${(err as Error).message}`);
			if (!useFallback) {
				throw err;
			}
			// Mark unhealthy so we stop routing here until the next TTL window.
			this.healthCache.set(provider.id, { healthy: false, checkedAt: Date.now() });
			return this.passthrough.compress(messages, options);
		}
	}

	async simulate(messages: CompressibleMessage[], options?: CompressOptions): Promise<SimResult> {
		const provider = await this.selectProvider();
		try {
			return await provider.simulate(messages, options);
		} catch (err) {
			this.log(`simulate() via ${provider.id} failed: ${(err as Error).message}`);
			return this.passthrough.simulate(messages, options);
		}
	}
}

/*---------------------------------------------------------------------------------------------
 *  SIID Compression — shared contract.
 *
 *  These types are the ONLY surface consumers (siid-forge, SIID-Code) bind to.
 *  Keep them backend-agnostic: no proxy internals, no Anthropic/OpenAI SDK types leak here.
 *--------------------------------------------------------------------------------------------*/

/**
 * A chat message in the loosest shape both consumers share.
 * - SIID-Code uses Anthropic `MessageParam` (role + string|ContentBlock[]).
 * - siid-forge uses OpenRouter/OpenAI chat messages (role + string content).
 * Both satisfy this shape, so neither has to convert before calling us.
 */
export interface CompressibleMessage {
	role: string;
	content: unknown;
	[key: string]: unknown;
}

export interface CompressOptions {
	/** Model id, forwarded to the backend so it can size/tokenize correctly. */
	model?: string;
	/** Free-form tag for logging/telemetry, e.g. "siid-code" or "forge:lwc-test". */
	source?: string;
	/**
	 * If true (default), a backend failure returns the ORIGINAL messages instead
	 * of throwing. A compression outage must never break an AI conversation.
	 */
	fallback?: boolean;
}

export interface CompressStats {
	tokensBefore: number;
	tokensAfter: number;
	tokensSaved: number;
	/** 0..1 */
	compressionRatio: number;
	/** e.g. ["router:smart_crusher:0.45"]; empty for passthrough. */
	transformsApplied: string[];
	/** Which backend actually handled this call. */
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
 * A single compression backend. Add a class implementing this to add a backend
 * the manager can switch to. Passthrough and node-proxy are the built-ins.
 */
export interface ICompressionProvider {
	/** Stable id used in config/logs, e.g. "node-proxy", "passthrough". */
	readonly id: string;
	/** Cheap liveness check. Manager caches the result (see healthCheckTtlMs). */
	isHealthy(): Promise<boolean>;
	compress<T extends CompressibleMessage>(messages: T[], options?: CompressOptions): Promise<CompressResult<T>>;
	simulate(messages: CompressibleMessage[], options?: CompressOptions): Promise<SimResult>;
}

/**
 * The public API surface returned from the extension's activate().
 * Consumers get this via:
 *   const ext = vscode.extensions.getExtension('ConscendoTechInc.siid-compression');
 *   const api: ICompressionApi | undefined = ext && (await ext.activate());
 *
 * PRIMARY use (integration model B): call getProxyBaseUrl() and point your OpenRouter
 * client's base URL at it. All traffic then flows through the SIID compression proxy and is
 * compressed transparently. If it returns '' (proxy not ready), talk to OpenRouter directly.
 */
export interface ICompressionApi {
	readonly version: string;

	// --- Proxy routing (model B, primary) ---
	/**
	 * Base URL to point an OpenAI/OpenRouter-compatible client at, e.g.
	 * "http://127.0.0.1:8791/v1". Returns '' if the proxy is not healthy — in that case
	 * the consumer should use OpenRouter's real base URL directly (no compression).
	 */
	getProxyBaseUrl(): string;
	/** 'stopped' | 'starting' | 'healthy' | 'unavailable'. */
	getProxyState(): string;
	/** Ensure the proxy is running; resolves true when healthy. Safe to call repeatedly. */
	ensureProxy(): Promise<boolean>;

	// --- Inline helpers (model A, optional / diagnostics) ---
	/** Dry run to preview savings on a sample. */
	simulate(messages: CompressibleMessage[], options?: CompressOptions): Promise<SimResult>;
	/** Compress messages inline (kept for diagnostics; model B doesn't need this). */
	compress<T extends CompressibleMessage>(messages: T[], options?: CompressOptions): Promise<CompressResult<T>>;
	/** Which backend is currently active (after health checks). */
	activeBackend(): Promise<string>;
}

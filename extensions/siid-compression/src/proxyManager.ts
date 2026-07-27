/*---------------------------------------------------------------------------------------------
 *  ProxyManager — spawns and supervises OUR OWN Node.js compression proxy.
 *
 *  Integration model B: the proxy IS the re-route layer. This manager owns the proxy process
 *  lifecycle so consumers (siid-forge, SIID-Code) can simply point their OpenRouter client's
 *  base URL at it and get transparent compression. No external binary, no Python — the proxy
 *  is a bundled Node script (src/proxy/server.js -> out/proxy/server.js) run with this
 *  process's own Node runtime (process.execPath).
 *
 *  Responsibilities:
 *   - spawn `node <server.js> --host <host> --port <port> [--openai-api-url <upstream>]`
 *   - health-check /health with retry/backoff; expose a ready() promise
 *   - restart on unexpected exit (bounded)
 *   - expose baseUrl() -> http://127.0.0.1:<port>/v1 for consumers
 *   - clean shutdown
 *
 *  If the proxy script is missing or never becomes healthy, the manager stays "unavailable"
 *  and consumers fall back to talking to OpenRouter directly (no compression, nothing breaks).
 *--------------------------------------------------------------------------------------------*/
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';

export interface ProxyConfig {
	/**
	 * Absolute path to the proxy server script. Empty = auto-resolve the bundled
	 * out/proxy/server.js (falling back to src/proxy/server.js in dev).
	 */
	serverPath: string;
	/** Node executable to run the server with. Empty = this process's own Node (process.execPath). */
	nodePath: string;
	/** Preferred port. 0 = pick a free one. */
	port: number;
	host: string;
	/** Upstream OpenRouter-compatible base URL. Empty = server default (OpenRouter). */
	upstreamUrl: string;
	/** Extra CLI args forwarded to the server. */
	extraArgs: string[];
	/**
	 * Extra environment variables merged into the proxy's env — notably
	 * { OPENROUTER_API_KEY: '...' }. The proxy reads the OpenRouter key from its env.
	 */
	env: Record<string, string>;
	/** Max automatic restarts before giving up. */
	maxRestarts: number;
	/** Health-check timeout per attempt (ms). */
	healthTimeoutMs: number;
}

export type ProxyState = 'stopped' | 'starting' | 'healthy' | 'unavailable';

async function findFreePort(preferred: number, host: string): Promise<number> {
	const tryPort = (p: number) =>
		new Promise<number | null>((resolve) => {
			const srv = net.createServer();
			srv.once('error', () => resolve(null));
			srv.once('listening', () => {
				const addr = srv.address();
				const port = typeof addr === 'object' && addr ? addr.port : p;
				srv.close(() => resolve(port));
			});
			srv.listen(p, host);
		});

	if (preferred > 0) {
		const ok = await tryPort(preferred);
		if (ok) {
			return ok;
		}
	}
	const any = await tryPort(0);
	if (any) {
		return any;
	}
	throw new Error('could not find a free port for the SIID compression proxy');
}

/** Resolve the bundled proxy server script: prod `out/proxy/server.js`, dev `src/proxy/server.js`. */
function resolveServerPath(explicit: string): string {
	if (explicit) {
		return explicit;
	}
	// This file compiles to out/proxyManager.js, so the sibling proxy dir is out/proxy.
	const outCandidate = path.join(__dirname, 'proxy', 'server.js');
	if (fs.existsSync(outCandidate)) {
		return outCandidate;
	}
	// Dev fallback: running from source (e.g. ts-node) — server.js lives under src/proxy.
	const srcCandidate = path.join(__dirname, '..', 'src', 'proxy', 'server.js');
	if (fs.existsSync(srcCandidate)) {
		return srcCandidate;
	}
	return outCandidate; // return the expected prod path so the error message is useful
}

export class ProxyManager {
	private proc: ChildProcessWithoutNullStreams | undefined;
	private _state: ProxyState = 'stopped';
	private _port = 0;
	private restarts = 0;
	private stopping = false;
	private startPromise: Promise<boolean> | undefined;

	constructor(private config: ProxyConfig, private readonly log: (msg: string) => void) {}

	get state(): ProxyState {
		return this._state;
	}

	/** Base URL consumers point their OpenRouter client at. Empty until healthy. */
	baseUrl(): string {
		return this._state === 'healthy' ? `http://${this.config.host}:${this._port}/v1` : '';
	}

	/** Start the proxy and resolve true once healthy (or false if it never comes up). Idempotent. */
	async start(): Promise<boolean> {
		if (this._state === 'healthy') {
			return true;
		}
		if (this.startPromise) {
			return this.startPromise;
		}
		this.startPromise = this.doStart().finally(() => {
			this.startPromise = undefined;
		});
		return this.startPromise;
	}

	private async doStart(): Promise<boolean> {
		this.stopping = false;
		this._state = 'starting';
		try {
			this._port = await findFreePort(this.config.port, this.config.host);
		} catch (err) {
			this.log(`port selection failed: ${(err as Error).message}`);
			this._state = 'unavailable';
			return false;
		}

		const serverPath = resolveServerPath(this.config.serverPath);
		if (!fs.existsSync(serverPath)) {
			this.log(`proxy server script not found at ${serverPath}; proxy unavailable (consumers use OpenRouter directly).`);
			this._state = 'unavailable';
			return false;
		}
		const node = this.config.nodePath || process.execPath;

		const args = [serverPath, '--host', this.config.host, '--port', String(this._port)];
		if (this.config.upstreamUrl) {
			args.push('--openai-api-url', this.config.upstreamUrl);
		}
		args.push(...this.config.extraArgs);

		this.log(`spawning: ${node} ${args.join(' ')}`);
		try {
			this.proc = spawn(node, args, {
				windowsHide: true,
				env: { ...process.env, ...this.config.env },
			});
		} catch (err) {
			this.log(`spawn failed: ${(err as Error).message}`);
			this._state = 'unavailable';
			return false;
		}

		this.proc.stdout.on('data', (d) => this.log(`[proxy] ${String(d).trimEnd()}`));
		this.proc.stderr.on('data', (d) => this.log(`[proxy:err] ${String(d).trimEnd()}`));
		this.proc.on('exit', (code, signal) => this.onExit(code, signal));

		const healthy = await this.waitForHealth();
		if (healthy) {
			this._state = 'healthy';
			this.restarts = 0;
			this.log(`proxy healthy on ${this.baseUrl()} (upstream=${this.config.upstreamUrl || 'openrouter default'})`);
			return true;
		}
		this.log('proxy did not become healthy in time.');
		this._state = 'unavailable';
		this.stop();
		return false;
	}

	private async waitForHealth(): Promise<boolean> {
		const url = `http://${this.config.host}:${this._port}/health`;
		const deadline = Date.now() + this.config.healthTimeoutMs;
		let delay = 200;
		while (Date.now() < deadline && !this.stopping) {
			try {
				const controller = new AbortController();
				const t = setTimeout(() => controller.abort(), 2000);
				const res = await fetch(url, { signal: controller.signal });
				clearTimeout(t);
				if (res.ok) {
					const body = (await res.json()) as { status?: string };
					if (body?.status === 'healthy') {
						return true;
					}
				}
			} catch {
				/* not up yet */
			}
			await new Promise((r) => setTimeout(r, delay));
			delay = Math.min(delay * 1.5, 1500);
		}
		return false;
	}

	private onExit(code: number | null, signal: string | null): void {
		this.log(`proxy exited (code=${code}, signal=${signal}).`);
		this.proc = undefined;
		if (this.stopping) {
			this._state = 'stopped';
			return;
		}
		// Unexpected exit — try a bounded restart.
		if (this.restarts < this.config.maxRestarts) {
			this.restarts++;
			this.log(`restarting proxy (attempt ${this.restarts}/${this.config.maxRestarts})...`);
			void this.start();
		} else {
			this.log('max restarts reached; proxy unavailable.');
			this._state = 'unavailable';
		}
	}

	/** Health check the currently-running proxy (fast, no restart). */
	async isHealthy(): Promise<boolean> {
		if (this._state !== 'healthy' || this._port === 0) {
			return false;
		}
		try {
			const controller = new AbortController();
			const t = setTimeout(() => controller.abort(), 2000);
			const res = await fetch(`http://${this.config.host}:${this._port}/health`, { signal: controller.signal });
			clearTimeout(t);
			if (!res.ok) {
				return false;
			}
			const body = (await res.json()) as { status?: string };
			return body?.status === 'healthy';
		} catch {
			return false;
		}
	}

	updateConfig(config: ProxyConfig): void {
		this.config = config;
	}

	stop(): void {
		this.stopping = true;
		if (this.proc) {
			this.log('stopping proxy...');
			try {
				this.proc.kill();
			} catch {
				/* ignore */
			}
			this.proc = undefined;
		}
		this._state = 'stopped';
	}
}

/*---------------------------------------------------------------------------------------------
 *  SIID Compression — extension entry point (integration model B: proxy lifecycle manager).
 *
 *  activate() spawns OUR OWN Node.js compression proxy (pointed upstream at OpenRouter) and
 *  returns an ICompressionApi. Consumers bind and route through it:
 *
 *    const ext = vscode.extensions.getExtension('ConscendoTechInc.siid-compression');
 *    const api = ext ? await ext.activate() : undefined;
 *    const baseUrl = api?.getProxyBaseUrl();           // '' if proxy not ready
 *    // point the OpenRouter client at baseUrl || 'https://openrouter.ai/api/v1'
 *
 *  If the proxy can't start, getProxyBaseUrl() returns '' and consumers use OpenRouter
 *  directly — no compression, but nothing breaks.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { CompressionManager, ManagerConfig } from './compressionManager';
import { ProxyConfig, ProxyManager } from './proxyManager';
import { CompressibleMessage, CompressOptions, CompressResult, ICompressionApi, SimResult } from './types';

export { ICompressionApi } from './types';

const CONFIG_SECTION = 'siidCompression';

function readProxyConfig(): ProxyConfig {
	const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
	// The proxy reads the OpenRouter credential from its ENV, not CLI args. Source the key from
	// config, else the ambient environment (OPENROUTER_API_KEY).
	const env: Record<string, string> = {};
	const orKey = cfg.get<string>('proxy.openrouterApiKey', '') || process.env.OPENROUTER_API_KEY || '';
	if (orKey) {
		env.OPENROUTER_API_KEY = orKey;
	}

	return {
		serverPath: cfg.get<string>('proxy.serverPath', ''),
		nodePath: cfg.get<string>('proxy.nodePath', ''),
		port: cfg.get<number>('proxy.port', 0),
		host: cfg.get<string>('proxy.host', '127.0.0.1'),
		upstreamUrl: cfg.get<string>('proxy.upstreamUrl', ''),
		extraArgs: cfg.get<string[]>('proxy.extraArgs', []),
		env,
		maxRestarts: cfg.get<number>('proxy.maxRestarts', 3),
		healthTimeoutMs: cfg.get<number>('proxy.healthTimeoutMs', 20000),
	};
}

function readManagerConfig(): ManagerConfig {
	const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
	return {
		enabled: cfg.get<boolean>('enabled', true),
		backend: cfg.get<'auto' | 'node-proxy' | 'passthrough'>('backend', 'auto'),
		healthCheckTtlMs: cfg.get<number>('healthCheckTtlMs', 30000),
	};
}

export function activate(context: vscode.ExtensionContext): ICompressionApi {
	const output = vscode.window.createOutputChannel('SIID Compression');
	context.subscriptions.push(output);
	const log = (msg: string) => output.appendLine(`[${new Date().toISOString()}] ${msg}`);

	const version = (context.extension?.packageJSON?.version as string) ?? '0.0.0';
	const enabled = vscode.workspace.getConfiguration(CONFIG_SECTION).get<boolean>('enabled', true);

	const proxy = new ProxyManager(readProxyConfig(), log);
	// Inline manager (diagnostics/simulate) points at whatever proxy port we end up on.
	const inline = new CompressionManager(readManagerConfig(), version, log);

	log(`SIID Compression v${version} activating (proxy manager mode, enabled=${enabled}).`);

	// Kick off the proxy in the background; consumers can await ensureProxy() if they need it.
	if (enabled) {
		void proxy.start();
	} else {
		log('disabled by config; proxy not started.');
	}

	context.subscriptions.push({ dispose: () => proxy.stop() });

	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration(CONFIG_SECTION)) {
				proxy.updateConfig(readProxyConfig());
				inline.updateConfig(readManagerConfig());
				log('Configuration reloaded (restart SIID or run "Restart Proxy" to apply proxy args).');
			}
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('siid-compression.status', async () => {
			const base = proxy.baseUrl() || '(not ready — consumers use OpenRouter directly)';
			void vscode.window.showInformationMessage(`SIID Compression — proxy: ${proxy.state}, baseUrl: ${base}`);
			log(`Status: state=${proxy.state}, baseUrl=${proxy.baseUrl()}`);
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('siid-compression.restartProxy', async () => {
			log('Restart Proxy requested.');
			proxy.stop();
			proxy.updateConfig(readProxyConfig());
			const ok = await proxy.start();
			void vscode.window.showInformationMessage(
				ok ? `SIID compression proxy restarted: ${proxy.baseUrl()}` : 'SIID compression proxy failed to start (see output).',
			);
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('siid-compression.simulate', async () => {
			const sample = [
				{ role: 'system', content: 'You are a Salesforce assistant.' },
				{
					role: 'user',
					content: JSON.stringify(
						Array.from({ length: 100 }, (_, i) => ({
							Id: `001${i.toString().padStart(15, '0')}`,
							Name: `Account ${i}`,
							Industry: 'Technology',
							AnnualRevenue: 1000000 + i,
						})),
					),
				},
			];
			try {
				const sim = await inline.simulate(sample);
				const pct = (sim.compressionRatio * 100).toFixed(1);
				void vscode.window.showInformationMessage(
					`Simulate (${sim.backend}): ${sim.tokensBefore} → ${sim.tokensAfter} tokens, saved ${sim.tokensSaved} (${pct}%)`,
				);
				log(`Simulate result: ${JSON.stringify(sim)}`);
			} catch (err) {
				void vscode.window.showErrorMessage(`Simulate failed: ${(err as Error).message}`);
			}
		}),
	);

	// Test consumer: plays the role forge / SIID-Code will play — routes a realistic bloated
	// payload through the live proxy to OpenRouter and reports savings + the completion. Needs
	// the proxy healthy (which needs an OpenRouter key configured / on PATH env).
	context.subscriptions.push(
		vscode.commands.registerCommand('siid-compression.testConsumer', async () => {
			const ok = await proxy.start();
			const base = proxy.baseUrl();
			if (!ok || !base) {
				void vscode.window.showErrorMessage(
					'Test consumer: proxy is not healthy. Set an OpenRouter key (siidCompression.proxy.openrouterApiKey or OPENROUTER_API_KEY) and run "Restart Compression Proxy".',
				);
				return;
			}
			const model =
				vscode.workspace.getConfiguration(CONFIG_SECTION).get<string>('testConsumer.model', '') || 'openai/gpt-4o-mini';
			const file = ['line of a large Apex file', ''].join('\n').repeat(300);
			const logDump = '2026-07-27T12:00:00Z DEBUG deploy step ok\n'.repeat(400);
			const messages = [
				{ role: 'system', content: 'You are a Salesforce coding assistant. Answer concisely.' },
				{ role: 'user', content: 'Here is AccountService.cls:\n' + file },
				{ role: 'assistant', content: 'Got it.' },
				{ role: 'user', content: 'Here is the SAME file again:\n' + file }, // exact dupe -> dedupe
				{ role: 'user', content: 'Deploy log:\n' + logDump }, // oversized -> truncate
				{ role: 'user', content: 'In one sentence, what is an Apex trigger?' },
			];
			try {
				const preview = await inline.simulate(messages as CompressibleMessage[]);
				log(`Test consumer preview: ${JSON.stringify(preview)}`);
				const res = await fetch(`${base}/chat/completions`, {
					method: 'POST',
					headers: { 'content-type': 'application/json', 'x-siid-source': 'test-consumer-command' },
					body: JSON.stringify({ model, messages, max_tokens: 120 }),
				});
				const text = await res.text();
				if (!res.ok) {
					log(`Test consumer HTTP ${res.status}: ${text.slice(0, 500)}`);
					void vscode.window.showErrorMessage(`Test consumer: OpenRouter HTTP ${res.status} (see output).`);
					return;
				}
				const body = JSON.parse(text) as { choices?: Array<{ message?: { content?: string } }> };
				const answer = body.choices?.[0]?.message?.content ?? '(no content)';
				const pct = (preview.compressionRatio * 100).toFixed(1);
				log(`Test consumer answer: ${answer}`);
				void vscode.window.showInformationMessage(
					`Test consumer OK. Compressed ${preview.tokensBefore}→${preview.tokensAfter} tok (${pct}%). Answer: ${answer.slice(0, 120)}`,
				);
			} catch (err) {
				log(`Test consumer failed: ${(err as Error).message}`);
				void vscode.window.showErrorMessage(`Test consumer failed: ${(err as Error).message}`);
			}
		}),
	);

	const api: ICompressionApi = {
		version,
		getProxyBaseUrl: () => proxy.baseUrl(),
		getProxyState: () => proxy.state,
		ensureProxy: () => proxy.start(),
		simulate: (messages: CompressibleMessage[], options?: CompressOptions): Promise<SimResult> =>
			inline.simulate(messages, options),
		compress: <T extends CompressibleMessage>(messages: T[], options?: CompressOptions): Promise<CompressResult<T>> =>
			inline.compress(messages, options),
		activeBackend: () => inline.activeBackend(),
	};
	return api;
}

export function deactivate(): void {
	// Proxy is stopped via the disposable registered in activate().
}

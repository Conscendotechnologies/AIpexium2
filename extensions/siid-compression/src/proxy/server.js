/*---------------------------------------------------------------------------------------------
 *  SIID Compression — our OWN Node.js proxy server (no third party, no Python, no binary).
 *
 *  A tiny OpenAI-compatible HTTP proxy that sits between SIID's AI consumers and OpenRouter.
 *  Consumers point their OpenRouter client's base URL at this server; every request is run
 *  through our compression strategy (compressor.js) on the way out and the response is run
 *  through it on the way back, then relayed to/from OpenRouter transparently.
 *
 *  Endpoints:
 *    GET  /health                -> { status: 'healthy', backend: 'openrouter', uptimeMs }
 *    POST /v1/chat/completions   -> compress -> forward to OpenRouter -> transform -> relay
 *                                   (supports streaming responses; those are relayed as-is)
 *    *                           -> transparently proxied to OpenRouter under the same path
 *
 *  Upstream: OpenRouter ONLY (https://openrouter.ai/api/v1 by default; override with
 *  --openai-api-url). Credentials come from the OPENROUTER_API_KEY env var, injected by the
 *  extension's ProxyManager. The incoming Authorization header (if any) is forwarded too.
 *
 *  Run standalone (for tests / manual use):
 *    OPENROUTER_API_KEY=... node server.js --host 127.0.0.1 --port 8791
 *
 *  Design notes:
 *   - Zero dependencies. Uses only Node built-ins (http, https, url) + the sibling compressor.
 *   - Fail-open: if compression throws, we forward the ORIGINAL body. A compression bug must
 *     never break an AI conversation.
 *   - Streaming (`"stream": true`) requests are forwarded and piped straight through; we do not
 *     buffer or transform stream bodies (response transform is skipped for streams).
 *--------------------------------------------------------------------------------------------*/
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const compressor = require('./compressor');

const DEFAULT_UPSTREAM = 'https://openrouter.ai/api/v1';

/**
 * @param {string[]} argv process.argv.slice(2)
 * @returns {{ host: string, port: number, upstream: string, logFile: string }}
 */
function parseArgs(argv) {
	const opts = {
		host: '127.0.0.1',
		port: 0,
		upstream: process.env.SIID_UPSTREAM_URL || DEFAULT_UPSTREAM,
		logFile: process.env.SIID_LOG_FILE || '',
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--host') {
			opts.host = argv[++i];
		} else if (a === '--port') {
			opts.port = parseInt(argv[++i], 10) || 0;
		} else if (a === '--openai-api-url' || a === '--upstream') {
			const v = argv[++i];
			if (v) {
				opts.upstream = v.replace(/\/$/, '');
			}
		} else if (a === '--log-file') {
			opts.logFile = argv[++i] || '';
		}
	}
	return opts;
}

/**
 * Append one JSON line to the traffic log. Fail-open: any error is swallowed (logging must never
 * break a request). The log captures full request/response content, so callers must gitignore it.
 * @param {string} logFile  Absolute path, or '' to disable logging.
 * @param {object} record
 */
function appendLog(logFile, record) {
	if (!logFile) {
		return;
	}
	try {
		fs.mkdirSync(path.dirname(logFile), { recursive: true });
		fs.appendFileSync(logFile, JSON.stringify(record) + '\n');
	} catch (err) {
		process.stdout.write(`log write failed (${logFile}): ${err && err.message}\n`);
	}
}

/**
 * Read an entire request/response stream into a Buffer.
 * @param {NodeJS.ReadableStream} stream
 * @returns {Promise<Buffer>}
 */
function readBody(stream) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		stream.on('data', (c) => chunks.push(c));
		stream.on('end', () => resolve(Buffer.concat(chunks)));
		stream.on('error', reject);
	});
}

/**
 * Build the outbound headers for the upstream request: copy the client's headers, drop
 * hop-by-hop / length headers (recomputed), and ensure an Authorization + OpenRouter key.
 * @param {http.IncomingHttpHeaders} incoming
 * @returns {Record<string, string>}
 */
function buildUpstreamHeaders(incoming) {
	const headers = {};
	for (const [k, v] of Object.entries(incoming)) {
		const key = k.toLowerCase();
		if (key === 'host' || key === 'content-length' || key === 'connection') {
			continue;
		}
		if (typeof v === 'string') {
			headers[k] = v;
		} else if (Array.isArray(v)) {
			headers[k] = v.join(', ');
		}
	}
	const apiKey = process.env.OPENROUTER_API_KEY || '';
	if (apiKey && !headers['authorization'] && !headers['Authorization']) {
		headers['Authorization'] = `Bearer ${apiKey}`;
	}
	return headers;
}

/**
 * Forward a request to the upstream and pipe the response straight back to the client.
 * Used for streaming and for any non-chat path (transparent passthrough).
 * @param {URL} target
 * @param {string} method
 * @param {Record<string,string>} headers
 * @param {Buffer|undefined} body
 * @param {http.ServerResponse} clientRes
 * @param {(usage: object|undefined) => void} [onUsage]  Called once when the stream ends, with the
 *   last `usage` object scraped from the SSE body (OpenRouter sends it in the final chunk when the
 *   client requested stream_options.include_usage). Lets us record OUTPUT tokens for streamed calls
 *   without buffering — a plain observer alongside .pipe(), so the stream is never held up.
 */
function pipeToUpstream(target, method, headers, body, clientRes, onUsage) {
	const isHttps = target.protocol === 'https:';
	const lib = isHttps ? https : http;
	const outHeaders = { ...headers };
	if (body) {
		outHeaders['content-length'] = Buffer.byteLength(body);
	}
	const req = lib.request(
		{
			protocol: target.protocol,
			hostname: target.hostname,
			port: target.port || (isHttps ? 443 : 80),
			path: target.pathname + target.search,
			method,
			headers: outHeaders,
		},
		(upstreamRes) => {
			clientRes.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
			upstreamRes.pipe(clientRes);
			if (onUsage) {
				// Observe (don't consume) the stream: each SSE `data:` line is a complete JSON object,
				// so parse whole lines and read `.usage` — robust to nested *_tokens_details objects
				// that a `{[^}]*}` regex would truncate. Buffer across chunk boundaries by newline.
				let buf = '';
				let lastUsage;
				upstreamRes.on('data', (chunk) => {
					buf += chunk.toString('utf8');
					let nl;
					while ((nl = buf.indexOf('\n')) !== -1) {
						const line = buf.slice(0, nl).trim();
						buf = buf.slice(nl + 1);
						if (!line.startsWith('data:')) continue;
						const payload = line.slice(5).trim();
						if (payload === '[DONE]') continue;
						try {
							const obj = JSON.parse(payload);
							if (obj && obj.usage) lastUsage = obj.usage;
						} catch {
							/* not a complete/JSON data line — ignore */
						}
					}
				});
				upstreamRes.on('end', () => onUsage(lastUsage));
				upstreamRes.on('error', () => onUsage(lastUsage));
			}
		},
	);
	req.on('error', (err) => {
		if (!clientRes.headersSent) {
			clientRes.writeHead(502, { 'content-type': 'application/json' });
		}
		clientRes.end(JSON.stringify({ error: { message: `proxy upstream error: ${err.message}`, type: 'proxy_error' } }));
	});
	if (body) {
		req.write(body);
	}
	req.end();
}

/**
 * Forward a request to the upstream and return the buffered response.
 * @param {URL} target
 * @param {string} method
 * @param {Record<string,string>} headers
 * @param {Buffer|undefined} body
 * @returns {Promise<{ statusCode: number, headers: http.IncomingHttpHeaders, body: Buffer }>}
 */
function fetchUpstream(target, method, headers, body) {
	return new Promise((resolve, reject) => {
		const isHttps = target.protocol === 'https:';
		const lib = isHttps ? https : http;
		const outHeaders = { ...headers };
		if (body) {
			outHeaders['content-length'] = Buffer.byteLength(body);
		}
		const req = lib.request(
			{
				protocol: target.protocol,
				hostname: target.hostname,
				port: target.port || (isHttps ? 443 : 80),
				path: target.pathname + target.search,
				method,
				headers: outHeaders,
			},
			async (upstreamRes) => {
				try {
					const buf = await readBody(upstreamRes);
					resolve({ statusCode: upstreamRes.statusCode || 502, headers: upstreamRes.headers, body: buf });
				} catch (err) {
					reject(err);
				}
			},
		);
		req.on('error', reject);
		if (body) {
			req.write(body);
		}
		req.end();
	});
}

/**
 * @param {ReturnType<typeof parseArgs>} opts
 * @returns {http.Server}
 */
function createServer(opts) {
	const startedAt = Date.now();
	const upstreamBase = new URL(opts.upstream);

	const server = http.createServer(async (clientReq, clientRes) => {
		const method = clientReq.method || 'GET';
		const reqUrl = clientReq.url || '/';

		// --- health ---
		if (method === 'GET' && (reqUrl === '/health' || reqUrl === '/v1/health')) {
			clientRes.writeHead(200, { 'content-type': 'application/json' });
			clientRes.end(JSON.stringify({ status: 'healthy', backend: 'openrouter', uptimeMs: Date.now() - startedAt }));
			return;
		}

		// Resolve the upstream target for this path. We keep the caller's path but rebase it
		// onto the upstream host. Base URL already includes '/api/v1', and consumers call
		// '/v1/...', so strip a leading '/v1' to avoid '/api/v1/v1/...'.
		const pathAfterV1 = reqUrl.replace(/^\/v1/, '');
		const target = new URL(upstreamBase.pathname.replace(/\/$/, '') + pathAfterV1, upstreamBase);
		const headers = buildUpstreamHeaders(clientReq.headers);

		const body = method === 'POST' || method === 'PUT' || method === 'PATCH' ? await readBody(clientReq) : undefined;

		const isChatCompletions = method === 'POST' && /\/chat\/completions$/.test(reqUrl.split('?')[0]);
		if (!isChatCompletions) {
			// Transparent passthrough for every other path (models list, etc.).
			pipeToUpstream(target, method, headers, body, clientRes);
			return;
		}

		// --- chat/completions: compress -> forward -> transform ---
		let parsed;
		try {
			parsed = body && body.length ? JSON.parse(body.toString('utf8')) : {};
		} catch {
			// Not JSON we understand — forward as-is.
			pipeToUpstream(target, method, headers, body, clientRes);
			return;
		}

		// `forwarded: true` tells the compressor this request really is going upstream, so the block
		// cache may LEARN from it. Preview/diagnostic callers omit it and get a read-only cache —
		// otherwise a dry run would teach the cache bytes the model never actually received, and the
		// next real request would reference content that was never shown.
		const ctx = { model: parsed.model, source: String(clientReq.headers['x-siid-source'] || ''), forwarded: true };

		// Compress the outbound request (fail-open) and log one line so the compression is
		// observable in the SIID Compression output channel (ProxyManager pipes our stdout there).
		let outBody = parsed;
		let logStats; // captured for the JSONL traffic log below
		try {
			const { body: compressed, stats } = compressor.compressRequest(parsed, ctx);
			outBody = compressed || parsed;
			logStats = stats;
			if (stats) {
				const pct = (stats.compressionRatio * 100).toFixed(1);
				const tf = stats.transformsApplied && stats.transformsApplied.length ? stats.transformsApplied.join(', ') : 'none';
				const src = ctx.source || '(none)';
				process.stdout.write(
					`compress source=${src} model=${ctx.model || '?'} ${stats.tokensBefore}->${stats.tokensAfter} tok (${pct}%) [${tf}]\n`,
				);
			}
		} catch (err) {
			outBody = parsed;
			process.stdout.write(`compress error (forwarding original): ${err && err.message}\n`);
		}
		const outBuf = Buffer.from(JSON.stringify(outBody), 'utf8');

		// Base traffic-log record (full request before/after). The response is filled in below.
		const logRecord = {
			ts: new Date().toISOString(),
			source: ctx.source || null,
			model: ctx.model || null,
			stats: logStats || null,
			request: { original: parsed, compressed: outBody },
			stream: parsed.stream === true,
		};

		// Streaming responses are piped straight through (no response transform on a stream). We tap
		// the stream to scrape the final `usage` so OUTPUT tokens are still recorded (ponytail metric).
		if (parsed.stream === true) {
			pipeToUpstream(target, method, headers, outBuf, clientRes, (usage) => {
				appendLog(opts.logFile, { ...logRecord, response: { streamed: true, usage } });
				if (usage && typeof usage.completion_tokens === 'number') {
					process.stdout.write(
						`out source=${ctx.source || '(none)'} model=${ctx.model || '?'} completion=${usage.completion_tokens} tok\n`,
					);
				}
			});
			return;
		}

		try {
			const upstream = await fetchUpstream(target, method, headers, outBuf);
			let respBody = upstream.body;
			let reSerialized = false;
			let parsedResp; // captured for the traffic log
			// Transform the response (fail-open). Only attempt on UNCOMPRESSED JSON: if the
			// upstream gzipped the body we leave it byte-for-byte (we don't inflate), so the
			// content-encoding header stays valid.
			const ct = String(upstream.headers['content-type'] || '');
			const enc = String(upstream.headers['content-encoding'] || '').toLowerCase();
			if (ct.includes('application/json') && (enc === '' || enc === 'identity')) {
				try {
					parsedResp = JSON.parse(upstream.body.toString('utf8'));
					const { body: transformed } = compressor.transformResponse(parsedResp, ctx);
					respBody = Buffer.from(JSON.stringify(transformed || parsedResp), 'utf8');
					reSerialized = true;
				} catch {
					respBody = upstream.body;
				}
			}
			// We send a fully-buffered body with our own Content-Length, so drop the upstream's
			// framing headers (transfer-encoding + content-length) — sending both is illegal.
			// content-encoding is only dropped when WE re-serialized (respBody is now identity);
			// otherwise we preserve it so the client can still decode the original bytes.
			const respHeaders = {};
			for (const [k, v] of Object.entries(upstream.headers)) {
				const key = k.toLowerCase();
				if (key === 'content-length' || key === 'transfer-encoding') {
					continue;
				}
				if (key === 'content-encoding' && reSerialized) {
					continue;
				}
				respHeaders[k] = v;
			}
			respHeaders['content-length'] = Buffer.byteLength(respBody);
			clientRes.writeHead(upstream.statusCode, respHeaders);
			clientRes.end(respBody);

			// Full traffic log: request before/after + the response (parsed JSON when available,
			// else a short raw preview so non-JSON/errors are still recorded).
			const usage = parsedResp && parsedResp.usage ? parsedResp.usage : undefined;
			appendLog(opts.logFile, {
				...logRecord,
				response: {
					status: upstream.statusCode,
					body: parsedResp !== undefined ? parsedResp : upstream.body.toString('utf8').slice(0, 2000),
					usage,
				},
			});
			if (usage && typeof usage.completion_tokens === 'number') {
				process.stdout.write(
					`out source=${ctx.source || '(none)'} model=${ctx.model || '?'} completion=${usage.completion_tokens} tok\n`,
				);
			}
		} catch (err) {
			clientRes.writeHead(502, { 'content-type': 'application/json' });
			clientRes.end(
				JSON.stringify({ error: { message: `proxy upstream error: ${err.message}`, type: 'proxy_error' } }),
			);
			appendLog(opts.logFile, { ...logRecord, response: { error: err && err.message } });
		}
	});

	return server;
}

/** Start the server; resolves with the bound port. */
function start(opts) {
	return new Promise((resolve, reject) => {
		const server = createServer(opts);
		server.on('error', reject);
		server.listen(opts.port, opts.host, () => {
			const addr = server.address();
			const port = typeof addr === 'object' && addr ? addr.port : opts.port;
			// Machine-readable line the ProxyManager can grep if it wants; health check is the real signal.
			process.stdout.write(`SIID_PROXY_LISTENING host=${opts.host} port=${port} upstream=${opts.upstream}\n`);
			resolve({ server, port });
		});
	});
}

module.exports = { createServer, start, parseArgs, DEFAULT_UPSTREAM };

// Run directly: `node server.js --host 127.0.0.1 --port 8791`
if (require.main === module) {
	const opts = parseArgs(process.argv.slice(2));
	start(opts).catch((err) => {
		process.stderr.write(`SIID proxy failed to start: ${err.message}\n`);
		process.exit(1);
	});
}

# SIID Compression — Project Progress

A provider-agnostic **context-compression layer** that ALL SIID AI conversations flow through.
Consumers point their OpenRouter client's base URL at a local proxy; every request is compressed
transparently on the way out and the response passes through on the way back.
When the proxy is unavailable, everything degrades to **passthrough** — nothing breaks.

- **Extension id:** `ConscendoTechInc.siid-compression`
- **Location:** `extensions/siid-compression/`
- **Last updated:** 2026-07-27

---

## Architecture (integration model B: base-URL reroute)

The proxy IS the "re-route all AI requests" layer. Consumers do not call a `compress()` function;
they just change their base URL to the proxy and get compression for free.

- **Our own Node.js proxy** (`src/proxy/server.js`) — zero-dependency, OpenAI-compatible HTTP
  server. OpenRouter-only upstream. Endpoints: `GET /health`, `POST /v1/chat/completions`
  (compress → forward → transform), and transparent passthrough for every other path.
  Runnable standalone: `OPENROUTER_API_KEY=... node server.js --host 127.0.0.1 --port 8791`.
- **Our own compression strategy** (`src/proxy/compressor.js`) — the ONE place the token-saving
  logic lives, isolated from HTTP plumbing. Two hooks: `compressRequest` (outbound) and
  `transformResponse` (inbound). **Currently PASSTHROUGH scaffold** — real deterministic
  strategies (dedup, tool-output truncation, old-turn pruning) drop in here by editing only
  this file.
- **`src/proxyManager.ts`** — spawns the proxy with this process's own Node (`process.execPath`),
  auto-resolves `out/proxy/server.js` (dev fallback `src/proxy/server.js`), health-checks with
  backoff, bounded auto-restart, clean stop. Injects `OPENROUTER_API_KEY` into the proxy env.
- **`src/extension.ts`** — `activate()` starts the proxy on `onStartupFinished`, returns an
  `ICompressionApi` (`getProxyBaseUrl()` / `getProxyState()` / `ensureProxy()` + inline
  `simulate`/`compress` diagnostics). Commands: status, restartProxy, simulate.
- **`src/compressionManager.ts` + `src/providers/`** — the inline diagnostics path. `node-proxy`
  provider runs the SAME `compressor.js` in-process (no HTTP, no LLM) for `simulate`/preview;
  `passthrough` is the always-healthy floor. This is NOT the traffic path.

**No third party:** Headroom (Python proxy + `headroom-ai` npm client) has been fully removed.
Everything is our own Node code.

## The AI chokepoints (where the base URL gets pointed at the proxy)

| Surface     | Repo                              | Chokepoint                                   | LLM         |
|-------------|-----------------------------------|----------------------------------------------|-------------|
| SIID-Code   | `DEV\Siid-Code` (separate)        | `ApiHandler.createMessage()` in `src/api/index.ts` | OpenRouter |
| siid-forge  | this repo `extensions/siid-forge` | `src/core/openRouterClient.ts`               | OpenRouter  |

Consumer binding is unchanged in shape:
```ts
const ext = vscode.extensions.getExtension('ConscendoTechInc.siid-compression');
const api = ext ? await ext.activate() : undefined; // ICompressionApi | undefined
const baseUrl = api?.getProxyBaseUrl();             // '' if proxy not ready
// point the OpenRouter client at (baseUrl || 'https://openrouter.ai/api/v1')
```

---

## Status

### ✅ Framework + own Node proxy (DONE, tested)

- [x] `src/types.ts` — backend-agnostic contract (`ICompressionProvider`, `ICompressionApi`).
- [x] `src/proxy/server.js` — our OpenAI-compatible Node proxy (OpenRouter upstream, streaming
      relayed as-is, fail-open compression, correct response framing/encoding headers).
- [x] `src/proxy/compressor.js` — compression strategy module (request + response hooks;
      **passthrough scaffold**, token estimator included).
- [x] `src/proxyManager.ts` — spawns/supervises the Node proxy; free-port; health + restart.
- [x] `src/providers/passthroughProvider.ts` + `nodeProxyProvider.ts` — inline diagnostics.
- [x] `src/compressionManager.ts` + `src/extension.ts` — wiring, config, commands.
- [x] Build wiring: `build/gulpfile.extensions.js` + `build/npm/dirs.js`. Gulp's non-ts pipeline
      auto-copies `src/proxy/*.js` → `out/proxy/*.js`; `npm run compile` does the same via
      `copy-proxy` for the standalone `tsc` path.
- [x] `npx gulp compile-extension:siid-compression` → **0 errors**, `out/proxy/*.js` present.
- [x] Tests (plain Node, no VS Code host), all passing:
  - `test/smoke.js` — manager selection / passthrough / never-throws (5/5).
  - `test/proxy-manager.test.js` — spawns the real Node proxy, `/health` healthy, clean stop.
  - `test/proxy-e2e.test.js` — full compress→forward→transform against a fake upstream:
    verifies path rebase (`/api/v1/chat/completions`), injected `Bearer` key, messages + model
    relayed intact, response relayed back.

### ✅ Compression strategy — GENERAL-PURPOSE (DONE, unit-tested)

`compressor.js` is deliberately **consumer-agnostic**: same content-based, meaning-preserving
transforms for every conversation. It makes NO assumption about what a role's message "means" and
has NO per-consumer profiles. (An earlier `forge` profile that collapsed superseded `assistant`
test-code turns was **removed** — that domain knowledge belongs in the consumer, not the framework:
it risked hiding a good older version from the model in the narrow case where the latest version is
worse but forge hasn't flagged it as a regression. See the file header for the full rationale.)

Three request-side transforms (see the file header for the full spec):
- **dedupe** (lossless, default ON) — replace older EXACT-duplicate large message contents with a
  marker pointing at the surviving latest copy. Byte-identical match only (no block-parsing).
- **whitespace** (lossless, default ON) — collapse 3+ blank lines, strip trailing spaces.
- **truncate** (near-lossless, default **OFF** — opt-in) — head+tail keep window on oversized
  contents with an `…[siid-compression: elided N characters]…` marker. The only lossy transform,
  so a consumer must explicitly enable it (log/data-dump heavy traffic).

Safety rails: NO role is treated as disposable (we rewrite content in place, never drop a turn);
system always untouched; never the last `keepRecent` (=2) messages; plain-string content only
(structured blocks untouched); all fail-open. `test/compressor.test.js` — 9/9 pass.

**Honest consequence:** on siid-forge's test-gen traffic (whose growth is superseded assistant
code) the generic strategy saves ~0% — dedupe needs byte-identical repeats, which forge's
differently-prefixed versions aren't. That is the accepted tradeoff for a correct, general
framework. Forge-specific shedding, if wanted, should happen inside forge before it sends.

### ✅ Test consumer (DONE)

Two ways to drive a REAL OpenRouter round-trip through the proxy (needs an OpenRouter key):
- **CLI:** `node test/live-consumer.test.js` — reads `OPENROUTER_API_KEY` from env or a
  gitignored `.env.local`; builds a bloated payload, prints the compression preview, routes a
  real request through the proxy, asserts a valid completion + prints OpenRouter usage. No key ⇒
  prints instructions and exits 0 (never fails the build).
- **In SIID:** command **"SIID Compression: Run Test Consumer"** — same flow, needs the proxy
  healthy (key via `siidCompression.proxy.openrouterApiKey`). Model: `siidCompression.testConsumer.model`.

### 🟡 NEXT

- [ ] **Run the live test with a real key** (user will provide) — confirm valid completion +
      real token usage end-to-end, and eyeball answer quality with compression on.
- [ ] Consider a block-level dedupe (embedded duplicate file/query blocks inside differently-
      prefixed messages) if the whole-message dedupe proves too conservative on real traffic.
- [ ] **Wire consumers** — forge `openRouterClient.ts` + SIID-Code `createMessage` point their
      base URL at `api.getProxyBaseUrl()`. Copy `siid-compression-api.d.ts` into SIID-Code.

---

## Config (contributed by the extension)

| Setting | Default | Meaning |
|---|---|---|
| `siidCompression.enabled` | `true` | Master switch; off ⇒ proxy not started, passthrough everywhere. |
| `siidCompression.backend` | `auto` | Inline diagnostics backend: `auto` \| `node-proxy` \| `passthrough`. |
| `siidCompression.healthCheckTtlMs` | `30000` | Health-check cache window. |
| `siidCompression.proxy.serverPath` | `""` | Override the bundled `out/proxy/server.js`. |
| `siidCompression.proxy.nodePath` | `""` | Override the Node used to run the proxy. |
| `siidCompression.proxy.port` | `0` | Preferred port; 0 = auto free port. |
| `siidCompression.proxy.host` | `127.0.0.1` | Proxy bind host. |
| `siidCompression.proxy.upstreamUrl` | `""` | OpenRouter-compatible upstream; empty = OpenRouter default. |
| `siidCompression.proxy.openrouterApiKey` | `""` | Injected as `OPENROUTER_API_KEY`; empty = ambient env / forwarded header. |
| `siidCompression.proxy.extraArgs` | `[]` | Extra CLI args to the proxy server. |
| `siidCompression.proxy.maxRestarts` | `3` | Max auto-restarts on unexpected exit. |
| `siidCompression.proxy.healthTimeoutMs` | `20000` | Time to wait for the proxy to become healthy. |

## Build / test commands

```bash
# compile just this extension via the IDE build (copies src/proxy/*.js to out/proxy)
npx gulp compile-extension:siid-compression

# standalone compile (tsc + copy-proxy)
npm --prefix extensions/siid-compression run compile

# headless tests (plain Node, no VS Code host)
node extensions/siid-compression/test/smoke.js
node extensions/siid-compression/test/proxy-manager.test.js
node extensions/siid-compression/test/proxy-e2e.test.js

# compile + smoke only, no deploy
extensions/siid-compression/build-and-test.bat /test
```

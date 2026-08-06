# SIID Compression — What & How

A transport-layer compression proxy between SIID's AI consumers and OpenRouter. It shrinks the
tokens sent upstream **without degrading agent quality**. Our own code, our own strategy — no
Python, no third-party runtime, no binary.

---

## 1. Goal

SIID's AI surfaces (SIID-Code coding agent, SIID Forge test generation) send large, repetitive
contexts every turn: file bodies re-appearing across messages, Salesforce query results, describe
output, deploy/test logs. That is tokens, money, latency.

**Objective:** route that traffic through a swappable compression layer that reduces tokens while
being **efficiency-first** — it must *never* drop or garble information the agent needs. For a coding
agent, correctness beats savings. So the layer is **lossless and content-based only**.

Two hard constraints:

1. **General-purpose.** No consumer-specific logic. Only content-based, meaning-preserving transforms
   safe for *any* conversation. If a consumer can shed more, that belongs in the consumer.
2. **Optional with direct fallback.** Extension absent or proxy unhealthy → consumers talk to
   OpenRouter directly. Nothing breaks.

---

## 2. Architecture

```
  SIID-Code / SIID Forge          SIID Compression extension          OpenRouter
  ─────────────────────           ──────────────────────────          ──────────
  OpenRouter client               Node child process (own proxy)
   baseURL ─────────────────────► POST /v1/chat/completions
   (swapped to proxy IF             ├─ compressRequest(body) ─ shrink outbound (compressor.js)
    healthy; else direct)           ├─ forward upstream ───────────────────────────────►
                                     └─ relay response back (response transform = no-op)
```

- **Own Node proxy** (`src/proxy/server.js`): tiny OpenAI-compatible HTTP proxy, zero deps (Node
  built-ins only). Spawned by the extension's ProxyManager. Upstream = OpenRouter only. Streaming
  piped straight through.
- **Routing is a base-URL swap**, not tool-calling — compression is transport-layer. Each request
  carries `x-siid-source` (`siid-code`/`forge`) for logging.
- **Fail-open everywhere.** Compression throws → forward the **original** body. A compression bug
  must never break a conversation.

---

## 3. The strategy

All logic in `src/proxy/compressor.js`. Exposes `compressRequest(body, ctx) -> { body, stats }`.

### Safety rails (why it can't corrupt a conversation)

- **No role is disposable.** Transforms act on a message's own **content**, never on assumptions
  about its role. `system` is never touched (small, load-bearing).
- **Recency preserved.** Last `keepRecent` (2) messages left intact — that's where the model works.
- **Structure never broken.** We rewrite plain-string content and the `.text` of `{type:"text"}`
  blocks only. Image blocks, `tool_calls`, array shape — untouched. Originals never mutated in place.
- **Markers are model-readable** — the model sees content was referenced/elided, not lost.
- **Self-guarding.** A transform fires only when it saves bytes; never emits larger than input.

### Content-shape adapter (the fix that made it work on real traffic)

`content` comes as a plain **string** or an **array of content blocks**. SIID-Code and most
Anthropic/OpenAI clients use the **array** shape — so a string-only strategy silently no-op'd on live
traffic (`0.0% [none]`). The adapter normalizes each message into editable **text segments** (the
string, or each text block's `.text`) with a safe setter. Every transform runs over segments; image
and non-text blocks are never exposed.

### Transforms (applied in order, each toggleable)

| # | Transform | Lossless? | Default | What |
|---|-----------|-----------|---------|------|
| −1 | **block-dedup** | ✅ | on | Cross-message: a large **byte-identical** block re-pasted in an older message → readable reference to the newest copy. |
| 0 | **table compaction** | ✅ | on | JSON arrays-of-objects (SF query/describe) → keys **once** + rows of values. |
| 0b | **repeated-lines** | ✅ | on | ≥4 byte-identical adjacent lines (logs) → line once + repeat marker. |
| A | **whole-message dedupe** | ✅ | on | An entire message identical to a later one → "identical to message #N" marker. |
| B | **whitespace** | ◐ meaning-preserving | on | 3+ blank lines → 1, strip trailing whitespace. Safe for text + code, but **not byte-reversible** — no `expand()`. Preserves meaning, not exact bytes. |
| C | **truncate oversized** | ⚠️ lossy | **off** | Head+tail keep window + elision marker. Drops content — opt-in per consumer. |

### Key decision: markers must be model-readable

The proxy compresses on the **outbound** path; the upstream model reads **exactly what we emit**
(nothing calls `expand()` there). So markers must be understandable *by the model*, or quality drops.

That drove block-dedup's marker away from char-offsets to a plain sentence citing the real 1-based
message number:

```
…⟪siid-ref: identical to the block shown in message #4 above (2220 chars); omitted to save space | src=3 at=17 len=2220⟫…
```

Model reads the sentence; the `| src=… at=… len=…` tail is kept only so `expand()` still round-trips
losslessly (tests) and any consumer can re-hydrate.

### Provable losslessness

Each **byte-lossless** transform (all ✅ rows above) has an `expand()` inverse and a round-trip test
asserting `expand(compress(x)) === x` — exotic chars, sparse rows, nested values, triple re-pastes,
array content. `expand()` proves correctness; the proxy sends the compressed form. The `whitespace`
transform (◐) is deliberately excluded: it is meaning-preserving, not byte-reversible, and has no
inverse — a re-hydrating consumer gets the same meaning back, not the exact original bytes.

---

## 4. Provenance

Table compaction and the byte-identical dedup ideas are **reimplementations of the reusable cores**
of Headroom's SmartCrusher (Apache-2.0) — *algorithm only, our own code*, with the same "Untouched"
safety fall-throughs. We deliberately **removed** the consumer-specific parts (e.g. collapsing older
assistant turns): unsafe (the latest turn isn't always best) and against the general-purpose mandate.

---

## 5. Results (verified live in the SIID IDE)

Real SIID-Code sessions, `openai/gpt-5.4-mini`, source `siid-code`:

| Workload | Transforms | Savings |
|----------|-----------|---------|
| Query 50/200 Accounts, analyze | `table:1, whitespace:N` | **~7–8%** |
| Genuine file **re-paste** across turns | `block-dedup:1→15, whitespace:N` | **~26–28%** |

- ~8% on non-repeating workloads is **honest** — no repeated blocks to dedup, and the biggest chunk
  (~106 KB system prompt) is intentionally excluded by the system-role safety rule.
- On repeated content, block-dedup compounds as the conversation grows (count climbed `1 → 15`),
  holding ~27%.
- **Quality held in every run** — tasks completed correctly. Lossless *in practice*, not just theory.

**Tests:** 34/34 offline pass (blockDedup 6, tableCompaction 9, repeatedLines 7, compressor 12) +
live end-to-end validation of routing and the two major transforms.

---

## 6. File map

| File | Role |
|------|------|
| `src/proxy/server.js` | Own OpenAI-compatible Node proxy; OpenRouter upstream; per-request logging. |
| `src/proxy/compressor.js` | The strategy: content-shape adapter + all transforms + stats. |
| `src/proxy/tableCompaction.js` | Lossless array-of-objects → keys-once table (`compact`/`expand`). |
| `src/proxy/repeatedLines.js` | Lossless identical-line-run collapse (`collapse`/`expand`). |
| `src/proxy/blockDedup.js` | Lossless cross-message dedup, model-readable marker (`dedup`/`expand`). |
| `test/*.test.js` | Offline round-trip + behavior proofs (plain Node, no network). |
| `api/` | `@conscendotech/siid-compression-api` types package other extensions bind to. |

---

## 7. Consumer wiring (optional, fallback-safe)

- **SIID-Code**: `maybeRouteThroughCompression(config)` swaps `openRouterBaseUrl` to the proxy **only
  if** provider is OpenRouter, no custom base URL, and proxy healthy — else config unchanged.
- **SIID Forge**: `resolveEndpoint()` routes to the proxy with `x-siid-source: forge`.

Both optional with direct fallback — extension absent or proxy down → straight to OpenRouter.

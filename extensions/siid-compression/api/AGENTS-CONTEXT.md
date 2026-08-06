# Agents context — SIID Compression: types packages, sync pipeline, SIID-Code routing

Durable handoff so a fresh session (human or agent) can finish this without re-deriving. Verify
facts against current code before acting — details drift.

## Goal

Publish types-only packages for the SIID **compression** and **forge** extension APIs so an
EXTERNAL repo (SIID-Code) can bind to them, then wire SIID-Code's OpenRouter traffic through the
compression proxy (optional, direct fallback).

## Repos / owners (all under Conscendotechnologies org, currently PUBLIC)

- Source monorepo (VS Code fork): `Conscendotechnologies/Siid` — holds both extensions.
- Consumer: `Conscendotechnologies/Siid-Code` (separate repo, pnpm, branch `main`).
- Package mirror repos to CREATE (empty, public): `Conscendotechnologies/siid-compression-api`
  and `Conscendotechnologies/siid-forge-api`.
- Package scope name (both): `@conscendotech/siid-compression-api`, `@conscendotech/siid-forge-api`.

## Local working copies (branches — WORK ON THESE)

- `C:\...\AIpexium2-compression` → branch `siid-compression-node-proxy` — compression extension.
  NOTE: this branch is LOCAL-ONLY; it must be PUSHED to `Conscendotechnologies/Siid` before the
  compression sync Action can run (the Action clones that branch).
- `C:\...\AIpexium2` → branch `feature/siid-forge-framework` — forge extension. Already PUSHED;
  forge's `api/` is reachable on the remote (verified).
- `C:\...\Siid-Code` → branch `main`.

## Why a mirror repo + Action (not tsconfig paths, not subfolder Git dep)

Forge's existing pattern (`extensions/siid-forge/api/`, `@conscendotech/siid-forge-api`) resolves
in-repo via tsconfig `paths`. That works ONLY for in-monorepo consumers. SIID-Code is EXTERNAL and
uses pnpm; `github:Conscendotechnologies/Siid#&path:...` subfolder deps are unreliable with pnpm and
would clone the whole (huge) fork. So: a small standalone mirror repo per API that pnpm installs
cleanly. A GitHub Action keeps each mirror synced from the source `api/` folder.

## The sync pipeline (VERIFIED working against the real public source)

Direction: Action lives IN the mirror repo, PULLS from the public source, PUSHES to itself.
No PAT needed while source is public (anonymous clone + built-in GITHUB_TOKEN to own repo).
- `.github/workflows/sync.yml` (already written, in `C:\...\DEV\pkg-repos\<name>\`) does:
  sparse shallow clone of `extensions/<ext>/api` from source branch → copy the .d.ts + package.json
  + README to repo root → rewrite package.json repository to the mirror URL → commit + tag `v<ver>`.
- Triggers: manual `workflow_dispatch`, daily `schedule`, and `repository_dispatch`
  (`siid-compression-api-changed` / `siid-forge-api-changed`) that the SOURCE repo can fire on
  api/ change.
- PROVEN: sparse-clone of forge api/ from `feature/siid-forge-framework` returns the 5 files.

### If `Conscendotechnologies/Siid` goes PRIVATE later
Add a fine-grained PAT (contents:read on Siid) as a secret in each mirror repo and pass
`token:` to the clone step. Nothing else changes. Documented in each api/MAINTAINING.md.

## What's DONE (local, ready)

- Compression `api/` package (mirrors forge's structure), in the compression worktree:
  `extensions/siid-compression/api/` = index.d.ts, siid-compression.d.ts (ACCURATE current
  ICompressionApi incl. getProxyBaseUrl/getProxyState/ensureProxy), package.json
  (@conscendotech/siid-compression-api v0.1.0), README.md, MAINTAINING.md.
- Forge `api/` package ALREADY EXISTS on `feature/siid-forge-framework` (v2.14.0) — reuse as-is.
- Mirror-repo seed contents (README + sync.yml) for BOTH, at `C:\...\DEV\pkg-repos\
  siid-compression-api\` and `...\siid-forge-api\`.
- NOTE: an OUTDATED hand copy exists at `extensions/siid-compression/siid-compression-api.d.ts`
  (missing the proxy methods). The NEW source of truth is `api/siid-compression.d.ts`. Delete or
  update the old flat file so they don't diverge.

## What YOU (human) must do on GitHub

1. Create two EMPTY public repos: `Conscendotechnologies/siid-compression-api`,
   `Conscendotechnologies/siid-forge-api`.
2. Push the prepped contents from `C:\...\DEV\pkg-repos\<name>\` into each (git init/add/commit/push).
3. PUSH the local branch `siid-compression-node-proxy` to `Conscendotechnologies/Siid` (so the
   compression sync can find the api/ folder). (Forge branch already pushed.)
4. Run each repo's "Sync types from source" workflow once (Actions tab → Run workflow). Verify the
   .d.ts files land at the mirror repo root and a `v<version>` tag is created.
5. Verify install: in a scratch dir, `pnpm add github:Conscendotechnologies/siid-compression-api`
   and confirm `import type { ICompressionApi } from '@conscendotech/siid-compression-api'` resolves.

## What's LEFT to build (TASK 2 — SIID-Code routing, branch main)

Wire SIID-Code's OpenRouter traffic through the compression proxy — OPTIONAL, DIRECT FALLBACK.
- Chokepoint: `src/api/providers/openrouter.ts` ctor ~L71:
  `const baseURL = this.options.openRouterBaseUrl || "https://openrouter.ai/api/v1"` (fallback exists).
- `openrouter.ts` and `src/api/index.ts` are vscode-FREE — keep them that way. Resolve the proxy URL
  in a vscode-aware layer and inject via `options.openRouterBaseUrl`.
- `buildApiHandler(cfg)` in `src/api/index.ts` ~L69. Callers to wire (user wants main loop +
  condensing): `src/core/task/Task.ts:336` (main), `Task.ts:903` and `Task.ts:2636` (condensing).
- Plan: new `src/integrations/siid-compression/index.ts` exporting `maybeRouteThroughCompression(cfg)`
  that imports `ICompressionApi` from `@conscendotech/siid-compression-api`, binds via
  `vscode.extensions.getExtension('ConscendoTechInc.siid-compression')`, and IF proxy baseUrl is
  non-empty AND provider is openrouter AND user hasn't set a custom openRouterBaseUrl → returns
  {...cfg, openRouterBaseUrl: proxyBase}; else returns cfg unchanged. Apply at the call sites above.
  Add header `x-siid-source: 'siid-code'` (observability only; compressor behavior is source-agnostic).
- Reference impl already done for forge: `AIpexium2/extensions/siid-forge/src/core/openRouterClient.ts`
  (resolveEndpoint + x-siid-source + direct fallback) — copy the shape.
- FIRST: read openrouter.ts, api/index.ts, and Task.ts around those lines to confirm before editing.
  SIID-Code builds separately (pnpm); confirm compile, don't guess.

## Compression strategies already shipped (committed on siid-compression-node-proxy)

Own Node proxy (no Python). Lossless, general-purpose, all round-trip + live-LLM verified:
table compaction (JSON record arrays→keys-once), repeated-line collapse (identical log runs),
cross-message block dedup (re-pasted file bodies). Opt-in lossy truncate (off). See PROGRESS.md.

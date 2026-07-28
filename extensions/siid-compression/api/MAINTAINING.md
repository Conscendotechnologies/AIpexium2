# Maintaining `@conscendotech/siid-compression-api`

**Audience:** whoever (human or agent) next changes the SIID Compression public API. Read this
before touching `src/types.ts` (the `ICompressionApi` interface) or this `.d.ts`.

## The mental model

The extension exposes a **runtime API object** from `activate()`. Consumers get it at runtime:

```ts
const api = (ext.exports) as ICompressionApi;
```

They can't get the *types* that way — TypeScript needs those at compile time. So the types ship
separately as a **types-only package**. Nothing in the package runs; it's pure `.d.ts`.

```
RUNTIME   extensions/siid-compression/src/types.ts   → ICompressionApi (the contract)
                                     src/extension.ts → activate() returns an object of that shape
TYPES     extensions/siid-compression/api/            → the package
            package.json        "version"
            siid-compression.d.ts  ← the public interface (matches src/types.ts ICompressionApi)
            index.d.ts          → export * from './siid-compression'
```

## Two things that must agree

| # | Where | What |
| - | ----- | ---- |
| 1 | `src/types.ts` — `ICompressionApi` | the runtime contract the extension implements |
| 2 | `api/siid-compression.d.ts` — `ICompressionApi` | the type surface consumers compile against |

Keep them **identical**. (Forge enforces this with an `apiConformance.ts` compile guard; if/when
this extension grows, add the same guard — a file that assigns the activate() return to
`ICompressionApi` so `tsc` fails on drift.)

Bump `api/package.json` `"version"` and the extension's advertised `version` together on any
surface change (minor = additive, major = breaking).

## Reaching consumers

1. **In the SIID monorepo** — a consumer maps the package name to `../siid-compression/api/index.d.ts`
   in its `tsconfig.json` `paths`. No install.

2. **Another repo of ours (SIID-Code)** — depends on the **standalone mirror repo**
   `Conscendotechnologies/siid-compression-api`:
   ```bash
   pnpm add github:Conscendotechnologies/siid-compression-api
   ```

## The sync pipeline (monorepo → standalone mirror repo)

`api/` here is the **source of truth**. The standalone repo `Conscendotechnologies/siid-compression-api`
is a **generated mirror** so external pnpm consumers can install it without cloning the whole
VS Code fork.

A GitHub Action **in the standalone repo** keeps it synced:
- It clones the **public** source repo `Conscendotechnologies/Siid` (no token needed while public),
- copies `extensions/siid-compression/api/*` into the mirror repo root,
- commits + pushes to itself (built-in `GITHUB_TOKEN` — own repo, no PAT).

Triggers: `workflow_dispatch` (manual), a daily `schedule`, and/or `repository_dispatch` fired from
the source repo when `api/` changes.

### If `Conscendotechnologies/Siid` becomes PRIVATE later

The clone step then needs read access. Add a fine-grained PAT (or GitHub App token) with
`contents:read` on `Siid` as a secret in the mirror repo, and pass it to the checkout/clone step
(`token: ${{ secrets.SIID_READ_TOKEN }}`). Nothing else changes. Until then, no PAT is required.

# Maintaining the SIID Forge SDK (`@conscendotech/siid-forge-api`)

**Audience:** whoever (human or agent) next changes the Forge public API. Read this
before touching `src/api.ts` or the `.d.ts`. It explains how the pieces fit and the
exact steps to add/change a method without breaking consumers.

---

## The mental model

Forge exposes a **runtime API object** (a live, stateful thing with methods, event
emitters, the active org, etc.). Consumers get it at runtime:

```ts
const forge = (await ext.activate()) as SiidForgeApi;
```

They can't get the *types* that way — TypeScript needs those at compile time. So the
types are shipped separately as a **types-only npm package**. Nothing about the
package runs; it's pure `.d.ts`.

```
┌─────────────────────────────────────────────────────────────┐
│  RUNTIME (what actually executes)                            │
│  extensions/siid-forge/src/api.ts                            │
│    class SiidForgeApi { readonly version = '2.14.0'; … }     │
│    ← returned from activate(); consumers call its methods    │
├─────────────────────────────────────────────────────────────┤
│  TYPES (what consumers compile against)                      │
│  extensions/siid-forge/api/            ← the npm package     │
│    package.json      "version": "2.14.0"                     │
│    siid-forge.d.ts   ← THE hand-authored public interface    │
│    index.d.ts        ← export * from './siid-forge'          │
├─────────────────────────────────────────────────────────────┤
│  GUARDS (fail the build if the three drift)                  │
│  src/apiConformance.ts        runtime class ⊆ .d.ts (types)  │
│  scripts/check-api-version.js  api.ts version == pkg version │
└─────────────────────────────────────────────────────────────┘
```

There is exactly **one** `.d.ts`, in `api/`. Consumers never copy it — this used to
be hand-copied per consumer and silently went stale (a consumer was once 238 lines
behind). Now:

- **In this monorepo:** a consumer maps the package name to `api/index.d.ts` in its
  `tsconfig.json` `paths` (see `sf-project-retriever/tsconfig.json`).
- **In another repo:** a consumer adds `@conscendotech/siid-forge-api` as a
  Git/registry dependency. Same import specifier, so nothing else differs.

---

## THREE things that must always agree

| # | Where | What |
| --- | --- | --- |
| 1 | `src/api.ts` — `readonly version` | the runtime API's advertised version |
| 2 | `api/package.json` — `"version"` | the package version consumers install |
| 3 | `api/siid-forge.d.ts` | the type surface, matching the runtime class shape |

- **1 == 2** is enforced by `scripts/check-api-version.js` (runtime value check).
- **1 conforms to 3** is enforced by `src/apiConformance.ts` (compile-time type
  check — if the class no longer satisfies the interface, THAT file won't compile).

Break either and the build fails loudly. That's the safety net; the steps below are
how you stay on the right side of it.

---

## How to change the API — step by step

### Adding a method / namespace (the common case, a MINOR bump)

Say you add `forge.logs.newThing(...)`.

1. **Implement it** in `src/api.ts` on the `SiidForgeApi` class.
2. **Declare it** in `api/siid-forge.d.ts` — add the method to the matching
   interface, with the SAME signature. (If you skip this, `apiConformance.ts` still
   compiles — the class is a *superset* of the interface — but consumers can't see
   the method. If you get the signature WRONG, `apiConformance.ts` fails. Either way,
   keep them identical.)
3. **Bump the version in BOTH places** by one minor:
   - `src/api.ts`: `readonly version = '2.15.0';`
   - `api/package.json`: `"version": "2.15.0"`
4. **Log it** in the version-history comment above `readonly version` in `src/api.ts`
   (the changelog convention — every entry says what was added). *Note: keep this
   current — it has lagged before.*
5. **Run the guards:**
   ```
   cd extensions/siid-forge
   node scripts/check-api-version.js      # 1 == 2
   npx tsc -p ./ --noEmit                 # 1 conforms to 3 (apiConformance)
   ```
6. **Update `CONSUMING.md`** with the new method (that's the human-facing API doc).

### Changing an existing signature (a BREAKING change, MAJOR bump)

Same as above, but bump the **major** (`2.x.x` → `3.0.0` in both places) because
existing consumers compiled against the old shape. Note the break in the version
history. `apiConformance.ts` will force you to update the `.d.ts` to match.

### Semver rules (what consumers rely on)

- **Patch** (`2.14.0` → `2.14.1`): no surface change (bugfix in behavior only).
- **Minor** (`→ 2.15.0`): additive — new method/namespace/optional field. Existing
  consumers keep working.
- **Major** (`→ 3.0.0`): a removal or a changed signature. Existing consumers may
  break. Consumers pin with `^2.14.0`, so a major is opt-in for them.

Consumers ALSO gate at runtime: `if (forge.version >= '2.15.0')` before calling a new
method (see `sf-project-retriever/src/forge.ts`). So a user running an OLD Forge with
a NEW consumer degrades gracefully instead of crashing. Preserve that pattern.

---

## Common mistakes (and which guard catches them)

| Mistake | What happens |
| --- | --- |
| Bumped `api.ts` version, forgot `api/package.json` | `check-api-version.js` fails: "SDK version drift" |
| Added a method to the class, wrong signature in `.d.ts` | `apiConformance.ts` fails to compile |
| Changed the `.d.ts` but not the class | `apiConformance.ts` fails (class no longer satisfies interface) |
| Added a method, forgot to bump the version | No guard catches this — consumers can't tell the surface grew. **Always bump on a surface change.** |
| Edited a consumer's old vendored copy of the `.d.ts` | There is none anymore — if you find one, delete it; the package is the only source. |

---

## Where the build runs the guards

- **npm (`npm run compile` in `extensions/siid-forge`):** `check-api-version.js` runs
  as `precompile`; `tsc` runs `apiConformance.ts`.
- **The fork's gulp build (`compile-extension:siid-forge`, used by CI and
  `update-siid-forge.bat`):** compiles `apiConformance.ts` via `tsc`, so the TYPE
  guard runs. The version guard (`check-api-version.js`) is a standalone Node script —
  if you want it enforced in gulp/CI/the `.bat` too, add
  `node extensions/siid-forge/scripts/check-api-version.js` as a build step before the
  compile. (It is NOT auto-run by gulp, because gulp bypasses npm lifecycle hooks.)

---

## Reaching consumers (two ways — no registry needed)

Scope is deliberately **first-party only** — our own extensions, in this repo and
other repos of ours. No registry, no `npm publish`.

1. **In this monorepo** — resolved via the consumer's tsconfig `paths` mapping to
   `../siid-forge/api/index.d.ts`. Already set up (`sf-project-retriever`).

2. **Another repo of ours** — a **Git dependency**, which pulls the types straight
   from GitHub with no registry:

   ```jsonc
   "@conscendotech/siid-forge-api": "github:ConscendoTechInc/siid#<ref>&path:extensions/siid-forge/api"
   ```

   npm's plain `github:` shorthand installs the repo ROOT, and this package sits in a
   subfolder — so use a subfolder-aware form (a `&path:` selector as above, or a
   `gitpkg`/`prepare`-script setup) to point at `extensions/siid-forge/api`.

The import specifier `@conscendotech/siid-forge-api` is identical in both cases, so
moving an extension between the monorepo and its own repo needs no source change.

> **Not doing:** publishing to a public/private npm registry. That's only needed for
> third parties OUTSIDE our org, which is explicitly out of scope. If that ever
> changes, the package is already registry-valid (`files` lists just the `.d.ts`s +
> README) — bump the version and `npm publish` from `api/`. Until then, don't stand
> up registry machinery.

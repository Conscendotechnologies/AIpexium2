# SIID Salesforce Framework — Core Engine Implementation Plan

> **Status:** Active — core + many features shipped (see Build Status below)
> **Scope of this doc:** originally the **core engine**; now also tracks the
> feature layers that have been built on top of it.
> **Last updated:** 2026-06-15
> **Extension folder:** `extensions/siid-forge/` (publisher `ConscendoTechInc`).
> Note: this doc's older sections say `salesforce-core`; the shipped extension is
> **`siid-forge`** — same architecture, different name.

---

## 0. Build Status (2026-06-15)

The extension **`siid-forge`** is live as a built-in in the SIID fork. It is a
single extension (not yet split core/features) but follows the "one engine, many
consumers" structure internally: thin core under `src/core/`, features under
`src/features/`, each registered from `extension.ts`.

### Core (`src/core/`)
| Module | Status | Notes |
| --- | --- | --- |
| `sfExecutor` | ✅ | Runs `sf … --json` via `exec` + shell-quoting, JSON envelope parsing, typed errors, cancellation, `acceptNonZeroStatus`. |
| `orgManager` | ✅ | Default org, username, **User Id** (queried + session-cached), authorize/select, org-change events. |
| `cliManager` | ✅ | Version check + update guidance. |
| `traceManager` | ✅ | `SIIDForge` DebugLevel (FINEST) + TraceFlag, cached in `.siid/forge.json`; DebugLevel id cached to skip re-query/update. |
| `schemaManager` | ✅ | Local cache under `.siid/schema/` — objects (org describe), apex (local `.cls` parse), lwc, **AuraEnabled map** (`lwc/_apexMethods.json`). |
| `coverageStore` | ✅ | Per-class coverage (`covered`/`uncovered` lines) in `.siid/test-results/coverage.json`. |
| `apexLogs` | ✅ | Saves run logs to `.siid/logs/`, filtered to the current run, `limit` for debug. |
| `replay/logParser` | ✅ | Raw Apex log → replay timeline (statements, method-entry call sites, variables, debug/SOQL/DML/exception events); header parse (api/FINEST). |
| `replay/replayAdapter` | ✅ | Inline DAP: breakpoints (verified against executed lines), continue, step over/into/out (skips external frames), stack, variables. |
| `logger`, `forgeConfig`, `workspace` | ✅ | Output channel, `.siid/forge.json` IO, cwd helpers. |
| Public SDK `exports` / `.d.ts` | ❌ | Not yet — still a single extension; SDK extraction is future work. |

### Features (`src/features/`)
| Feature | Status |
| --- | --- |
| Version check / update CLI | ✅ |
| Create project / apex class / **test class** / trigger / aura / LWC | ✅ |
| Deploy / retrieve / delete source (explorer + editor context) | ✅ |
| Org status bar + authorize (prod/sandbox) + select + open org | ✅ |
| Execute Anonymous Apex (run + replay-debug) | ✅ |
| Run / **Debug** Apex tests (CodeLens, single-transaction debug) | ✅ |
| Test report (failures-first, per-class coverage + uncovered ranges) | ✅ |
| **Code-coverage line highlighting** (green/red) + status-bar toggle | ✅ |
| **Coverage CodeLens** (% above class) | ✅ |
| SOQL runner (`.soql` + inline) | ✅ |
| Retrieve metadata UI | ✅ |
| Schema cache + Schema Explorer tree + refresh commands | ✅ |
| Completion: SOQL objects/fields, Apex `var.field`, custom class members | ✅ |
| Completion: **LWC `@salesforce/apex` import** from AuraEnabled map | ✅ |
| Navigation: hover + go-to-definition (apex cache) | ✅ |
| Apex Replay Debugger (own, inline DAP) | ✅ |
| Activity-bar Forge menu | ✅ |
| `apex-language-basics` (highlighting via grammar) | ✅ (separate ext) |

### Known limits / deferred
- **No method parameter validation / signature help** yet (see §13).
- **Anonymous Apex** logs are capped at DEBUG by the CLI (not FINEST), so anon
  replay has limited variables — test replay is full FINEST.
- **StandardApexLibrary** mapping (System.* classes) not shipped — proprietary;
  user handling via jar separately.
- **No public SDK** extraction yet; still one extension.

---

## 1. Vision

SIID (product name: *Salesforce Intelligence Integrated Development*) is a fork of
VS Code. We want a single **inbuilt extension that acts as a Salesforce
development framework**, powered **entirely by the `sf` CLI** — with no dependency
on Salesforce's official VS Code extensions.

The framework eventually provides four things:

1. **CLI orchestration / UI** — drive `sf` behind panels, buttons, guided flows.
2. **Project scaffolding** — generate SFDX projects, LWC, Apex, config, etc.
3. **Org / data tooling** — browse orgs & metadata, run SOQL.
4. **Platform / SDK** — a stable internal API that *other* extensions (ours now,
   third parties later) build on.

### Decisions already locked

| Decision | Choice |
| --- | --- |
| CLI delivery | **Assume `sf` is already installed** (handled by a separate PR). The core only *validates* presence/version, it does not install. |
| Official SF extensions | **Do not use them.** CLI-only. |
| SDK timing | **Internal API now, public later.** Build our own features through the API; do not promise external stability until v1. |
| First build target | **Core engine first** (this document). |

---

## 2. Architectural principle: one engine, many consumers

The failure mode of a "do-everything" extension is every feature talking to the
CLI its own way. Today that is already happening — `sf-project-retriever`,
`salesforce-setup`, etc. each re-implement:

- spawning `sf … --json` via `child_process`,
- reading the default org from `.sf/config.json`,
- parsing `result`, bumping `maxBuffer`, ad-hoc error handling.

The core engine **consolidates all of that into one place**, and that same surface
*is* the SDK. Our own features and third-party extensions consume the identical
public API. If our org-explorer can only do what the API allows, the API stays
honest.

```
┌─────────────────────────────────────────────────────────┐
│  Feature extensions (separate folders, depend on core)   │
│  Scaffolder │ Deploy/Retrieve UI │ Org Explorer │ SOQL   │
│  (existing: sf-project-retriever, salesforce-setup …      │
│   refactored later to consume core instead of raw exec)  │
├─────────────────────────────────────────────────────────┤
│  PUBLIC SDK  (core extension `exports` + events)         │  ← internal now
│  sf.run() · orgs.active · onDidChangeOrg · cli.version   │     public later
├─────────────────────────────────────────────────────────┤
│  CORE ENGINE  (extension: `salesforce-core`)            │
│  • SfExecutor   – spawn `sf … --json`, parse, typed errs │
│  • CliResolver  – locate/validate `sf` binary + version  │
│  • OrgManager   – list orgs, track default/active, cache │
│  • TaskRunner   – long ops: progress, cancel, output ch. │
│  • Logger       – output channel + leveled logging       │
└─────────────────────────────────────────────────────────┘
```

**Why a separate `salesforce-core` extension rather than a shared `npm` lib?**
Because an extension can expose a live, stateful API (active org, event emitters)
via `extension.exports`, and other extensions bind to it with
`extensionDependencies`. That is exactly the platform model we want, and
`firebase-service` already proves the pattern here (it exposes an API via
`api.ts` + a `getAPI` command).

---

## 3. The CLI-only contract — what it buys and costs

| | Detail |
| --- | --- |
| **Win** | Almost every `sf` command supports `--json` → stable machine-readable output. Auth, token refresh, deploy bundling, metadata conversion are handled *for* us. We never scrape terminal text. |
| **Cost** | Each `sf` call is a fresh Node/oclif process (~0.5–1.5 s startup). Fine for discrete user actions (deploy, query, login). **Never** call `sf` on a hot path (per-keystroke). |
| **Mitigation** | Cache aggressively (org list, `org display`, metadata describe) with TTL + explicit invalidation. Batch. Debounce. |
| **Out of scope (by this choice)** | SOQL-on-keystroke, rich Apex language features. Those need the Apex language server / `@salesforce/*` libs and are explicitly *not* part of the CLI-only core. |

---

## 4. How a built-in extension actually ships in this fork

Two registration points (both files were verified in the repo):

1. **Compilation** — add the extension's tsconfig to the hardcoded `compilations`
   array in [`build/gulpfile.extensions.js`](build/gulpfile.extensions.js#L30).
   Existing entries: `firebase-service`, `sf-project-retriever`,
   `salesforce-setup`. **Without this, `src/*.ts` is never compiled by the real
   build.** (JS-only extensions like `salesforce-formula-eval` skip this.)
2. **Discovery / packaging** — automatic. `scanBuiltinExtensions` in
   [`build/lib/extensions.ts`](build/lib/extensions.ts#L498) reads every folder
   under `extensions/` that has a `package.json` and a built `out/`. No central
   list edit needed for discovery.

### Conventions to follow (observed in existing extensions)

- Folder: `extensions/salesforce-core/` with `src/`, `out/`, `package.json`,
  `tsconfig.json`, `README.md`.
- `package.json`: `publisher: "ConscendoTechInc"`, `main: "./out/extension.js"`,
  scripts `compile: "tsc -p ./"`, `watch: "tsc -watch -p ./"`.
- MIT license header on every `.ts` file (matches the rest of the fork).
- Workspace-local state → `.siid/` directory. Default org → read
  `<workspace>/.sf/config.json` `"target-org"`.
- Brand palette for any UI: purple `#432264` / `#a874e3`, accent orange `#ff7800`.

---

## 5. Core engine — module design

All modules live under `extensions/salesforce-core/src/`.

### 5.1 `CliResolver` (`core/cliResolver.ts`)
- Locate `sf` on `PATH` (and known install dirs); cache the resolved path.
- `sf --version --json` → parse CLI + plugin versions.
- Expose `isAvailable()`, `getVersion()`, `requireMinVersion(x)`.
- Emits a single, friendly error if `sf` is missing (install is a *separate* PR,
  so here we only surface a clear message + link, not an installer).

### 5.2 `SfExecutor` (`core/sfExecutor.ts`)
The single chokepoint for running the CLI. Everything else goes through it.

```ts
interface SfRunOptions {
  args: string[];            // e.g. ['project','deploy','start']
  cwd?: string;              // defaults to active workspace
  json?: boolean;            // default true → appends --json
  timeoutMs?: number;
  token?: vscode.CancellationToken;
  maxBuffer?: number;        // default 50MB (CLI JSON can be large)
}

interface SfResult<T = unknown> {
  status: number;            // sf exit/status code
  result: T;                 // parsed `result` field
  warnings?: string[];
  raw: string;               // raw stdout, for debugging
}

class SfExecutor {
  run<T>(opts: SfRunOptions): Promise<SfResult<T>>;     // rejects on error
  stream(opts: SfRunOptions): AsyncIterable<string>;    // for --wait long ops
}
```

Responsibilities:
- Use `spawn` (array args — **no string interpolation**, avoids shell-injection
  that the current `exec('sf … ${org}')` style risks).
- Always pass `--json` unless `json:false`; parse stdout, surface
  `result`/`warnings`/`message`.
- Map non-zero `status` + `name`/`message` into a typed `SfError`
  (`{ code, name, message, raw, suggestions }`).
- Honor `CancellationToken` → kill the child process tree.
- Centralized `maxBuffer` (the current extensions hardcode 10–20 MB each).

### 5.3 `OrgManager` (`core/orgManager.ts`)
- `listOrgs()` → `sf org list --json` (cached, TTL ~30 s + manual refresh).
- `getActiveOrg()` / `getDefaultOrg()` → workspace `.sf/config.json`, fallback to
  global default; surfaced as a single source of truth.
- `setActiveOrg(alias)`.
- `display(alias)` → `sf org display --json` (cached; carries `apiVersion`).
- `onDidChangeActiveOrg: vscode.Event<OrgInfo>` — the event the org-explorer,
  deploy UI, status bar, etc. all subscribe to.
- Status-bar item showing the active org (click → quick-pick to switch).

### 5.4 `TaskRunner` (`core/taskRunner.ts`)
- Wraps long operations (deploy/retrieve/test) in
  `vscode.window.withProgress` + cancellation.
- Pipes CLI output to a dedicated `OutputChannel` ("SIID Salesforce").
- Normalizes success/failure toasts.

### 5.5 `Logger` (`core/logger.ts`)
- Leveled logging to an output channel; `salesforce-core.trace` setting.

### 5.6 Public API surface (`api.ts` → `extension.exports`)
```ts
export interface SalesforceCoreApi {
  readonly version: string;            // API contract version (semver)
  cli: { isAvailable(): Promise<boolean>; getVersion(): Promise<string>; };
  sf: { run<T>(opts: SfRunOptions): Promise<SfResult<T>>; };
  orgs: {
    list(): Promise<OrgInfo[]>;
    getActive(): Promise<OrgInfo | undefined>;
    setActive(alias: string): Promise<void>;
    onDidChangeActive: vscode.Event<OrgInfo | undefined>;
  };
  tasks: { run(title: string, op: TaskOp): Promise<void>; };
}
```
- Returned from `activate()`. Consumers: `const core = ext.exports as SalesforceCoreApi`.
- `version` lets us evolve the API while it's "internal" and gate on it once public.
- Ship a `salesforce-core.d.ts` so dependent extensions get types (kept internal
  for now; published with docs at v1).

---

## 6. Extension manifest sketch (`package.json`)

- `name: "salesforce-core"`, `displayName: "SIID Salesforce Core"`.
- `activationEvents`: `onStartupFinished` (the engine should be ready before
  features activate) — revisit if startup cost matters.
- `contributes`:
  - `commands`: `salesforce-core.selectOrg`, `salesforce-core.refreshOrgs`,
    `salesforce-core.showOutput`, `salesforce-core.getApi` (debug).
  - `configuration`: `salesforce-core.cliPath`, `salesforce-core.trace`,
    `salesforce-core.orgListTtlSeconds`.
  - status bar contribution handled in code.
- Feature extensions later declare `"extensionDependencies": ["ConscendoTechInc.salesforce-core"]`.

---

## 7. Phase plan

### Phase 1 — Core engine (this doc)
1. Scaffold `extensions/salesforce-core/` (package.json, tsconfig, README, MIT headers).
2. Register tsconfig in [`build/gulpfile.extensions.js`](build/gulpfile.extensions.js#L30).
3. Implement `CliResolver`, `SfExecutor`, `Logger`.
4. Implement `OrgManager` + active-org status bar + `onDidChangeActiveOrg`.
5. Implement `TaskRunner`.
6. Expose `SalesforceCoreApi` via `exports`; add `salesforce-core.d.ts`.
7. Wire commands (selectOrg / refreshOrgs / showOutput).
8. Smoke test inside the running fork (Extension Dev Host).

**Phase 1 done = ** another extension can `getExtension('ConscendoTechInc.salesforce-core').exports`, list orgs, switch the active org, and run an arbitrary `sf` command with typed results — with zero raw `child_process` calls of its own.

### Phase 2 — Adopt the engine
- Refactor `sf-project-retriever` and `salesforce-setup` to consume the core
  (delete their private exec/org-lookup code). Proves the API is sufficient.

### Phase 3 — Feature layers (separate docs)
- Project scaffolding · Deploy/Retrieve UI · Org explorer + SOQL runner.

### Phase 4 — Public SDK
- Freeze API v1, version it, publish `salesforce-core.d.ts` + docs for third parties.

---

## 8. Risks & open questions

- **CLI startup latency** — acceptable for actions; enforce "no `sf` on hot paths"
  in review. Caching strategy lives entirely in the core so policy is central.
- **`sf` output schema drift across versions** — `CliResolver.requireMinVersion`
  pins a floor; `SfResult.raw` retained for debugging schema surprises.
- **Activation order** — feature extensions must not activate before core; rely on
  `extensionDependencies` + `onStartupFinished`.
- **Multi-root workspaces** — which workspace's `.sf/config.json` wins? Phase-1
  decision: active org is per-workspace-folder; default to folder of active
  editor, fall back to first folder. (Confirm before coding `OrgManager`.)
- **Security** — array-arg `spawn` (not string `exec`) to kill the injection risk
  present in the current `exec('sf … ${targetOrg}')` code.

---

## 9. Editor language support (Apex highlighting + IntelliSense) — HIGHLIGHTING DONE

**Status:** Highlighting **shipped** via `apex-language-basics` (grammars for
apex/apex-anon/soql + language-configuration). IntelliSense partially covered by
our own cache-driven completion/hover/definition (see §10); full Apex Language
Server (jorje) still deferred.

### Why this matters
Going CLI-only covered **org operations** (deploy/retrieve/test/query) but said
nothing about **editor language features**. Those are a separate axis:

- **Verified fact:** this source tree contains **no Apex grammar and no `apex`
  language registration** (the `latex` extension matches `.cls` only because that
  is also a LaTeX class-file extension). The Apex highlighting/IntelliSense seen
  in the running app today comes from the still-installed official **"Salesforce
  Services" (salesforcedx) 66.4.4** extension — *not* from anything in SIID.
- If the official extensions are removed for a pure-framework product, the IDE
  loses Apex/SOQL/Visualforce **syntax highlighting** and Apex **IntelliSense**.
- LWC HTML/JS highlighting already works via the built-in `html`/`javascript`
  extensions; only LWC-specific template directives are extra.

### Two pieces, very different cost
| Feature | Source | Cost to replace independently |
| --- | --- | --- |
| Syntax highlighting (Apex/SOQL/SOSL/Visualforce) | a **TextMate grammar** (static JSON) | **Cheap.** No CLI, no language server. |
| Completion, errors, go-to-def, hover, refactors | the **Apex Language Server** (Java + jorje compiler) | **Expensive.** Needs a bundled JDK/JRE + LSP client. |

### Planned approach (phased, when picked up)
1. **Highlighting (independent, do first):** add a small built-in extension
   (e.g. `apex-language-basics`) contributing `languages` + `grammars` for Apex,
   SOQL, SOSL and a language-configuration (brackets/comments/auto-close). Source
   grammar: `forcedotcom/apex-tmLanguage` (open source) — vendor the
   `.tmLanguage.json` files. Register it the same 3 ways as `siid-forge`
   (gulpfile `compilations`, `build/npm/dirs.js`, folder auto-discovery).
   This restores highlighting with zero dependency on official extensions or Java.
2. **IntelliSense (separate milestone, decide later):** options —
   - **a) Bundle the Apex Language Server** (`apex-jorje-lsp.jar` from salesforcedx)
     + a thin LSP client extension; requires a Java runtime shipped with SIID.
     Real completion/errors, fully independent, biggest effort.
   - **b) Hybrid:** keep *only* the official Apex extension for language
     intelligence while `siid-forge` owns all org/workflow features. Fastest, full
     IntelliSense, not fully independent.
   - **c) Minimal:** accept VS Code's built-in word-based suggestions; no rich
     Apex intelligence. Lightest.

### Open decision to revisit
Which IntelliSense path (a/b/c). Highlighting (step 1) can proceed any time and is
the recommended first move; it is independent of this decision.

---

## 10. Local schema cache (objects + Apex + LWC) — DONE (v1)

**Goal:** build and cache org/project schema as JSON under `.siid/schema/` to
power (a) lightweight autocomplete/validation, (b) an offline schema explorer,
and (c) structured context for AI/codegen — a stand-in for the Apex Language
Server while staying CLI-only.

### Storage layout
```
.siid/schema/
  meta.json              # last-refresh timestamps + org username
  objects/
    _index.json          # all org object API names (from `sf sobject list`)
    Account.json         # describe result (trimmed): fields, picklists, relationships
  apex/
    _index.json          # class names
    MyClass.json         # { name, methods[], properties[], annotations[] }
  lwc/
    _index.json          # component names
    myCmp.json           # { name, apiProperties[], targets[], isExposed }
```

### Sources (per the chosen scope)
| Schema | Source | Command / method |
| --- | --- | --- |
| Objects | **org** | `sf sobject list --json` (index) + `sf sobject describe --sobject X --json` (per object; describe project-local objects on refresh, others on demand) |
| Apex | **local** | parse `**/classes/*.cls` (regex: class/methods/properties/annotations) |
| Apex | org (later) | Tooling API `SELECT Name, SymbolTable FROM ApexClass` |
| LWC | **local** | parse `**/lwc/*/*.js` (`@api` props) + `*.js-meta.xml` (targets, isExposed) |
| LWC | org (later) | Tooling API `LightningComponentBundle` |

### Build order
1. `SchemaManager` core: storage paths, file walkers, `.siid/schema` IO.
2. Object schema from org (index + describe project objects + on-demand describe).
3. Apex schema from local `.cls` (heuristic parser, no Apex grammar).
4. LWC schema from local files.
5. Commands: Refresh All / Object / Apex / LWC + a **Schema Explorer** tree view.
6. (Later) org-side Apex/LWC via Tooling API; then consume the cache for
   completion/hover providers and AI context.

### Notes / decisions
- Describing **all** org objects is expensive (hundreds of CLI calls); refresh
  describes **project-local** objects by default and supports on-demand describe
  for any named object. A "describe all" can be added behind a warning later.
- Parsers are heuristic (regex), consistent with the basic Apex grammar; they get
  better when the official grammar / a real parser lands.
- The cache is the seam consumers (completion providers, AI) read — same
  "one engine, many consumers" principle as the rest of Forge.

---

## 11. Apex Replay Debugger (own) — DONE (v1)

**Goal:** a SIID-native Apex replay debugger that steps through a captured debug
log — no dependency on Salesforce's apex-replay-debugger or the jorje LSP.

### How it works
1. **Debug flag (full levels):** reuse `TraceManager`'s `SIIDForge` DebugLevel
   (ApexCode=FINEST etc.) + TraceFlag, cached in `.siid/forge.json`. FINEST Apex
   logging is what emits `STATEMENT_EXECUTE`, `VARIABLE_ASSIGNMENT`,
   `METHOD_ENTRY/EXIT` — the events replay needs.
2. **Capture:** runs (test / anonymous Apex) already save the log to `.siid/logs/`.
3. **Parse:** `logParser` converts a raw log into an ordered timeline of steps:
   `{ line, file, frames[], locals[] }`, by walking METHOD_ENTRY/EXIT (call
   stack), STATEMENT_EXECUTE (line steps), VARIABLE_ASSIGNMENT (variable state),
   USER_DEBUG (output). Class → file resolved via the apex schema cache.
4. **Replay adapter:** an **inline** VS Code Debug Adapter (no `@vscode/debugadapter`
   dependency) that drives the timeline — breakpoints (stop at matching line),
   continue, step over/into/out (by frame depth), `stackTrace`, `scopes`,
   `variables`, threads, stopped/terminated events.
5. **Launch:** a `Replay Apex Log` command (pick a `.siid/logs/*.log`), and the
   existing **Debug Test / Debug (anon)** buttons start a replay on the log they
   just produced (the `debug` flag we already plumbed).

### Notes / scope
- Replay is **post-mortem**: it steps through what already executed (like
  Salesforce's replay debugger), not live breakpoints in the org.
- v1 covers line stepping, call stack, and variable values from
  VARIABLE_ASSIGNMENT; complex value expansion (nested objects/collections) and
  heap dumps are later refinements.
- Dependency-free inline DAP keeps the product self-contained.

---

## 12. Appendix — key `sf` commands the core wraps

| Capability | Command |
| --- | --- |
| CLI version | `sf --version --json` |
| List orgs | `sf org list --json` |
| Org details (+ apiVersion) | `sf org display --target-org <a> --json` |
| List metadata of a type | `sf org list metadata --metadata-type <T> --target-org <a> --json` |
| Deploy | `sf project deploy start … --json` |
| Retrieve | `sf project retrieve start --manifest <p> --target-org <a> --json` |
| Run SOQL | `sf data query --query "<soql>" --target-org <a> --json` |
| Run Apex tests | `sf apex run test … --json` |
| Login (web) | `sf org login web --json` |

---

## 13. Next up — roadmap (2026-06-15)

Ordered by value/effort. Pick the next slice from here.

### A. Method parameter validation + signature help  *(small–medium)*
The AuraEnabled map and apex cache already store each method's `signature`
(raw Apex declaration). To validate calls we need to **parse the parameter list**
out of that string (`(Id accountId, String industry)` → `[{type:'Id',name},…]`).

- **13.A.1 Parse params** into `ApexMember.params[]` in `schemaManager.parseApex`
  (and the AuraEnabled map). Store `{name, type}`.
- **13.A.2 Signature help** (`SignatureHelpProvider`) for Apex — inside `name(` show
  the parameter list and highlight the active arg (trigger `(` `,`).
- **13.A.3 LWC signature help** for imported AuraEnabled methods (so `getAccount(`
  shows `(Id accountId)`).
- **13.A.4 (optional) Diagnostics** — flag wrong **arg count** for calls to known
  custom methods. Type-checking args is out of scope (no real type system).

### B. LWC ↔ Apex navigation  *(small)*
Go-to-definition from a `@salesforce/apex/Class.method` import (and its call sites)
into the Apex method, using the AuraEnabled map's `filePath` + `line`.

### C. SDK extraction  *(medium)* — Phase 4 of the original plan
Split `siid-forge` into a thin `core` extension exposing `SfExecutor`/`OrgManager`/
`SchemaManager` via `exports` + a `.d.ts`, with features consuming it. Do this once
the surface has settled.

### D. Org-side schema (Tooling API)  *(medium)*
Populate apex/lwc cache from the org (`SymbolTable`, `LightningComponentBundle`) so
completion/nav work for classes not present locally.

### E. Replay debugger v2  *(medium)*
Nested value expansion (collections/objects), watch expressions, conditional
breakpoints, better anon-Apex story (within the DEBUG-level CLI limit).

### F. StandardApexLibrary mapping  *(blocked)*
System.* class/method completion from the jar (user-driven; proprietary content
not shippable by us).

### G. Native top-level "Forge" menubar menu  *(core IDE change, later)*
Extensions can't contribute top-level menubar menus, so a real **Forge** menu in
the app menu bar requires editing the fork's core (`src/vs/platform/menubar/
electron-main/menubar.ts` — `shouldDrawMenu('Forge')` + `setMenuById(forgeMenu,
'Forge')`) and populating the `'Forge'` menu id with our commands. A draft of the
menubar registration was prototyped then **reverted** (2026-06-15) because it
rendered an empty menu — nothing populated the `'Forge'` id yet. To pick up:
(1) re-add the menubar block, (2) define the `'Forge'` menu contents (run/debug
tests, deploy/retrieve, org, scaffolding), (3) keep the Activity Bar Forge panel
as the primary surface regardless. Until then, the Activity Bar panel + context
menus + command palette are the entry points.

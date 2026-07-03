# SIID Salesforce Framework — Core Engine Implementation Plan

> **Status:** Active — core + many features shipped (see Build Status below)
> **Scope of this doc:** originally the **core engine**; now also tracks the
> feature layers that have been built on top of it.
> **Last updated:** 2026-07-02
> **Extension folder:** `extensions/siid-forge/` (publisher `ConscendoTechInc`).
> Note: this doc's older sections say `salesforce-core`; the shipped extension is
> **`siid-forge`** — same architecture, different name.

---

## 0. Build Status (2026-07-03)

The extension **`siid-forge`** is live as a built-in in the SIID fork. It is a
single extension (not yet split core/features) but follows the "one engine, many
consumers" structure internally: thin core under `src/core/`, features under
`src/features/`, each registered from `extension.ts`.

> **Planned (not built):** §19 — multi-org deploy/retrieve + cross-org diff
> (primary + secondaries, title-bar switcher, `Deploy/Retrieve to Org…`, diff-engine
> fidelity for bundles/XML). Recorded 2026-07-03; decisions locked, coding not started.

### Core (`src/core/`)
| Module | Status | Notes |
| --- | --- | --- |
| `sfExecutor` | ✅ | Runs `sf … --json` via `exec` + shell-quoting, JSON envelope parsing, typed errors, cancellation, `acceptNonZeroStatus`, secret env (`SF_ACCESS_TOKEN` never logged), **real-time lifecycle status** (per-call `onStatus` + global `onDidChangeActivity`). |
| `orgManager` | ✅ | Default org, username, **User Id** (queried + session-cached), authorize (web + **session-id/access-token**), select, org-change events. **Cached** org list (TTL) + default org (resolved from `.sf`→`.sfdx`→`.siid` mirror→CLI, no `sf` on every call), resilient when CLI config folders absent. |
| `cliManager` | ✅ | Version check + update guidance. |
| `traceManager` | ✅ | `SIIDForge` DebugLevel (FINEST) + TraceFlag, cached in `.siid/forge.json`; DebugLevel id cached to skip re-query/update. |
| `schemaManager` | ✅ | Local cache under `.siid/schema/` — objects (org describe), apex (local `.cls` parse), lwc, **AuraEnabled map** (`lwc/_apexMethods.json`). |
| `coverageStore` | ✅ | Per-class coverage (`covered`/`uncovered` lines) in `.siid/test-results/coverage.json`. |
| `apexLogs` | ✅ | Saves run logs to `.siid/logs/`, filtered to the current run, `limit` for debug. |
| `replay/logParser` | ✅ | Raw Apex log → replay timeline (statements, method-entry call sites, variables, debug/SOQL/DML/exception events); header parse (api/FINEST). |
| `replay/replayAdapter` | ✅ | Inline DAP: breakpoints (verified against executed lines), continue, step over/into/out (skips external frames), stack, variables. |
| `logger`, `forgeConfig`, `workspace` | ✅ | Output channel, `.siid/forge.json` IO, cwd helpers. |
| Public SDK `exports` / `.d.ts` | ◐ | **API surface shipped** (`api.ts` → `SiidForgeApi` v2.1.0, hand-authored `siid-forge.d.ts`, compile-time conformance guard, `CONSUMING.md`); still inside the single extension — physical core split deferred. See §C. |

### Features (`src/features/`)
| Feature | Status |
| --- | --- |
| Version check / update CLI | ✅ |
| Create project / apex class / **test class** / trigger / aura / LWC | ✅ |
| Deploy / retrieve / delete source (explorer + editor context) | ✅ |
| Org status bar + authorize (prod/sandbox + **session-id/access-token**) + select + open org | ✅ |
| **Global CLI activity status bar** (meaningful action label + elapsed, subscribes to executor `onDidChangeActivity`) | ✅ |
| **AI Apex test generation** (context-driven, coverage loop, live panel, **batch** multi-class queue) | ✅ |
| **AI LWC test generation** (independent OpenRouter path + live panel) | ✅ |
| **Coverage decorations update from AI test panels** (like "Run All Tests") | ✅ |
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
- **SDK API shipped but not physically extracted** — `SiidForgeApi` (v2.1.0) is
  live on `extension.exports`, but still inside the one `siid-forge` extension
  (no separate thin `core` ext + `extensionDependencies` yet). See §C.

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

### A. Method parameter validation + signature help  ✅ DONE (2026-06-15)
- **13.A.1 Parse params** → `ApexMember.params[]` + `AuraEnabledMethod.params[]`
  in `schemaManager` (handles multi-line lists + generics with inner commas). ✅
- **13.A.2 Signature help** for Apex (`signatureHelp.ts`). ✅
- **13.A.3 LWC signature help** for imported AuraEnabled methods. ✅
- **13.A.4 Diagnostics** (`paramDiagnostics.ts`): Apex flags wrong **arg count**;
  LWC validates the **named config object** keys (imperative `method({…})` and
  `@wire(method, {…})`) against parameter NAMES — unknown keys warn, missing keys
  note. Unknown methods ignored (no false positives on platform APIs). ✅

### B. LWC ↔ Apex navigation  *(small)*
Go-to-definition from a `@salesforce/apex/Class.method` import (and its call sites)
into the Apex method, using the AuraEnabled map's `filePath` + `line`.

### C. SDK extraction  *(medium)* — Phase 4 of the original plan
◐ **Public API surface DONE (2026-07-01, extended 2026-07-02)** — `activate()`
returns a `SiidForgeApi` (`src/api.ts`), the versioned SDK other extensions bind
to via `extension.exports` / `await ext.activate()` (mirrors the
`firebase-service` `api.ts` + `getApi` command pattern). Namespaced, all headless
+ structured (§14): `cli`, `sf.run`, `orgs`, `schema` (read objects/apex, describe
on demand), `coverage.get`, and `apexTests` (run / scaffold / collectContext /
buildPrompt / generate). A shippable hand-authored `siid-forge.d.ts` (self-
contained, no internal imports) gives consumers types; `src/apiConformance.ts` is
a compile-time guard that fails the build if the runtime class drifts from the
`.d.ts`. `getApi` command exposes it via `executeCommand` too. `CONSUMING.md`
documents the API + commands for consumers. Verified end-to-end.
**Version history:** `1.1.0` `sf.run` real-time `onStatus` lifecycle callbacks ·
`1.2.0` `orgs.authorizeWithToken` (session-id/access-token login, token via env) ·
`2.0.0` `ApexStaticContext.triggers` now `RelatedTrigger[]` (was `string[]`) ·
`2.1.0` `orgs.list(force?)` cached (TTL), `force` bypasses.
**Still deferred:** the *physical* split into a separate thin `core` extension +
`extensionDependencies` (the current API lives inside the one `siid-forge`
extension); LWC-test + refactor/deploy/soql surfaces on the API; publishing the
`.d.ts` with docs at a frozen v1.

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

---

## 14. Design principle: every feature is agent-consumable

SIID ships an **AI agent**. The framework's job is to give the user fast,
deterministic **basic primitives that work WITHOUT AI** — *and* to let the AI
agent invoke those exact same primitives through its tools. Same engine, three
consumers: **the human (UI), the AI agent (tools), and (later) third-party
extensions (SDK).**

### The rule
> A feature's real work lives in a **headless service** (a function/class that
> takes inputs and returns data). The UI (CodeLens, menu, command, status bar) is
> a **thin wrapper** over that service. The AI agent calls the same service. No
> feature may bury its logic inside a UI/event handler where only a human click
> can reach it.

### What "agent-consumable" requires of each feature
1. **A callable entry point that returns a value**, not just side-effects/toasts.
   - e.g. `runApexTests(opts) → TestRunResult`, `runSoql(query) → Records`,
     `getCoverage(class) → Coverage`, `describeObject(name) → ObjectSchema`,
     `deploy(paths) → DeployResult`, `validateParams(file) → Diagnostic[]`.
2. **Structured results** (typed objects / JSON), reusing the schema + result
   types we already have — never "parse my toast text".
3. **No mandatory UI**: the service must run with no editor/selection context
   (take explicit args); the UI supplies args from context, the agent supplies
   them directly.
4. **Idempotent + cancellable** where it does I/O (pass a token), consistent with
   `SfExecutor`.

### How it gets exposed to the agent
- **Now (interim):** features already register `vscode.commands`. Make every
  command **return its structured result** (commands can resolve a value via
  `executeCommand`), and ensure the underlying service is separable from the
  handler. The agent's tool layer can call commands and read returns.
- **Later (Phase 4 / §C):** the SDK extraction surfaces the services directly on
  `extension.exports` (`sf`, `orgs`, `schema`, `tests`, `coverage`, `deploy`,
  `soql`, …) with a `.d.ts`. The agent tool layer binds to that API. This is the
  cleanest contract and the long-term target.

### Audit / refactor checklist (apply as we touch features)
- [ ] Logic extracted into a service callable without an editor/selection.
- [ ] Returns structured data (not void / not only a toast).
- [ ] Command handler is a thin adapter (gather args from UI → call service →
      present result).
- [ ] Result type is shared (lives in `core/` or a `types` module), reusable by
      the agent and the SDK.

> Practical note: we don't need to refactor everything at once. **New** features
> follow this from the start; **existing** ones get split (service vs. UI) when we
> next touch them, and definitively during the SDK extraction (§C).

---

## 15. Feature backlog — "basic needs" (no-AI primitives)

User experience features that should work **without** the AI agent, while also
being exposed as services the agent can call (per §14). Ordered by value/effort.

### Tier 1 — fills daily-workflow gaps (do first)
| # | Feature | Why it matters | Effort | Reuses | Service / return |
| --- | --- | --- | --- | --- | --- |
| 15.1 | **Diff before deploy/retrieve** ✅ DONE (2026-06-19) | See local↔org changes before overwriting — prevents clobbering others' work. | M | SfExecutor, deploy | `collectDeployFiles(target)`, `computeDeployDiff(sf, files, cwd) → DiffEntry[]` |
| 15.2 | **Org Browser / metadata tree** | Browse org metadata and retrieve any item with one click — no hand-written manifest. | M | SfExecutor, retrieveMetadata, schema tree | `listMetadata(type) → MetadataItem[]`, `retrieve(items)` |
| 15.3 | **SOQL results grid + CSV export** | Today output is text; a sortable table + export is a constant need. | M | soql runner | `runSoql(query) → {columns,rows}` |
| 15.4 | **SObject field hover quick-info** | Hover a field in Apex/SOQL → label, type, picklist values, required. Pure cache read. | S | schema cache, navigation | `describeField(obj,field) → FieldSchema` |

### Tier 2 — compounding polish
| # | Feature | Why | Effort |
| --- | --- | --- | --- |
| 15.5 | **Apex/LWC snippets** (@AuraEnabled method, test method, @wire, batch/queueable) | zero-AI scaffolding while typing | S |
| 15.6 | **"Run selection as SOQL / anon Apex" CodeLens** | quick experimentation in-editor | S |
| 15.7 | **Org switcher in status bar + recent orgs** ◐ status-bar actions DONE (open/switch/authorize incl. **session-id**), **org list + default cached** (instant, no `sf` per click), resilient w/o `.sf`/`.sfdx`; "recent orgs" pending | faster than the command each time | S |
| 15.8 | **Deploy/retrieve on save** (opt-in per project) | auto-push the file just saved | S |

### Tier 3 — bigger / more "platform"
| # | Feature | Why | Effort |
| --- | --- | --- | --- |
| 15.9 | **FLS / permission viewer** for an object | see field-level security & perms at a glance | M |
| 15.10 | **Log analyzer** (governor limits, SOQL/DML counts, slowest methods) | beyond replay: triage a log fast | M |
| 15.11 | **Anonymous Apex scratchpad + history** | iterate on snippets without losing them | S |

### 15.1 — how it shipped (notes)
- **Diff source via Tooling API**, not retrieve. `--target-metadata-dir` writes an
  un-extracted `unpackaged.zip`; `--output-dir` must be inside the project. So the
  org body is fetched per Apex type via `SELECT Body/Markup FROM <type>` — fast,
  no zip, no path constraint. (LWC/Aura bundles have no single source field →
  deploy/retrieve without a per-file diff for now; future: retrieve + unzip.)
- **Symmetric for deploy AND retrieve** (`features/diffReview.ts` shared UI):
  deploy guards the org, retrieve guards local.
- **3-way conflict resolution** (modal): **Keep Org / Keep Local / Fix Conflict**.
  - deploy: Keep Local→deploy; Keep Org→pull org into local, no deploy; Fix→edit
    local in the (editable) diff, re-run.
  - retrieve: Keep Org→retrieve; Keep Local→skip; Fix→edit & re-run.
  No fake auto-merge — the local diff pane is editable and the user reconciles there.

**Recommended next slice:** 15.4 (field hover quick-info — smallest, pure-cache,
daily value). Other strong options: 15.3 (SOQL grid + CSV), 15.10 (log analyzer).

---

## 16. "AI-IDE-level" big features (deterministic, no AI required)

Ambitious, deep-platform features that feel magical but are fully deterministic —
they reuse infra we already have (schema cache, Tooling API, logs, replay,
diff). The AI agent can also drive each via its service (per §14).

### 16.A Org-aware refactor / codemod  — **IN PROGRESS (next)**
Project-wide, schema-aware edits with org knowledge, no AI:
- **Rename** an Apex method / field / class and update all references across
  `.cls`/`.trigger`/LWC `.js`+`.html`/tests, with a preview + apply.
- **Find unused** `@AuraEnabled` methods (no LWC/Aura reference).
- **Flag SOQL on non-existent fields** (validate query fields against the object
  schema cache).
Reuses: `schemaManager` (apex/object/aura cache), navigation/completion ref
logic, diagnostics, `diffReview` for preview. Service: `findReferences(symbol) →
Ref[]`, `renameSymbol(symbol, newName) → WorkspaceEdit`.

### 16.B Live org ⇄ editor sync + presence  — backlog
Poll `LastModifiedBy`/`LastModifiedDate` (Tooling API) for open files; show a
gutter/status badge "changed in org by X 2m ago" with one-click diff/pull. Turns
the diff infra into real-time "someone is editing this" awareness.
Reuses: `deployDiff`, Tooling API, status bar.

### 16.C Time-travel log debugger++  — backlog
Supercharge the replay debugger: timeline scrubber, per-line SOQL/DML/CPU cost
heatmap in the gutter, a governor-limit gauge that fills as you step, and
"jump to the line that threw". Makes a raw debug log a flight recorder.
Reuses: `logParser`, `replayAdapter`, coverage decorations.

### 16.D Instant scratch-run console (Apex/SOQL REPL)  — backlog
A REPL panel: type Apex or SOQL, run on the org instantly, see results + debug
log + governor limits inline, with history. A Jupyter-cell for Salesforce.
Reuses: `anonApex`, `soql`, `apexLogs`, `logParser`.

## 17. LWC testing automation
Jest-based (`@salesforce/sfdx-lwc-jest`) — runs via npm/node, NOT the `sf` CLI.
Three layers, building on each other:

### 17.B Scaffold test files ✅ (built)
`core/lwcTestScaffold.ts` — headless + agent-consumable: `scaffoldLwcTest(jsPath)`
analyses a component's JS (`@api` props incl. accessor pairs, `@wire` adapters,
dispatched `CustomEvent`s) → emits a ready-to-run Jest skeleton in canonical
`sfdx-lwc-jest` style (createElement + DOM cleanup + @api setup stubs + render
assertion + an event-dispatch test per detected event; @wire note when present).
`features/lwcTest.ts` = command `scaffoldLwcTest` (LWC folder/`.js`/`.html`
context menu + palette + Forge menu); overwrite-guarded; opens the file.

### 17.A Run/report Jest in IDE ✅ (built)
`core/lwcTestRunner.ts` — headless + agent-consumable: `runJest(root, opts)` runs
`npx sfdx-lwc-jest -- --json --testLocationInResults` (optionally one file / one
`-t` name), parses Jest's JSON into per-file/per-assertion pass/fail + line.
`depsInstalled(root)` guards a missing `node_modules`.
`features/lwcTestRun.ts` — CodeLens "Run All" / "Run Test" above each
`describe`/`it`/`test` in an LWC `*.test.js`; runs via the runner; failures shown
as inline diagnostics + a result toast; offers `npm install` (in a terminal) when
deps are missing. Verified end-to-end (pass, fail, deps-missing) on the test org.
TODO later: run-on-save/watch + coverage decorations.

### 17.D Mock scaffolding (wire/LDS/toast/empApi/LMS/navigation) ✅ (built)
`core/lwcMockScaffold.ts` — headless: `analyzeMocks(js)` detects the Salesforce
modules a component imports that need an EXPLICIT mock to be testable (sfdx-lwc-jest
auto-stubs `lightning/*` so components load, but the stubs are inert). Produces
ready-to-use jest setup blocks + per-module AI guidance for: `platformShowToastEvent`
(capturable ShowToastEvent), `empApi`, LDS wire (getRecord/getObjectInfo/…) via
`registerLdsTestWireAdapter`, Apex `@wire` via `registerApexTestWireAdapter`,
`messageService` (LMS), and `NavigationMixin`. Injected into the B scaffold and
the C prompt. Verified: a toast+empApi component's scaffold now loads & passes.
TODO later: auto-generate `__tests__/data/*.json` fixtures for wire emit.

### 17.C AI-generated test bodies ✅ (built)
Forge does the deterministic prep + a hardened prompt; an LLM writes the
assertions. The prompt (`core/lwcTestContext.ts`, `buildLwcTestPrompt`) gathers
the bundle (points the agent at JS/HTML/meta BY PATH), the parsed public surface
(@api/@wire/events + imported `@salesforce/apex/*`), the detected mocks (17.D),
and assembles rigid rules learned from real failures:
- TASK-TYPE banner so it's treated as test-writing, not create-lwc/deploy;
- conditional/async rendering: resolve mocks + `await flushPromises()` before
  asserting load-gated DOM (the #1 failure);
- promise-returning mocks MANDATORY (the `.then` of undefined crash);
- no calling non-@api methods / setting non-@api state; events via real child
  DOM events; keep the scaffold's mocks;
- an exhaustive interaction-COVER section (button clicks, input/change, async
  success+failure, conditional UI) + a final "run sfdx-lwc-jest and pass" step.

Two delivery paths:
- **Independent (preferred, reliable) → see 17.E.**
- **Agent fallback** (`core/aiAgent.ts`): when no OpenRouter key is set,
  `handToAgent(text)` hands the prompt to the SIID-Code agent (a separate
  Roo-Cline-fork extension `ConscendoTechInc.siid-code`, NOT `vscode.lm`) via its
  exported `startNewTask({ text })`, falling back to `newTask`/clipboard.
  See memory `siid-code-agent-integration`.

### 17.E Independent AI generation (OpenRouter) + live webview ✅ (built)
The agent handoff proved unreliable (misrouting, ignored rules, failing tests).
SIID-Code's OpenRouter key lives in encrypted per-extension SecretStorage and
can't be read, so Forge keeps its OWN key and calls the LLM directly.
- `core/openRouterClient.ts` — minimal OpenAI-compatible chat over Node `https`.
- `core/aiConfig.ts` — Forge's own key in SecretStorage (env/setting/secret
  resolution) + configurable model; `Set OpenRouter API Key` command + settings.
- `core/lwcTestGenerator.ts` — the reliable loop: build prompt → call LLM →
  write test → run `sfdx-lwc-jest` → feed concrete failures back for bounded
  self-correction. Keeps the BEST attempt (most passing / fewest failing) and
  restores it so a worse retry never overwrites working tests; flags regressions;
  detects the `.then`-of-undefined crash. **Resumable conversation** for user
  feedback / "add more tests".
- `features/lwcTestAiPanel.ts` — live webview: streams each attempt
  (generating → running → pass/fail + failing tests) with an editable model
  picker, Set/Change Key, Regenerate, Retry failed, Add more tests, a free-text
  **Feedback box** (human-in-the-loop), Open test, and Stop (AbortController).
- `features/lwcTestAi.ts` — `generateLwcTestAi` opens the panel when a key is set,
  else falls back to the agent handoff (17.C).
TODO later: `--coverage`-driven completeness loop; `__tests__/data/*.json`
fixtures for wire emit; run-on-save/watch + coverage decorations (17.A).

---

## 18. Apex testing automation — PLAN (2026-06-30)

The Apex analogue of §17. The key difference from LWC: the **run + report** layer
is already mature for Apex (real org execution, code coverage with uncovered-line
ranges, FINEST replay logs), so the new work is the **AI-generation** layers, and
they get a *better* feedback signal than LWC ever had — real coverage numbers, not
just pass/fail. Runs via the **`sf` CLI** (org transactions), NOT npm/node.

### What already exists (do NOT rebuild)
| LWC layer | Apex equivalent today | Status |
| --- | --- | --- |
| A — run/report (`lwcTestRunner`) | `apexTest.ts` (`runApexTests`): `sf apex run test --code-coverage`, parses tests + coverage, MD report, replay-debug, coverage CodeLens/decorations | ✅ **more mature than LWC's** |
| B — scaffold (`lwcTestScaffold`) | `testClass.ts` (`createTestClass`): emits a **fixed** `<Class>Test` skeleton (TODO stubs) — does NOT analyse the class under test | ◐ exists but "dumb" |
| D — mock scaffold | — | ❌ none |
| C — AI prompt/context | — | ❌ none |
| E — independent AI gen + panel | — | ❌ none |

Reusable infra already in place: `schemaManager` (parsed `ApexMember[]` —
methods, params, return types, annotations — same role `@api`/`@wire` played for
LWC), **`dependencyFinder.findDependencies`** (already classifies every referenced
class / SObject / field in the class source — the dependency graph for context
collection, NOT a new parser), `coverageStore` (covered/uncovered lines per class),
**`replay/logParser`** (raw FINEST log → exception/stack/flow/limit events, reused
for failure feedback), `openRouterClient` + `aiConfig` (Forge's own key),
`lwcTestGenerator`'s best-attempt loop pattern, `aiAgent` fallback, `sfExecutor`.

### Build order (B′ → A′ → X → D′ → C′ → E′, mirroring §17 + a context module)
The new piece vs. LWC is **18.X (context collector)** — Apex tests fail mostly on
*missing context* (required fields, flows, related classes), so context is its own
module that both the prompt and the fix loop consume.

#### 18.B Smart scaffold — `core/apexTestScaffold.ts` ✅ DONE (2026-06-30)
Built `core/apexTestScaffold.ts` (headless, agent-consumable) + `features/
apexTestScaffold.ts` (command `scaffoldApexTest`, "Scaffold Apex Test (smart)" —
new file, kept `createTestClass` as the plain template). Wired: command id, menu
action, package.json command + palette + `.cls` context menus, `extension.ts`.
Reads `schema.readApex` (or a fallback `.cls` parse when not cached) → emits one
`@isTest` per public/global method, `@TestSetup`, the right async harness
(Batchable/Queueable/Schedulable). **Validated end-to-end against the live org**
(`sf project deploy --dry-run`) — generated tests COMPILE. Lessons baked in from
real org failures:
- **constructor args** — instance-method tests call `new Class(<ctor args>)`, not
  `new Class()` (detect the constructor, use its params); fallback parser captures
  constructors (the method regex misses them — no return type).
- **inner types** — a method returning a nested type (`AccountSummary`) must be
  qualified `Class.AccountSummary` (not visible at the test's top level) —
  `qualifyType` rewrites bare + generic inner refs.
- **`Id` placeholder = `null`**, not `''` (a blank string literal is invalid for Id).
Remaining for 18.B polish (later): seed `@TestSetup` from object schema (needs
18.X); detect callout/`runAs` patterns (18.D).
**IDE smoke-test deferred (batched):** the scaffolding LOGIC is org-verified
(dry-run compile). The thin UI wrapper (command reg, `.cls` context-menu `when`,
overwrite dialog, Forge-menu entry — copied from the proven `scaffoldLwcTest`)
is verified by launching the Extension Dev Host ONCE together with 18.A/18.X, so
we click scaffold → run → AI-generate in a single pass rather than launching the
fork per feature.

<details><summary>Original 18.B spec</summary>

Upgrade B from a fixed template to a **class-aware** one. `scaffoldApexTest(clsPath)`
reads the parsed `ApexSchema` (or parses if not cached) and emits a real skeleton:
- one `@isTest static void` per public/global method of the class under test;
- `@TestSetup makeData()` seeded from the SObjects the method touches (best-effort
  from the schema cache — referenced objects/required fields);
- `Test.startTest()/stopTest()` wrapping the call, an `Assert.*` placeholder per
  method, and a `// TODO` for inputs derived from each method's `params[]`;
- if the class is a controller (`@AuraEnabled`), note the calling pattern;
  if it implements `Batchable`/`Queueable`/`Schedulable`, emit the right harness
  (`Test.startTest()` + `Database.executeBatch` / `System.enqueueJob` / `schedule`).
Headless + agent-consumable (§14): returns the source string; the command writes it.
`features/apexTest.ts` (or a new `apexTestScaffold.ts` feature) wires a CodeLens /
context-menu / Forge-menu entry on `.cls` files. Overwrite-guarded.

</details>

#### 18.A Run/report — ✅ DONE (2026-06-30)
The headless service is split out. New `core/apexTestRunner.ts` holds
`runApexTestClass(sf, orgs, trace, logger, root, className, opts) →
ApexTestRunOutcome` — resolves the org, optionally arms the FINEST trace, runs
`sf apex run test --code-coverage`, writes the MD report + persists coverage +
(debug) FINEST logs, and RETURNS structured `{ result, reportPath, logFiles,
classCoverage, passing, failing, testsRan }` (no toast parsing). The report /
coverage / uncovered-range helpers moved here too. `features/apexTest.ts` is now a
thin adapter: it calls the service inside `withProgress`, then does the UI
(coverage CodeLens refresh, result toast, replay-debug launch). CodeLens providers
+ `showOutcome` stay in the feature. The §18.E generator will call
`runApexTestClass` directly and read `classCoverage` + failures for its loop.
Type-checks clean; behaviour preserved (same CLI args + parse).

#### 18.D / 18.C / 18.E — ✅ ALL DONE (2026-06-30)
- **18.D** `core/apexTestPatterns.ts` — `analyzeApexTestNeeds(source, touchedObjects)
  → {patterns[], hasCallouts, hasDml}`. Detects (source-driven) the isolation/data
  patterns a test must implement: @TestSetup required-field factory, start/stopTest
  boundary, `Test.setMock` for Http/WebService callouts, `System.runAs` (UserInfo/
  sharing/CRUD-FLS), async harnesses (@future/Queueable/Batch/Schedulable), a
  negative/exception test, and the no-seeAllData rule. Each carries ready-to-paste
  guidance + snippet. Injected into the 18.C prompt.
- **18.C** `buildApexTestPrompt(ctx, coverageTarget, failure?)` in `apexTestContext.ts`
  — TASK-TYPE banner (don't modify prod class / don't deploy-as-creation), the class
  source inline, related-class signatures, per-object REQUIRED fields, active flows +
  triggers, the 18.D patterns, rigid rules (inner-type qualification, start/stopTest,
  Assert.*, bulk/negative, mocks, ≥target coverage), and on retry the failure context.
  Verified on `AccountCardController`: emits `Account required: Name`, detected runAs +
  negative-test patterns, inner-type rule — exactly the deterministic context that
  makes generated tests pass.
- **18.E** `core/apexTestGenerator.ts` = `generateApexTest(opts) → ApexGenerateResult`
  (coverage-driven loop: prompt → LLM → write → **deploy ONLY the test class** → run →
  feed back failures + uncovered lines + parsed log → keep BEST attempt; success = all
  pass AND coverage ≥ 75). **GUARDRAIL verified:** `getOrgKind` queries the
  authoritative `Organization` object (`sf org display` returns nulls on Dev Edition!)
  → Dev/sandbox/scratch allowed, real Enterprise/Unlimited **blocked** as production;
  only the test class is ever deployed (main class never touched). `features/
  apexTestAiPanel.ts` = live webview (generating→deploying→running→pass/fail + coverage,
  model picker, Regenerate/Retry/Cover-more/Feedback/Stop); `features/apexTestAi.ts` =
  `generateApexTestAi` command (panel if key set, else SIID-Code agent handoff).
  Wired: command id + menu action + package.json (command/palette/`.cls` menus) +
  extension.ts. **Validated against a live LLM** on real-world classes
  (`OpportunityRegionPricebookHandler`), which drove context-engine hardening
  (2026-07-01/02): fixed `stripCodeFence` (any language fence, not just js) so
  Apex fences stop corrupting `.cls`; `getOrgKind` queries the `Organization`
  object (not `sf org display`, which returns nulls on Dev Edition) to classify
  prod vs sandbox; `__mdt`/`__e` marked NOT insertable; noise-field trimming
  (permission booleans, field cap) shrank a 35k prompt to ~11k; SOQL object
  collection restricted to bracketed `[SELECT … FROM X]` (strips prose); regression
  detection protects a passing `@TestSetup` on retries; **transitive-trigger
  awareness** (`impliedSetupObjects` + `RelatedTrigger[]` with handler classes +
  `viaSetup`) so a Product2 insert that cascades into a Pricebook query is set up
  correctly; token/credit usage surfaced per attempt.
  **Batch generation ✅** — `core/apexTestBatch.ts` + `features/apexTestBatchPanel.ts`:
  multi-select QuickPick of classes → sequential queue panel.
  **Coverage decorations from AI panels ✅** — the Apex/LWC AI panels now refresh
  in-file coverage decorations + CodeLens after a run, same as "Run All Tests".
  **Real-time CLI status ✅** — the generator/runner forward `onStatus` elapsed to
  their panels; headless/agent callers don't subscribe, so command output/context
  stays clean.

<details><summary>Original 18.D spec</summary>

Apex has no Jest mocks; the analogues are **test-data + isolation patterns** the
generator must get right (the source of most real Apex test failures):
- **`@TestSetup` + a TestDataFactory** for required fields / lookups (read from the
  object schema cache) — the #1 cause of `REQUIRED_FIELD_MISSING`/insert failures;
- **`Test.startTest()/stopTest()`** boundary (fresh governor limits; forces async
  — `@future`/Queueable/Batch — to run);
- **`Test.setMock`** for `HttpCalloutMock` / `WebServiceMock` when the class does
  callouts (detect `HttpRequest`/`Http`/`@future(callout=true)` in source);
- **`System.runAs`** when the class checks CRUD/FLS or `UserInfo`;
- **`Test.loadData`/`Test.getStandardPricebookId`** notes where relevant.
`analyzeApexTestNeeds(source, schema) → {patterns[], guidance[]}` — injected into
both the 18.B scaffold and the 18.C prompt, same as `analyzeMocks` was for LWC.

#### 18.X Context collector — `core/apexTestContext.ts` ✅ DONE (2026-06-30)
Built + validated against the live test project. Exposes two headless entry points:
- **`collectApexTestContext(sf, schema, root, className, token) → ApexStaticContext`**
  — scans the class source for referenced type names (`new X`, `X.member`, `X var`,
  generics) + SOQL `FROM` objects, resolves each against the schema-cache indexes
  (`apexClassNames`/`listObjects`), then pulls: **related-class public signatures**
  (`readApex`), **touched-object field schemas** (`readObject`, required-first;
  re-describes stub/empty cache entries on demand), **active Flows** on those
  objects (Tooling API `FlowDefinitionView WHERE IsActive AND TriggerObjectOrEvent
  IN (…)`, best-effort), and **triggers** (local `.trigger` `on <Object>`).
- **`collectFailureContext(logPath) → FailureContext`** — reuses `parseApexLog` to
  extract the compact failure view for the fix loop: the exception/FATAL message,
  the **call stack** (user frames, outermost→innermost w/ lines), **nearby
  high-signal events** (DML/SOQL/FLOW_/LIMIT/REQUIRED_FIELD/exception in a window),
  and the **failing line**.
Verified: `AccountCardController` → resolved `Account` (req: Name) + `Contact`
(both from real SOQL); found the empty-`Contact.json` stub bug and fixed it
(re-describe when a cached object has 0 fields). Failure parser on a crafted
`REQUIRED_FIELD_MISSING` DML log → correct exception + 3-frame stack + DML/exception
events + failing line 21 — exactly what the loop needs to set `Name` in `@TestSetup`.
Type-checks clean.

<details><summary>Original 18.X spec</summary>

The thing that decides whether generated tests **compile and pass**. Splits into
**static** context (to write the test) and **runtime** context (to fix a failing
one), so it feeds both 18.C (prompt) and 18.E (the fix loop).

`collectApexTestContext(className) → ApexTestContext` gathers, by combining two
infra layers we already produce — NOT a new parser:
- **`findDependencies`** = the "*what is referenced*" pass (classified hits).
- **the persisted schema cache** (`.siid/schema/objects/`, `apex/`, each with an
  `_index.json`) = the "*what does it look like*" pass — O(1) lookups, no re-scan.

The resolution flow: `findDependencies` yields referenced **names**; resolve each
against the cache indexes (`apexClassNames` → is it a class? `listObjects` → an
object?), then `readApex(name)` / `readObject(name)` to pull the structured detail.
If a referenced name isn't cached yet, fall back to building it
(`refreshObjects`/parse the `.cls`) and cache it. The cache is the seam — same
"one engine, many consumers" principle as the rest of Forge.

**Static (pre-generation):**
1. **The class under test** — source BY PATH + `schema.readApex(className)`
   (members, params, return types, annotations) — already cached.
2. **Related classes** — `findDependencies` over the class source: every
   `apex-type`/`apex-new`/`apex-static` hit is a candidate class. Resolve each via
   `apexClassNames`, then `readApex(name)` for its **public signature**
   (constructors + public methods) — by name from cache, not by re-parsing, and by
   path not full body to stay compact. This is the dependency graph, already
   classified AND already parsed.
3. **SObjects touched** — every `soql-from` hit + every referenced type that
   `listObjects` confirms is an object → `readObject(name)` for **required fields,
   types, picklist values, lookups/master-detail** (the data the `@TestSetup`
   factory MUST satisfy — the #1 compile/insert failure source). On-demand
   `describeObject` for any object not yet cached.
4. **Active Flows on those objects** — Tooling API: list active Flows whose trigger
   object matches a touched SObject; retrieve the FlowDefinition/Flow metadata for
   matches. Surface as "record-triggered flow `X` fires **before/after insert** on
   `Account`" so the AI anticipates side effects (extra DML, validation, required
   fields a flow sets) that the class source alone never reveals. Cache under
   `.siid/schema/flows/`.
5. **Triggers** on those objects (from local `.trigger` files + schema) — same
   reason: a trigger firing during the test changes what assertions are valid.

**Runtime (post-failure, fed back into the loop):**
6. **Parsed test log** — the run already saves FINEST logs to `.siid/logs/`; reuse
   `replay/logParser` to extract the **failure essentials**: the exception + message,
   the **call stack**, the **line that threw**, and nearby `FLOW_*` / trigger /
   `DML`/`SOQL`-limit / governor events. Compact + high-signal (not the raw log) —
   tells the AI *why* it failed (a flow’s validation, a missing required field, a
   limit) instead of just "assertion failed".

`ApexTestContext` is a structured object (§14): the prompt builder and the fix loop
both read it; the agent can call the collector directly.

</details>

#### 18.C AI prompt — `buildApexTestPrompt(ctx)` (in `apexTestContext.ts`)
Mirrors `lwcTestContext`: TASK-TYPE banner (write a test class, not
create-apex/deploy); the static context from 18.X (class + members + related-class
signatures + SObject required-field schema + active Flows/triggers); the detected
patterns (18.D); and rigid rules learned from Apex failures —
- always `@TestSetup`/factory satisfying **required fields** (from 18.X.3); never
  hard-code Ids;
- account for **active Flows/triggers** (18.X.4/5) that fire on DML — set the fields
  they require, expect the records they create;
- wrap exercised code in `Test.startTest()/stopTest()`; assert with `Assert.*`;
- **bulk test** (200 records) for triggers/handlers; positive + negative + bulk;
- callouts MUST use `Test.setMock`; no `seeAllData=true`;
- a final "run, pass, and reach the coverage threshold" instruction.
On a retry, the prompt also gets the **runtime context** (18.X.6) for each failing
test.

#### 18.E Independent AI gen + live panel *(large)* — the payoff
- `core/apexTestGenerator.ts` — the reliable loop, modeled on `lwcTestGenerator`
  but with a **coverage-driven** objective: build prompt → call LLM → write
  `<Class>Test.cls` (+ `-meta.xml`) → **deploy ONLY the test class** → `runApexTests`
  → feed back concrete failures **AND uncovered line ranges** (from `coverageStore`)
  **AND parsed log essentials** (18.X.6) for bounded self-correction. Keep the BEST
  attempt = **all written tests pass AND class coverage ≥ 75%** (never regress);
  resumable conversation for feedback/"cover more".
  - **Deploy guardrails (per the constraints):**
    - **Target must be a sandbox or developer org.** Before deploying, check the
      org type (`sf org display` / `orgManager`); if it looks like production,
      **block** with a clear message — never auto-deploy generated tests to prod.
    - **Only the test class is deployed.** The loop must NEVER modify the class
      under test or any related class. If a fix would require changing the main
      class, the loop **stops and asks** — changing main code needs **explicit
      user permission** (a confirmation in the panel), it is never automatic.
    - Reuse `deploy` + the diff guard so the user sees exactly what's pushed.
  - **Success threshold = 75% coverage of the class under test + all written tests
    passing** (not 90). The loop keeps adding/fixing tests until BOTH hold or max
    attempts is reached; it does not chase 100%.
  - Compile errors come back from the deploy step — feed those into the correction
    loop too (an extra failure mode LWC didn't have).
- `features/apexTestAiPanel.ts` — live webview mirroring `lwcTestAiPanel`: per-attempt
  status (generating → deploying → running → pass/fail + **coverage %** + uncovered
  lines), model picker, Set/Change Key, Regenerate, Retry failed, **"Cover more
  lines"**, Feedback box, Open test, Stop.
- `features/apexTestAi.ts` — `generateApexTestAi`: opens the panel if a key is set,
  else falls back to the `aiAgent` handoff (same pattern as `lwcTestAi`).

</details>

### Constraints (locked, 2026-06-30)
1. **Deploy target: sandbox or developer org only.** Generated tests are deployed
   to run (coverage needs a real org run), but the loop must verify the target is a
   sandbox/dev org and **refuse to deploy to production**.
2. **Never change the main/related classes.** Only the test class is deployed.
   Modifying the class under test requires **explicit user permission** (a panel
   confirmation) — it is never automatic; without it the loop stops and reports.
3. **Success = coverage ≥ 75% of the class under test AND all written tests pass.**
   Not 90/100 — 75 is the deployment floor and the stop condition.

### Open decisions to confirm before coding
1. Where the 18.B smart scaffold lives — extend `testClass.ts` in place vs. a new
   `apexTestScaffold` feature (leaning new file; keep `createTestClass` as the
   plain template, add "Scaffold Smart Test" as the analysed one).
2. Flow context depth — confirmed **list + metadata** (active Flows on touched
   objects, retrieved from Tooling API), not full flow-XML-in-prompt.
3. Log feedback depth — confirmed **parsed essentials** via `logParser`
   (exception + stack + throwing line + nearby flow/trigger/limit events).

### Recommended first slice
**18.B (smart scaffold)** — small, pure-local, immediately useful without any AI,
and it produces the structured analysis that 18.X/C/E consume. Then 18.A's headless
refactor (tiny), then **18.X (context collector)** — the load-bearing piece — then
the AI loop (18.D→C→E). Same incremental order that worked for LWC, plus the context
module in the middle.

## 19. Multi-org deploy/retrieve + cross-org diff — PLAN (2026-07-03)

Work with more than one authorized org from a single project: a **primary** org
(the current default — schema, status bar, everything follows it) plus
**secondary** orgs (Sec1, Sec2…) that are **deploy/retrieve/compare targets only**.
The secondaries are just the other authorized orgs (`orgs.listOrgs()`); no separate
registration or named-slot persistence in v1 — pick from the authed list each time.

### Locked decisions (2026-07-03)
1. **No schema for secondaries.** Schema stays tied to the primary org only.
   Secondaries never build/replace the local `.siid/schema/` cache. (If per-org
   schema is ever wanted, the future shape is keying the cache by org id —
   `.siid/schema/<orgId>/…` — but that is explicitly out of scope here.)
2. **Org-switch does NOT touch schema.** Switching the primary org must stay cheap
   and side-effect-free (users switch just to deploy/retrieve elsewhere). No
   auto-refresh, no auto-clear of object schema on `onDidChangeDefaultOrg`. The
   known tradeoff: object schema may reflect a different org than the current
   primary until an explicit refresh/retrieve — accepted deliberately.
3. **Title-bar org switcher sets the PRIMARY.** A control in the workbench title
   bar (next to the Command Center / search box) shows the current primary and,
   on click, offers a quick-pick of authed orgs → `OrgManager.setDefaultOrg`.
   Separate from auth (auth flows stay as-is). This touches the fork
   (`src/vs/workbench/browser/parts/titlebar`), like the existing native Forge
   menubar menu — the extension registers the command; the title bar renders it
   via `MenuId.TitleBar`.
4. **Separate `Deploy to Org…` / `Retrieve from Org…` commands** for secondaries.
   The button only switches primary; these commands target ANY authed org via
   `--target-org <picked>` **without** calling `setDefaultOrg` (primary untouched).
   Context-menu + palette, **multi-component aware** (explorer multi-select, same
   batch pattern as `generateApexTestsBatch`). Plain `Deploy Source` / `Retrieve
   Source` keep using the primary.
5. **Diff engine extended FIRST, then the conflict panel.** Do the fidelity work
   before the UX so the conflict list is accurate for every type, not just Apex.

### Current diff limits (why phase 1 exists)
`core/deployDiff.ts` today diffs by metadata type:
- ✅ **Single-file Apex** (`.cls/.trigger/.page/.component`) — fast **Tooling-API
  field query** (`SELECT Body FROM ApexClass WHERE Name=…`), no zip.
- ⚠️ **Bundles** (LWC/Aura) — **no per-file diff** (retrieve+unzip "not yet
  implemented"); deploys blind.
- ❌ **Objects/fields/flows/permsets** — not mapped; deploys with no diff.
  These have no single "body field"; their definition lives in the **`-meta.xml`**,
  so diffing them means retrieving the org copy and comparing XML/files, not a
  field query.

### Phase 1 — extend the diff engine (foundation, do first) ✅ DONE (2026-07-03)
`core/deployDiff.ts` gained a **batched retrieve-based diff path** beside the fast Tooling path:
1. ✅ **`targetOrg` threaded through** `computeDeployDiff` / `fetchToolingSource`
   (optional last arg → `--target-org`). Callers still pass nothing → default org,
   so deploy/retrieve UX is unchanged; the seam is ready for phase 2's org picker.
2. ✅ **Bundles (LWC/Aura):** batched retrieve, then each local member file matches
   its retrieved counterpart by bundle-relative path → per-file differs/new.
3. ⚠️ **XML metadata:** **permsets + flows only** (non-decomposed single-file types)
   diff cleanly. **Objects/fields are DEFERRED** — see the format caveat below.
4. ✅ Unified into the existing `DiffEntry[]` shape; downstream unchanged.

**Perf decision (resolved): BATCHED retrieve.** One `sf project retrieve start`
with all non-Apex `--metadata Type:Name` flags — pays the cold-CLI cost once.

**Live CLI mechanics discovered while building (2026-07-03) — these forced the design:**
- **`--output-dir` honors SOURCE TRACKING** → already-tracked components retrieve
  *nothing* ("Nothing retrieved"), useless for a diff. Must use
  **`--target-metadata-dir <dir> --unzip`**, which always pulls a fresh copy.
- The org copy comes back in **METADATA format** under `<dir>/unpackaged/unpackaged/…`.
- **`<dir>` MUST be inside the project root** (CLI raises `OutputDirOutsideProjectError`
  for an OS-temp path) → we mkdtemp under `<cwd>/.siid/difftmp` and `rmSync` it after.
- A **missing component** returns `result.files[].state === 'Failed'` ("cannot be
  found") with top-level `status: 0` → detected as new-in-org (don't rely on file
  absence alone; use `acceptNonZeroStatus`).
- Metadata format uses a **different suffix** than source (`X.permissionset` vs
  `X.permissionset-meta.xml`) → bundles map by rel path, XML types by `<name>.<mdExt>`.

**Object/field diff caveat (deferred):** objects are *decomposed* in source format
(one `-meta.xml` per field/listView under `objects/<name>/…`) but retrieve back as a
single inline `<name>.object` — the two are **not file-comparable** without a
source-convert step. Deferred out of phase 1. Future shape: `sf project convert
source`/`mdapi` the org copy into decomposed form, then compare per-field; or diff
the whole object at the metadata-format level and surface it as one object-level entry.

### Phase 2 — `Deploy to Org…` / `Retrieve from Org…` commands
- New commands (context menu + palette), org-picker from `listOrgs()` (cached),
  multi-select aware, run against `--target-org` **without** touching primary.
- Use the phase-1 engine to diff the whole selected set against the chosen org.

### Phase 3 — conflict-list panel
- Webview listing every selected component with status vs the target
  (⬤ differs / ◯ identical / + new); each **differing row opens the diff editor**.
  Actions: Deploy all / Deploy differing / Cancel. Built on the shared webview kit.

### Phase 4 — title-bar org switcher
- Command in `MenuId.TitleBar` (fork change, like the native Forge menubar). Shows
  primary; click → quick-pick → `setDefaultOrg`; re-renders on
  `onDidChangeDefaultOrg`. Only fork-touching piece, so it can lag.

### Build order
**1 → 2 → 3 → 4.** Phase 1 unblocks everything; 2+3 deliver the core workflow;
4 is the convenience switcher. Deploy/retrieve to a secondary works for ALL types
from phase 2 (it's just `--source-dir` + `--target-org`); the *diff fidelity* for
non-Apex types is what phase 1 adds.

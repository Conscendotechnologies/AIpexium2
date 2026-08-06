# Consuming SIID Forge from another extension

SIID Forge (`ConscendoTechInc.siid-forge`) exposes a **stable, headless SDK** so
other extensions (and scripts) can drive Salesforce operations — run `sf`
commands, read org/schema, run and AI-generate Apex tests — without
re-implementing any of it.

There are **two ways** to use it:

1. **The API** (`SiidForgeApi`) — typed, structured return values. Preferred.
2. **Commands** — fire-and-forget UI actions via `vscode.commands.executeCommand`.

---

## 1. The API (recommended)

The extension's `activate()` returns a versioned `SiidForgeApi`. Every method is
headless (no editor/selection dependency) and returns structured data.

### Bind to it

```ts
import * as vscode from 'vscode';
import type { SiidForgeApi } from '@conscendotech/siid-forge-api';

async function getForge(): Promise<SiidForgeApi | undefined> {
  const ext = vscode.extensions.getExtension('ConscendoTechInc.siid-forge');
  if (!ext) {
    vscode.window.showErrorMessage('SIID Forge is not installed.');
    return undefined;
  }
  // activate() returns the API (also available as ext.exports once active).
  const forge = (await ext.activate()) as SiidForgeApi;

  // Guard on the contract version before relying on newer methods.
  if (forge.version < '1.0.0') {
    vscode.window.showWarningMessage(`SIID Forge API ${forge.version} is too old.`);
    return undefined;
  }
  return forge;
}
```

> **Types:** depend on the **`@conscendotech/siid-forge-api`** package (types
> only — no runtime code) and `import type { SiidForgeApi } from
> '@conscendotech/siid-forge-api'`. Its version tracks `SiidForgeApi.version`, so
> `"@conscendotech/siid-forge-api": "^2.14.0"` gives you exactly the surface a
> Forge that reports `2.14.x` exposes. The live API is still bound at runtime via
> `ext.activate()`; the package only provides the compile-time types.
>
> **How to get the package:**
> - **A different repo (your other extensions, third parties):** add it as a
>   dependency — `"@conscendotech/siid-forge-api": "github:ConscendoTechInc/siid#..."`
>   (or from a registry once published). Nothing else to configure.
> - **Inside this monorepo:** the package lives at
>   [`extensions/siid-forge/api`](./api). Map the specifier to it in your
>   `tsconfig.json` so the fork's gulp build resolves it without an install:
>   ```jsonc
>   "compilerOptions": {
>     "baseUrl": ".",
>     "paths": { "@conscendotech/siid-forge-api": ["../siid-forge/api/index.d.ts"] }
>   }
>   ```
>   `sf-project-retriever` is wired this way — copy its `tsconfig.json`. The import
>   specifier is identical to the different-repo case, so no source changes if the
>   extension later moves out of the monorepo.

> **Activation order:** if your extension might run before Forge, add
> `"extensionDependencies": ["ConscendoTechInc.siid-forge"]` to your
> `package.json` so Forge is guaranteed active first.

### API surface

`version` — the API contract version (semver). Check it before using a method.

#### `forge.cli`
| Method | Returns |
| --- | --- |
| `getVersion()` | `Promise<string \| undefined>` — installed `sf` CLI version |
| `isAvailable()` | `Promise<boolean>` |

#### `forge.sf`
| Method | Returns |
| --- | --- |
| `run<T>(args: string[], opts?)` | `Promise<SfResult<T>>` — run any `sf … --json` command through the shared executor (typed, injection-safe, cancellable) |

```ts
// Query records without touching child_process yourself:
const res = await forge.sf.run<{ records: { Id: string; Name: string }[] }>(
  ['data', 'query', '--query', 'SELECT Id, Name FROM Account LIMIT 5']
);
console.log(res.result.records);
```

**Live running status** (API ≥ 1.1.0) — pass `onStatus` to drive a spinner /
elapsed timer while the command runs. It fires `started` → periodic `running`
(heartbeat) → one terminal `succeeded` / `failed` / `cancelled`:

```ts
await forge.sf.run(['project', 'deploy', 'start', '--wait', '10'], {
  cwd: projectRoot,
  statusHeartbeatMs: 1000, // running ticks (default 1000)
  onStatus: (s) => {
    switch (s.phase) {
      case 'started':   myStatusBar.text = '$(sync~spin) sf running…'; break;
      case 'running':   myStatusBar.text = `$(sync~spin) sf running… ${Math.round(s.elapsedMs / 1000)}s`; break;
      case 'succeeded': myStatusBar.text = `$(check) sf done (${Math.round(s.elapsedMs / 1000)}s)`; break;
      case 'failed':    myStatusBar.text = `$(error) sf failed: ${s.message ?? ''}`; break;
      case 'cancelled': myStatusBar.text = '$(circle-slash) sf cancelled'; break;
    }
  }
});
```

> Works for every command. Note `--json` commands emit no output until they
> finish, so `onStatus` gives you **lifecycle + elapsed time** (not per-line
> output). The callback is side-effect free — a throwing callback never affects
> the command. Combine with `token` (a `CancellationToken`) to cancel.

#### `forge.orgs`
| Method | Returns |
| --- | --- |
| `list()` | `Promise<OrgInfo[]>` |
| `getDefault()` | `Promise<string \| undefined>` — default org alias |
| `getUsername()` | `Promise<string \| undefined>` |
| `getUserId()` | `Promise<string \| undefined>` |
| `onDidChangeDefault` | `Event<string \| undefined>` — fires when the default org changes |

#### `forge.schema`
Reads the local `.siid/schema/` cache (fast, O(1)). `projectRoot` is optional —
defaults to the active workspace.
| Method | Returns |
| --- | --- |
| `listObjects(projectRoot?)` | `string[]` — cached org object API names |
| `readObject(name, projectRoot?)` | `ObjectSchema \| undefined` — fields, picklists, relationships |
| `apexClassNames(projectRoot?)` | `string[]` |
| `readApex(name, projectRoot?)` | `ApexSchema \| undefined` — members, params, annotations |
| `describeObject(name, projectRoot?, token?)` | `Promise<boolean>` — describe on demand (org round-trip) and cache |

```ts
const account = forge.schema.readObject('Account');
const required = account?.fields.filter(f => f.required).map(f => f.name);
```

##### `forge.schema.stdlib`
The Salesforce **StandardApexLibrary** (`System.*`, `ConnectApi.*`, `Schema.*`, …),
parsed from the bundled Apex jar. It's the same for every project, so it's built
**once** into the extension's global storage and shared — hence no `projectRoot`.
The first `ensure()` (or an open Salesforce project) triggers the build.
| Method | Returns |
| --- | --- |
| `ensure()` | `Promise<void>` — build/load the shared cache if needed (idempotent) |
| `namespaces()` | `Record<string, string[]> \| undefined` — namespace → class names, or `undefined` until built |
| `lookup(name)` | `StdlibClass \| undefined` — resolve by qualified (`System.Database`) or bare (`Database`) name |

```ts
await forge.schema.stdlib.ensure();
const db = forge.schema.stdlib.lookup('Database');
const convertOverloads = db?.schema.members.filter(m => m.name === 'convertLead');
```

#### `forge.data`
Query records and write edits back (the editable SOQL grid uses these).
| Method | Returns |
| --- | --- |
| `query(soql, opts?, token?)` | `Promise<{ totalSize?, done?, records? }>` — raw records, like `sf data query` |
| `objectOf(soql)` | `string \| undefined` — the query's `FROM` object |
| `updateRecords(sobject, edits, opts?, token?)` | `Promise<RecordSaveResult[]>` — one update per row; per-record success/error |

`updateRecords` is headless — it does **not** apply the production-org guard; a UI/agent
caller should check `orgs.getOrgKind()` first (the grid confirms before writing to a
non-sandbox org).

```ts
const { records } = await forge.data.query('SELECT Id, Industry FROM Account LIMIT 5');
const results = await forge.data.updateRecords('Account', [
  { recordId: records[0].Id, fields: [{ field: 'Industry', value: 'Technology' }] }
]);
```

#### `forge.coverage`
| Method | Returns |
| --- | --- |
| `get(className, projectRoot?)` | `ClassCoverageEntry \| undefined` — last recorded covered/uncovered lines + percent |

#### `forge.diff` (API ≥ 2.2.0)
| Method | Returns |
| --- | --- |
| `byMetadataTypes(types, opts?)` | `Promise<TypeDiffGroup[]>` — diff whole metadata **types** (org ∪ local members) and get per-member status + paths for a diff editor |

```ts
// Diff every Apex class + LWC between the org and local, grouped by type:
const groups = await forge.diff.byMetadataTypes(['ApexClass', 'LightningComponentBundle']);
for (const g of groups) {
  const changed = g.rows.filter(r => r.status === 'changed');
  const newInOrg = g.rows.filter(r => r.status === 'new-in-org');
  console.log(`${g.type}: ${changed.length} changed, ${newInOrg.length} new in org`);
  // Open a diff for a changed row: vscode.diff(Uri.file(row.orgPath!), Uri.file(row.localPath!))
}
```

> Each row's `status` is `new-in-org` (pull adds it), `changed` (differs — a
> potential conflict), `only-local`, `identical`, or `retrieved-not-compared`.
> `CustomObject` is always `retrieved-not-compared` (it's decomposed locally but
> comes back inline from a metadata retrieve, so the two aren't file-comparable) —
> retrieve it, just without a content diff. Pass `{ targetOrg }` to diff a
> non-default org.

#### `forge.apexTests`
| Method | Returns |
| --- | --- |
| `run(className, opts?)` | `Promise<ApexTestRunOutcome>` — run the class's tests, structured pass/fail + coverage |
| `scaffold(clsPath, apiVersion?, projectRoot?)` | `ApexScaffoldResult \| undefined` — class-aware test skeleton (no AI) |
| `collectContext(className, projectRoot?, token?)` | `Promise<ApexStaticContext>` — related classes, touched objects + required fields, flows, triggers |
| `buildPrompt(ctx, coverageTarget?)` | `ApexTestPrompt` — the hardened LLM prompt from a context |
| `generate(clsPath, opts?)` | `Promise<ApexGenerateResult>` — full coverage-driven AI loop (deploy to sandbox/dev → run → self-correct) |

```ts
// Run a class's tests and read structured coverage:
const outcome = await forge.apexTests.run('AccountService');
console.log(`${outcome.passing}/${outcome.testsRan} passing, ` +
            `${outcome.classCoverage?.coveredPercent ?? 0}% covered`);

// Or drive the AI generator, streaming progress:
const result = await forge.apexTests.generate(
  '/path/to/AccountService.cls',
  {
    coverageTarget: 75,
    onEvent: (e) => {
      if (e.type === 'attempt-result') {
        console.log(`attempt ${e.attempt}: ${e.passed}/${e.total}, ${e.coverage}%`);
      }
    }
  }
);
console.log(result.success, result.totalTokens, result.totalCost);
```

> **AI key:** `apexTests.generate` needs an OpenRouter key. Pass `{ apiKey }`
> explicitly, or leave it out to use Forge's configured key (set via the
> **SIID Forge: Set OpenRouter API Key** command). Generated tests deploy to run,
> so the default org must be a **sandbox / developer / scratch** org — production
> is blocked (`result.blockedReason` is set).

#### `forge.formula` (API ≥ 2.7.0)
| Method | Returns |
| --- | --- |
| `evaluate(opts, token?)` | `Promise<FormulaEvalResult>` — evaluate a Salesforce formula against one record |
| `evaluateMany(opts, token?)` (≥ 2.9.0) | `Promise<FormulaMultiResult>` — one formula across several records in a single run (per-record table) |
| `sampleRecords(objectName, opts?, token?)` (≥ 2.8.0) | `Promise<SampleRecord[]>` — a few records (Id + label) to pick one to evaluate against |

There is **no `sf` CLI command** for formula evaluation; this runs the standard
`FormulaEval` Apex library through anonymous Apex (arming the FINEST trace to read
the result back). Flow `{!…}` / `$Record.` syntax is stripped for you.

```ts
const r = await forge.formula.evaluate({
  formula: 'IF(Amount > 10000, "High", "Standard")',
  objectName: 'Opportunity',
  returnType: 'STRING'          // optionally recordId, targetOrg
});
if (r.success) {
  console.log(r.value, r.referencedFields);   // e.g. "High"  ["Amount"]
} else {
  console.error(r.error);
}
```

---

## 2. Commands

For one-off UI actions you can call any Forge command with
`vscode.commands.executeCommand('<id>', ...args)`. These open panels / show
toasts; most do not return structured data (use the API for that).

```ts
// Fetch the API through a command (alternative to activate()):
const forge = await vscode.commands.executeCommand<SiidForgeApi>('siid-forge.getApi');

// Open the AI test panel for a class:
await vscode.commands.executeCommand(
  'siid-forge.generateApexTestAi',
  vscode.Uri.file('/path/to/AccountService.cls')
);

// Batch: open the multi-class picker + queue panel:
await vscode.commands.executeCommand('siid-forge.generateApexTestsBatch');
```

### Useful command ids
| Command | Does |
| --- | --- |
| `siid-forge.getApi` | Returns the `SiidForgeApi` instance |
| `siid-forge.scaffoldApexTest` | Scaffold a class-aware Apex test (arg: class `.cls` Uri) |
| `siid-forge.generateApexTestAi` | Open the AI test panel (arg: class `.cls` Uri) |
| `siid-forge.generateApexTestsBatch` | Multi-class picker → batch queue panel |
| `siid-forge.runApexTests` | Run a class's tests (arg: `.cls` Uri, `{ tests?, debug? }`) |
| `siid-forge.setOpenRouterKey` | Prompt for + store the OpenRouter key |
| `siid-forge.runSoql` | SOQL runner |
| `siid-forge.deploySource` / `retrieveSource` | Deploy / retrieve against the **default** org (arg: Uri) |
| `siid-forge.deployToOrg` / `retrieveFromOrg` | Deploy / retrieve against **any authorized org** via `--target-org` — the default (primary) org is left unchanged. Opens a component picker, then an org picker that pre-selects the last org targeted in this workspace (args: `Uri`, `Uri[]`) |
| `siid-forge.selectOrg` / `openOrg` | Switch / open default org |
| `siid-forge.refreshCoverage` / `refreshCoverageLens` | Repaint coverage gutter / CodeLens |

> Prefer the **API** for anything where you need the result — commands are for
> triggering Forge's own UI.

---

## Versioning

`SiidForgeApi.version` is semver. Breaking changes bump the major. Always check
it before calling a method that may not exist in older Forge builds:

```ts
if (forge.version >= '1.1.0') {
  // use a method added in 1.1.0
}
```

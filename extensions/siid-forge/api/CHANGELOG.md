# Changelog — `@conscendotech/siid-forge-api`

Every published version is an **immutable git tag** (`vX.Y.Z`) on the
[siid-forge-api](https://github.com/Conscendotechnologies/siid-forge-api) mirror repo.
Tags are only ever added, never moved or deleted — so **any version listed below stays
installable forever**.

**Downgrading (if a new version misbehaves):** pin the consumer back to the previous tag —
```jsonc
"@conscendotech/siid-forge-api": "github:Conscendotechnologies/siid-forge-api#v2.14.0"
```
then reinstall. No republish needed; the old tag is still there. Runtime stays
backward-compatible (additive-only until a MAJOR bump), so an older type pin against a newer
installed Forge keeps working — gate new methods with `if (forge.version >= 'X.Y.Z')`.

Semver: **patch** = behavior-only fix, **minor** = additive (new method/namespace/optional
field, safe), **major** = removal or changed signature (opt-in for consumers).

> This file is the human-readable mirror of the version-history comment in the source
> `src/api.ts`. Keep them in sync when bumping (see `MAINTAINING.md`).

---

## 2.15.0
`FormulaMultiResult` now documents `evaluated?`/`truncated?` in the public types (the runtime
already returned them). Additive + optional; older consumers unaffected. Also corrected the
`orgs.list` doc (cached ~5 min, stale-while-revalidate — not "~30s").

## 2.14.0
Added batch/async-job analysis to `logs`: `collectBatchJob`, `analyzeBatchJob`,
`analyzeBatchJobById`, `batchToMarkdown` (roll a Batchable/Queueable job's many logs into one
per-phase analysis). *(First version published as a git tag.)*

## 2.13.0
Added the `not-finest` LogInsight kind (a DEBUG-level log now reports that its analysis is
incomplete instead of looking clean).

## 2.12.0
Added `logs` namespace: `analyze` / `analyzeFile` / `toMarkdown` (Apex debug-log analysis —
governor limits, method timings, call tree, SOQL/DML, callouts, heap-over-time, insights, errors).

## 2.11.0
Added `data` namespace: `query`, `objectOf`, `updateRecords` (edit queried records + write back
per row).

## 2.10.0
Added `schema.stdlib` (Salesforce StandardApexLibrary: System.*, ConnectApi.*, … parsed from the
bundled Apex jar; shared globally, built on demand).

## 2.9.0
Added `formula.evaluateMany` (evaluate one formula across several records in a single run →
per-record result table).

## 2.8.0
Added `formula.sampleRecords` (list a few records of an object to pick one to evaluate against).

## 2.7.0
Added `formula.evaluate` (Salesforce formula evaluation via the standard FormulaEval Apex
library; no `sf` CLI command exists).

## 2.6.0
`DiffMetadataTypesOptions.onType` fires per-type as the diff progresses (drives a
"Comparing &lt;Type&gt; (n of N)…" label). Additive and optional — older consumers unaffected.

## 2.5.0
Added `diff.retrieveTypes` (whole-type retrieve, no per-member args) and `diff.isDiffable`
(split diffable vs retrieve-only types).

## 2.4.0
`byMetadataTypes` keeps the full org tree; added `diff.applyFromDiff` (apply by copy from the
kept tree — no second org retrieve).

## 2.3.0
Added `diff.dispose`, `diff.applyToLocal` (orphan-immune pull), `diff.findOrphanedMeta`.

## 2.2.0
Added `diff.byMetadataTypes` (type-level org↔local diff).

## 2.1.0
`orgs.list(force?)` is cached (TTL); `force` bypasses the cache.

## 2.0.0
**Breaking:** `ApexStaticContext.triggers` is now `RelatedTrigger[]` (was `string[]`).

## 1.2.0
Added `orgs.authorizeWithToken` (session-id / access-token login).

## 1.1.0
`sf.run` gained real-time `onStatus` lifecycle callbacks.

---

> **Note on pre-2.14 versions:** entries below 2.14.0 document the API surface as it evolved,
> but were never cut as git tags in the mirror repo (the types package was introduced at 2.14.0).
> Only **2.14.0 and later** exist as installable tags. From 2.15.0 on, every bump is tagged.

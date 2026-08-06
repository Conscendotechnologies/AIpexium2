# Audit Findings — siid-forge / siid-compression / SIID-Code (new changes)

Three read-only audit subagents (2026-07-31), each verifying against real source/SDK types. Findings
below are **independently re-verified** where noted (runnable repro). Fix in sequence; check off as done.

Legend: 🔴 confirmed bug · 🟡 real but low prod-impact · 🟢 doc/perf · ✅ fixed · ⬜ pending

Key context: on the compression proxy's OUTBOUND path **nothing calls `expand()`** — the model reads
the compressed text directly. So a losslessness hole only bites if a future consumer re-hydrates;
but anything the model *reads* (sentinels/markers) is a live quality concern now.

---

## 🔴 Confirmed bugs

### A. [✅ FIXED] SIID-Code — `retrieveTypes` wrong arg shape
`src/core/tools/forgeFeatureRegistry.ts` — passed `projectRoot` as a bare string where the SDK wants
`{ projectRoot }`; `as never` hid it from tsc. Fired on every call (handler defaults projectRoot).
Fixed → `forge.diff.retrieveTypes(types, { projectRoot: opt(...) })`. Verified: audit + tsc.

### B. [✅ FIXED] SIID-Code — running timer was dead code
`webview-ui/src/components/chat/ChatRow.tsx` — gate assumed the anchor message flips `ask→say` on
approval; `cline.ask()` never mutates it, so the row showed "Awaiting approval…" the whole time the
command ran and `<SiidForgeRunning>` never rendered (the empty-space/stuck symptom seen in testing).
Fixed → gate on real signals: `forgeRunning = !forgeDone && (!!lastProgress || (isLast && isStreaming))`.
Verified: audit + tsc (both surfaces).

### C. [✅ FIXED] compression — streaming usage regex breaks on nested usage
`src/proxy/server.js` (~line 165) — `/"usage"\s*:\s*(\{[^}]*\})/g` stopped at the first `}`, so modern
OpenRouter/OpenAI payloads with `prompt_tokens_details`/`completion_tokens_details` captured a
truncated span → `JSON.parse` threw (swallowed) → `completion_tokens` was **never recorded for streamed
calls**. Metric-only; stream itself fine.
Fixed → observer now buffers by newline and parses whole SSE `data:` lines, reading `obj.usage`
directly (each data line is a complete JSON object). Robust to nested details + chunk-boundary splits.
Verified: self-check — new scraper returns completion_tokens=345 with nested details intact; old regex
throws on the same payload.

### D. [✅ FIXED] compression — tableCompaction drops a value shaped like the HOLE sentinel
`src/proxy/tableCompaction.js` — absent-key sentinel was the object `{"_siidTable_absent":true}`;
`isHole()` couldn't distinguish a genuine cell of that exact shape → `expand()` dropped the key.
Violated "LOSSLESS BY CONSTRUCTION".
Fixed → sentinel is now the string `⟪siid-absent⟫`; any REAL cell equal to the sentinel (or to its
escaped form) is escaped with `⟪siid-lit:` on compact and unescaped on expand. Collision-SAFE by
construction, not merely unlikely. Verified: new round-trip test with a real cell == sentinel and a
real cell == escaped-form both restore exactly; absent key stays absent; live model still reads it.

### E. [✅ FIXED — same monorepo, `AIpexium2` worktree] siid-forge — `trlhdtips__` managed-package deploy error root cause
`extensions/siid-forge/src/core/deployDiff.ts` (same `Siid` repo, checked out in the `AIpexium2`
worktree — NOT the `@conscendotech/siid-forge-api` types package) `collectDeployFiles`/`classify` — folder deploy recurses
and includes EVERY `.cls` with **no namespace-prefix exclusion**; managed classes (`trlhdtips__*`) then
get `SELECT Body ... WHERE Name='trlhdtips__Foo'` (returns nothing → mis-flagged `isNew`) → bundled →
org rejects read-only managed code. Affects source-dir and deployToOrg paths.
Our siid_forge `deploy` feature (named `--metadata`) already sidesteps this for the agent; the IDE's own
deploy button needed the fix. FIXED at chokepoint: `classify()` now drops any component whose fullName
carries a managed namespace prefix (`hasManagedNamespace()` — strips a trailing custom suffix
`__c/__mdt/__e/…` then treats any remaining `__` as a namespace separator, so `ns__Obj__c` skips while
`Foo__c` is kept). Verified: file-level self-check (`test/deployDiff.managed.test.js`) + 13 name edge
cases; tsc clean.

---

## 🟡 Real, low prod-impact

- **F2** [✅ FIXED] compression — tableCompaction emitted `{"_siidTable_absent":true}` into the
  compacted JSON the model reads on sparse tables → internal-encoding noise. Fixed with D: the sentinel
  is now the compact, obviously-meta string `⟪siid-absent⟫` (matches the ⟪siid-…⟫ marker convention),
  far cleaner for the model to interpret.
- **F3** compression — `repeatedLines.expand()` treats any line matching the repeat marker as control,
  even in raw content → mutates content / corrupts if content contains a literal marker line. Only bites
  if expand runs. Same unescaped-collision class as blockDedup `⟪siid-ref⟫` and `_siidTable`.
- **F6** compression — blockDedup dedups only ONE shared block per older message; a message re-pasting
  two different large bodies references only the larger. Missed savings, not a correctness bug.
- **siid-forge #6** — with `acceptNonZeroStatus`, a non-zero exit RESOLVES the promise but fires an
  `onStatus` `failed` phase. A global "sf failed" UI indicator flashes on acceptNonZero runs (e.g. test
  runs with some failures). Relevant to our timer/status UI. Arguably by-design; `.d.ts` doc gives no hint.
- **siid-forge #3/#4** [✅ DECIDED — keep hidden] runtime `ApexGenerateResult.conversation`
  (ChatMessage[]) and `ApexScaffoldResult.facts` are internal types not in the public `.d.ts`.
  Decision: keep them OUT of the public surface — don't publish internal AI/scaffold shapes we'd then
  have to support forever. No change.

---

## 🟢 Doc / perf

- **F5** [✅ FIXED] compression — `whitespace` was documented as ✅ Lossless (STRATEGY.md:80) and
  covered by "each lossless transform has an expand() inverse", but it has **no inverse** and is
  irreversible. Fixed: table now marks it ◐ meaning-preserving / not byte-reversible / no expand();
  the losslessness section explicitly excludes it; truncate relabeled plainly "lossy".
- **siid-forge #2** [✅ FIXED] `FormulaMultiResult` runtime returns `truncated?`/`evaluated?` but the
  public `.d.ts` hid them → a caller over the record cap was silently truncated with no typed signal.
  Fixed: added both fields to `api/siid-forge.d.ts` (verified against `src/core/formulaEval.ts:369-372`).
  Additive → api package bumped 2.14.0 → **2.15.0** (both `src/api.ts` readonly version + api/package.json,
  guard green). SIID-Code `REQUIRED_FORGE_VERSION` left at 2.14.0 — the runtime already returned these
  fields, no new functional dependency. Source-of-truth `.d.ts` is mirrored to the public
  `siid-forge-api` repo by its `sync.yml` Action (daily / repository_dispatch / manual).
- **siid-forge #7** [✅ FIXED] `orgs.list` doc said "cached ~30s"; actual is `ORG_LIST_TTL_MS = 5*60*1000`
  (5 min, stale-while-revalidate — `orgManager.ts:38,471-482`). Fixed the doc comment in the `.d.ts`.
- **siid-forge #5** [⏭ SKIPPED] `SfResult.raw` is `raw?` in `.d.ts` but always set at runtime. Harmless
  direction (a consumer over-guards for undefined) — not worth a breaking-direction tighten. No change.
- **siid-forge #1** [⏭ SKIPPED] `diff.applyToLocal` `ApplyResult` applied/missing sets not guaranteed
  disjoint on duplicate refs. Low blast radius, requires duplicate refs in one call. No change.

---

## ✅ Verified clean (audited, no action)

- Auto-approve toggle plumbing threaded through ALL layers (settings schema, message unions, provider
  state, handler cases, hooks, menu, settings UI, i18n) — no missing wire / silent no-op.
- `isAutoApproved` siidForge case reads `mutating ? write : read`, matches handler gating; deps complete.
- `visibleMessages` filtering keeps the anchor, drops progress/result rows the anchor reads from
  `modifiedMessages` (pre-filter). Coherent.
- Registry ↔ SDK for all other features (query, describeObject, updateRecords, applyToLocal, deploy,
  sfRun, analyzeBatchJobById, evaluateFormula, sampleRecords, stdlib, diffTypes) — correct method
  names/arg order/shapes, awaits present.
- Compression: fail-open (every transform wrapped, no escaping throw), non-mutation of caller messages
  (incl. array-of-text-block shape), response framing (drops content-length/transfer-encoding, strips
  content-encoding only when re-serialized), blockDedup src-index mapping + `displayNumberOf` +
  `REF_RE` lazy match + nesting guard, tableCompaction size guard.
- siid-forge: API version guard (both 2.14.0), `this.root()` throws rather than defaulting to install
  dir, executor cancellation/heartbeat cleanup, onStatus callback try/catch, error-context extraction,
  org caching heal loop, getOrgKind fail-closed.
- lean-output: SIID_LEAN_OFF short-circuit, PONYTAIL always / CAVEMAN off in `code` mode, test coverage.
- Compression routing in SIID-Code: `maybeRouteThroughCompression` genuinely fail-open at all three
  buildApiHandler sites; `x-siid-source` only when non-default base URL; `getProxyBaseUrl` name matches.

---

## Fix order (planned)
1. ✅ A — retrieveTypes arg shape (done)
2. ✅ B — running-timer dead code (done)
3. ✅ C — streaming usage regex (compression) (done)
4. ✅ D + F2 — tableCompaction sentinel collision + model-visible noise (compression) (done)
5. ✅ F5 — whitespace lossless doc fix (compression STRATEGY.md) (done)
6. ✅ E — Forge managed-package deploy filter (siid-forge, AIpexium2 worktree) (done)
7. ✅ `.d.ts` drifts — siid-forge (done): #2 fields added + api bumped 2.15.0, #7 TTL doc fixed,
   #3/#4 kept hidden, #1/#5 skipped. (Public repo auto-syncs via sync.yml.)

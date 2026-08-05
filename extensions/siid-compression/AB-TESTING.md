# A/B Testing — Lean-Output Prompt (ponytail + caveman)

How to measure whether the **lean-output** system-prompt block (in SIID-Code, branch
`feat/lean-output-prompt`) actually saves tokens **without hurting quality**. Separate concern from
the SIID Compression proxy — that shrinks INPUT bytes; this shrinks OUTPUT and wasted work.

---

## What each lever does

- **ponytail** (all modes): "prefer the simplest solution, reuse before adding, YAGNI". → fewer
  turns, less over-building. Measured by **turns-to-done** + **total tokens/task**.
- **caveman** (all modes EXCEPT `code`): terse prose replies. → fewer **output tokens**. Off in
  `code` mode because it emits full Apex/LWC artifacts that must never be abbreviated.

---

## The instrument (already wired)

`server.js` logs both directions to `traffic.jsonl` and stdout:

- **Input:** `compress source=siid-code ... <before>-><after> tok (X%) [transforms]`
- **Output:** `out source=siid-code ... completion=<N> tok`  ← added for the A/B
- JSONL: `response.usage.completion_tokens` per request (streaming + non-streaming).

Log file:
`C:\Users\Aman\AppData\Local\Programs\Siid\resources\app\extensions\siid-compression\logs\traffic.jsonl`

> ⚠️ Output tokens on streamed calls rely on OpenRouter sending `usage` (client must set
> `stream_options.include_usage`). If the log shows `usage: undefined` on streams, that option isn't
> set — tell Claude; one-line fix in the compressor to inject it.

---

## Metrics (per task)

| Metric | Where | ponytail | caveman |
|--------|-------|----------|---------|
| Output tokens | sum `completion_tokens` across the task | small | **main** |
| Turns to done | count `compress source=siid-code` requests for the task | **main** | small |
| Total input tokens | sum `tokensBefore` | ✅ | ✅ |
| **Success** | eyeball: correct artifact / answer / nothing requested dropped | must hold | must hold |

Task boundary in the log = a tiny request (`<200 tok`) starting a fresh run.

---

## Procedure

1. Two builds of SIID-Code: **ON** = `feat/lean-output-prompt` vsix; **OFF** = base/main vsix.
   *(Or add a `SIID_LEAN_OFF=1` env toggle — ask Claude — to flip without rebuilding.)*
2. Reload SIID window so the proxy respawns with the current `server.js`.
3. Run each scenario below **ON and OFF**, **3× each** (model is non-deterministic — compare
   medians, not single runs).
4. Copy the log block per run; Claude computes the table.

---

## Scenarios (testV3 project, org `salesforce-experiments`)

Real class names so reuse-vs-rebuild is testable: `AccountService` (`countAccounts`, `greet`),
`Hello`, `HTMLBuilder`, `OpenRouterClient`.

### Bucket 1 — Ponytail (fewer turns / less over-building)

| # | Mode | Prompt |
|---|------|--------|
| P1 | code | "I need to format an Account's CreatedDate as YYYY-MM-DD in Apex. Add what's needed." |
| P2 | code | "Add a method to greet a user by name. Check the project first." (should reuse `AccountService.greet`/`Hello`) |
| P3 | code | "I want to count Accounts from a new LWC button." (should reuse `AccountService.countAccounts`) |
| P4 | salesforce-agent | "Where should I store a rarely-changing per-user preference in this org?" (Custom Setting/Metadata, not new object+trigger) |

**Win:** fewer new files/turns, reuses existing, same correct result.

### Bucket 2 — Caveman (shorter prose) — non-code modes only

| # | Mode | Prompt |
|---|------|--------|
| C1 | salesforce-agent | "Difference between a Role and a Profile?" |
| C2 | salesforce-agent | "When do I use a Flow vs an Apex trigger?" |
| C3 | orchestrator | "Summarize what the last task did." |

**Win:** fewer output tokens, answer still complete, no filler/preamble.

### Bucket 3 — Guardrails (MUST NOT break) ⚠️

| # | Mode | Prompt | Must hold |
|---|------|--------|-----------|
| **G1** ⚠️ | code | "Create Apex class `RatingService` with `bumpRatings()` setting Rating='Hot' on all Accounts with AnnualRevenue > 1000000, plus test class `RatingServiceTest`. Deploy both." | **Full, complete `.cls` + `.cls-meta.xml` verbatim** — no `// unchanged`, no fragments. The caveman-off proof. **Run first.** |
| G2 | code | "Add null-checks to `bumpRatings` before the update." | ponytail must NOT skip the *requested* validation. |
| G3 | code | "Write complete `AccountServiceTest` for `AccountService`, deploy, hit 75%+ coverage." | Complete test class, real coverage, artifact intact. |
| G4 | salesforce-agent | "Give me the full SOQL for open cases grouped by owner." | SOQL complete — caveman trims prose, never the artifact. |

`RatingService`/`RatingServiceTest` don't exist yet — clean throwaway targets, deployable to
`salesforce-experiments`.

---

## Minimum viable pass

Don't run all 11. Run **G1 → G2 → P2 → C1**, each ON and OFF, 3× each = 24 runs. Answers: does it
help (P2/C1) and does it not hurt (G1/G2).

**Success-rate (Bucket 3) is pass/fail, not a median — one truncated `.cls` in G1 = fail.**

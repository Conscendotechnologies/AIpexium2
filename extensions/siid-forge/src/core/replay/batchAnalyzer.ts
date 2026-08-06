/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as fs from 'fs';
import { analyzeLog, AnalyzeOptions, LogAnalysis, LogInsight, LimitUsage } from './logAnalyzer';
import { BatchJobLogs, BatchPhase } from '../batchLogs';

/**
 * Aggregates the MANY logs of one async Apex job into a single job-level analysis
 * with a per-phase breakdown.
 *
 * Why aggregate: a batch job is not one transaction. `start`, each `execute`
 * chunk, and `finish` run separately, and GOVERNOR LIMITS RESET PER CHUNK. The
 * question a developer actually has is "did my batch misbehave, and where" — which
 * no single log can answer. This rolls the whole job up, while keeping each phase
 * addressable so you can see which chunk is the problem.
 *
 * All behaviour here is driven by findings from a real batch run (see batchLogs.ts).
 */

/** One transaction of the job, analyzed on its own. */
export interface BatchPhaseAnalysis {
  phase: BatchPhase;
  /** 1-based chunk number, for `execute` phases. */
  chunkIndex?: number;
  logId: string;
  file: string;
  /** The full single-log analysis for this transaction. */
  analysis: LogAnalysis;
}

/** The whole job, rolled up. */
export interface BatchJobAnalysis {
  jobId: string;
  status: string;
  className?: string;
  jobType?: string;
  itemsProcessed?: number;
  totalItems?: number;
  numberOfErrors?: number;
  /** Wall time across the job (createdDate → completedDate), ms. */
  jobDurationMs?: number;
  /** Each transaction, in phase order (start → chunks → finish). */
  phases: BatchPhaseAnalysis[];
  /**
   * Job-wide totals summed across every phase. soql/dml/dbRows/callouts are
   * COUNTED FROM EVENTS, not read from limit blocks — see `limitsUsable`.
   */
  totals: {
    soql: number;
    dml: number;
    dbRows: number;
    callouts: number;
    /**
     * Summed CPU across phases (each chunk gets a FRESH allowance). Usually 0 for
     * batch jobs — their limit blocks report zeros (see `limitsUsable`), so treat
     * this as unavailable rather than "no CPU used" when `limitsUsable` is false.
     */
    cpuMs: number;
    /** Summed wall time of the individual transactions. */
    transactionMs: number;
    errors: number;
    chunks: number;
  };
  /**
   * False when the job's logs carry no usable governor data.
   *
   * Async logs CAN report real limits — a batch doing real work showed
   * `13/200 SOQL`, `12/150 DML` and 285ms CPU (note the ASYNC caps: 200/60000, not
   * the sync 100/10000). But a batch whose chunks do very little reports every
   * limit as `0 out of <cap>` across every log, and that zero means "nothing worth
   * reporting", NOT "measured as zero".
   *
   * The distinction matters because an all-zero rollup rendered as 0% bars reads as
   * a clean bill of health. When false the UI says "not reported" instead; the
   * SOQL/DML counts stay reliable either way since they are counted from log events.
   */
  limitsUsable: boolean;
  /**
   * The WORST per-phase limit usage across the job, by limit name. A batch is
   * healthy only if EVERY chunk stayed under the cap, so the peak chunk is what
   * matters — averages would hide the one chunk that blew up.
   */
  peakLimits: Array<LimitUsage & { phase: BatchPhase; chunkIndex?: number }>;
  /** Job-level insights (deduped across phases + batch-specific findings). */
  insights: BatchInsight[];
  /** True when any phase's log was truncated — the rollup is then partial. */
  truncated: boolean;
  /** True when every collected log was FINEST (a full analysis). */
  isFinest: boolean;
}

/** A job-level insight; carries where it came from. */
export interface BatchInsight extends LogInsight {
  /** Which phase raised it; absent for job-wide findings. */
  phase?: BatchPhase;
  /** How many phases raised the same thing (a chunk-wide pattern). */
  phaseCount?: number;
}

/**
 * Analyzes every collected log and rolls the results into one job view.
 * Pure + dependency-free (reads the already-downloaded files), so the SDK and the
 * agent can call it exactly like `analyzeLog`.
 */
export function analyzeBatchJob(job: BatchJobLogs, options: AnalyzeOptions = {}): BatchJobAnalysis {
  const phases: BatchPhaseAnalysis[] = [];
  for (const l of job.logs) {
    let raw: string;
    try {
      raw = fs.readFileSync(l.file, 'utf-8');
    } catch {
      continue;
    }
    phases.push({
      phase: l.phase,
      chunkIndex: l.chunkIndex,
      logId: l.id,
      file: l.file,
      analysis: analyzeLog(raw, options)
    });
  }

  const totals = {
    soql: 0, dml: 0, dbRows: 0, callouts: 0, cpuMs: 0, transactionMs: 0, errors: 0, chunks: 0
  };
  for (const p of phases) {
    const a = p.analysis;
    totals.soql += a.counts.soql;
    totals.dml += a.counts.dml;
    totals.dbRows += a.counts.dbRows;
    totals.callouts += a.counts.callouts;
    totals.cpuMs += a.cpuMs ?? 0;
    totals.transactionMs += a.durationMs;
    totals.errors += a.errors.length;
    if (p.phase === 'execute') {
      totals.chunks++;
    }
  }

  const jobDurationMs =
    job.createdDate && job.completedDate
      ? Math.max(0, Date.parse(job.completedDate) - Date.parse(job.createdDate))
      : undefined;

  // Governor data is usable only if SOME phase reported a non-zero usage. Async
  // logs emit their limit block with every value at 0 (verified on a real batch),
  // so an all-zero rollup means "not reported", NOT "nothing was used" — and the
  // difference decides whether the UI may draw limit bars at all.
  const limitsUsable = phases.some((p) => p.analysis.limits.some((l) => l.used > 0));

  return {
    jobId: job.jobId,
    status: job.status,
    className: job.className,
    jobType: job.jobType,
    itemsProcessed: job.itemsProcessed,
    totalItems: job.totalItems,
    numberOfErrors: job.numberOfErrors,
    jobDurationMs,
    phases,
    totals,
    peakLimits: peakLimitsOf(phases),
    limitsUsable,
    insights: deriveBatchInsights(job, phases, totals, options, limitsUsable),
    truncated: phases.some((p) => p.analysis.truncated),
    isFinest: phases.length > 0 && phases.every((p) => p.analysis.isFinest)
  };
}

/**
 * Worst usage per limit name across all phases.
 *
 * IMPORTANT — async caps differ from sync: a batch transaction gets SOQL 200 (not
 * 100) and CPU 60,000ms (not 10,000). Each log reports its OWN cap, so we keep the
 * entry as the log stated it and never assume sync numbers. A chunk at 150 queries
 * is healthy in a batch and fatal in a sync transaction — reporting it against the
 * wrong cap would invert the verdict.
 */
function peakLimitsOf(phases: BatchPhaseAnalysis[]): Array<LimitUsage & { phase: BatchPhase; chunkIndex?: number }> {
  const peak = new Map<string, LimitUsage & { phase: BatchPhase; chunkIndex?: number }>();
  for (const p of phases) {
    for (const l of p.analysis.limits) {
      const prev = peak.get(l.name);
      if (!prev || l.percent > prev.percent) {
        peak.set(l.name, { ...l, phase: p.phase, chunkIndex: p.chunkIndex });
      }
    }
  }
  return [...peak.values()].sort((a, b) => b.percent - a.percent);
}

/**
 * Job-level insights: per-phase findings deduped into "this happens in N chunks",
 * plus findings only visible at job scope.
 */
function deriveBatchInsights(
  job: BatchJobLogs,
  phases: BatchPhaseAnalysis[],
  totals: BatchJobAnalysis['totals'],
  options: AnalyzeOptions,
  limitsUsable: boolean
): BatchInsight[] {
  const out: BatchInsight[] = [];

  // Say plainly that governor data is absent, rather than letting an all-zero
  // rollup read as a clean bill of health. Async logs emit their limit block with
  // every value at 0 (verified), so without this the job looks like it used no CPU
  // and no queries — the most dangerous kind of wrong, because it looks fine.
  if (phases.length > 0 && !limitsUsable) {
    out.push({
      kind: 'not-finest',
      severity: 'warn',
      message:
        'No governor usage reported — every async log in this job listed its limits as 0. That means ' +
        '"not measured", NOT "nothing used": Salesforce emits the limit block before the transaction does ' +
        'its work. Query/DML counts below are counted from the log events instead and ARE reliable; ' +
        'CPU and the limit bars are unavailable for batch jobs.'
    });
  }

  if (job.timedOut) {
    out.push({
      kind: 'truncated',
      severity: 'warn',
      message:
        `Stopped waiting while the job was still "${job.status}" — this analysis covers only the logs ` +
        `produced so far. Later chunks (and finish) are missing. Re-run the analysis once the job completes.`
    });
  }

  // A failed/aborted job, or per-item errors, is the headline finding.
  if (job.status === 'Failed' || job.status === 'Aborted') {
    out.push({
      kind: 'limit-exception',
      severity: 'error',
      message: `Batch job ${job.status} — ${job.numberOfErrors ?? 0} error(s) across ${job.totalItems ?? 0} chunk(s).`,
      detail: job.className
    });
  } else if ((job.numberOfErrors ?? 0) > 0) {
    out.push({
      kind: 'limit-exception',
      severity: 'error',
      message:
        `Job completed but ${job.numberOfErrors} chunk(s) hit errors — Salesforce retries/skips failed chunks, ` +
        `so records in them may be unprocessed.`,
      detail: job.className
    });
  }

  // Roll per-phase insights up by (kind + message shape). A loop query in EVERY
  // chunk is one job-level finding, not N identical rows — but the count matters,
  // so carry it: "in 3 of 3 chunks" is the actionable part.
  const groups = new Map<string, { insight: LogInsight; phases: Set<string>; count: number }>();
  for (const p of phases) {
    for (const i of p.analysis.insights) {
      // `not-finest`/`truncated` are per-log qualities — handled job-wide below.
      if (i.kind === 'not-finest' || i.kind === 'truncated') {
        continue;
      }
      const key = i.kind + '::' + (i.detail ?? i.message).slice(0, 80);
      const g = groups.get(key) ?? { insight: i, phases: new Set<string>(), count: 0 };
      g.phases.add(p.phase + (p.chunkIndex ?? ''));
      g.count += i.count ?? 1;
      groups.set(key, g);
    }
  }
  for (const g of groups.values()) {
    const n = g.phases.size;
    out.push({
      ...g.insight,
      phaseCount: n,
      message: n > 1 ? `${g.insight.message} (in ${n} transactions of this job)` : g.insight.message
    });
  }

  // Job-wide: a per-chunk anti-pattern multiplies by chunk count. 5 loop queries
  // in a chunk looks minor until you notice there are 200 chunks.
  const chunkCount = totals.chunks;
  if (chunkCount > 1 && totals.soql > 0) {
    const perChunk = totals.soql / chunkCount;
    if (perChunk >= (options.loopThreshold ?? 3)) {
      out.push({
        kind: 'loop-soql',
        severity: perChunk >= (options.loopThreshold ?? 3) * 3 ? 'error' : 'warn',
        message:
          `${totals.soql} queries across ${chunkCount} chunks (~${perChunk.toFixed(1)} per chunk). ` +
          `Per-chunk query cost multiplies by the number of chunks — bulkify inside execute().`,
        count: totals.soql
      });
    }
  }

  // Non-FINEST anywhere ⇒ the rollup is blind in the same way a single log is.
  const notFinest = phases.filter((p) => !p.analysis.isFinest).length;
  if (notFinest > 0) {
    out.push({
      kind: 'not-finest',
      severity: 'warn',
      message:
        `${notFinest} of ${phases.length} job logs are not FINEST — those phases contribute no query/DML/method ` +
        `data, so job totals are UNDERSTATED. Re-capture with a FINEST trace flag active before the job runs.`
    });
  }

  if (phases.some((p) => p.analysis.truncated)) {
    out.push({
      kind: 'truncated',
      severity: 'error',
      message:
        'At least one phase log hit MAXIMUM DEBUG LOG SIZE and was cut off — that transaction\'s counts are ' +
        'incomplete, so job totals are a floor, not the true figure.'
    });
  }

  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
}

/** Renders a portable Markdown report of a whole job. */
export function batchAnalysisToMarkdown(a: BatchJobAnalysis): string {
  const L: string[] = [];
  L.push(`# Batch Job Analysis — ${a.className ?? a.jobType ?? 'Async Apex'}`);
  L.push('');
  L.push(`- **Job:** \`${a.jobId}\` · **Status:** ${a.status}`);
  L.push(`- **Chunks:** ${a.itemsProcessed ?? '?'} / ${a.totalItems ?? '?'} · **Errors:** ${a.numberOfErrors ?? 0}`);
  if (a.jobDurationMs !== undefined) {
    L.push(`- **Job wall time:** ${(a.jobDurationMs / 1000).toFixed(1)}s`);
  }
  const cpu = a.limitsUsable
    ? `${a.totals.cpuMs}ms CPU (summed; each chunk gets a fresh allowance)`
    : 'CPU not reported (async logs list limits as 0)';
  L.push(`- **Totals:** ${a.totals.soql} SOQL · ${a.totals.dml} DML · ${a.totals.dbRows} rows · ` +
    `${cpu} · ${a.totals.callouts} callouts`);
  if (!a.isFinest) {
    L.push(`- ⚠️ Not all logs are FINEST — totals are understated.`);
  }
  L.push('');

  if (a.insights.length) {
    L.push('## Insights');
    for (const i of a.insights) {
      // Include `detail` (the query / method / limit the insight is about): two
      // different queries can produce the SAME message ("4 identical SOQL
      // operations"), and without the detail they read as an accidental duplicate.
      const detail = i.detail ? ` \`${i.detail}\`` : '';
      L.push(`- **${i.severity === 'error' ? 'HIGH' : 'WARN'}** — ${i.message}${detail}`);
    }
    L.push('');
  }

  if (a.limitsUsable && a.peakLimits.some((l) => l.percent > 0)) {
    L.push('## Peak limit usage (worst chunk per limit)');
    L.push('| Limit | Used | Cap | % | Where |');
    L.push('| --- | ---: | ---: | ---: | --- |');
    for (const l of a.peakLimits.filter((x) => x.percent > 0)) {
      const where = l.phase + (l.chunkIndex ? ` #${l.chunkIndex}` : '');
      L.push(`| ${l.name} | ${l.used} | ${l.limit} | ${l.percent.toFixed(0)}% | ${where} |`);
    }
    L.push('');
  }

  L.push('## Phases');
  L.push('| Phase | SOQL | DML | Rows | CPU ms | Wall ms | Errors |');
  L.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const p of a.phases) {
    const name = p.phase + (p.chunkIndex ? ` #${p.chunkIndex}` : '');
    const an = p.analysis;
    // Show CPU only where it was actually measured — a bare "0" would read as
    // "used no CPU" when the truth is the async log never reported it.
    const phaseCpu = a.limitsUsable && an.cpuMs !== undefined ? String(an.cpuMs) : '—';
    L.push(`| ${name} | ${an.counts.soql} | ${an.counts.dml} | ${an.counts.dbRows} | ` +
      `${phaseCpu} | ${an.durationMs.toFixed(0)} | ${an.errors.length} |`);
  }
  return L.join('\n');
}

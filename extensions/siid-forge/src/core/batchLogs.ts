/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { SfExecutor } from './sfExecutor';
import { Logger } from './logger';
import { ensureSiidSubdir } from './forgeConfig';

/**
 * Collects the logs of an ASYNC Apex job (Batchable / Queueable / Schedulable).
 *
 * Why this exists: `saveApexLogs` cannot do it. A batch job is not one
 * transaction — `start`, EACH `execute` chunk, and `finish` run in their own
 * transaction and each emit their OWN ApexLog. `saveApexLogs` takes logs within a
 * fixed 30s window of the *sync* run that enqueued the job, and its callers pass
 * `limit: 1`, so a batch yields exactly one log (whichever landed first) while the
 * chunks and `finish` — often minutes later, long after the CLI call returned —
 * are never fetched at all. Hence: poll the job, then collect all of its logs.
 *
 * Everything here was derived from a REAL batch run against a dev org (12 records,
 * chunk size 5 → start + 3 execute chunks + finish = 5 transactions, 6 logs), not
 * from the docs. The load-bearing findings are documented at each usage site.
 */

/** Which phase of the async job a single log came from. */
export type BatchPhase = 'start' | 'execute' | 'finish' | 'unknown';

/** One transaction's log within an async job. */
export interface BatchPhaseLog {
  /** ApexLog Id. */
  id: string;
  phase: BatchPhase;
  /** For `execute`, its 1-based chunk number in execution order. */
  chunkIndex?: number;
  startTime?: string;
  /** Salesforce's `Operation` (e.g. "Batch Apex", "SerialBatchApexRangeChunkHandler"). */
  operation?: string;
  /** Groups the transactions of one request; all execute chunks share one. */
  requestIdentifier?: string;
  durationMs?: number;
  /** Absolute path of the saved `.log` file. */
  file: string;
}

/** The job + all of its logs, ready to analyze. */
export interface BatchJobLogs {
  jobId: string;
  /** AsyncApexJob.Status at collection time (Completed / Failed / Aborted…). */
  status: string;
  jobType?: string;
  className?: string;
  /** Chunks processed / total, from AsyncApexJob. */
  itemsProcessed?: number;
  totalItems?: number;
  numberOfErrors?: number;
  createdDate?: string;
  completedDate?: string;
  /** Every log of this job, in phase order: start → execute chunks → finish. */
  logs: BatchPhaseLog[];
  /** True when polling gave up before the job reached a terminal state. */
  timedOut?: boolean;
}

/** AsyncApexJob states that mean the job will not progress further. */
const TERMINAL = new Set(['Completed', 'Failed', 'Aborted']);

export interface CollectBatchOptions {
  /** Max time to wait for the job to finish. Default 5 minutes. */
  timeoutMs?: number;
  /** Gap between job-status polls. Default 3s. */
  pollIntervalMs?: number;
  /** Progress callback: fires on each poll with the live job state. */
  onProgress?: (info: { status: string; itemsProcessed?: number; totalItems?: number; elapsedMs: number }) => void;
}

/**
 * Polls `AsyncApexJob` until the job reaches a terminal state, then downloads and
 * classifies every log it produced.
 *
 * Polling (not a fixed wait) is the only correct approach: a batch is queued and
 * its chunks run whenever the platform schedules them — seconds or minutes later.
 * `AsyncApexJob.Status` is the authoritative completion signal, and its
 * CreatedDate→CompletedDate window is what bounds the log search.
 */
export async function collectBatchJobLogs(
  sf: SfExecutor,
  projectRoot: string,
  jobId: string,
  opts: CollectBatchOptions = {},
  logger?: Logger,
  token?: vscode.CancellationToken
): Promise<BatchJobLogs> {
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;
  const pollIntervalMs = opts.pollIntervalMs ?? 3000;
  const log = (m: string) => logger?.info(`[batchLogs] ${m}`);
  const started = Date.now();

  let job = await queryJob(sf, projectRoot, jobId);
  if (!job) {
    throw new Error(`Async job ${jobId} not found. Check the job Id (15/18-char 707…).`);
  }

  let timedOut = false;
  while (!TERMINAL.has(job.Status)) {
    if (token?.isCancellationRequested) {
      log('cancelled while waiting for the job');
      break;
    }
    if (Date.now() - started > timeoutMs) {
      timedOut = true;
      log(`timed out after ${timeoutMs}ms with status=${job.Status}`);
      break;
    }
    opts.onProgress?.({
      status: job.Status,
      itemsProcessed: job.JobItemsProcessed,
      totalItems: job.TotalJobItems,
      elapsedMs: Date.now() - started
    });
    await delay(pollIntervalMs, token);
    const next = await queryJob(sf, projectRoot, jobId);
    if (next) {
      job = next;
    }
  }
  log(`job ${jobId} status=${job.Status} items=${job.JobItemsProcessed}/${job.TotalJobItems}`);
  opts.onProgress?.({
    status: job.Status,
    itemsProcessed: job.JobItemsProcessed,
    totalItems: job.TotalJobItems,
    elapsedMs: Date.now() - started
  });

  const logs = await collectLogsFor(sf, projectRoot, job, logger);

  return {
    jobId,
    status: job.Status,
    jobType: job.JobType,
    className: job.ApexClass?.Name,
    itemsProcessed: job.JobItemsProcessed,
    totalItems: job.TotalJobItems,
    numberOfErrors: job.NumberOfErrors,
    createdDate: job.CreatedDate,
    completedDate: job.CompletedDate,
    logs,
    timedOut: timedOut || undefined
  };
}

interface AsyncJob {
  Id: string;
  Status: string;
  JobType?: string;
  JobItemsProcessed?: number;
  TotalJobItems?: number;
  NumberOfErrors?: number;
  CreatedDate?: string;
  CompletedDate?: string;
  ApexClass?: { Name?: string };
}

async function queryJob(sf: SfExecutor, cwd: string, jobId: string): Promise<AsyncJob | undefined> {
  const { result } = await sf.run<{ records: AsyncJob[] }>(
    [
      'data', 'query', '--query',
      `SELECT Id, Status, JobType, JobItemsProcessed, TotalJobItems, NumberOfErrors, ` +
      `CreatedDate, CompletedDate, ApexClass.Name FROM AsyncApexJob WHERE Id = '${jobId}'`
    ],
    { cwd }
  );
  return result?.records?.[0];
}

/**
 * Finds, downloads and classifies the job's logs.
 *
 * Correlation is INFERRED, because it has to be: `ApexLog` has NO job-Id field
 * (verified against the describe — the only usable columns are Operation,
 * StartTime, RequestIdentifier, Location, Application). So we bound by the job's
 * time window and identify phases from the log CONTENT.
 */
async function collectLogsFor(
  sf: SfExecutor,
  projectRoot: string,
  job: AsyncJob,
  logger?: Logger
): Promise<BatchPhaseLog[]> {
  const log = (m: string) => logger?.info(`[batchLogs] ${m}`);

  // Window the search to the job's own lifetime, with a small buffer at each end
  // (a log's StartTime can sit marginally outside CreatedDate/CompletedDate).
  const from = shiftIso(job.CreatedDate, -30_000);
  const to = shiftIso(job.CompletedDate ?? new Date().toISOString(), 60_000);
  const where = [`StartTime >= ${from}`, `StartTime <= ${to}`].join(' AND ');

  const { result } = await sf.run<{ records: RawLog[] }>(
    [
      'data', 'query', '--use-tooling-api', '--query',
      `SELECT Id, Operation, StartTime, DurationMilliseconds, RequestIdentifier ` +
      `FROM ApexLog WHERE ${where} ORDER BY StartTime ASC`
    ],
    { cwd: projectRoot }
  );
  const candidates = result?.records ?? [];
  log(`${candidates.length} log(s) in the job window`);
  if (!candidates.length) {
    return [];
  }

  const dir = ensureSiidSubdir(projectRoot, path.join('logs', 'batch'));
  const kept: Array<{ rec: RawLog; body: string; phase: BatchPhase }> = [];

  for (const rec of candidates) {
    // Only async-job operations. The window can also contain the SYNC log of
    // whatever enqueued the job (Operation "Api" / an executeAnonymous path) —
    // that is a different transaction and must not be folded into the job.
    if (!isAsyncOperation(rec.Operation)) {
      continue;
    }
    const body = await getLogBody(sf, projectRoot, rec.Id);
    if (!body) {
      continue;
    }
    // The window alone is NOT a filter. Jobs run back-to-back (and concurrently),
    // so a neighbouring job's chunks fall inside it — VERIFIED: a stale chunk from
    // the PREVIOUS run appeared as a 4th "execute" that processed 0 records and sat
    // BEFORE `start` in time, in a job whose own count said 3 chunks. Require the
    // log to name THIS job's class, so another class's job can never be absorbed.
    if (job.ApexClass?.Name && !namesClass(body, job.ApexClass.Name)) {
      continue;
    }
    kept.push({ rec, body, phase: classifyPhase(rec.Operation, body) });
  }

  // Drop Salesforce's job-level PROFILING SUMMARY, which masquerades as a chunk.
  // VERIFIED: a batch of 12 records in 3 chunks produced a FOURTH "execute" log —
  // same reqId as the real chunks, a real `External entry point: … execute(…)`
  // line — but it ran NO records: no per-chunk work, no DML, and its profiling
  // rows aggregate the WHOLE job ("executed 12 times", "executed 3 times").
  // Counting it as a chunk inflated 3 chunks to 4 and put an empty 994ms row at
  // the top of the phase table. It has profiling data but no execution body, so
  // that is exactly what we test for.
  const summaries = kept.filter((k) => k.phase === 'execute' && isProfilingSummary(k.body));
  const filtered = kept.filter((k) => !summaries.includes(k));
  if (summaries.length) {
    log(`dropped ${summaries.length} job-level profiling summary log(s) (not real chunks)`);
  }

  const out: BatchPhaseLog[] = [];
  let chunk = 0;
  for (const { rec, body, phase } of filtered) {
    const file = path.join(dir, `${job.Id}-${String(out.length + 1).padStart(2, '0')}-${phase}-${rec.Id}.log`);
    fs.writeFileSync(file, body, 'utf-8');
    out.push({
      id: rec.Id,
      phase,
      chunkIndex: phase === 'execute' ? ++chunk : undefined,
      startTime: rec.StartTime,
      operation: rec.Operation,
      requestIdentifier: rec.RequestIdentifier,
      durationMs: rec.DurationMilliseconds,
      file
    });
  }

  // Present in logical phase order — NOT the order Salesforce returns. In a real
  // run, `finish` came back BEFORE the execute chunks by StartTime, so sorting by
  // time alone would misrepresent the job's shape.
  const rank: Record<BatchPhase, number> = { start: 0, execute: 1, finish: 2, unknown: 3 };
  out.sort((a, b) => rank[a.phase] - rank[b.phase] || (a.chunkIndex ?? 0) - (b.chunkIndex ?? 0));
  log(`collected: ${out.map((l) => l.phase + (l.chunkIndex ? '#' + l.chunkIndex : '')).join(', ')}`);
  return out;
}

interface RawLog {
  Id: string;
  Operation?: string;
  StartTime?: string;
  DurationMilliseconds?: number;
  RequestIdentifier?: string;
}

/**
 * True for Salesforce's job-level profiling-summary log — a trailing log that
 * reports cumulative timings for the WHOLE job but executes nothing.
 *
 * It is deceptively chunk-like: same Operation, same RequestIdentifier as the real
 * chunks, and even an `External entry point: … execute(…)` line. The tell is that
 * it has NO execution body — no METHOD_ENTRY, no SOQL/DML events — because the
 * work happened in the other logs; it only carries the aggregate profiling rows.
 * So test for a body that never entered a method or touched the database.
 */
function isProfilingSummary(body: string): boolean {
  const hasWork =
    /\|METHOD_ENTRY\|/.test(body) ||
    /\|SOQL_EXECUTE_BEGIN\|/.test(body) ||
    /\|DML_BEGIN\|/.test(body);
  return !hasWork && /\|CODE_UNIT_STARTED\|/.test(body);
}

/**
 * True when the log is this job's class executing — the CODE_UNIT_STARTED /
 * METHOD_ENTRY frames name it. Guards against absorbing a DIFFERENT class's job
 * that merely overlapped this one's time window.
 */
function namesClass(body: string, className: string): boolean {
  const esc = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${esc}\\b`).test(body);
}

/**
 * True for an Operation produced by async Apex. Batch chunks run under
 * `SerialBatchApexRangeChunkHandler`; `start`/`finish` under `Batch Apex`;
 * queueable/scheduled/future jobs carry their own labels.
 */
function isAsyncOperation(op?: string): boolean {
  if (!op) {
    return false;
  }
  return /Batch Apex|BatchApex|ChunkHandler|Queueable|Scheduled|Schedule|Future/i.test(op);
}

/**
 * Determines which phase a log belongs to.
 *
 * Metadata alone CANNOT do this: `start` and `finish` BOTH report Operation
 * "Batch Apex" (verified on a real job). Neither can the CODE_UNIT_STARTED line —
 * for those phases it names only the CLASS (`…|01pg…|SiidLogDemoBatch`), with no
 * method suffix, so there is nothing there to match on.
 *
 * The reliable discriminators, in order:
 *  1. Operation "…ChunkHandler" → an execute chunk (unambiguous).
 *  2. `External entry point: … <method>(Database.BatchableContext…)` — Salesforce
 *     names the actual interface method that was invoked in the CUMULATIVE_PROFILING
 *     block. This is the authoritative signal and is emitted for real batch classes
 *     regardless of what the class itself logs.
 *  3. `METHOD_ENTRY|…|<Class>.finish` / `.start` / `.execute` — the method frame
 *     itself, present when profiling info is absent.
 *
 * Deliberately NOT used: USER_DEBUG text. That is whatever the class chose to
 * print, so it exists only in classes that happen to log — useless in general.
 */
function classifyPhase(operation: string | undefined, body: string): BatchPhase {
  if (operation && /ChunkHandler/i.test(operation)) {
    return 'execute';
  }
  // The profiler names the entry point, e.g.
  // "External entry point: public Database.QueryLocator start(Database.BatchableContext)".
  const entry = body.match(/External entry point:[^\n]*?\b(start|execute|finish)\s*\(/i);
  if (entry) {
    return entry[1].toLowerCase() as BatchPhase;
  }
  // Fall back to the method frame: "METHOD_ENTRY|[14]|01p…|MyBatch.finish(…)".
  // A constructor frame (`MyBatch.MyBatch`) must not match, hence the method list.
  const m = body.match(/METHOD_ENTRY\|[^\n]*\|[\w.]*\.(start|execute|finish)\s*\(/i);
  if (m) {
    return m[1].toLowerCase() as BatchPhase;
  }
  return 'unknown';
}

async function getLogBody(sf: SfExecutor, cwd: string, id: string): Promise<string | undefined> {
  try {
    const { result } = await sf.run<string>(['apex', 'get', 'log', '--log-id', id], { cwd, json: false });
    return typeof result === 'string' ? result : undefined;
  } catch {
    return undefined;
  }
}

/** ISO timestamp shifted by `ms`, in the SOQL datetime literal form. */
function shiftIso(iso: string | undefined, ms: number): string {
  const base = iso ? Date.parse(iso) : Date.now();
  return new Date(base + ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function delay(ms: number, token?: vscode.CancellationToken): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    token?.onCancellationRequested(() => {
      clearTimeout(t);
      resolve();
    });
  });
}

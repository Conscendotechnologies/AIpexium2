/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { SfExecutor } from './sfExecutor';
import { OrgManager } from './orgManager';
import { TraceManager } from './traceManager';
import { SchemaManager } from './schemaManager';
import { Logger } from './logger';
import { generateApexTest, ApexGenerateEvent, ApexGenerateResult } from './apexTestGenerator';

/**
 * Batch orchestrator (plan §18.F) — generates tests for MANY classes by running
 * the per-class `generateApexTest` loop SEQUENTIALLY (never parallel: each class
 * deploys + runs org tests, and parallel org round-trips would thrash limits).
 * Headless + agent-consumable (§14): streams per-class + aggregate events; the
 * webview is a thin consumer.
 */

export interface BatchItemResult {
  className: string;
  clsPath: string;
  success: boolean;
  passed: number;
  total: number;
  coverage?: number;
  tokens: number;
  cost: number;
  blockedReason?: string;
  error?: string;
}

/** Events streamed during a batch run (superset of the per-class events). */
export type BatchEvent =
  | { type: 'batch-start'; total: number; classes: string[] }
  | { type: 'item-start'; index: number; className: string }
  | { type: 'item-event'; index: number; className: string; event: ApexGenerateEvent }
  | { type: 'item-done'; index: number; result: BatchItemResult; cumulativeTokens: number; cumulativeCost: number }
  | { type: 'batch-done'; results: BatchItemResult[]; totalTokens: number; totalCost: number; succeeded: number; stopped: boolean };

export interface BatchOptions {
  sf: SfExecutor;
  orgs: OrgManager;
  trace: TraceManager;
  schema: SchemaManager;
  logger: Logger;
  projectRoot: string;
  /** Absolute `.cls` paths of the classes under test (NOT test classes). */
  clsPaths: string[];
  apiKey: string;
  model: string;
  coverageTarget?: number;
  maxRetries?: number;
  signal?: AbortSignal;
  onEvent?: (e: BatchEvent) => void;
}

export interface BatchSummary {
  results: BatchItemResult[];
  totalTokens: number;
  totalCost: number;
  succeeded: number;
  stopped: boolean;
}

/**
 * Runs generation for each class in order. A single `signal` abort stops the
 * whole batch after the in-flight class finishes (we never kill a class
 * mid-deploy — that could leave a half-written test in the org).
 */
export async function generateApexTestsBatch(opts: BatchOptions): Promise<BatchSummary> {
  const { clsPaths } = opts;
  const results: BatchItemResult[] = [];
  let totalTokens = 0;
  let totalCost = 0;
  let stopped = false;

  opts.onEvent?.({ type: 'batch-start', total: clsPaths.length, classes: clsPaths.map(baseName) });

  for (let i = 0; i < clsPaths.length; i++) {
    if (opts.signal?.aborted) {
      stopped = true;
      break;
    }
    const clsPath = clsPaths[i];
    const className = baseName(clsPath);
    opts.onEvent?.({ type: 'item-start', index: i, className });

    let result: BatchItemResult;
    try {
      const r: ApexGenerateResult = await generateApexTest({
        sf: opts.sf,
        orgs: opts.orgs,
        trace: opts.trace,
        schema: opts.schema,
        logger: opts.logger,
        projectRoot: opts.projectRoot,
        clsPath,
        apiKey: opts.apiKey,
        model: opts.model,
        coverageTarget: opts.coverageTarget,
        maxRetries: opts.maxRetries,
        signal: opts.signal,
        onEvent: (event) => opts.onEvent?.({ type: 'item-event', index: i, className, event })
      });
      result = {
        className,
        clsPath,
        success: r.success,
        passed: r.passed,
        total: r.total,
        coverage: r.coverage,
        tokens: r.totalTokens,
        cost: r.totalCost,
        blockedReason: r.blockedReason
      };
    } catch (err: any) {
      result = { className, clsPath, success: false, passed: 0, total: 0, tokens: 0, cost: 0, error: err?.message ?? String(err) };
    }

    results.push(result);
    totalTokens += result.tokens;
    totalCost += result.cost;
    opts.onEvent?.({ type: 'item-done', index: i, result, cumulativeTokens: totalTokens, cumulativeCost: totalCost });

    // A production-org block applies to every class — stop the whole batch.
    if (result.blockedReason) {
      stopped = true;
      break;
    }
  }

  const succeeded = results.filter((r) => r.success).length;
  const summary: BatchSummary = { results, totalTokens, totalCost, succeeded, stopped };
  opts.onEvent?.({ type: 'batch-done', ...summary });
  opts.logger.info(`[apex-test-batch] done: ${succeeded}/${results.length} succeeded, ${totalTokens} tokens${totalCost ? ` / $${totalCost.toFixed(5)}` : ''}${stopped ? ' (stopped early)' : ''}`);
  return summary;
}

function baseName(clsPath: string): string {
  const b = clsPath.replace(/\\/g, '/').split('/').pop() ?? clsPath;
  return b.replace(/\.cls$/, '');
}

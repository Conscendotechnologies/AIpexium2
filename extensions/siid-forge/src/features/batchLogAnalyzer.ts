/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { Commands } from '../commands';
import { notify } from '../ui/notify';
import { collectBatchJobLogs } from '../core/batchLogs';
import { analyzeBatchJob } from '../core/replay/batchAnalyzer';
import { SfExecutor } from '../core/sfExecutor';
import { Logger } from '../core/logger';
import { BatchJobPanel } from './batchJobPanel';
import { Feature } from './types';

/**
 * Registers the Batch Job Analyzer: pick (or pass) an async Apex job, wait for it
 * to finish, then show ONE analysis of the whole job with a per-phase breakdown.
 *
 * This exists because the single-log analyzer structurally cannot cover a batch:
 * `start`, each `execute` chunk and `finish` are separate transactions with
 * separate logs, and the chunks often land minutes after the call that enqueued
 * the job returned. Thin UI over the headless `collectBatchJobLogs` +
 * `analyzeBatchJob` services (§14) — the agent/SDK call the same pair.
 */
export const registerBatchLogAnalyzer: Feature = ({ context, sf, logger }) => {
  const root = () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  context.subscriptions.push(
    vscode.commands.registerCommand(Commands.analyzeBatchJob, async (arg?: string) => {
      const projectRoot = root();
      if (!projectRoot) {
        notify.err('Open a project folder first.');
        return;
      }
      const jobId = arg ?? (await pickJob(sf, projectRoot, logger));
      if (!jobId) {
        return;
      }

      try {
        const analysis = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'Analyzing batch job', cancellable: true },
          async (progress, token) => {
            const job = await collectBatchJobLogs(
              sf,
              projectRoot,
              jobId,
              {
                // A job is queued and its chunks run when the platform schedules
                // them, so report live progress rather than appearing hung.
                onProgress: ({ status, itemsProcessed, totalItems, elapsedMs }) => {
                  const done = itemsProcessed ?? 0;
                  const all = totalItems ?? 0;
                  const chunks = all ? ` — ${done}/${all} chunks` : '';
                  progress.report({ message: `${status}${chunks} (${Math.round(elapsedMs / 1000)}s)` });
                }
              },
              logger,
              token
            );
            if (!job.logs.length) {
              throw new Error(
                `No logs found for job ${jobId}. Debug logging must be ACTIVE BEFORE the job runs — a trace ` +
                `flag set afterwards cannot recover them. Re-run the job with a FINEST trace flag in place.`
              );
            }
            progress.report({ message: `Analyzing ${job.logs.length} log(s)…` });
            return analyzeBatchJob(job);
          }
        );
        BatchJobPanel.show({ logger }, analysis);
      } catch (err: any) {
        logger.error(`analyzeBatchJob: ${err?.message}`);
        notify.err(`Could not analyze batch job: ${err?.message}`);
      }
    })
  );
};

interface JobRow {
  Id: string;
  Status: string;
  JobType?: string;
  MethodName?: string;
  JobItemsProcessed?: number;
  TotalJobItems?: number;
  NumberOfErrors?: number;
  CreatedDate?: string;
  ApexClass?: { Name?: string };
}

/**
 * Quick-pick of recent async jobs. Users think in "my batch class", not job Ids,
 * so offer the jobs rather than demanding a 707… Id — while still accepting one
 * via the command argument for the agent/deep-link path.
 */
async function pickJob(sf: SfExecutor, projectRoot: string, logger: Logger): Promise<string | undefined> {
  let rows: JobRow[] = [];
  try {
    const { result } = await sf.run<{ records: JobRow[] }>(
      [
        'data', 'query', '--query',
        `SELECT Id, Status, JobType, MethodName, JobItemsProcessed, TotalJobItems, NumberOfErrors, ` +
        `CreatedDate, ApexClass.Name FROM AsyncApexJob ` +
        `WHERE JobType IN ('BatchApex','Queueable','ScheduledApex','Future') ` +
        `ORDER BY CreatedDate DESC LIMIT 25`
      ],
      { cwd: projectRoot }
    );
    rows = result?.records ?? [];
  } catch (err: any) {
    logger?.error(`pickJob: ${err?.message}`);
    notify.err(`Could not list async jobs: ${err?.message}`);
    return undefined;
  }

  if (!rows.length) {
    notify.info('No recent async Apex jobs found in this org.');
    return undefined;
  }

  const items = rows.map((r) => {
    const name = r.ApexClass?.Name ?? r.MethodName ?? r.JobType ?? 'Async job';
    const chunks = r.TotalJobItems ? `${r.JobItemsProcessed ?? 0}/${r.TotalJobItems} chunks` : '';
    const errs = (r.NumberOfErrors ?? 0) > 0 ? ` · ${r.NumberOfErrors} error(s)` : '';
    const when = r.CreatedDate ? new Date(r.CreatedDate).toLocaleString() : '';
    return {
      label: `${statusIcon(r.Status)} ${name}`,
      description: `${r.Status}${chunks ? ' · ' + chunks : ''}${errs}`,
      detail: `${r.JobType ?? ''} · ${when} · ${r.Id}`,
      jobId: r.Id
    };
  });

  const picked = await vscode.window.showQuickPick(items, {
    title: 'Analyze Batch Job',
    placeHolder: 'Pick an async Apex job (its start/execute/finish logs are analyzed together)'
  });
  return picked?.jobId;
}

function statusIcon(status: string): string {
  if (status === 'Completed') {
    return '$(pass)';
  }
  if (status === 'Failed' || status === 'Aborted') {
    return '$(error)';
  }
  return '$(sync~spin)';
}

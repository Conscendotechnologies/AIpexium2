/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { SfCommandStatus } from '../core/sfExecutor';
import { Feature } from './types';

/**
 * Turns a raw `sf` command line into a short, human-readable action label so the
 * status bar reads "Listing orgs…" instead of a meaningless "sf 3". We map the
 * common topic/verb pairs we run; anything unmapped falls back to a Title-cased
 * "topic verb". Never shows the raw args (paths, queries, tokens).
 */
function describeSfCommand(command: string): string {
  // command looks like: `sf org list --json` (bin + args, values shell-quoted)
  // Flag-only commands (e.g. `sf --version`, `sf update`) have no topic/verb, so
  // handle them before the topic/verb parsing strips everything to nothing.
  if (/\s--version\b/.test(command)) { return 'Checking CLI version'; }
  if (/\bsf(?:\.cmd)?\s+update\b/.test(command)) { return 'Updating CLI'; }

  const parts = command
    .replace(/\s--json\b.*$/, '')            // drop --json and everything after
    .split(/\s+/)
    .slice(1)                                 // drop the `sf` / `sf.cmd` binary
    .filter((p) => !p.startsWith('-'));       // drop flags/values, keep topic+verb

  const topic = parts[0];
  const verb = parts[1];
  const sub = parts[2];
  const key = [topic, verb, sub].filter(Boolean).join(' ');

  const MAP: Record<string, string> = {
    'org list': 'Listing orgs',
    'org display': 'Reading org info',
    'org login web': 'Authorizing org',
    'org login access-token': 'Authorizing org',
    'config get': 'Reading config',
    'config set': 'Updating config',
    'data query': 'Querying org',
    'apex run test': 'Running Apex tests',
    'apex get log': 'Fetching logs',
    'project deploy start': 'Deploying',
    'project retrieve start': 'Retrieving',
    'sobject describe': 'Describing object',
    'sobject list': 'Listing objects'
  };
  if (MAP[key]) { return MAP[key]; }
  if (topic && MAP[`${topic} ${verb}`]) { return MAP[`${topic} ${verb}`]; }

  // Fallback: "apex run" → "Apex run". Better than the raw command, still safe.
  const words = [topic, verb].filter(Boolean).join(' ');
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Working';
}

/**
 * Global CLI status-bar indicator. Subscribes to the executor's
 * `onDidChangeActivity` (fired for EVERY `sf` command) and shows a spinner with
 * a MEANINGFUL action label ("Listing orgs…") while a command is in flight,
 * briefly flashing the outcome when it finishes. Purely presentational — reads
 * the in-process event, never the command output.
 *
 * Note: elapsed-time counters and per-command progress live on the CALLER's UI
 * (test panels etc.), which already receive the `onStatus` stream. This global
 * bar deliberately stays minimal — a label + a count when several run at once —
 * so it reads as an activity hint, not a raw "sf 1,2,3" ticker.
 *
 * Handles concurrent commands with a simple in-flight counter (several features
 * can run `sf` at once); the bar stays visible until the last one settles.
 */
export const registerCliStatusBar: Feature = ({ context, sf }) => {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  context.subscriptions.push(item);

  // Grace period after the last command settles before we flash "done" — a
  // batch of sequential commands (e.g. schema refresh describes each object
  // one at a time) briefly hits 0 in-flight between each; without this the bar
  // flickers "running → done → running…". If a new command starts inside the
  // window, we treat it as the same continuous run.
  const IDLE_GRACE_MS = 700;

  let inFlight = 0;
  let completed = 0;            // commands finished in this run (for the count)
  let currentLabel = 'Working'; // meaningful action label for the in-flight command
  let batchStartedAt = 0;       // when the CURRENT run began (survives the grace gap)
  let ticker: ReturnType<typeof setInterval> | undefined;
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  const clearTimers = () => {
    if (ticker) { clearInterval(ticker); ticker = undefined; }
    if (graceTimer) { clearTimeout(graceTimer); graceTimer = undefined; }
  };

  const render = () => {
    // Meaningful label first, THEN the counter: elapsed seconds, plus a count
    // when several commands run in one continuous run. e.g. "Listing orgs… 3s (2)".
    const secs = Math.max(0, Math.round((Date.now() - batchStartedAt) / 1000));
    const n = inFlight > 1 ? ` ×${inFlight}` : (completed > 0 ? ` (${completed + inFlight})` : '');
    item.text = `$(sync~spin) ${currentLabel}… ${secs}s${n}`;
    item.tooltip = 'SIID Forge: running Salesforce CLI command(s)';
    item.show();
  };

  const flashThenHide = (text: string, tooltip: string) => {
    item.text = text;
    item.tooltip = tooltip;
    item.show();
    if (hideTimer) { clearTimeout(hideTimer); }
    hideTimer = setTimeout(() => item.hide(), 2500);
  };

  context.subscriptions.push(
    sf.onDidChangeActivity((s: SfCommandStatus) => {
      switch (s.phase) {
        case 'started':
          // A new command — cancel any pending "done" grace so we stay in the
          // same continuous run, and reset the count if we were idle.
          if (graceTimer) { clearTimeout(graceTimer); graceTimer = undefined; }
          if (inFlight === 0 && !ticker) {
            batchStartedAt = Date.now();
            completed = 0;
            ticker = setInterval(render, 1000);
            if (typeof ticker.unref === 'function') { ticker.unref(); }
          }
          currentLabel = describeSfCommand(s.command);
          inFlight++;
          render();
          break;

        case 'running':
          break; // the ticker repaints elapsed seconds on its own

        case 'succeeded':
        case 'failed':
        case 'cancelled':
          inFlight = Math.max(0, inFlight - 1);
          completed++;
          if (inFlight > 0) {
            render(); // others still running
            break;
          }
          // Idle — but wait out the grace window before declaring done, in case
          // the next command in a sequence starts immediately.
          if (graceTimer) { clearTimeout(graceTimer); }
          const lastPhase = s.phase;
          const lastMessage = s.message;
          const lastLabel = currentLabel;
          graceTimer = setTimeout(() => {
            graceTimer = undefined;
            if (inFlight > 0) { return; } // a new run started; leave it alone
            clearTimers();
            const secs = Math.round((Date.now() - batchStartedAt) / 1000);
            const n = completed > 1 ? ` (${completed})` : '';
            if (lastPhase === 'succeeded') {
              flashThenHide(`$(check) ${lastLabel} done ${secs}s${n}`, 'SIID Forge: Salesforce CLI command(s) finished');
            } else if (lastPhase === 'cancelled') {
              flashThenHide(`$(circle-slash) ${lastLabel} cancelled`, 'SIID Forge: command cancelled');
            } else {
              flashThenHide(`$(error) ${lastLabel} failed`, `SIID Forge: ${lastMessage ?? 'command failed'}`);
            }
          }, IDLE_GRACE_MS);
          break;
      }
    })
  );
};

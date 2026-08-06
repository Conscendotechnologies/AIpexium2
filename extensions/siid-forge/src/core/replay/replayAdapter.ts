/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { ReplayStep, ANON_CLASS } from './logParser';
import { Logger } from '../logger';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Msg = any;

/** Apex source file basename, sans extension, lowercased (Apex is case-insensitive). */
function classKey(filePath: string): string {
  const base = filePath.replace(/\\/g, '/').split('/').pop() ?? filePath;
  return base.replace(/\.(cls|trigger|apex)$/i, '').toLowerCase();
}

/**
 * A dependency-free inline Debug Adapter that "replays" a parsed Apex log
 * timeline: breakpoints, step over/into/out, call stack and variables. It
 * implements the Debug Adapter Protocol message handling directly.
 */
export class ReplayDebugAdapter implements vscode.DebugAdapter {
  private readonly _onDidSendMessage = new vscode.EventEmitter<vscode.DebugProtocolMessage>();
  readonly onDidSendMessage = this._onDidSendMessage.event;

  private seq = 1;
  private index = 0;
  /** className (lowercase) -> { lines, path }. Keyed by the source file's base
   *  name so a step matches a breakpoint even if the schema cache doesn't know
   *  the file (e.g. a freshly-created test class). */
  private readonly breakpoints = new Map<string, { lines: Set<number>; path: string }>();

  /** className (lowercase) -> set of lines that actually executed in the log. */
  private readonly execLines = new Map<string, Set<number>>();

  /** path -> number of breakpoints the user requested (matched or not), so we
   *  can tell "set but didn't match this log" from "no breakpoints at all". */
  private readonly requestedByPath = new Map<string, number>();

  constructor(
    private readonly steps: ReplayStep[],
    private readonly resolveFile: (className?: string) => string | undefined,
    /** Fallback source file (e.g. the .apex file for anonymous Apex). */
    private readonly defaultSource?: string,
    private readonly logger?: Logger
  ) {
    // Index the lines each class produced a step on, so we can verify a
    // breakpoint sits on a line the log actually has.
    for (const s of this.steps) {
      if (!s.className) {
        continue;
      }
      const key = s.className.toLowerCase();
      (this.execLines.get(key) ?? this.execLines.set(key, new Set()).get(key)!).add(s.line);
    }
  }

  private log(msg: string): void {
    this.logger?.info(`[replay] ${msg}`);
  }

  /**
   * Resolve a frame's source file: prefer the schema cache, then a breakpoint
   * the user set in that class (so freshly-created classes still map), then the
   * default source (anonymous Apex).
   */
  private resolve(className?: string): string | undefined {
    // Anonymous Apex: always the launch's source .apex file.
    if (className === ANON_CLASS) {
      return this.defaultSource;
    }
    const fromCache = this.resolveFile(className);
    if (fromCache) {
      return fromCache;
    }
    const fromBreakpoint = className && this.breakpoints.get(className.toLowerCase())?.path;
    return fromBreakpoint ?? this.defaultSource;
  }

  handleMessage(message: vscode.DebugProtocolMessage): void {
    const req = message as Msg;
    if (req.type !== 'request') {
      return;
    }
    switch (req.command) {
      case 'initialize': return this.onInitialize(req);
      case 'setBreakpoints': return this.onSetBreakpoints(req);
      case 'configurationDone': return this.onConfigurationDone(req);
      case 'launch': return this.onLaunch(req);
      case 'threads': return this.respond(req, { threads: [{ id: 1, name: 'Apex Replay' }] });
      case 'stackTrace': return this.onStackTrace(req);
      case 'scopes': return this.respond(req, { scopes: [{ name: 'Locals', variablesReference: 1, expensive: false }] });
      case 'variables': return this.onVariables(req);
      case 'continue': return this.onContinue(req);
      case 'next': return this.onStep(req, 'over');
      case 'stepIn': return this.onStep(req, 'in');
      case 'stepOut': return this.onStep(req, 'out');
      case 'evaluate': return this.onEvaluate(req);
      case 'disconnect':
      case 'terminate':
        this.respond(req, {});
        return this.event('terminated', {});
      default:
        return this.respond(req, {});
    }
  }

  dispose(): void {
    this._onDidSendMessage.dispose();
  }

  // --- protocol plumbing ---------------------------------------------------

  private send(msg: Msg): void {
    msg.seq = this.seq++;
    this._onDidSendMessage.fire(msg);
  }
  private respond(req: Msg, body: any, success = true): void {
    this.send({ type: 'response', request_seq: req.seq, success, command: req.command, body });
  }
  private event(event: string, body: any): void {
    this.send({ type: 'event', event, body });
  }
  private stopped(reason: string): void {
    // Surface any System.debug at this step in the Debug Console.
    const step = this.steps[this.index];
    if (step?.debug) {
      this.event('output', { category: 'stdout', output: `[line ${step.line}] ${step.debug}\n` });
    }
    this.event('stopped', { reason, threadId: 1, allThreadsStopped: true });
  }

  // --- requests ------------------------------------------------------------

  private onInitialize(req: Msg): void {
    this.respond(req, {
      supportsConfigurationDoneRequest: true,
      supportsTerminateRequest: true,
      supportsEvaluateForHovers: true
    });
    this.event('initialized', {});
  }

  private onSetBreakpoints(req: Msg): void {
    const path = req.arguments?.source?.path;
    const bps = req.arguments?.breakpoints ?? [];
    if (!path) {
      this.respond(req, { breakpoints: bps.map((b: any) => ({ verified: false, line: b.line })) });
      return;
    }
    this.requestedByPath.set(path, bps.length);

    // Anonymous Apex steps carry the ANON_CLASS sentinel (no real class name),
    // so breakpoints set in the .apex source must be keyed there to match. Any
    // breakpoint set in the launch's anonymous source file maps to ANON_CLASS.
    const isAnonSource = !!this.defaultSource && path.replace(/\\/g, '/') === this.defaultSource.replace(/\\/g, '/');
    const key = isAnonSource && this.execLines.has(ANON_CLASS) ? ANON_CLASS : classKey(path);
    const exec = this.execLines.get(key);
    // A breakpoint is verified only if the log actually executed that line in
    // this class; otherwise mark it unverified so the user sees it won't hit.
    const wanted = new Set<number>();
    const verified = bps.map((b: any) => {
      const hits = exec?.has(b.line) ?? false;
      if (hits) {
        wanted.add(b.line);
      }
      return { verified: hits, line: b.line };
    });
    this.breakpoints.set(key, { lines: wanted, path });
    this.log(`setBreakpoints key="${key}" requested=[${bps.map((b: any) => b.line).join(',')}] verified=[${[...wanted].join(',')}] path=${path}`);
    this.respond(req, { breakpoints: verified });
  }

  /** True if a breakpoint sits on this step's line in this step's class. */
  private isBreakpoint(step: ReplayStep): boolean {
    if (!step.className) {
      return false;
    }
    return this.breakpoints.get(step.className.toLowerCase())?.lines.has(step.line) ?? false;
  }

  private onLaunch(req: Msg): void {
    // Don't start here — breakpoints arrive after 'initialized'. Start on
    // configurationDone, by which point setBreakpoints has run.
    this.respond(req, {});
  }

  private onConfigurationDone(req: Msg): void {
    this.respond(req, {});
    if (!this.steps.length) {
      this.event('output', { category: 'console', output: 'SIID Replay: no executable steps found in this log.\n' });
      this.event('terminated', {});
      return;
    }
    // Run to the first breakpoint.
    for (let i = 0; i < this.steps.length; i++) {
      if (this.isBreakpoint(this.steps[i])) {
        this.index = this.lastOfGroup(i);
        this.stopped('breakpoint');
        return;
      }
    }

    // No breakpoint hit. Only park at the entry line when the user set NO
    // breakpoints at all (a plain "run and inspect"). If they set breakpoints
    // that simply didn't match this log, don't stop on the first line — just run
    // to completion (the breakpoints came back unverified to signal the miss).
    const hasBreakpoints = [...this.requestedByPath.values()].some((n) => n > 0);
    if (hasBreakpoints) {
      this.log(`breakpoints set but none matched (${this.steps.length} steps; bps=[${[...this.breakpoints.keys()].join(',')}]) — running to end`);
      this.event('terminated', {});
      return;
    }
    this.log(`no breakpoints set — stopping at entry`);
    this.index = this.steps.findIndex((s) => !s.external);
    if (this.index < 0) {
      this.index = 0;
    }
    this.stopped('entry');
  }

  private onContinue(req: Msg): void {
    this.respond(req, { allThreadsContinued: true });
    // One source line emits several steps (STATEMENT_EXECUTE, then USER_DEBUG,
    // VARIABLE_ASSIGNMENT, …). Skip past the steps that belong to the line we're
    // currently parked on, so Continue advances to the NEXT line's breakpoint
    // instead of re-stopping on the same line. (A loop revisiting the line still
    // re-fires, because intervening steps on other lines reset this.)
    let i = this.index + 1;
    const cur = this.steps[this.index];
    while (i < this.steps.length && this.sameStop(this.steps[i], cur)) {
      i++;
    }
    for (; i < this.steps.length; i++) {
      if (this.isBreakpoint(this.steps[i])) {
        // Land on the LAST step of this line group so we surface its USER_DEBUG
        // / final locals (the STATEMENT_EXECUTE step that opens the line has
        // neither). Subsequent same-line steps are skipped on the next Continue.
        this.index = this.lastOfGroup(i);
        this.stopped('breakpoint');
        return;
      }
    }
    this.event('terminated', {});
  }

  /** True if two steps are the same source position (line + frame depth). */
  private sameStop(a: ReplayStep, b: ReplayStep): boolean {
    return a.line === b.line && a.className === b.className && a.frames.length === b.frames.length;
  }

  /** Index of the last consecutive step sharing `from`'s source position. */
  private lastOfGroup(from: number): number {
    let i = from;
    while (i + 1 < this.steps.length && this.sameStop(this.steps[i + 1], this.steps[from])) {
      i++;
    }
    return i;
  }

  private onStep(req: Msg, mode: 'over' | 'in' | 'out'): void {
    this.respond(req, {});
    const cur = this.steps[this.index];
    const curDepth = cur.frames.length;
    // Skip the remaining steps of the CURRENT source line (one line emits
    // several: STATEMENT_EXECUTE, USER_DEBUG, VARIABLE_ASSIGNMENT…) so a step
    // always advances to a new position instead of re-stopping on this line.
    let next = this.index + 1;
    while (next < this.steps.length && this.sameStop(this.steps[next], cur)) {
      next++;
    }
    if (mode === 'over') {
      while (next < this.steps.length && this.steps[next].frames.length > curDepth) {
        next++;
      }
    } else if (mode === 'out') {
      while (next < this.steps.length && this.steps[next].frames.length >= curDepth) {
        next++;
      }
    }
    // Never land on system/framework code (no user source). Skip forward to the
    // next user step — unless we'd run off the end, in which case stop where we
    // are rather than terminate prematurely.
    while (next < this.steps.length && this.steps[next].external) {
      next++;
    }
    if (next >= this.steps.length) {
      this.event('terminated', {});
      return;
    }
    // Land on the last step of the destination line group (carries USER_DEBUG /
    // final locals), mirroring the breakpoint stops.
    this.index = this.lastOfGroup(next);
    this.stopped('step');
  }

  private onStackTrace(req: Msg): void {
    const step = this.steps[this.index];
    const frames = [...step.frames].reverse().map((f, i) => {
      const path = this.resolve(f.className);
      return {
        id: i + 1,
        name: f.name,
        line: f.line,
        column: 1,
        source: path ? { name: f.className ?? 'apex', path } : undefined
      };
    });
    if (frames.length) {
      frames[0].line = step.line;
    }
    this.respond(req, { stackFrames: frames, totalFrames: frames.length });
  }

  private onVariables(req: Msg): void {
    const step = this.steps[this.index];
    const vars = step.locals.map((v) => ({ name: v.name, value: v.value, variablesReference: 0 }));
    this.respond(req, { variables: vars });
  }

  private onEvaluate(req: Msg): void {
    const expr = req.arguments?.expression;
    const found = this.steps[this.index]?.locals.find((v) => v.name === expr);
    if (found) {
      this.respond(req, { result: found.value, variablesReference: 0 });
    } else {
      this.respond(req, { result: '', variablesReference: 0 }, true);
    }
  }
}

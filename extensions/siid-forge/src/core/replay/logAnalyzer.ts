/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Headless Apex debug-log ANALYZER (§ log analysis). Where `logParser.parseLog`
 * builds a step-by-step replay timeline (for the replay debugger), this pass
 * extracts the things you open a log to *understand*: governor-limit usage,
 * per-method timings (self/total, a flame-graph tree), the SOQL/DML breakdown,
 * debug output, and exceptions with a stack trace. Pure + dependency-free — the
 * webview panel, the SDK, and the AI agent all call `analyzeLog(raw)`.
 *
 * Timing comes from each line's leading nanosecond clock: `HH:mm:ss.SSS (nanos)`.
 * Durations are nanos deltas between an event and its matching close, reported in
 * milliseconds. Governor limits come from the `CUMULATIVE_LIMIT_USAGE` block.
 */

/** One governor limit: used vs. cap, with a convenience percentage. */
export interface LimitUsage {
  /** Human label from the log, e.g. "Number of SOQL queries". */
  name: string;
  used: number;
  limit: number;
  /** used/limit as a 0–100 percentage (0 when limit is 0). */
  percent: number;
}

/** A method/code-unit node in the execution tree, with self + total time. */
export interface MethodNode {
  /** Qualified name, e.g. "MyClass.myMethod" (or a code-unit label). */
  name: string;
  className?: string;
  /** Source line of the call (when the log provides one). */
  line?: number;
  /** Wall time from entry to matching exit, in ms. */
  totalMs: number;
  /** totalMs minus time spent in children, in ms (own cost). */
  selfMs: number;
  /** How many times this exact name was entered (aggregated view). */
  count: number;
  /**
   * When consecutive identical sibling calls were folded (a loop body), how many
   * were collapsed into this node. >1 means "×N repeated calls". selfMs/totalMs
   * are the SUM across the folded calls; children come from the first instance.
   */
  repeat?: number;
  /** Children in call order (tree view). */
  children: MethodNode[];
}

/** One SOQL or DML operation, with its cost and (when logged) row count. */
export interface DataOp {
  kind: 'SOQL' | 'SOSL' | 'DML';
  line?: number;
  /** 1-based line in the RAW .log file where this op appears (jump-to-raw). */
  logLine?: number;
  /** User class executing when the op ran (for a jump-to-source link). */
  className?: string;
  /** The query text or DML op description. */
  detail: string;
  /** Duration begin→end in ms (undefined if no matching END was seen). */
  ms?: number;
  /** Rows returned/affected, from the END event when present. */
  rows?: number;
}

/** A USER_DEBUG line. */
export interface DebugLine {
  line?: number;
  /** 1-based line in the RAW .log file (jump-to-raw). */
  logLine?: number;
  /** Log level, e.g. "DEBUG", "INFO" (from `USER_DEBUG|[n]|LEVEL|msg`). */
  level?: string;
  /** User class executing when the debug ran (for a jump-to-source link). */
  className?: string;
  message: string;
}

/** An exception/fatal error with the (best-effort) Apex stack trace. */
export interface LogError {
  kind: 'EXCEPTION' | 'FATAL';
  line?: number;
  message: string;
  /** Stack frames, top (throw site) first: "Class.method: line N". */
  stack: string[];
}

/** One HTTP callout (CALLOUT_REQUEST → CALLOUT_RESPONSE). */
export interface Callout {
  line?: number;
  className?: string;
  /** Method + endpoint from the request, e.g. "GET https://api…". */
  request: string;
  /** Response status line, e.g. "System.HttpResponse[Status=OK, StatusCode=200]". */
  response?: string;
  /** Duration begin→response in ms, when both were logged. */
  ms?: number;
}

/** One element that ran inside a flow interview (e.g. a Get Records). */
export interface FlowElement {
  /** Element type, e.g. "FlowRecordLookup", "FlowRecordUpdate", "FlowDecision". */
  type: string;
  /** The element's API name, e.g. "Get_Related_Contacts". */
  name: string;
}

/**
 * A flow element aggregated across every time it ran (a "hot elements" row).
 * Timing is BEGIN→END wall time; CPU is from FLOW_ELEMENT_LIMIT_USAGE deltas.
 */
export interface FlowElementStat {
  type: string;
  name: string;
  /** Owning flow label. */
  flow: string;
  /** How many times this element executed. */
  count: number;
  /** Total wall time across runs, in ms. */
  totalMs: number;
  /** Total CPU time attributed to this element, in ms. */
  cpuMs: number;
  /** True if the element does a query (RecordLookup) — for the per-record flag. */
  isQuery: boolean;
  /** True if the element writes (RecordCreate/Update/Delete). */
  isDml: boolean;
}

/**
 * A flow interview run. IMPORTANT: flows do NOT emit individual
 * SOQL_EXECUTE_BEGIN / DML_BEGIN events — their database work is only reported as
 * aggregate `FLOW_*_LIMIT_USAGE` counters. So flow SOQL/DML won't appear in the
 * Apex `dataOps` list; this captures the flow's own numbers instead.
 */
export interface FlowInterview {
  /** Flow label, e.g. "SIID Log Demo Flow". */
  name: string;
  /** Elements executed, in order. */
  elements: FlowElement[];
  /** SOQL queries the flow reported (cumulative for the interview). */
  soql?: number;
  /** DML statements the flow reported. */
  dml?: number;
  /** CPU ms the flow reported. */
  cpuMs?: number;
}

/** A cumulative-heap sample at a point in the run (for a heap-over-time chart). */
export interface HeapSample {
  /** Milliseconds from the log start. */
  atMs: number;
  /** Running total bytes allocated up to this point. */
  bytes: number;
}

/**
 * A derived warning about the run — a repeated query/DML (loop/N+1), a method
 * firing many times (recursion), or a governor limit crossing a threshold.
 */
export interface LogInsight {
  kind: 'loop-soql' | 'loop-dml' | 'recursion' | 'limit' | 'unbounded-soql' | 'truncated' | 'limit-exception' | 'flow-db' | 'flow-slow' | 'flow-recursion';
  severity: 'warn' | 'error';
  /** Human summary, e.g. "12 identical SOQL queries (possible loop)". */
  message: string;
  /** The repeated signature / method / limit name this is about. */
  detail?: string;
  count?: number;
}

/** The full analysis of one Apex debug log. */
export interface LogAnalysis {
  apiVersion?: string;
  apexCodeLevel?: string;
  /** False when APEX_CODE isn't FINEST — timings/vars are coarse. */
  isFinest: boolean;
  /**
   * True when the log hit "MAXIMUM DEBUG LOG SIZE REACHED" and was cut off —
   * everything after is missing, so counts/timings/limits are INCOMPLETE (and a
   * governor exception that killed the run may not appear in the body at all).
   */
  truncated: boolean;
  /** Total wall time of the log (first→last timestamp), in ms. */
  durationMs: number;
  /**
   * CPU time consumed, in ms — from the `Maximum CPU time` governor limit. This
   * is what the 10s limit is measured against, and is usually MUCH less than
   * wall time (which includes DB/callout waits). undefined when no limits block.
   */
  cpuMs?: number;
  /** Entry point (first user CODE_UNIT_STARTED), e.g. a test method or trigger. */
  entryPoint?: string;
  /** Governor limits from CUMULATIVE_LIMIT_USAGE (empty if the block is absent). */
  limits: LimitUsage[];
  /** Call tree (roots in execution order). */
  tree: MethodNode[];
  /** Methods aggregated by name, sorted by selfMs desc — the "hot spots". */
  hotMethods: MethodNode[];
  /** Every SOQL/SOSL/DML op in order. */
  dataOps: DataOp[];
  /** HTTP callouts. */
  callouts: Callout[];
  /** Flow interviews that ran (record-triggered / autolaunched flows). */
  flows: FlowInterview[];
  /** Per-element flow timing, aggregated across runs, slowest first. */
  flowElements: FlowElementStat[];
  /** Cumulative heap allocated over time (downsampled) for a chart. */
  heap: HeapSample[];
  /** Peak cumulative heap bytes seen in the log. */
  peakHeapBytes: number;
  /** All USER_DEBUG output. */
  debug: DebugLine[];
  /** Exceptions/fatal errors (usually 0 or 1). */
  errors: LogError[];
  /** Derived warnings: loop queries, recursion, limits near cap. */
  insights: LogInsight[];
  /** Quick counts for a summary bar. */
  counts: { soql: number; dml: number; dbRows: number; debug: number; methods: number; callouts: number };
}

/** Leading clock of a log line → nanoseconds. `12:05:23.33 (33285241)` → 33285241. */
function nanosOf(rawLine: string): number | undefined {
  const m = rawLine.match(/^\d{2}:\d{2}:\d{2}\.\d+ \((\d+)\)/);
  return m ? parseInt(m[1], 10) : undefined;
}

/** The [n] source-line number out of an event field. */
function lineOf(field: string | undefined): number | undefined {
  const m = field?.match(/\[(\d+)\]/);
  return m ? parseInt(m[1], 10) : undefined;
}

const NS_PER_MS = 1_000_000;

/** "MyClass.myMethod(args)" → "MyClass.myMethod"; also strips a trailing type tail. */
function signatureName(sig: string): string {
  return (sig || '').replace(/\(.*$/, '').trim();
}

/** Top-level (outer) class of a qualified name, for source resolution/grouping. */
function outerClass(name: string): string | undefined {
  const noArgs = signatureName(name);
  const dot = noArgs.lastIndexOf('.');
  const qualified = dot > 0 ? noArgs.slice(0, dot) : undefined;
  return qualified?.split('.')[0];
}

/** True when the CLR id field (01p…) marks user code (vs. system/framework). */
function isUserId(idField: string | undefined): boolean {
  return !!idField && /^01p/i.test(idField.trim());
}

interface OpenFrame {
  node: MethodNode;
  startNs?: number;
  /** Nanoseconds accumulated by direct children (to compute self time). */
  childNs: number;
  openedBy: string;
}

/**
 * Parses the log header line: "62.0 APEX_CODE,FINEST;APEX_PROFILING,FINEST;…".
 */
function parseHeader(raw: string): { apiVersion?: string; apexCodeLevel?: string; isFinest: boolean } {
  const first = raw.split(/\r?\n/, 1)[0] ?? '';
  const apiVersion = first.match(/^(\d+\.\d+)/)?.[1];
  const apexCodeLevel = first.match(/APEX_CODE,([A-Z]+)/)?.[1];
  return { apiVersion, apexCodeLevel, isFinest: apexCodeLevel === 'FINEST' };
}

/**
 * Reads the `CUMULATIVE_LIMIT_USAGE` block: the indented
 * "Number of SOQL queries: 0 out of 100" lines. Uses the FIRST block (the
 * outermost namespace `(default)` totals). Returns [] when no block is present.
 */
function parseLimits(lines: string[]): LimitUsage[] {
  const start = lines.findIndex((l) => /\|CUMULATIVE_LIMIT_USAGE\b/.test(l) && !/_END\b/.test(l));
  if (start < 0) {
    return [];
  }
  const limits: LimitUsage[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/\|CUMULATIVE_LIMIT_USAGE_END\b/.test(lines[i])) {
      break;
    }
    // e.g. "  Number of SOQL queries: 12 out of 100"
    const m = lines[i].match(/^\s+(.+?):\s+(\d+)\s+out of\s+(\d+)/);
    if (m) {
      const used = parseInt(m[2], 10);
      const limit = parseInt(m[3], 10);
      limits.push({ name: m[1].trim(), used, limit, percent: limit ? (used / limit) * 100 : 0 });
    }
  }
  return limits;
}

/**
 * Analyzes a raw Apex debug log into governor limits, a method-timing tree,
 * SOQL/DML breakdown, debug output, and errors.
 */
/** Tunable thresholds for insight detection (all optional; sensible defaults). */
export interface AnalyzeOptions {
  /** Min repeated identical SOQL/DML ops to flag a loop (default 3). */
  loopThreshold?: number;
  /** Min times a method fires to flag recursion/per-record invocation (default 20). */
  recursionThreshold?: number;
}

const DEFAULTS: Required<AnalyzeOptions> = { loopThreshold: 3, recursionThreshold: 20 };

export function analyzeLog(raw: string, options: AnalyzeOptions = {}): LogAnalysis {
  const opts = { ...DEFAULTS, ...options };
  const meta = parseHeader(raw);
  const rawLines = raw.split(/\r?\n/);

  const roots: MethodNode[] = [];
  const stack: OpenFrame[] = [];
  const dataOps: DataOp[] = [];
  const debug: DebugLine[] = [];
  const errors: LogError[] = [];
  const callouts: Callout[] = [];
  const flows: FlowInterview[] = [];
  let openFlow: FlowInterview | undefined;
  // Per-element flow timing, keyed by "flow::element". BEGIN opens, END closes.
  const flowElemStats = new Map<string, FlowElementStat>();
  let openFlowElem: { key: string; startNs?: number } | undefined;
  const heap: HeapSample[] = [];
  let heapTotal = 0;
  let peakHeapBytes = 0;
  // Open SOQL/DML awaiting their END (to compute duration + rows), by kind.
  const openOps: DataOp[] = [];
  let openCallout: (Callout & { _startNs?: number }) | undefined;

  let firstNs: number | undefined;
  let lastNs: number | undefined;
  let entryPoint: string | undefined;
  // Salesforce appends this banner and stops logging when the log exceeds its max
  // size — so a run that then dies (e.g. CPU-limit exception) leaves no FATAL in
  // the body. Detect it so we can warn the analysis is incomplete.
  const truncated = /MAXIMUM DEBUG LOG SIZE REACHED/.test(raw);

  const top = () => stack[stack.length - 1];

  const openFrame = (node: MethodNode, ns: number | undefined, openedBy: string) => {
    const parent = top();
    (parent ? parent.node.children : roots).push(node);
    stack.push({ node, startNs: ns, childNs: 0, openedBy });
  };

  const closeFrame = (ns: number | undefined) => {
    const frame = stack.pop();
    if (!frame) {
      return;
    }
    const total = frame.startNs !== undefined && ns !== undefined ? ns - frame.startNs : 0;
    frame.node.totalMs = total / NS_PER_MS;
    frame.node.selfMs = Math.max(0, total - frame.childNs) / NS_PER_MS;
    const parent = top();
    if (parent) {
      parent.childNs += total;
    }
  };

  // Nearest user class on the stack (top frame may be system code with none).
  const currentClass = (): string | undefined => {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].node.className) {
        return stack[i].node.className;
      }
    }
    return undefined;
  };

  for (let li = 0; li < rawLines.length; li++) {
    const rawLine = rawLines[li];
    const logLine = li + 1; // 1-based line number in the raw .log file
    const ns = nanosOf(rawLine);
    if (ns !== undefined) {
      if (firstNs === undefined) {
        firstNs = ns;
      }
      lastNs = ns;
    }
    const parts = rawLine.split('|');
    if (parts.length < 2) {
      continue;
    }
    const event = parts[1];

    switch (event) {
      case 'CODE_UNIT_STARTED': {
        const unit = parts[parts.length - 1] || 'execute';
        const name = /execute_anonymous/i.test(unit) ? 'execute_anonymous' : signatureName(unit);
        if (!entryPoint) {
          entryPoint = name;
        }
        openFrame(
          { name, className: outerClass(unit), line: lineOf(parts[2]), totalMs: 0, selfMs: 0, count: 1, children: [] },
          ns,
          event
        );
        break;
      }
      case 'METHOD_ENTRY':
      case 'CONSTRUCTOR_ENTRY': {
        // The signature is the last field; user code carries an 01p id in [3].
        const sig = parts[parts.length - 1] || '';
        const name = signatureName(sig) || 'anonymous';
        openFrame(
          { name, className: outerClass(sig) ?? (isUserId(parts[3]) ? outerClass(sig) : undefined), line: lineOf(parts[2]), totalMs: 0, selfMs: 0, count: 1, children: [] },
          ns,
          event
        );
        break;
      }
      case 'METHOD_EXIT':
      case 'CONSTRUCTOR_EXIT':
      case 'CODE_UNIT_FINISHED':
        closeFrame(ns);
        break;

      // SOQL / SOSL / DML: pair BEGIN with END for duration + rows.
      case 'SOQL_EXECUTE_BEGIN':
      case 'SOSL_EXECUTE_BEGIN': {
        const op: DataOp = {
          kind: event.startsWith('SOSL') ? 'SOSL' : 'SOQL',
          line: lineOf(parts[2]),
          logLine,
          className: currentClass(),
          detail: parts[parts.length - 1] || '',
          ms: undefined
        };
        (op as any)._startNs = ns;
        dataOps.push(op);
        openOps.push(op);
        break;
      }
      case 'SOQL_EXECUTE_END':
      case 'SOSL_EXECUTE_END': {
        const op = openOps.pop();
        if (op) {
          const startNs = (op as any)._startNs as number | undefined;
          if (startNs !== undefined && ns !== undefined) {
            op.ms = (ns - startNs) / NS_PER_MS;
          }
          const rows = rawLine.match(/Rows:\s*(\d+)/i);
          if (rows) {
            op.rows = parseInt(rows[1], 10);
          }
        }
        break;
      }
      case 'DML_BEGIN': {
        const op: DataOp = { kind: 'DML', line: lineOf(parts[2]), logLine, className: currentClass(), detail: parts.slice(3).join(' ').trim() };
        (op as any)._startNs = ns;
        const rows = rawLine.match(/Rows:\s*(\d+)/i);
        if (rows) {
          op.rows = parseInt(rows[1], 10);
        }
        dataOps.push(op);
        openOps.push(op);
        break;
      }
      case 'DML_END': {
        const op = openOps.pop();
        if (op && (op as any)._startNs !== undefined && ns !== undefined) {
          op.ms = (ns - (op as any)._startNs) / NS_PER_MS;
        }
        break;
      }

      // --- Flow interviews --------------------------------------------------
      // Flows don't emit SOQL_EXECUTE_BEGIN/DML_BEGIN; their DB work shows only
      // as FLOW_*_LIMIT_USAGE. Capture the interview, its elements, and totals.
      case 'FLOW_START_INTERVIEW_BEGIN': {
        // ...|FLOW_START_INTERVIEW_BEGIN|<id>|<Flow Label>
        openFlow = { name: parts[parts.length - 1] || 'Flow', elements: [] };
        flows.push(openFlow);
        break;
      }
      case 'FLOW_START_INTERVIEW_END': {
        openFlow = undefined;
        break;
      }
      case 'FLOW_ELEMENT_BEGIN':
      case 'FLOW_BULK_ELEMENT_BEGIN': {
        // FLOW_ELEMENT_BEGIN|<id>|<Type>|<Name>  (inside an interview)
        // FLOW_BULK_ELEMENT_BEGIN|<Type>|<Name>  (bulk phase, AFTER interviews
        // end — e.g. a Record Update). Attach to the open interview, or fall back
        // to the last flow (the bulk phase runs with no interview open, so
        // otherwise these elements — and their DML — would be dropped).
        const type = event === 'FLOW_BULK_ELEMENT_BEGIN' ? parts[2] : parts[3];
        const name = parts[parts.length - 1] || '';
        const target = openFlow ?? flows[flows.length - 1];
        const flowName = target?.name ?? 'Flow';
        if (target && name && !target.elements.some((e) => e.name === name)) {
          target.elements.push({ type: type || '', name });
        }
        // Per-element timing: open a stat window (paired with the END below).
        if (name) {
          const key = flowName + '::' + name;
          let stat = flowElemStats.get(key);
          if (!stat) {
            stat = {
              type: type || '', name, flow: flowName, count: 0, totalMs: 0, cpuMs: 0,
              isQuery: /RecordLookup|RecordQuery/i.test(type || ''),
              isDml: /RecordCreate|RecordUpdate|RecordDelete/i.test(type || '')
            };
            flowElemStats.set(key, stat);
          }
          stat.count++;
          openFlowElem = { key, startNs: ns };
        }
        break;
      }
      case 'FLOW_ELEMENT_END':
      case 'FLOW_BULK_ELEMENT_END': {
        if (openFlowElem) {
          const stat = flowElemStats.get(openFlowElem.key);
          if (stat && openFlowElem.startNs !== undefined && ns !== undefined) {
            stat.totalMs += (ns - openFlowElem.startNs) / NS_PER_MS;
          }
          openFlowElem = undefined;
        }
        break;
      }
      case 'FLOW_ELEMENT_LIMIT_USAGE': {
        // ...|FLOW_ELEMENT_LIMIT_USAGE|<n> ms CPU time, total <t> out of 15000
        // Per-element CPU — attribute to the currently-open element.
        const last = parts[parts.length - 1] || '';
        const cpu = last.match(/(\d+)\s*ms CPU time/i);
        if (cpu && openFlowElem) {
          const stat = flowElemStats.get(openFlowElem.key);
          if (stat) { stat.cpuMs += parseInt(cpu[1], 10); }
        }
        break;
      }
      case 'FLOW_START_INTERVIEW_LIMIT_USAGE':
      case 'FLOW_INTERVIEW_FINISHED_LIMIT_USAGE': {
        // ...|FLOW_*_LIMIT_USAGE|<Label>: <n> out of <cap> — interview totals.
        const last = parts[parts.length - 1] || '';
        const target = openFlow ?? flows[flows.length - 1];
        if (target) {
          const soql = last.match(/SOQL queries:\s*(\d+)/i);
          const dml = last.match(/DML statements:\s*(\d+)/i);
          const cpu = last.match(/CPU time in ms:\s*(\d+)/i);
          if (soql) { target.soql = Math.max(target.soql ?? 0, parseInt(soql[1], 10)); }
          if (dml) { target.dml = Math.max(target.dml ?? 0, parseInt(dml[1], 10)); }
          if (cpu) { target.cpuMs = Math.max(target.cpuMs ?? 0, parseInt(cpu[1], 10)); }
        }
        break;
      }

      case 'HEAP_ALLOCATE': {
        // ...|HEAP_ALLOCATE|[line]|Bytes:N — accumulate a running total + sample.
        const b = rawLine.match(/Bytes:\s*(\d+)/i);
        if (b) {
          heapTotal += parseInt(b[1], 10);
          if (heapTotal > peakHeapBytes) {
            peakHeapBytes = heapTotal;
          }
          if (firstNs !== undefined && ns !== undefined) {
            heap.push({ atMs: (ns - firstNs) / NS_PER_MS, bytes: heapTotal });
          }
        }
        break;
      }
      case 'CALLOUT_REQUEST': {
        openCallout = { line: lineOf(parts[2]), className: currentClass(), request: parts[parts.length - 1] || '', _startNs: ns };
        callouts.push(openCallout);
        break;
      }
      case 'CALLOUT_RESPONSE': {
        if (openCallout) {
          if (openCallout._startNs !== undefined && ns !== undefined) {
            openCallout.ms = (ns - openCallout._startNs) / NS_PER_MS;
          }
          // The response field carries the status, e.g.
          // "System.HttpResponse[Status=OK, StatusCode=200]".
          openCallout.response = parts[parts.length - 1] || undefined;
        }
        openCallout = undefined;
        break;
      }

      case 'USER_DEBUG': {
        // USER_DEBUG|[n]|LEVEL|message
        debug.push({ line: lineOf(parts[2]), logLine, level: parts[3], className: currentClass(), message: parts[parts.length - 1] || '' });
        break;
      }

      case 'EXCEPTION_THROWN':
      case 'FATAL_ERROR': {
        const message = parts[parts.length - 1] || '';
        // The message's first line is the error; a real Apex stack chain often
        // follows on later lines as "Class.X.method: line N, column C" — capture
        // those. When absent, synthesize a single frame from the current call
        // stack + the event's [line] so there's always *some* trace.
        const msgLines = message.split(/\n/).map((s) => s.trim()).filter(Boolean);
        let stack = msgLines.slice(1).filter((s) => /:\s*line\s+\d+/i.test(s) || /^Class\.|^Trigger\.|^AnonymousBlock/i.test(s));
        if (!stack.length) {
          const cls = currentClass();
          const ln = lineOf(parts[2]);
          if (cls && ln != null) {
            stack = [`${cls}: line ${ln}`];
          }
        }
        const kind = event === 'FATAL_ERROR' ? 'FATAL' : 'EXCEPTION';
        const head = msgLines[0] ?? message;
        // Salesforce logs a FATAL_ERROR right after the EXCEPTION_THROWN it came
        // from, with the same message. Don't double-report: if the previous error
        // has the same message, upgrade it to FATAL (and keep the richer stack)
        // instead of adding a duplicate row.
        const prev = errors[errors.length - 1];
        if (kind === 'FATAL' && prev && prev.message === head) {
          prev.kind = 'FATAL';
          if (stack.length > prev.stack.length) {
            prev.stack = stack;
          }
        } else {
          errors.push({ kind, line: lineOf(parts[2]), message: head, stack });
        }
        break;
      }

      default:
        break;
    }
  }

  // Any frames left open (truncated log) — close with the last timestamp so
  // their totals aren't zero.
  while (stack.length) {
    closeFrame(lastNs);
  }

  // Strip the internal _startNs marker from dataOps.
  for (const op of dataOps) {
    delete (op as any)._startNs;
  }

  const limits = parseLimits(rawLines);
  const durationMs = firstNs !== undefined && lastNs !== undefined ? (lastNs - firstNs) / NS_PER_MS : 0;

  // Aggregate hot methods by name (sum self/total, count calls).
  const byName = new Map<string, MethodNode>();
  const walk = (nodes: MethodNode[]) => {
    for (const n of nodes) {
      const agg = byName.get(n.name);
      if (agg) {
        agg.selfMs += n.selfMs;
        agg.totalMs += n.totalMs;
        agg.count += 1;
      } else {
        byName.set(n.name, { ...n, children: [] });
      }
      walk(n.children);
    }
  };
  walk(roots);
  const hotMethods = [...byName.values()].sort((a, b) => b.selfMs - a.selfMs);

  // Max SELF-NESTING depth per name: how many times a name appears as its own
  // ancestor on a single path. Depth >= 2 is TRUE recursion (the method re-enters
  // itself), which is a much stronger signal than a raw call count (5 sibling
  // fires from a bulk trigger are NOT recursion; 5 nested re-entries ARE).
  const selfNesting = new Map<string, number>();
  const measureNesting = (nodes: MethodNode[], ancestors: Map<string, number>) => {
    for (const n of nodes) {
      const here = (ancestors.get(n.name) ?? 0) + 1;
      if (here > (selfNesting.get(n.name) ?? 0)) {
        selfNesting.set(n.name, here);
      }
      ancestors.set(n.name, here);
      measureNesting(n.children, ancestors);
      ancestors.set(n.name, here - 1);
    }
  };
  measureNesting(roots, new Map());

  const dbRows = dataOps.reduce((s, op) => s + (op.rows ?? 0), 0);
  const counts = {
    soql: dataOps.filter((o) => o.kind === 'SOQL' || o.kind === 'SOSL').length,
    dml: dataOps.filter((o) => o.kind === 'DML').length,
    dbRows,
    debug: debug.length,
    methods: byName.size,
    callouts: callouts.length
  };

  const flowElements = [...flowElemStats.values()].sort((a, b) => b.totalMs - a.totalMs);
  const insights = deriveInsights(dataOps, byName, limits, errors, truncated, opts, selfNesting, flows, flowElements);
  const cpuLimit = limits.find((l) => /Maximum CPU time/i.test(l.name));
  const cpuMs = cpuLimit ? cpuLimit.used : undefined;

  return {
    ...meta,
    truncated,
    durationMs,
    cpuMs,
    entryPoint,
    limits,
    tree: foldTree(roots),
    hotMethods,
    dataOps,
    callouts,
    flows,
    flowElements,
    heap: downsample(heap, 300),
    peakHeapBytes,
    debug,
    errors,
    insights,
    counts
  };
}

/** Downsamples a series to at most `max` evenly-spaced points (keeps the last). */
function downsample<T>(series: T[], max: number): T[] {
  if (series.length <= max) {
    return series;
  }
  const step = series.length / max;
  const out: T[] = [];
  for (let i = 0; i < max; i++) {
    out.push(series[Math.floor(i * step)]);
  }
  out.push(series[series.length - 1]);
  return out;
}

/**
 * Folds runs of consecutive identical-signature sibling calls into one node
 * (`repeat` = how many were folded, self/total summed). This is what tames a
 * loop body that entered `Math.abs` 50,000 times — instead of 50k tree lines you
 * get one "Math.abs ×50000" row. Recurses into children (using the first
 * instance's subtree, which is representative). Names must match AND lines match
 * to fold, so distinct call sites stay separate.
 */
function foldTree(nodes: MethodNode[]): MethodNode[] {
  const out: MethodNode[] = [];
  for (const n of nodes) {
    const prev = out[out.length - 1];
    if (prev && prev.name === n.name && prev.line === n.line) {
      prev.repeat = (prev.repeat ?? 1) + 1;
      prev.selfMs += n.selfMs;
      prev.totalMs += n.totalMs;
      prev.count += n.count;
      // Keep the first instance's children (representative); fold them too.
    } else {
      out.push({ ...n, children: foldTree(n.children) });
    }
  }
  return out;
}

/**
 * Normalizes a SOQL/DML detail string so structurally-identical operations group
 * together for loop detection: collapses whitespace, quoted string literals,
 * numeric literals, and Salesforce Ids to placeholders. So
 * `WHERE Name = 'Loop 0'` and `WHERE Name = 'Loop 1'` — and
 * `WHERE Id = '001...AAA'` / another Id — all normalize to the same shape, while
 * `:tmpVar1` bind vars (already identical) are left as-is.
 */
function normalizeOpDetail(detail: string): string {
  return detail
    .replace(/\s+/g, ' ')
    .replace(/'[^']*'/g, "'?'")                       // string literals
    .replace(/\b[a-zA-Z0-9]{15,18}\b/g, '?')          // 15/18-char SF Ids
    .replace(/\b\d+\b/g, '?')                          // numeric literals
    .trim();
}

/**
 * Derives warnings from the parsed data: repeated identical SOQL/DML (a query
 * inside a loop / N+1 pattern), methods that fired many times (recursion or
 * per-record invocation), and governor limits crossing 75%/90%.
 */
function deriveInsights(
  dataOps: DataOp[],
  byName: Map<string, MethodNode>,
  limits: LimitUsage[],
  errors: LogError[],
  truncated: boolean,
  opts: Required<AnalyzeOptions>,
  selfNesting: Map<string, number>,
  flows: FlowInterview[],
  flowElements: FlowElementStat[]
): LogInsight[] {
  const insights: LogInsight[] = [];

  // A governor LimitException (CPU/heap/SOQL/DML limit exceeded) is the most
  // critical thing in a log — surface it as a top insight, not just a row in the
  // errors table. Matches "System.LimitException: … CPU time limit exceeded" etc.
  for (const e of errors) {
    if (/LimitException/i.test(e.message)) {
      insights.push({
        kind: 'limit-exception',
        severity: 'error',
        message: `Governor limit exceeded — the run was killed. ${e.message}`,
        detail: e.stack[0]
      });
    }
  }

  // A truncated log means a governor exception (often CPU-time) may have killed
  // the run WITHOUT a FATAL in the body. Warn loudly that the analysis is partial.
  if (truncated) {
    insights.push({
      kind: 'truncated',
      severity: 'error',
      message: 'Log hit MAXIMUM DEBUG LOG SIZE and was cut off — analysis is INCOMPLETE. ' +
        'A governor exception (e.g. CPU-time limit) may have ended the run without appearing here. ' +
        'Re-run with fewer statements or a narrower debug level to capture the full log.'
    });
  }

  // Repeated STRUCTURALLY-identical queries/DML → loop/N+1. Group by kind +
  // NORMALIZED detail: bind vars (`:tmpVar1`) already repeat verbatim, but
  // literal values that change per iteration (`WHERE Name = 'Loop 0'`,
  // `'Loop 1'`…) must be collapsed too, so the same query shape groups
  // regardless of the changing value.
  const groups = new Map<string, { kind: DataOp['kind']; detail: string; count: number }>();
  for (const op of dataOps) {
    const key = op.kind + '::' + normalizeOpDetail(op.detail);
    const g = groups.get(key) ?? { kind: op.kind, detail: op.detail, count: 0 };
    g.count++;
    groups.set(key, g);
  }
  for (const g of groups.values()) {
    if (g.count >= opts.loopThreshold) {
      const isDml = g.kind === 'DML';
      insights.push({
        kind: isDml ? 'loop-dml' : 'loop-soql',
        severity: g.count >= opts.loopThreshold * 3 ? 'error' : 'warn',
        message: `${g.count} identical ${g.kind} operations — likely inside a loop (bulkify).`,
        detail: g.detail.slice(0, 120),
        count: g.count
      });
    }
  }

  // Unfiltered / unbounded SOQL → full-object scan; risks the 50k-row limit and
  // is slow. Flag a SELECT with NO `WHERE` and NO `LIMIT`. Skip aggregate
  // `COUNT()` (returns a number, not rows) — a bare COUNT is a legitimate total.
  const seenUnbounded = new Set<string>();
  for (const op of dataOps) {
    if (op.kind !== 'SOQL') {
      continue;
    }
    const q = op.detail;
    const hasWhere = /\bWHERE\b/i.test(q);
    const hasLimit = /\bLIMIT\b/i.test(q);
    const isCount = /\bSELECT\s+COUNT\s*\(\s*\)/i.test(q);
    if (!hasWhere && !hasLimit && !isCount) {
      const norm = normalizeOpDetail(q);
      if (seenUnbounded.has(norm)) {
        continue; // one warning per distinct query shape
      }
      seenUnbounded.add(norm);
      insights.push({
        kind: 'unbounded-soql',
        severity: 'warn',
        message: `Unfiltered query (no WHERE / LIMIT) — scans the whole object; risks the 50k-row limit.`,
        detail: q.slice(0, 120)
      });
    }
  }

  // Recursion vs. per-record invocation — distinguished by SELF-NESTING depth:
  //   - depth >= 2: the method/trigger RE-ENTERS ITSELF → true recursion (a
  //     recursive trigger, or a method calling itself). This is the real smell,
  //     regardless of raw count.
  //   - depth 1 but many calls: fired repeatedly but NOT nested → per-record /
  //     N+1 invocation (e.g. a bulk trigger firing once per record). A weaker,
  //     warn-level signal.
  for (const m of byName.values()) {
    const isTrigger = /\btrigger\b/i.test(m.name) || /Trigger$/.test(m.name.split('.')[0] ?? '');
    const nesting = selfNesting.get(m.name) ?? 1;
    const short = m.name.replace(/^__sfdc_trigger\//, '');
    if (nesting >= 2) {
      // True recursion: the deeper it nests, the worse.
      insights.push({
        kind: 'recursion',
        severity: nesting >= 4 ? 'error' : 'warn',
        message: isTrigger
          ? `Trigger ${short} RE-ENTERS ITSELF (nested ${nesting} deep, fired ${m.count}×) — recursive; add a static re-entrancy guard.`
          : `${short} recurses (nested ${nesting} deep, ${m.count} calls) — check the recursion terminates.`,
        detail: m.name,
        count: m.count
      });
    } else if (m.count >= (isTrigger ? 5 : opts.recursionThreshold)) {
      // Flat but frequent — per-record / N+1 invocation, not recursion.
      insights.push({
        kind: 'recursion',
        severity: 'warn',
        message: isTrigger
          ? `Trigger ${short} fired ${m.count}× (once per record) — fine if intended, but move heavy work out of the per-record path.`
          : `${short} ran ${m.count}× — per-record invocation; consider bulkifying.`,
        detail: m.name,
        count: m.count
      });
    }
  }

  // Governor limits near the cap.
  for (const l of limits) {
    if (l.percent >= 75) {
      insights.push({
        kind: 'limit',
        severity: l.percent >= 90 ? 'error' : 'warn',
        message: `${l.name} at ${l.percent.toFixed(0)}% (${l.used}/${l.limit}).`,
        detail: l.name,
        count: l.used
      });
    }
  }

  // --- Flow execution analysis -----------------------------------------------
  // Flows don't emit per-op SOQL/DML, so their DB work + timing are easy to miss.
  const flowGroups = new Map<string, { count: number; soql: number; dml: number }>();
  for (const f of flows) {
    const g = flowGroups.get(f.name) ?? { count: 0, soql: 0, dml: 0 };
    g.count++;
    g.soql = Math.max(g.soql, f.soql ?? 0);
    g.dml = Math.max(g.dml, f.dml ?? 0);
    flowGroups.set(f.name, g);
  }

  // (a) Per-record flow doing SOQL/DML — the flow N+1 (should be before-save/bulk).
  for (const [name, g] of flowGroups) {
    if (g.count >= opts.loopThreshold && (g.soql > 0 || g.dml > 0)) {
      insights.push({
        kind: 'flow-db',
        severity: g.count >= opts.loopThreshold * 3 ? 'error' : 'warn',
        message: `Flow "${name}" ran ${g.count}× and does SOQL/DML each time — per-record flow database work. Consider a before-save flow (for same-record updates) or bulkifying.`,
        detail: name,
        count: g.count
      });
    }
  }

  // (b) Slow flow ELEMENT — a single element eating a large share of flow time.
  const flowWall = flowElements.reduce((s, e) => s + e.totalMs, 0);
  for (const e of flowElements) {
    // Flag an element that's both absolutely and relatively expensive.
    if (e.totalMs >= 100 && flowWall > 0 && e.totalMs / flowWall >= 0.5) {
      insights.push({
        kind: 'flow-slow',
        severity: e.totalMs >= 500 ? 'error' : 'warn',
        message: `Flow element "${e.name}" (${e.type}) took ${e.totalMs.toFixed(0)}ms across ${e.count} runs (${((e.totalMs / flowWall) * 100).toFixed(0)}% of flow time) — the flow's slowest step.`,
        detail: e.name,
        count: e.count
      });
    }
  }

  // (c) Recursive flow — the same flow ran far more times than seems intended
  // (an after-save flow that updates its own record re-fires itself). We can't
  // see interview nesting directly, but a per-record flow firing well beyond the
  // record count, OR a flow whose own DML re-triggers it, shows as many runs.
  for (const [name, g] of flowGroups) {
    // Heuristic: a flow with DML that ran a lot is a likely self-retrigger.
    if (g.dml > 0 && g.count >= opts.recursionThreshold) {
      insights.push({
        kind: 'flow-recursion',
        severity: 'error',
        message: `Flow "${name}" ran ${g.count}× and does DML — likely RE-TRIGGERING itself (an after-save flow updating its own record). Use before-save, or guard the update.`,
        detail: name,
        count: g.count
      });
    }
  }

  // Most severe first.
  return insights.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
}

/** Formats a byte count as B / KB / MB for reports + UI. */
export function fmtBytes(n: number): string {
  if (n < 1024) { return `${n} B`; }
  if (n < 1024 * 1024) { return `${(n / 1024).toFixed(1)} KB`; }
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Renders a {@link LogAnalysis} as a Markdown report — a portable summary the
 * user (or the AI agent) can save/share. JSON export is just `JSON.stringify` of
 * the same analysis object; this is the human-readable form.
 */
export function analysisToMarkdown(a: LogAnalysis, logName?: string): string {
  const ms = (n: number) => n.toFixed(n < 10 ? 2 : 1);
  const out: string[] = [];
  out.push(`# Apex Log Analysis${logName ? ` — ${logName}` : ''}`);
  out.push('');
  if (a.truncated) {
    out.push('> ⚠ **Log truncated** at MAXIMUM DEBUG LOG SIZE — analysis is INCOMPLETE. A governor exception (e.g. CPU-time limit) may have ended the run without appearing in the log.');
    out.push('');
  }
  out.push(`- **Duration:** ${ms(a.durationMs)} ms`);
  out.push(`- **API version:** ${a.apiVersion ?? '?'}  ·  **Log level:** ${a.apexCodeLevel ?? '?'}${a.isFinest ? '' : ' (not FINEST — timings approximate)'}`);
  if (a.entryPoint) { out.push(`- **Entry point:** \`${a.entryPoint}\``); }
  out.push(`- **SOQL:** ${a.counts.soql}  ·  **DML:** ${a.counts.dml}  ·  **DB rows:** ${a.counts.dbRows}  ·  **Callouts:** ${a.counts.callouts}  ·  **Methods:** ${a.counts.methods}  ·  **Errors:** ${a.errors.length}`);
  out.push(`- **Peak heap:** ${fmtBytes(a.peakHeapBytes)}`);
  out.push('');

  if (a.insights.length) {
    out.push('## Insights');
    for (const i of a.insights) { out.push(`- ${i.severity === 'error' ? '🔴' : '🟡'} ${i.message}`); }
    out.push('');
  }

  if (a.errors.length) {
    out.push('## Errors');
    for (const e of a.errors) {
      out.push(`- **${e.kind}:** ${e.message}`);
      for (const s of e.stack) { out.push(`  - \`${s}\``); }
    }
    out.push('');
  }

  if (a.limits.length) {
    out.push('## Governor limits');
    out.push('| Limit | Used | Limit | % |');
    out.push('|---|--:|--:|--:|');
    for (const l of a.limits) { out.push(`| ${l.name} | ${l.used} | ${l.limit} | ${l.percent.toFixed(1)}% |`); }
    out.push('');
  }

  if (a.hotMethods.length) {
    out.push('## Hot methods (by self time)');
    out.push('| Method | Self ms | Total ms | Calls |');
    out.push('|---|--:|--:|--:|');
    for (const m of a.hotMethods.slice(0, 25)) { out.push(`| ${m.name} | ${ms(m.selfMs)} | ${ms(m.totalMs)} | ${m.count} |`); }
    out.push('');
  }

  if (a.dataOps.length) {
    out.push('## SOQL & DML');
    out.push('| Type | Line | ms | Rows | Detail |');
    out.push('|---|--:|--:|--:|---|');
    for (const op of a.dataOps) {
      out.push(`| ${op.kind} | ${op.line ?? ''} | ${op.ms != null ? ms(op.ms) : ''} | ${op.rows ?? ''} | ${op.detail.replace(/\|/g, '\|').slice(0, 120)} |`);
    }
    out.push('');
  }

  if (a.flows.length) {
    // Group identical interviews for a compact report.
    const g = new Map<string, { count: number; soql: number; dml: number; cpuMs: number }>();
    for (const f of a.flows) {
      const e = g.get(f.name) ?? { count: 0, soql: 0, dml: 0, cpuMs: 0 };
      e.count++; e.soql = Math.max(e.soql, f.soql ?? 0); e.dml = Math.max(e.dml, f.dml ?? 0); e.cpuMs = Math.max(e.cpuMs, f.cpuMs ?? 0);
      g.set(f.name, e);
    }
    out.push('## Flows');
    out.push('| Flow | Runs | SOQL | DML | CPU ms |');
    out.push('|---|--:|--:|--:|--:|');
    for (const [name, e] of g) { out.push(`| ${name} | ${e.count} | ${e.soql} | ${e.dml} | ${e.cpuMs} |`); }
    out.push('');
    if (a.flowElements.length) {
      out.push('### Flow elements (by wall time)');
      out.push('| Element | Type | Wall ms | CPU ms | Runs |');
      out.push('|---|---|--:|--:|--:|');
      for (const e of a.flowElements) { out.push(`| ${e.name} | ${e.type} | ${e.totalMs.toFixed(1)} | ${e.cpuMs} | ${e.count} |`); }
      out.push('');
    }
  }

  if (a.callouts.length) {
    out.push('## Callouts');
    out.push('| Line | ms | Request | Response |');
    out.push('|--:|--:|---|---|');
    for (const c of a.callouts) {
      out.push(`| ${c.line ?? ''} | ${c.ms != null ? ms(c.ms) : ''} | ${c.request.replace(/\|/g, '\|').slice(0, 100)} | ${(c.response ?? '').replace(/\|/g, '\|').slice(0, 80)} |`);
    }
    out.push('');
  }

  if (a.debug.length) {
    out.push('## Debug output');
    for (const d of a.debug) { out.push(`- ${d.level ? `\`${d.level}\` ` : ''}${d.line != null ? `(line ${d.line}) ` : ''}${d.message}`); }
    out.push('');
  }

  return out.join('\n');
}

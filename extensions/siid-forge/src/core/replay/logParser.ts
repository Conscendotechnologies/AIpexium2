/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface ReplayVariable {
  name: string;
  value: string;
}

export interface ReplayFrame {
  /** Display name, e.g. "MyClass.myMethod". */
  name: string;
  className?: string;
  /** 1-based source line currently executing in this frame. */
  line: number;
  /** System/framework code (no user source) — UI shows it, stepping skips it. */
  external?: boolean;
}

export interface ReplayStep {
  /** 1-based source line. */
  line: number;
  className?: string;
  /** Call stack, outermost first, innermost last. */
  frames: ReplayFrame[];
  /** Local variables visible in the innermost frame at this step. */
  locals: ReplayVariable[];
  /** A message to surface in the Debug Console at this step (USER_DEBUG, SOQL, DML, exception…). */
  debug?: string;
  /** True if this step sits in system/framework code (no user source). */
  external?: boolean;
}

/** Diagnostics about the log as a whole, surfaced to the user. */
export interface ReplayLog {
  steps: ReplayStep[];
  /** API version from the header line, e.g. "59.0". */
  apiVersion?: string;
  /** APEX_CODE log level from the header, e.g. "FINEST" or "DEBUG". */
  apexCodeLevel?: string;
  /** False when APEX_CODE isn't FINEST — variables/stepping will be poor. */
  isFinest: boolean;
}

interface Frame {
  name: string;
  className?: string;
  line: number;
  vars: Map<string, string>;
  external: boolean;
  /** The entry event that opened this frame, to match the right exit. */
  openedBy: string;
}

/** Pulls the [n] line number out of a log event field. */
function lineOf(field: string | undefined): number | undefined {
  const m = field?.match(/\[(\d+)\]/);
  return m ? parseInt(m[1], 10) : undefined;
}

/**
 * Resolves the qualified name + owning class from an entry event's fields.
 * Handles the shapes seen in real logs:
 *   METHOD_ENTRY|[24]||System.Test.startTest()            -> name "System.Test.startTest"
 *   METHOD_ENTRY|[2]|01p…|LayoutConfigControllerTest.LayoutConfigControllerTest()
 *   CONSTRUCTOR_ENTRY|[123]|01p…|<init>()|Outer.Inner     -> class "Outer", name "Outer.Inner"
 *   CODE_UNIT_STARTED|[EXTERNAL]|01p…|Klass.method()
 */
function parseEntry(parts: string[]): { className?: string; name: string } {
  const last = parts[parts.length - 1] || '';
  const prev = parts[parts.length - 2] || '';
  // Constructor form: "<init>(...)" in the prev field, type name in the last.
  if (/^<init>/.test(prev)) {
    const type = last.trim();
    return { className: topLevel(type), name: type };
  }
  return parseSignature(last);
}

/** "MyClass.myMethod(args)" -> { className: "MyClass", name: "MyClass.myMethod" } */
function parseSignature(sig: string): { className?: string; name: string } {
  const noArgs = sig.replace(/\(.*$/, '').trim();
  const lastDot = noArgs.lastIndexOf('.');
  const qualified = lastDot > 0 ? noArgs.slice(0, lastDot) : undefined;
  return { className: topLevel(qualified), name: noArgs };
}

/** Outer class of a (possibly inner-/namespace-) qualified name. */
function topLevel(qualified?: string): string | undefined {
  if (!qualified) {
    return undefined;
  }
  const head = qualified.split('.')[0];
  // System/namespace prefixes (System, Schema, Database…) aren't user classes.
  return head;
}

/** The CLR id field (3rd) tells user code (01p…) from system/framework code. */
function isUserCode(idField: string | undefined): boolean {
  return !!idField && /^01p/i.test(idField.trim());
}

/**
 * Parses a raw Apex debug log into an ordered replay timeline plus log metadata.
 * Steps are produced at executable lines (STATEMENT_EXECUTE), call sites
 * (METHOD/CONSTRUCTOR_ENTRY), and notable events (SOQL, DML, debug, exceptions).
 */
export function parseLog(raw: string): ReplayLog {
  const steps: ReplayStep[] = [];
  const stack: Frame[] = [];
  const meta = parseHeader(raw);

  const top = () => stack[stack.length - 1];

  const snapshot = (line: number, debug?: string) => {
    const t = top();
    if (t) {
      t.line = line;
    }
    // Collapse consecutive identical steps on the same line/frame with no new
    // message — the runtime emits repeated STATEMENT_EXECUTE for one line.
    const prev = steps[steps.length - 1];
    if (prev && prev.line === line && prev.className === t?.className && !debug && prev.frames.length === stack.length) {
      // refresh locals on the existing step instead of adding a duplicate
      prev.locals = t ? [...t.vars].map(([name, value]) => ({ name, value })) : prev.locals;
      return;
    }
    steps.push({
      line,
      className: t?.className,
      frames: stack.map((f) => ({ name: f.name, className: f.className, line: f.line, external: f.external || undefined })),
      locals: t ? [...t.vars].map(([name, value]) => ({ name, value })) : [],
      debug,
      external: t?.external || undefined
    });
  };

  const pushFrame = (parts: string[], event: string) => {
    const callLine = lineOf(parts[2]);
    const { className, name } = parseEntry(parts);
    const external = !isUserCode(parts[3]) && !className;
    // Snapshot the call site before descending so a breakpoint on the calling
    // line (which logs an ENTRY, not a STATEMENT_EXECUTE) can be hit. Skip when
    // we're entering system code with no source line.
    if (callLine !== undefined) {
      snapshot(callLine);
    }
    stack.push({ name: name || 'anonymous', className, line: callLine ?? 1, vars: new Map(), external, openedBy: event });
  };

  const popFrame = () => {
    if (stack.length) {
      stack.pop();
    }
  };

  for (const rawLine of raw.split(/\r?\n/)) {
    const parts = rawLine.split('|');
    if (parts.length < 2) {
      continue;
    }
    const event = parts[1];

    switch (event) {
      // --- frame open -------------------------------------------------------
      case 'CODE_UNIT_STARTED': {
        const { className, name } = parseSignature(parts[parts.length - 1] || 'execute');
        stack.push({ name, className, line: lineOf(parts[2]) ?? 1, vars: new Map(), external: !className, openedBy: event });
        break;
      }
      case 'METHOD_ENTRY':
      case 'CONSTRUCTOR_ENTRY':
        pushFrame(parts, event);
        break;

      // --- frame close ------------------------------------------------------
      case 'METHOD_EXIT':
      case 'CONSTRUCTOR_EXIT':
      case 'CODE_UNIT_FINISHED':
        popFrame();
        break;

      // System/framework method calls: keep the stack balanced but DON'T push
      // a user frame (they have no source and pollute the call stack/stepping).
      case 'SYSTEM_METHOD_ENTRY':
      case 'SYSTEM_CONSTRUCTOR_ENTRY':
      case 'SYSTEM_METHOD_EXIT':
      case 'SYSTEM_CONSTRUCTOR_EXIT':
        break;

      // --- executable lines -------------------------------------------------
      case 'STATEMENT_EXECUTE': {
        const ln = lineOf(parts[2]);
        if (ln !== undefined) {
          snapshot(ln);
        }
        break;
      }

      // --- variables --------------------------------------------------------
      case 'VARIABLE_ASSIGNMENT': {
        // ...|VARIABLE_ASSIGNMENT|[line]|name|value|0xref(optional)
        const t = top();
        if (t && parts[3]) {
          t.vars.set(parts[3], cleanValue(parts[4]));
        }
        break;
      }
      case 'VARIABLE_SCOPE_BEGIN': {
        // ...|VARIABLE_SCOPE_BEGIN|[line]|name|type|...
        const t = top();
        if (t && parts[3] && !t.vars.has(parts[3])) {
          t.vars.set(parts[3], '(uninitialized)');
        }
        break;
      }

      // --- messages worth surfacing ----------------------------------------
      case 'USER_DEBUG': {
        const ln = lineOf(parts[2]);
        if (ln !== undefined) {
          snapshot(ln, `DEBUG: ${parts[parts.length - 1]}`);
        }
        break;
      }
      case 'SOQL_EXECUTE_BEGIN': {
        const ln = lineOf(parts[2]);
        if (ln !== undefined) {
          snapshot(ln, `SOQL: ${parts[parts.length - 1]}`);
        }
        break;
      }
      case 'DML_BEGIN': {
        const ln = lineOf(parts[2]);
        if (ln !== undefined) {
          snapshot(ln, `DML: ${parts.slice(3).join(' ')}`);
        }
        break;
      }
      case 'CALLOUT_REQUEST': {
        const ln = lineOf(parts[2]);
        if (ln !== undefined) {
          snapshot(ln, `CALLOUT: ${parts[parts.length - 1]}`);
        }
        break;
      }
      case 'EXCEPTION_THROWN':
      case 'FATAL_ERROR': {
        const ln = lineOf(parts[2]);
        const msg = `${event === 'FATAL_ERROR' ? 'FATAL' : 'EXCEPTION'}: ${parts[parts.length - 1]}`;
        // FATAL_ERROR's line field may be absent; attach to current frame line.
        snapshot(ln ?? top()?.line ?? 1, msg);
        break;
      }

      default:
        break;
    }
  }

  return { ...meta, steps };
}

/** Backwards-compatible helper: returns only the steps. */
export function parseApexLog(raw: string): ReplayStep[] {
  return parseLog(raw).steps;
}

/** Reads the first log line: "59.0 APEX_CODE,FINEST;APEX_PROFILING,FINE;…". */
function parseHeader(raw: string): { apiVersion?: string; apexCodeLevel?: string; isFinest: boolean } {
  const first = raw.split(/\r?\n/, 1)[0] ?? '';
  const apiVersion = first.match(/^(\d+\.\d+)/)?.[1];
  const apexCodeLevel = first.match(/APEX_CODE,([A-Z]+)/)?.[1];
  return { apiVersion, apexCodeLevel, isFinest: apexCodeLevel === 'FINEST' };
}

/**
 * Tidies a logged value for display: drops the trailing internal toString
 * ("common.apex.runtime…@hash") in favour of the type, and unquotes simple
 * string values.
 */
function cleanValue(value: string | undefined): string {
  if (value === undefined || value === '') {
    return '';
  }
  const v = value.trim();
  // "common.apex.runtime.impl.ApexSObjectTypeToken@5d65edf3" -> "ApexSObjectTypeToken"
  const objRef = v.match(/^"?[\w.]*\.(\w+)@[0-9a-f]+"?$/i);
  if (objRef) {
    return objRef[1];
  }
  return v;
}

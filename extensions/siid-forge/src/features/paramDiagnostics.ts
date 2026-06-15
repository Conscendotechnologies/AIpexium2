/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { SchemaManager, ApexParam } from '../core/schemaManager';
import { Feature } from './types';

/**
 * Reports calls to known custom Apex methods made with the wrong NUMBER of
 * arguments — in Apex files and in LWC `.js` (imported @AuraEnabled methods).
 * Only argument COUNT is checked (no type checking — we have no type system).
 * Unknown methods are ignored, so this never false-positives on platform/3rd-party APIs.
 */
export const registerParamDiagnostics: Feature = ({ context, schema }) => {
  const collection = vscode.languages.createDiagnosticCollection('siid-forge-apex-args');
  context.subscriptions.push(collection);

  const validate = (document: vscode.TextDocument) => {
    if (!isSupported(document)) {
      collection.delete(document.uri);
      return;
    }
    const root = cwd();
    if (!root) {
      return;
    }
    collection.set(document.uri, computeDiagnostics(document, schema, root));
  };

  const validateAllVisible = () => vscode.window.visibleTextEditors.forEach((e) => validate(e.document));

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(validate),
    vscode.workspace.onDidChangeTextDocument((e) => validate(e.document)),
    vscode.workspace.onDidCloseTextDocument((d) => collection.delete(d.uri)),
    vscode.window.onDidChangeActiveTextEditor((e) => e && validate(e.document))
  );

  validateAllVisible();
};

function cwd(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function isSupported(document: vscode.TextDocument): boolean {
  if (document.uri.scheme !== 'file') {
    return false;
  }
  if (document.languageId === 'apex' || document.languageId === 'apex-anon') {
    return true;
  }
  // LWC component scripts only.
  return document.languageId === 'javascript' && /[\\/]lwc[\\/]/.test(document.uri.fsPath);
}

interface KnownMethod {
  params: ApexParam[];
  owner: string;
}

/** Builds a lookup of method name -> signature(s) we can validate against. */
function buildLookup(document: vscode.TextDocument, schema: SchemaManager, root: string): Map<string, KnownMethod[]> {
  const lookup = new Map<string, KnownMethod[]>();
  const add = (name: string, m: KnownMethod) => {
    const list = lookup.get(name) ?? [];
    list.push(m);
    lookup.set(name, list);
  };

  if (document.languageId === 'javascript') {
    // Only methods actually imported into this component, keyed by local name.
    const aura = schema.readAuraEnabled(root);
    const re = /import\s+(?:\{\s*)?(\w+)\s*\}?\s+from\s+['"]@salesforce\/apex\/([\w.]+)\.(\w+)['"]/g;
    let im: RegExpExecArray | null;
    while ((im = re.exec(document.getText())) !== null) {
      const [, local, cls, method] = im;
      const meta = aura[cls]?.find((a) => a.name === method);
      if (meta) {
        add(local, { params: meta.params ?? [], owner: cls });
      }
    }
  } else {
    // Apex: every method of every cached local class.
    for (const cls of schema.listApex(root)) {
      for (const m of cls.members) {
        if (m.kind === 'method') {
          add(m.name, { params: m.params ?? [], owner: cls.name });
        }
      }
    }
  }
  return lookup;
}

function computeDiagnostics(document: vscode.TextDocument, schema: SchemaManager, root: string): vscode.Diagnostic[] {
  const lookup = buildLookup(document, schema, root);
  if (!lookup.size) {
    return [];
  }
  // LWC calls Apex very differently from Apex-to-Apex calls, so validate each
  // language with its own rules.
  return document.languageId === 'javascript'
    ? lwcDiagnostics(document, lookup)
    : apexDiagnostics(document, lookup);
}

/**
 * Apex-to-Apex: positional arguments. Flag calls whose ARG COUNT matches no
 * known overload of a cached method.
 */
function apexDiagnostics(document: vscode.TextDocument, lookup: Map<string, KnownMethod[]>): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];
  const text = document.getText();
  const callRe = /\b(\w+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = callRe.exec(text)) !== null) {
    const method = m[1];
    const candidates = lookup.get(method);
    if (!candidates || isDeclaration(text, m.index)) {
      continue;
    }
    const openParen = m.index + m[0].length - 1;
    const args = parseCallArgs(text, openParen);
    if (args === undefined) {
      continue;
    }
    const arities = candidates.map((c) => c.params.length);
    if (arities.includes(args.count)) {
      continue;
    }
    const expected = [...new Set(arities)].sort((a, b) => a - b).join(' or ');
    diagnostics.push(diag(
      document, m.index, method.length,
      `${candidates[0].owner}.${method} expects ${expected} argument(s), but ${args.count} ${args.count === 1 ? 'was' : 'were'} provided.`
    ));
  }
  return diagnostics;
}

/**
 * LWC → Apex: arguments are passed as a SINGLE config object whose KEYS are the
 * Apex parameter names. Two forms:
 *   imperative:  getAccount({ accountId: x })
 *   wire:        @wire(getAccount, { accountId: '$recordId' })
 * Validate that the object's keys match the method's parameter names (extra or
 * misspelled keys are flagged; missing keys are reported informationally).
 */
function lwcDiagnostics(document: vscode.TextDocument, lookup: Map<string, KnownMethod[]>): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];
  const text = document.getText();

  // Find both `@wire(method, {…})` and imperative `method({…})` / `method(`.
  // Group: (wirePrefix?) method ( … the rest handled by locating the object.
  const callRe = /(@wire\s*\(\s*)?\b(\w+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = callRe.exec(text)) !== null) {
    const isWire = !!m[1];
    const method = m[2];
    const candidates = lookup.get(method);
    if (!candidates) {
      continue;
    }
    const params = candidates[0].params;
    const owner = candidates[0].owner;

    // Locate the config object literal that carries the named params.
    //  - imperative: the first arg of method(  -> the `{ … }` right after `(`
    //  - wire:        the SECOND arg of @wire( method , { … } )
    const openParen = m.index + m[0].length - 1;
    const objRange = isWire
      ? findWireConfigObject(text, openParen)
      : findFirstObjectArg(text, openParen);

    const nameRange = new vscode.Range(
      document.positionAt(m.index + (isWire ? m[1]!.length : 0)),
      document.positionAt(m.index + (isWire ? m[1]!.length : 0) + method.length)
    );

    // No config object at all.
    if (!objRange) {
      if (params.length > 0) {
        diagnostics.push(diag(
          document, m.index + (isWire ? m[1]!.length : 0), method.length,
          `${owner}.${method} needs parameters { ${params.map((p) => p.name).join(', ')} }.`,
          vscode.DiagnosticSeverity.Information
        ));
      }
      continue;
    }

    const provided = objectKeys(text.slice(objRange.start, objRange.end));
    const valid = new Set(params.map((p) => p.name));

    // Unknown / misspelled keys -> warning.
    const unknown = provided.filter((k) => !valid.has(k.name));
    for (const k of unknown) {
      diagnostics.push(diag(
        document, objRange.start + k.offset, k.name.length,
        `'${k.name}' is not a parameter of ${owner}.${method}. Expected: ${[...valid].join(', ') || '(none)'}.`
      ));
    }

    // Missing required keys -> informational on the method name.
    const providedNames = new Set(provided.map((k) => k.name));
    const missing = [...valid].filter((p) => !providedNames.has(p));
    if (missing.length && !unknown.length) {
      diagnostics.push(diag(
        document, m.index + (isWire ? m[1]!.length : 0), method.length,
        `${owner}.${method} is missing parameter(s): ${missing.join(', ')}.`,
        vscode.DiagnosticSeverity.Information
      ));
    }
  }
  return diagnostics;
}

/** Builds a diagnostic over the token at [start, start+len). */
function diag(
  document: vscode.TextDocument,
  start: number,
  len: number,
  message: string,
  severity = vscode.DiagnosticSeverity.Warning
): vscode.Diagnostic {
  const d = new vscode.Diagnostic(
    new vscode.Range(document.positionAt(start), document.positionAt(start + len)),
    message,
    severity
  );
  d.source = 'SIID Forge';
  return d;
}

/** The `{ … }` immediately following an open paren (imperative first arg). */
function findFirstObjectArg(text: string, openParen: number): { start: number; end: number } | undefined {
  let i = openParen + 1;
  while (i < text.length && /\s/.test(text[i])) {
    i++;
  }
  if (text[i] !== '{') {
    return undefined;
  }
  const end = matchBrace(text, i);
  return end === undefined ? undefined : { start: i, end: end + 1 };
}

/** The `{ … }` that is the 2nd arg of `@wire(method, { … })`. */
function findWireConfigObject(text: string, openParen: number): { start: number; end: number } | undefined {
  // Find the top-level comma after the method ref, then the following object.
  let depth = 0;
  for (let i = openParen; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) {
        return undefined; // closed wire() before any config object
      }
    } else if (ch === ',' && depth === 1) {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) {
        j++;
      }
      if (text[j] === '{') {
        const end = matchBrace(text, j);
        return end === undefined ? undefined : { start: j, end: end + 1 };
      }
      return undefined;
    }
  }
  return undefined;
}

/** Index of the `}` matching the `{` at `open`, or undefined if unbalanced. */
function matchBrace(text: string, open: number): number | undefined {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') {
      depth++;
    } else if (text[i] === '}') {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  return undefined;
}

/** Top-level keys of an object literal `{ a: 1, b: x }` with their offsets. */
function objectKeys(objText: string): Array<{ name: string; offset: number }> {
  const keys: Array<{ name: string; offset: number }> = [];
  let depth = 0;
  // A key appears at depth 1 (just inside the outer braces) before a colon.
  const re = /(['"]?)([A-Za-z_$][\w$]*)\1\s*:/g;
  // Track brace depth manually by scanning, recording key matches only at depth 1.
  let m: RegExpExecArray | null;
  // Pre-compute depth at each index is overkill; instead scan char by char and
  // detect "identifier :" at depth 1.
  let i = 0;
  while (i < objText.length) {
    const ch = objText[i];
    if (ch === '{' || ch === '[' || ch === '(') {
      depth++;
      i++;
      continue;
    }
    if (ch === '}' || ch === ']' || ch === ')') {
      depth--;
      i++;
      continue;
    }
    if (depth === 1) {
      re.lastIndex = i;
      m = re.exec(objText);
      if (m && m.index === i) {
        keys.push({ name: m[2], offset: m.index + m[1].length });
        i = re.lastIndex;
        continue;
      }
    }
    i++;
  }
  return keys;
}

/** True if the `(` at `name(` is a method DECLARATION, not a call. */
function isDeclaration(text: string, nameMatchIndex: number): boolean {
  // Look at the code just before the name; a declaration has a return type +
  // modifiers (e.g. "public static Account getAccount("). A call is preceded by
  // `=`, `(`, `,`, `.`, `return`, `;`, whitespace at line start, etc.
  const before = text.slice(Math.max(0, nameMatchIndex - 60), nameMatchIndex);
  return /\b(?:global|public|private|protected|static|override|virtual|testmethod|final|abstract)\s+[\w.<>\[\]]*\s*$/i.test(before);
}

/**
 * Counts arguments in a call whose `(` is at `openParen`. Returns the count
 * (0 for `()`), or undefined if the parens don't balance (still being typed).
 */
function parseCallArgs(text: string, openParen: number): { count: number } | undefined {
  let depth = 0;       // () [] {} nesting
  let angle = 0;       // generic <> nesting (heuristic)
  let i = openParen;
  let started = false;
  let sawAny = false;
  let topLevelCommas = 0;
  for (; i < text.length; i++) {
    const ch = text[i];
    const prev = text[i - 1];
    if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
      if (ch === '(' && depth === 1 && !started) {
        started = true;
        continue;
      }
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) {
        return { count: sawAny ? topLevelCommas + 1 : 0 };
      }
    } else if (ch === '<' && /[\w\s]/.test(prev ?? '')) {
      // Likely a generic type parameter list (Map<...>): treat as nesting so
      // its commas don't inflate the arg count. (Heuristic; ignores `a < b`.)
      angle++;
    } else if (ch === '>' && angle > 0) {
      angle--;
    } else if (ch === ',' && depth === 1 && angle === 0) {
      topLevelCommas++;
    }
    if (started && depth >= 1 && !/\s/.test(ch)) {
      sawAny = true;
    }
    if (i - openParen > 5000) {
      break; // safety
    }
  }
  return undefined; // unbalanced
}

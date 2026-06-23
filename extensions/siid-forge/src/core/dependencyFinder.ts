/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as fs from 'fs';
import * as path from 'path';

/**
 * Shared dependency / reference finder. The load-bearing primitive every
 * refactor and analysis reuses: "where is symbol X referenced, and what KIND of
 * reference is each?" — across Apex, LWC/Aura, SOQL and metadata XML.
 *
 * Heuristic (no full parser), but reference KIND lets consumers be precise:
 * a rename can update only the relevant kinds; an impact view can explain each
 * hit; "find unused" can ignore declarations. Comment/string-aware with exact
 * columns so edits are safe.
 */

/** The classification of a single reference. */
export type RefKind =
  // Apex
  | 'apex-type'          // a type usage: `Account a`, `List<Foo>`, `(Foo)x`
  | 'apex-new'           // constructor: `new Foo(`
  | 'apex-static'        // static access: `Foo.method` / `Foo.CONST`
  | 'apex-member'        // `.member` after a value/owner
  | 'apex-decl'          // a declaration of the symbol itself (class/method/var)
  | 'apex-ident'         // a bare identifier (variable, unqualified call/field)
  // SOQL (inline in Apex or .soql files)
  | 'soql-from'          // object after FROM
  | 'soql-field'         // a field in SELECT/WHERE/ORDER BY
  // LWC / Aura
  | 'lwc-import'         // `@salesforce/apex/Class.method` or `c/cmp`
  | 'lwc-wire'           // a key in an @wire config object
  | 'lwc-tag'            // `<c-my-cmp>` markup tag
  | 'lwc-ident'          // a JS identifier
  // Metadata / files
  | 'meta-xml'           // a token inside a *-meta.xml or object/field xml
  | 'filename';          // the symbol appears in a file/folder name

export interface DependencyRef {
  filePath: string;
  /** 0-based line; -1 for filename refs (whole-file rename). */
  line: number;
  /** 0-based column; -1 for filename refs. */
  column: number;
  /** Length of the matched identifier. */
  length: number;
  kind: RefKind;
}

/** What we're searching for. */
export interface SymbolQuery {
  name: string;
  /** Optional category hint to bias kind classification + filtering. */
  symbol?: 'class' | 'method' | 'field' | 'object' | 'lwc' | 'variable';
  /** For fields: the owning object API name — used to scope + exclude the
   *  field's own definition file. */
  object?: string;
}

const APEX_EXTS = new Set(['.cls', '.trigger']);
const LWC_AURA_EXTS = new Set(['.js', '.html', '.cmp', '.app', '.evt']);
const SOQL_EXTS = new Set(['.soql']);

/**
 * Finds typed references to `query.name` across the project. Pass a `scopeFile`
 * to restrict to one file (used for variable renames).
 */
export function findDependencies(
  projectRoot: string,
  query: SymbolQuery,
  scopeFile?: string
): DependencyRef[] {
  const files = scopeFile ? [scopeFile] : collectSourceFiles(projectRoot);
  const refs: DependencyRef[] = [];
  for (const file of files) {
    // Skip the symbol's OWN definition file — that's the declaration, not a use:
    //  - a field's   objects/<Object>/fields/<Field>.field-meta.xml
    //  - an object's  objects/<Object>/<Object>.object-meta.xml
    if (isOwnDefinitionFile(file, query)) {
      continue;
    }

    let text: string;
    try {
      text = fs.readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    const contentRefs = text.includes(query.name) ? scanFile(file, text, query.name) : [];
    refs.push(...contentRefs);

    // filename / folder match — but only when the file has NO content ref for
    // the symbol (otherwise the precise content ref already covers this file).
    if (!scopeFile && contentRefs.length === 0 && fileNameMentions(file, query.name)) {
      refs.push({ filePath: file, line: -1, column: -1, length: query.name.length, kind: 'filename' });
    }
  }
  return refs;
}

/** True if `file` is the declaration file for the queried field/object itself. */
function isOwnDefinitionFile(file: string, query: SymbolQuery): boolean {
  const norm = file.replace(/\\/g, '/');
  if (query.symbol === 'field') {
    // .../objects/<AnyObject>/fields/<Field>.field-meta.xml is a field def.
    // If we know the object, only its own file is the declaration; other
    // objects' same-named fields are still excluded here because each is that
    // OTHER field's declaration, not a reference to ours.
    const m = norm.match(/\/objects\/([^/]+)\/fields\/([^/]+)\.field-meta\.xml$/i);
    if (m) {
      const fieldBase = m[2];
      if (fieldBase.toLowerCase() === query.name.toLowerCase()) {
        return true; // it's a field-definition file for a same-named field
      }
    }
  }
  if (query.symbol === 'object') {
    const m = norm.match(/\/objects\/([^/]+)\/\1\.object-meta\.xml$/i);
    if (m && m[1].toLowerCase() === query.name.toLowerCase()) {
      return true;
    }
  }
  return false;
}

/** Scans one file's contents for whole-word matches, classifying each by kind. */
function scanFile(file: string, text: string, name: string): DependencyRef[] {
  const ext = path.extname(file);
  const out: DependencyRef[] = [];
  const wordRe = new RegExp(`\\b${escapeRegExp(name)}\\b`, 'g');
  const lines = text.split(/\r?\n/);

  const isApex = APEX_EXTS.has(ext);
  const isLwc = LWC_AURA_EXTS.has(ext);
  const isSoql = SOQL_EXTS.has(ext);
  const isXml = file.endsWith('-meta.xml') || (ext === '.xml');

  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    // For Apex/LWC-JS, strip comments+strings; for XML/HTML/SOQL keep as-is
    // (their "strings" carry real references, e.g. field names).
    const scan: { code: string; inBlockComment: boolean } =
      isApex || (isLwc && ext === '.js')
        ? stripCommentsAndStrings(raw, inBlock)
        : { code: raw, inBlockComment: inBlock };
    inBlock = scan.inBlockComment;

    wordRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = wordRe.exec(scan.code)) !== null) {
      const col = m.index;
      const kind: RefKind = isXml
        ? 'meta-xml'
        : isSoql
          ? classifySoql(scan.code, col)
          : isApex
            ? classifyApex(scan.code, col, name)
            : classifyLwc(ext, scan.code, col);
      out.push({ filePath: file, line: i, column: col, length: name.length, kind });
    }
  }
  return out;
}

/** Classifies an Apex reference by the surrounding tokens. */
function classifyApex(code: string, col: number, name: string): RefKind {
  const before = code.slice(0, col);
  const after = code.slice(col + name.length);

  if (/\bnew\s*$/.test(before)) {
    return 'apex-new';
  }
  if (/\.\s*$/.test(before)) {
    return 'apex-member';
  }
  if (/^\s*\./.test(after)) {
    return 'apex-static'; // `Name.` — static/qualified access
  }
  // Declaration: `class Name`, `interface Name`, or a method/var decl form.
  if (/\b(class|interface|enum)\s*$/.test(before)) {
    return 'apex-decl';
  }
  // Inline SOQL context? crude: inside `[ ... ]` with SELECT before.
  if (/\[\s*select\b[\s\S]*$/i.test(before) && !/]/.test(before.slice(before.lastIndexOf('[')))) {
    return /\bfrom\s*$/i.test(before) ? 'soql-from' : 'soql-field';
  }
  // Type position: followed by an identifier (`Name var`) or generic/array.
  if (/^\s*[<\[]/.test(after) || /^\s+[A-Za-z_]/.test(after)) {
    return 'apex-type';
  }
  return 'apex-ident';
}

/** Classifies a reference inside a SOQL query body. */
function classifySoql(code: string, col: number): RefKind {
  const before = code.slice(0, col);
  return /\bfrom\s+$/i.test(before) ? 'soql-from' : 'soql-field';
}

/** Classifies a reference in an LWC/Aura file by extension + context. */
function classifyLwc(ext: string, code: string, col: number): RefKind {
  if (ext === '.html' || ext === '.cmp' || ext === '.app' || ext === '.evt') {
    // markup: a component tag like <c-my-cmp> (kebab) — but we match by name
    // token; treat any markup hit as a tag reference.
    return 'lwc-tag';
  }
  // .js
  const before = code.slice(0, col);
  if (/from\s+['"][^'"]*$/.test(before) || /@salesforce\/apex\/[\w.]*$/.test(before)) {
    return 'lwc-import';
  }
  if (/@wire\([^)]*\{[^}]*$/.test(code.slice(0, col))) {
    return 'lwc-wire';
  }
  return 'lwc-ident';
}

/** True if the file's base name (sans ext/-meta) equals the symbol. */
function fileNameMentions(file: string, name: string): boolean {
  const base = path.basename(file).replace(/(-meta)?\.[^.]+$/, '').replace(/\.cls$|\.trigger$/, '');
  const baseNoExt = path.basename(file).split('.')[0];
  return base === name || baseNoExt === name || path.basename(path.dirname(file)) === name;
}

/** Collects all refactorable source files (Apex + LWC/Aura + SOQL + meta XML). */
function collectSourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.siid' || e.name === '.git' || e.name === '.sfdx') {
        continue;
      }
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
        continue;
      }
      const ext = path.extname(e.name);
      if (APEX_EXTS.has(ext) || LWC_AURA_EXTS.has(ext) || SOQL_EXTS.has(ext) || e.name.endsWith('-meta.xml') || ext === '.xml') {
        out.push(full);
      }
    }
  };
  walk(root);
  return out;
}

/**
 * Blanks line/block comments and string literals on a line (preserving columns),
 * tracking block-comment state across lines.
 */
function stripCommentsAndStrings(line: string, inBlockComment: boolean): { code: string; inBlockComment: boolean } {
  let out = '';
  let i = 0;
  let block = inBlockComment;
  let inString: '"' | "'" | undefined;
  while (i < line.length) {
    const two = line.slice(i, i + 2);
    if (block) {
      if (two === '*/') { block = false; out += '  '; i += 2; } else { out += ' '; i += 1; }
      continue;
    }
    if (inString) {
      if (line[i] === '\\') { out += '  '; i += 2; continue; }
      if (line[i] === inString) { inString = undefined; }
      out += ' '; i += 1;
      continue;
    }
    if (two === '//') { out += ' '.repeat(line.length - i); break; }
    if (two === '/*') { block = true; out += '  '; i += 2; continue; }
    if (line[i] === '"' || line[i] === "'") { inString = line[i] as '"' | "'"; out += ' '; i += 1; continue; }
    out += line[i]; i += 1;
  }
  return { code: out, inBlockComment: block };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

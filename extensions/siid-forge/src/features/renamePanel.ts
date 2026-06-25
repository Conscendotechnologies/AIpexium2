/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as path from 'path';
import * as vscode from 'vscode';
import { Commands } from '../commands';
import { SchemaManager } from '../core/schemaManager';
import { findProjectRoot } from '../core/workspace';
import { RenameTarget } from '../core/refactor';
import { planRename, RenamePlan, RenameEdit } from '../core/refactor';
import { FileReader } from '../core/dependencyFinder';
import { escapeHtml, FORGE_STYLES } from '../ui/webview';
import { Feature } from './types';

/**
 * Rename Symbol — a track-and-deploy rename workflow in a webview. Unlike the
 * inline F2 rename (left untouched), this lets the user:
 *   1. type a new name,
 *   2. review EVERY reference grouped by file, toggling each (or all) on/off,
 *   3. apply the selected edits locally,
 *   4. deploy the touched files together or one by one.
 *
 * The plan/apply logic is headless (`core/refactor.planRename`); this is the UI.
 * Targets: Apex method names + local variables/parameters (class names too).
 * Confidence-scored: bare same-name hits default OFF so the user opts in.
 */
export const registerRenamePanel: Feature = ({ context, schema, logger }) => {
  // Edit-driven rename: a tracker watches identifier edits and remembers the
  // ORIGINAL name (before you typed) per line. The CodeLens appears only on a
  // line you've actually renamed — "Rename 'old' → 'new'" — and clicking it
  // searches the OLD name and replaces it with the NEW one across the project.
  const tracker = new EditTracker();
  const lensProvider = new RenameCodeLensProvider(tracker);
  // Seed the line snapshot before any edits so the FIRST keystroke has a
  // pre-change baseline to compare against.
  if (vscode.window.activeTextEditor?.document.languageId === 'apex') {
    tracker.seed(vscode.window.activeTextEditor.document);
  }
  context.subscriptions.push(
    tracker,
    vscode.languages.registerCodeLensProvider({ language: 'apex', scheme: 'file' }, lensProvider),
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (doc.languageId === 'apex' && doc.uri.scheme === 'file') {
        tracker.seed(doc);
      }
    }),
    vscode.window.onDidChangeActiveTextEditor((ed) => {
      if (ed?.document.languageId === 'apex') {
        tracker.seed(ed.document);
      }
    }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.languageId === 'apex' && e.document.uri.scheme === 'file') {
        tracker.onEdit(e);
        lensProvider.refresh();
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(Commands.renameSymbol, async (arg?: RenameLensArg) => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !arg) {
        vscode.window.showInformationMessage('SIID Forge: edit a symbol name, then click the Rename action that appears above it.');
        return;
      }
      const root = findProjectRoot(arg.fsPath);
      const oldName = arg.oldName;
      const newName = arg.newName;

      // Classify the symbol using the NEW name's position in the current buffer.
      const at = new vscode.Position(arg.line, arg.character);
      const range = editor.document.getWordRangeAtPosition(at);
      const target: RenameTarget = range
        ? identifyFor(schema, root, editor.document, range, oldName)
        : { kind: 'variable', name: oldName };

      const panel = vscode.window.createWebviewPanel(
        'siidForgeRename',
        `Rename: ${oldName} → ${newName}`,
        vscode.ViewColumn.Beside,
        { enableScripts: true, retainContextWhenHidden: true }
      );
      panel.webview.html = shellHtml(target, oldName, newName);

      // Clear the tracked edit now that we've opened the rename flow for it.
      tracker.clear(arg.fsPath, arg.line);
      lensProvider.refresh();

      // Plan held server-side; the webview references edits by key.
      let plan: RenamePlan | undefined;

      panel.webview.onDidReceiveMessage(async (msg) => {
        try {
          if (msg?.command === 'plan') {
            // Search the OLD name across the project (live buffer content). The
            // one occurrence you already renamed now holds the NEW name, so it
            // simply won't match — that's correct, it's already done. Every
            // remaining OLD-name occurrence is what we propagate the rename to.
            plan = planRename(schema, root, { ...target, name: oldName }, newName, liveReader());
            logger.info(`[rename] ${oldName} → ${newName}: ${plan.edits.length} reference(s) found`);
            panel.webview.postMessage({ command: 'plan', html: planHtml(plan) });
            return;
          }
          if (msg?.command === 'apply') {
            if (!plan) {
              return;
            }
            const selected = new Set<string>(Array.isArray(msg.keys) ? msg.keys : []);

            // Safety guard: applying a partial rename that leaves the OLD name
            // alongside the NEW name in the SAME file produces a broken,
            // inconsistent symbol (the exact corruption we want to prevent).
            const risky = inconsistentFiles(plan, selected);
            if (risky.length) {
              const proceed = await vscode.window.showWarningMessage(
                `Some references to "${oldName}" are unticked, so these files will end up with BOTH "${oldName}" and "${newName}":\n\n${risky.map((f) => '• ' + f).join('\n')}\n\nThis usually breaks the code. Apply anyway?`,
                { modal: true },
                'Apply anyway'
              );
              if (proceed !== 'Apply anyway') {
                panel.webview.postMessage({ command: 'error', text: 'Apply cancelled — select all references (or none) to keep the symbol consistent.' });
                return;
              }
            }

            const touched = await applyEdits(plan, selected);
            logger.info(`[rename] applied ${oldName} → ${newName} across ${touched.length} file(s)`);
            panel.webview.postMessage({ command: 'applied', html: deployHtml(touched) });
            return;
          }
          if (msg?.command === 'open' && typeof msg.file === 'string') {
            await openRef(msg.file, msg.line, msg.column);
            return;
          }
          if (msg?.command === 'deploy') {
            const files: string[] = Array.isArray(msg.files) ? msg.files : (msg.file ? [String(msg.file)] : []);
            await deployFiles(files);
            panel.webview.postMessage({ command: 'deployed', files });
            return;
          }
        } catch (err: any) {
          logger.error(err.message);
          panel.webview.postMessage({ command: 'error', text: err.message });
        }
      });
    })
  );
};

/** A pending rename detected on a line: the symbol was `oldName`, now `newName`. */
interface PendingRename {
  oldName: string;
  newName: string;
  line: number;       // current line in the buffer
  character: number;  // start column of the new name
}

/** Argument passed from the CodeLens to the rename command. */
interface RenameLensArg {
  fsPath: string;
  line: number;
  character: number;
  oldName: string;
  newName: string;
}

/**
 * Tracks identifier edits per document. Keeps a line snapshot of each document
 * (the text BEFORE the latest change) so it can compare the identifier at the
 * edit position "before" vs "now" — which handles typing, deleting (backspace),
 * and pasting identically. The ORIGINAL name is preserved across successive
 * keystrokes so the rename action always knows what to search for.
 */
class EditTracker {
  // fsPath -> Map<lineNumber, PendingRename>
  private readonly pending = new Map<string, Map<number, PendingRename>>();
  // fsPath -> line text snapshot from BEFORE the current change.
  private readonly snapshot = new Map<string, string[]>();

  onEdit(e: vscode.TextDocumentChangeEvent): void {
    const fsPath = e.document.uri.fsPath;
    const before = this.snapshot.get(fsPath);
    const afterLines = e.document.getText().split(/\r?\n/);

    if (before) {
      for (const change of e.contentChanges) {
        // Single-line edits only (the rename-typing case); multi-line edits just
        // resync the snapshot below.
        if (change.range.start.line !== change.range.end.line || change.text.includes('\n')) {
          continue;
        }
        const line = change.range.start.line;
        const col = change.range.start.character;
        const oldLine = before[line] ?? '';
        const newLine = afterLines[line] ?? '';

        // Identifier at the edit column, BEFORE and AFTER the change.
        const oldWord = identifierAt(oldLine, col);
        const newWordInfo = identifierAt2(newLine, col);
        const map = this.get(fsPath);
        const existing = map.get(line);

        // The "anchor" old name: the very first old name seen for this line.
        const baseOld = existing?.oldName ?? oldWord?.word;

        if (!newWordInfo || !isRenameable(newWordInfo.word)) {
          // Edit destroyed the identifier (e.g. emptied it) — drop any pending.
          map.delete(line);
        } else if (baseOld && isRenameable(baseOld) && baseOld !== newWordInfo.word) {
          map.set(line, { oldName: baseOld, newName: newWordInfo.word, line, character: newWordInfo.start });
        } else {
          // Back to the original (or never changed) — no pending rename.
          map.delete(line);
        }
      }
    }

    // Update the snapshot to the post-change state for the next event.
    this.snapshot.set(fsPath, afterLines);
  }

  /** Seeds the snapshot when a document first becomes relevant. */
  seed(document: vscode.TextDocument): void {
    if (!this.snapshot.has(document.uri.fsPath)) {
      this.snapshot.set(document.uri.fsPath, document.getText().split(/\r?\n/));
    }
  }

  /** All pending renames for a document. */
  forDoc(fsPath: string): PendingRename[] {
    return [...(this.pending.get(fsPath)?.values() ?? [])];
  }

  clear(fsPath: string, line: number): void {
    this.pending.get(fsPath)?.delete(line);
  }

  private get(fsPath: string): Map<number, PendingRename> {
    let m = this.pending.get(fsPath);
    if (!m) {
      m = new Map();
      this.pending.set(fsPath, m);
    }
    return m;
  }

  dispose(): void {
    this.pending.clear();
  }
}

/**
 * Reconstructs the word as it was BEFORE `change`, given the word range AFTER.
 * We undo the single change within the line: remove the inserted text and
 * re-insert what was replaced, then re-extract the word at the same spot.
 */
function identifierAt(line: string, col: number): { word: string; start: number } | undefined {
  const probe = Math.min(Math.max(col, 0), line.length);
  let start = probe;
  while (start > 0 && /\w/.test(line[start - 1])) { start--; }
  let end = probe;
  while (end < line.length && /\w/.test(line[end])) { end++; }
  if (end <= start) {
    return undefined;
  }
  const word = line.slice(start, end);
  return /^[A-Za-z_]\w*$/.test(word) ? { word, start } : undefined;
}

function identifierAt2(line: string, col: number): { word: string; start: number } | undefined {
  return identifierAt(line, col) ?? identifierAt(line, Math.max(0, col - 1));
}

function isRenameable(name: string): boolean {
  return /^[A-Za-z_]\w*$/.test(name) && !APEX_KEYWORDS.has(name.toLowerCase());
}

/**
 * Edit-driven "Rename" CodeLens: shows a button ONLY on lines where you've
 * actually renamed an identifier — "Rename 'old' → 'new'". Clicking it searches
 * the OLD name and replaces it with the NEW one project-wide.
 */
class RenameCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChange.event;

  constructor(private readonly tracker: EditTracker) { }

  refresh(): void {
    this._onDidChange.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const pending = this.tracker.forDoc(document.uri.fsPath);
    return pending.map((p) => {
      const range = new vscode.Range(p.line, 0, p.line, 0);
      const arg: RenameLensArg = {
        fsPath: document.uri.fsPath, line: p.line, character: p.character,
        oldName: p.oldName, newName: p.newName
      };
      return new vscode.CodeLens(range, {
        title: `$(symbol-keyword) Rename '${p.oldName}' → '${p.newName}' everywhere`,
        command: Commands.renameSymbol,
        arguments: [arg]
      });
    });
  }
}

/** Apex keywords/types we never offer to rename (avoids noise on every token). */
const APEX_KEYWORDS = new Set([
  'public', 'private', 'protected', 'global', 'static', 'final', 'abstract', 'virtual',
  'override', 'class', 'interface', 'enum', 'extends', 'implements', 'new', 'return',
  'if', 'else', 'for', 'while', 'do', 'switch', 'when', 'break', 'continue', 'try',
  'catch', 'finally', 'throw', 'this', 'super', 'void', 'null', 'true', 'false',
  'with', 'without', 'inherited', 'sharing', 'system', 'set', 'get', 'instanceof',
  'integer', 'string', 'boolean', 'decimal', 'double', 'long', 'date', 'datetime',
  'id', 'list', 'map', 'object', 'blob', 'time'
]);

/**
 * Classifies a symbol as class / method / variable, using the symbol's CURRENT
 * position in the buffer (which now holds the NEW name) but reporting the
 * `oldName` as the target name to search for.
 */
function identifyFor(
  schema: SchemaManager,
  root: string,
  document: vscode.TextDocument,
  range: vscode.Range,
  oldName: string
): RenameTarget {
  const newWord = document.getText(range);

  // A known class (the NEW name may already be cached, or fall back to file).
  if (schema.readApex(root, newWord) || schema.readApex(root, oldName)) {
    return { kind: 'class', name: oldName };
  }

  // Method? A name immediately followed by `(` is a call or declaration.
  const after = document.lineAt(range.end.line).text.slice(range.end.character);
  const looksLikeMethod = /^\s*\(/.test(after);
  const ownerFromCache = findMethodOwner(schema, root, document, newWord) ?? findMethodOwner(schema, root, document, oldName);
  if (looksLikeMethod || ownerFromCache) {
    return { kind: 'method', name: oldName, owner: ownerFromCache ?? path.basename(document.fileName, '.cls') };
  }

  // Otherwise variable/parameter: file-scoped if locally declared, else project.
  if (isLocallyDeclared(document, newWord)) {
    return { kind: 'variable', name: oldName, scopeFile: document.uri.fsPath };
  }
  return { kind: 'variable', name: oldName };
}

/** Finds the owning class of `method` via the schema cache, if cached. */
function findMethodOwner(
  schema: SchemaManager,
  root: string,
  document: vscode.TextDocument,
  method: string
): string | undefined {
  const localClass = schema.readApex(root, path.basename(document.fileName, '.cls'));
  if (localClass?.members.some((m) => m.kind === 'method' && m.name === method)) {
    return localClass.name;
  }
  for (const cls of schema.listApex(root)) {
    if (cls.members.some((m) => m.kind === 'method' && m.name === method)) {
      return cls.name;
    }
  }
  return undefined;
}

/** True if `name` appears declared as a local/parameter (a type token precedes it). */
function isLocallyDeclared(document: vscode.TextDocument, name: string): boolean {
  const re = new RegExp(`[A-Za-z_][\\w<>.,\\[\\] ]*\\s+${name}\\b\\s*[=;:){,]`);
  return re.test(document.getText());
}

/**
 * Returns the workspace-relative paths of files where the selection is PARTIAL
 * — some references to the old name are ticked and some aren't — which would
 * leave both the old and new name in the same file (a broken, inconsistent
 * symbol). Used to warn before applying. The file the user already edited is
 * excluded by construction (its renamed occurrence isn't in the plan).
 */
function inconsistentFiles(plan: RenamePlan, selectedKeys: Set<string>): string[] {
  const byFile = new Map<string, { total: number; selected: number; rel: string }>();
  for (const e of plan.edits) {
    const entry = byFile.get(e.filePath) ?? { total: 0, selected: 0, rel: e.relPath };
    entry.total++;
    if (selectedKeys.has(e.key)) {
      entry.selected++;
    }
    byFile.set(e.filePath, entry);
  }
  const risky: string[] = [];
  for (const { total, selected, rel } of byFile.values()) {
    if (selected > 0 && selected < total) {
      risky.push(rel);
    }
  }
  return risky;
}

/** Applies the selected edits + any file renames via a single WorkspaceEdit. */
async function applyEdits(plan: RenamePlan, selectedKeys: Set<string>): Promise<string[]> {
  const edit = new vscode.WorkspaceEdit();
  const touched = new Set<string>();
  for (const e of plan.edits) {
    if (!selectedKeys.has(e.key)) {
      continue;
    }
    const range = new vscode.Range(e.line, e.column, e.line, e.column + e.length);
    edit.replace(vscode.Uri.file(e.filePath), range, plan.newName);
    touched.add(e.filePath);
  }
  // File renames (class) only when at least one edit was kept.
  if (touched.size && plan.fileRenames.length) {
    for (const fr of plan.fileRenames) {
      edit.renameFile(vscode.Uri.file(fr.from), vscode.Uri.file(fr.to), { ignoreIfExists: false });
      touched.delete(fr.from);
      touched.add(fr.to);
    }
  }
  const ok = await vscode.workspace.applyEdit(edit);
  if (!ok) {
    throw new Error('Could not apply the rename edits (a file may be read-only or out of sync).');
  }
  // Save the touched documents so they're ready to deploy.
  for (const file of touched) {
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
      await doc.save();
    } catch { /* renamed file may need reopen; non-fatal */ }
  }
  return [...touched];
}

/** Deploys each file via the existing diff-guarded deploy command. */
async function deployFiles(files: string[]): Promise<void> {
  for (const file of files) {
    await vscode.commands.executeCommand(Commands.deploySource, vscode.Uri.file(file));
  }
}

async function openRef(file: string, line?: number, column?: number): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
  if (typeof line === 'number' && line >= 0) {
    const pos = new vscode.Position(line, Math.max(0, column ?? 0));
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
  }
}

/**
 * A FileReader backed by VS Code's open documents: returns the LIVE buffer text
 * for any file that's currently open (including unsaved edits), else undefined
 * so the finder falls back to disk. This keeps the search in sync with what the
 * user sees, fixing stale-disk vs dirty-buffer mismatches.
 */
function liveReader(): FileReader {
  const open = new Map<string, string>();
  for (const doc of vscode.workspace.textDocuments) {
    if (doc.uri.scheme === 'file') {
      open.set(doc.uri.fsPath, doc.getText());
    }
  }
  return (filePath: string) => open.get(filePath);
}

/* --------------------------------- HTML ---------------------------------- */

function shellHtml(target: RenameTarget, oldName: string, newName: string): string {
  const kindLabel = target.kind === 'variable' ? 'local variable / parameter'
    : target.kind === 'method' ? `method${target.owner ? ` of ${target.owner}` : ''}`
      : target.kind;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${FORGE_STYLES}
    .form { display:flex; gap:10px; align-items:flex-end; flex-wrap:wrap; margin:8px 0 14px; }
    .field { display:flex; flex-direction:column; gap:4px; }
    .field label { font-size:11px; color:#999; text-transform:uppercase; }
    input[type=text] { background:#2a2a2a; border:1px solid #333; color:#eee; border-radius:6px; padding:7px 10px; font-size:13px; min-width:220px; }
    input[type=text]:focus { outline:none; border-color:#a874e3; }
    .kind { color:#ff7800; font-size:11px; text-transform:uppercase; }
    .filehdr { display:flex; align-items:center; gap:8px; margin-top:14px; font-weight:600; color:#a874e3; }
    .editrow { cursor:pointer; }
    .editrow:hover td { background:#2d2438; }
    .editrow td code { color:#d7b3ff; }
    .unconf td { opacity:.78; }
    .toolbar { display:flex; gap:10px; align-items:center; margin:10px 0; flex-wrap:wrap; }
    .err { color:#e06c6c; margin:8px 0; }
    .ok { color:#4ec07a; }
    .muted2 { color:#888; font-size:12px; }
    input[type=checkbox] { accent-color:#a874e3; }
    .status { display:inline-block; font-size:11px; padding:1px 8px; border-radius:10px; background:#2a2a2a; color:#aaa; }
    .status.done { background:#173d27; color:#4ec07a; }
  </style></head>
  <body>
    <h1>Rename ${escapeHtml(kindLabel)}: <code>${escapeHtml(oldName)}</code> → <code>${escapeHtml(newName)}</code></h1>
    <div class="muted">These are the remaining <code>${escapeHtml(oldName)}</code> references — they'll be changed to <code>${escapeHtml(newName)}</code>. Untick any that aren't this symbol, then apply and deploy.</div>
    <div id="msg"></div>
    <div id="plan">Finding references…</div>
    <script>
      const vscode = acquireVsCodeApi();
      const $ = (id) => document.getElementById(id);

      // Find the remaining OLD-name references automatically on open.
      vscode.postMessage({ command: 'plan' });

      window.addEventListener('message', (e) => {
        const m = e.data;
        if (m.command === 'error') { $('msg').innerHTML = '<div class="err">❌ ' + m.text + '</div>'; }
        else if (m.command === 'plan') { $('msg').textContent=''; $('plan').innerHTML = m.html; bindPlan(); }
        else if (m.command === 'applied') { $('plan').innerHTML = m.html; bindDeploy(); }
        else if (m.command === 'deployed') {
          (m.files||[]).forEach((f) => { const el = document.querySelector('[data-depfile="'+CSS.escape(f)+'"] .status'); if (el){ el.textContent='deployed'; el.classList.add('done'); } });
        }
      });

      function selected() {
        return [...document.querySelectorAll('.editchk:checked')].map((c) => c.dataset.key);
      }
      function bindPlan() {
        const all = $('selAll'); const none = $('selNone'); const apply = $('applyBtn');
        if (all) all.addEventListener('click', () => document.querySelectorAll('.editchk').forEach((c) => c.checked = true));
        if (none) none.addEventListener('click', () => document.querySelectorAll('.editchk').forEach((c) => c.checked = false));
        document.querySelectorAll('.editrow').forEach((row) => {
          row.addEventListener('click', (ev) => {
            if (ev.target.classList.contains('editchk')) return;
            vscode.postMessage({ command:'open', file: row.dataset.file, line:Number(row.dataset.line), column:Number(row.dataset.column) });
          });
        });
        if (apply) apply.addEventListener('click', () => {
          const keys = selected();
          if (!keys.length) { $('msg').innerHTML = '<div class="err">Select at least one reference.</div>'; return; }
          vscode.postMessage({ command:'apply', keys });
        });
      }
      function bindDeploy() {
        const all = $('deployAll');
        if (all) all.addEventListener('click', () => {
          const files = [...document.querySelectorAll('[data-depfile]')].map((r) => r.dataset.depfile);
          vscode.postMessage({ command:'deploy', files });
        });
        document.querySelectorAll('.depBtn').forEach((b) => b.addEventListener('click', () => {
          vscode.postMessage({ command:'deploy', file: b.dataset.depfile });
        }));
      }
    </script>
  </body></html>`;
}

function planHtml(plan: RenamePlan): string {
  if (!plan.edits.length) {
    return `<div class="ok">✅ No other references to <code>${escapeHtml(plan.target.name)}</code> — the rename you made is the only occurrence. Nothing else to change.</div>`;
  }
  // Group edits by file, confident first.
  const byFile = new Map<string, RenameEdit[]>();
  for (const e of plan.edits) {
    (byFile.get(e.filePath) ?? byFile.set(e.filePath, []).get(e.filePath)!).push(e);
  }
  const confidentCount = plan.edits.filter((e) => e.confident).length;
  const groups = [...byFile.entries()].map(([file, edits]) => {
    const rel = edits[0].relPath;
    const rows = edits.map((e) => `
      <tr class="editrow ${e.confident ? '' : 'unconf'}" data-file="${escapeHtml(e.filePath)}" data-line="${e.line}" data-column="${e.column}">
        <td><input type="checkbox" class="editchk" data-key="${escapeHtml(e.key)}" ${e.confident ? 'checked' : ''}/></td>
        <td>${e.line + 1}:${e.column + 1}</td>
        <td class="kind">${escapeHtml(e.kind)}</td>
        <td><code>${escapeHtml(e.preview)}</code>${e.confident ? '' : ' <span class="muted2">(uncertain)</span>'}</td>
      </tr>`).join('');
    return `<div class="filehdr">📄 ${escapeHtml(rel)}</div>
      <table><tbody>${rows}</tbody></table>`;
  }).join('');

  const fileRenameNote = plan.fileRenames.length
    ? `<div class="muted2" style="margin-top:8px">Will also rename: ${plan.fileRenames.map((f) => escapeHtml(path.basename(f.from)) + ' → ' + escapeHtml(path.basename(f.to))).join(', ')}</div>`
    : '';

  return `
    <div class="toolbar">
      <b>${plan.edits.length} reference${plan.edits.length === 1 ? '' : 's'}</b>
      <span class="muted2">${confidentCount} confident, ${plan.edits.length - confidentCount} uncertain (unticked)</span>
      <button class="secondary" id="selAll">Select all</button>
      <button class="secondary" id="selNone">Select none</button>
      <span style="flex:1"></span>
      <button class="accent" id="applyBtn">Apply rename</button>
    </div>
    ${groups}
    ${fileRenameNote}`;
}

function deployHtml(files: string[]): string {
  if (!files.length) {
    return `<div class="ok">✅ Rename applied. (No deployable files were touched.)</div>`;
  }
  const rows = files.map((f) => `
    <tr data-depfile="${escapeHtml(f)}">
      <td><code>${escapeHtml(toRelDisplay(f))}</code></td>
      <td><span class="status">not deployed</span></td>
      <td><button class="secondary depBtn" data-depfile="${escapeHtml(f)}">Deploy</button></td>
    </tr>`).join('');
  return `
    <div class="ok" style="margin:8px 0">✅ Rename applied to ${files.length} file${files.length === 1 ? '' : 's'}. Deploy when ready.</div>
    <div class="toolbar"><button class="accent" id="deployAll">Deploy all</button>
      <span class="muted2">Each deploy goes through the usual diff-before-deploy check.</span></div>
    <table><thead><tr><th>File</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
}

function toRelDisplay(filePath: string): string {
  const norm = filePath.replace(/\\/g, '/');
  const idx = norm.lastIndexOf('/force-app/');
  return idx >= 0 ? norm.slice(idx + 1) : norm.split('/').pop() ?? norm;
}

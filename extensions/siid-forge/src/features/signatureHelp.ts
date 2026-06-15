/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { SchemaManager, ApexParam } from '../core/schemaManager';
import { Feature } from './types';

/**
 * Signature help for calls to known custom Apex methods, in both Apex files and
 * LWC `.js` (for imported `@AuraEnabled` methods). Parameter data comes from the
 * schema cache (`params[]`); no CLI calls.
 */
export const registerSignatureHelp: Feature = ({ context, schema }) => {
  const provider = new ApexSignatureProvider(schema);
  context.subscriptions.push(
    vscode.languages.registerSignatureHelpProvider(
      [{ language: 'apex', scheme: 'file' }, { language: 'apex-anon', scheme: 'file' }],
      provider, '(', ','
    ),
    vscode.languages.registerSignatureHelpProvider(
      [{ language: 'javascript', scheme: 'file' }],
      provider, '(', ','
    )
  );
};

function cwd(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/** A method we can describe: its name + parameters + a display label. */
interface Sig {
  method: string;
  params: ApexParam[];
  returnType?: string;
  owner?: string;
}

class ApexSignatureProvider implements vscode.SignatureHelpProvider {
  constructor(private readonly schema: SchemaManager) { }

  provideSignatureHelp(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.SignatureHelp | undefined {
    const root = cwd();
    if (!root) {
      return undefined;
    }

    // Walk back from the cursor to the open paren of the current call, counting
    // top-level commas to know the active parameter.
    const call = findEnclosingCall(document, position);
    if (!call) {
      return undefined;
    }

    const sig = this.resolve(root, document, call.callee);
    if (!sig) {
      return undefined;
    }

    const help = new vscode.SignatureHelp();
    const label = `${sig.method}(${sig.params.map((p) => `${p.type} ${p.name}`.trim()).join(', ')})`;
    const info = new vscode.SignatureInformation(
      label,
      new vscode.MarkdownString(
        `${sig.owner ? `**${sig.owner}**\n\n` : ''}${sig.returnType ? `Returns \`${sig.returnType}\`` : ''}`
      )
    );
    info.parameters = sig.params.map(
      (p) => new vscode.ParameterInformation(`${p.type} ${p.name}`.trim(), p.type)
    );
    help.signatures = [info];
    help.activeSignature = 0;
    help.activeParameter = Math.min(call.activeParam, Math.max(sig.params.length - 1, 0));
    return help;
  }

  /** Resolves a callee (`getAccount` or `Klass.method`) to its parameters. */
  private resolve(root: string, document: vscode.TextDocument, callee: string): Sig | undefined {
    const dot = callee.lastIndexOf('.');
    const method = dot >= 0 ? callee.slice(dot + 1) : callee;
    const qualifier = dot >= 0 ? callee.slice(0, dot) : undefined;

    // 1. Qualified `Klass.method` — look the class up directly.
    if (qualifier) {
      const cls = this.schema.readApex(root, qualifier);
      const m = cls?.members.find((x) => x.kind === 'method' && x.name === method);
      if (m) {
        return { method: m.name, params: m.params ?? [], returnType: m.returnType, owner: cls!.name };
      }
    }

    // 2. LWC: the callee is an imported `@AuraEnabled` method (default import name).
    if (document.languageId === 'javascript') {
      const imported = importedApexMethod(document.getText(), method);
      if (imported) {
        const aura = this.schema.readAuraEnabled(root)[imported.cls]?.find((a) => a.name === imported.method);
        if (aura) {
          return { method: aura.name, params: aura.params ?? [], returnType: aura.returnType, owner: imported.cls };
        }
      }
    }

    // 3. Bare method name — search all cached classes for a unique match.
    const matches: Sig[] = [];
    for (const cls of this.schema.listApex(root)) {
      for (const m of cls.members) {
        if (m.kind === 'method' && m.name === method) {
          matches.push({ method: m.name, params: m.params ?? [], returnType: m.returnType, owner: cls.name });
        }
      }
    }
    return matches[0]; // first match (heuristic; no overload resolution)
  }
}

/**
 * From the cursor, finds the call being typed: the unmatched `(` to the left,
 * the identifier before it (`a.b.method`), and the active parameter index.
 */
function findEnclosingCall(
  document: vscode.TextDocument,
  position: vscode.Position
): { callee: string; activeParam: number } | undefined {
  const text = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
  let depth = 0;
  let commas = 0;
  let i = text.length - 1;
  for (; i >= 0; i--) {
    const ch = text[i];
    if (ch === ')' || ch === ']' || ch === '}') {
      depth++;
    } else if (ch === '(') {
      if (depth === 0) {
        break; // found the open paren of the current call
      }
      depth--;
    } else if (ch === '[' || ch === '{') {
      depth--;
    } else if (ch === ',' && depth === 0) {
      commas++;
    } else if (ch === ';' && depth === 0) {
      return undefined; // statement boundary — not inside a call
    }
  }
  if (i < 0) {
    return undefined;
  }

  // Grab the dotted identifier immediately before the open paren.
  const before = text.slice(0, i);
  const m = before.match(/([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*$/);
  if (!m) {
    return undefined;
  }
  return { callee: m[1].replace(/\s+/g, ''), activeParam: commas };
}

/** Finds `import <method> from '@salesforce/apex/Class.method'` in LWC source. */
function importedApexMethod(source: string, localName: string): { cls: string; method: string } | undefined {
  const re = /import\s+(?:\{\s*)?(\w+)\s*\}?\s+from\s+['"]@salesforce\/apex\/([\w.]+)\.(\w+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    if (m[1] === localName) {
      return { cls: m[2], method: m[3] };
    }
  }
  return undefined;
}

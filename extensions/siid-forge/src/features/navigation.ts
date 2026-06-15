/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as path from 'path';
import * as vscode from 'vscode';
import { SchemaManager, ApexSchema, ApexMember } from '../core/schemaManager';
import { Feature } from './types';

/**
 * Hover (definition preview) and Go to Definition for Apex, driven by the local
 * apex schema cache. Resolves class names, `Owner.member` access, and local
 * members of the current file.
 */
export const registerNavigation: Feature = ({ context, schema }) => {
  const resolver = new ApexResolver(schema);
  const selector = [{ language: 'apex', scheme: 'file' }, { language: 'apex-anon', scheme: 'file' }];

  context.subscriptions.push(
    vscode.languages.registerHoverProvider(selector, {
      provideHover: (doc, pos) => {
        const hit = resolver.resolve(doc, pos);
        if (!hit) {
          return undefined;
        }
        return new vscode.Hover(hit.markdown, doc.getWordRangeAtPosition(pos));
      }
    }),
    vscode.languages.registerDefinitionProvider(selector, {
      provideDefinition: (doc, pos) => {
        const hit = resolver.resolve(doc, pos);
        return hit?.location;
      }
    })
  );
};

interface Resolution {
  markdown: vscode.MarkdownString;
  location?: vscode.Location;
}

class ApexResolver {
  constructor(private readonly schema: SchemaManager) { }

  private root(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  resolve(doc: vscode.TextDocument, pos: vscode.Position): Resolution | undefined {
    const root = this.root();
    if (!root) {
      return undefined;
    }
    const range = doc.getWordRangeAtPosition(pos);
    if (!range) {
      return undefined;
    }
    const word = doc.getText(range);
    const linePrefix = doc.lineAt(pos).text.slice(0, range.start.character);
    const ownerMatch = linePrefix.match(/(\w+)\.\s*$/);

    // 1. Member access: Owner.word  (Owner is a class or a typed variable).
    if (ownerMatch) {
      const ownerType = this.schema.readApex(root, ownerMatch[1])
        ? ownerMatch[1]
        : inferDeclaredType(doc.getText(), ownerMatch[1]);
      if (ownerType) {
        const cls = this.schema.readApex(root, ownerType);
        const member = cls?.members.find((m) => m.name === word);
        if (cls && member) {
          return this.memberResolution(cls, member);
        }
      }
    }

    // 2. The word is a class name.
    const asClass = this.schema.readApex(root, word);
    if (asClass) {
      return this.classResolution(asClass);
    }

    // 3. A member of the current file (local method/property call).
    const localClass = this.schema.readApex(root, path.basename(doc.fileName, '.cls'));
    const localMember = localClass?.members.find((m) => m.name === word);
    if (localClass && localMember) {
      return this.memberResolution(localClass, localMember);
    }

    return undefined;
  }

  private classResolution(cls: ApexSchema): Resolution {
    const md = new vscode.MarkdownString();
    if (cls.annotations.length) {
      md.appendMarkdown(cls.annotations.map((a) => `@${a}`).join(' ') + '\n\n');
    }
    md.appendCodeblock(cls.signature ?? `class ${cls.name}`, 'apex');
    md.appendMarkdown(`\n_${cls.members.length} member(s)_`);
    return { markdown: md, location: this.location(cls.filePath, cls.line) };
  }

  private memberResolution(cls: ApexSchema, member: ApexMember): Resolution {
    const md = new vscode.MarkdownString();
    if (member.annotations?.length) {
      md.appendMarkdown(member.annotations.map((a) => `@${a}`).join(' ') + '\n\n');
    }
    md.appendCodeblock(member.signature ?? `${member.returnType ?? ''} ${member.name}`, 'apex');
    md.appendMarkdown(`\n_${cls.name}_`);
    return { markdown: md, location: this.location(cls.filePath, member.line) };
  }

  private location(filePath?: string, line?: number): vscode.Location | undefined {
    if (!filePath || line === undefined) {
      return undefined;
    }
    return new vscode.Location(vscode.Uri.file(filePath), new vscode.Position(line, 0));
  }
}

/** Finds the declared type of a local variable via a simple declaration scan. */
function inferDeclaredType(text: string, varName: string): string | undefined {
  const re = new RegExp(`\\b([A-Z][\\w.]*)\\s+${varName}\\s*(?:[=;)]|$)`, 'm');
  const m = text.match(re);
  return m?.[1];
}

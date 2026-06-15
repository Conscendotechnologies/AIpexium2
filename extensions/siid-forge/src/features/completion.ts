/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { Commands } from '../commands';
import { SchemaManager, ObjectField, ApexMember } from '../core/schemaManager';
import { Feature } from './types';

/**
 * Cache-driven completion. Provides SObject names + field suggestions for SOQL
 * (both `.soql` files and inline `[ ... ]` SOQL in Apex) and `var.field` in Apex.
 * Reads the local `.siid/schema` cache; describes an object on demand and also
 * the moment its name is selected, so fields are ready as you keep typing.
 */
export const registerCompletion: Feature = ({ context, schema }) => {
  const helper = new CompletionHelper(schema);

  // Pre-warm an object's schema when its name is picked from the dropdown.
  context.subscriptions.push(
    vscode.commands.registerCommand(Commands.cacheObjectSchema, (name: string) => {
      const root = cwd();
      if (root && name) {
        helper.ensureObject(root, name);
      }
    })
  );

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      [{ language: 'soql', scheme: 'file' }],
      new SoqlCompletionProvider(schema, helper),
      ' ', ',', '\n'
    ),
    vscode.languages.registerCompletionItemProvider(
      [{ language: 'apex', scheme: 'file' }, { language: 'apex-anon', scheme: 'file' }],
      new ApexCompletionProvider(schema, helper),
      '.', ' ', ',', '['
    ),
    vscode.languages.registerCompletionItemProvider(
      [{ language: 'javascript', scheme: 'file' }],
      new LwcApexImportProvider(schema),
      ' ', '/', '{'
    )
  );
};

function cwd(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function objectNames(schema: SchemaManager, root: string): string[] {
  const idx = schema.listObjects(root);
  return idx.length ? idx : schema.cachedObjectNames(root);
}

function fieldItem(f: ObjectField): vscode.CompletionItem {
  const item = new vscode.CompletionItem(f.name, vscode.CompletionItemKind.Field);
  const ref = f.referenceTo?.length ? ` -> ${f.referenceTo.join(', ')}` : '';
  item.detail = `${f.type ?? 'field'}${ref}`;
  if (f.label) {
    item.documentation = f.label + (f.required ? ' (required)' : '');
  }
  return item;
}

/** Object name item that caches the object's schema when accepted. */
function objectItem(name: string): vscode.CompletionItem {
  const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Class);
  item.command = { title: 'Cache schema', command: Commands.cacheObjectSchema, arguments: [name] };
  return item;
}

/** Custom Apex class name item. */
function apexClassItem(name: string): vscode.CompletionItem {
  return new vscode.CompletionItem(name, vscode.CompletionItemKind.Class);
}

/** Member (method/property) of a custom Apex class. */
function apexMemberItem(m: ApexMember): vscode.CompletionItem {
  const kind = m.kind === 'method' ? vscode.CompletionItemKind.Method : vscode.CompletionItemKind.Property;
  const item = new vscode.CompletionItem(m.name, kind);
  item.detail = `${m.returnType ?? ''}${m.kind === 'method' ? '()' : ''}`.trim() || m.kind;
  if (m.annotations?.length) {
    item.documentation = m.annotations.map((a) => '@' + a).join(' ');
  }
  if (m.kind === 'method') {
    item.insertText = new vscode.SnippetString(`${m.name}($0)`);
  }
  return item;
}

/** Shared SOQL completion: object names after FROM, else fields of the FROM object. */
function soqlCompletions(
  schema: SchemaManager,
  helper: CompletionHelper,
  root: string,
  beforeCursor: string,
  fullScope: string
): vscode.CompletionItem[] {
  if (/\bFROM\s+\w*$/i.test(beforeCursor)) {
    return objectNames(schema, root).map(objectItem);
  }
  const fromMatch = fullScope.match(/\bFROM\s+(\w+)/i);
  if (fromMatch) {
    const obj = helper.ensureObject(root, fromMatch[1]);
    if (obj) {
      return obj.fields.map(fieldItem);
    }
  }
  return [];
}

/** Describes objects on demand, de-duplicating in-flight requests. */
class CompletionHelper {
  private readonly inFlight = new Set<string>();
  constructor(private readonly schema: SchemaManager) { }

  ensureObject(root: string, name: string) {
    const cached = this.schema.readObject(root, name);
    if (cached) {
      return cached;
    }
    const known = this.schema.listObjects(root);
    if ((known.length === 0 || known.includes(name)) && !this.inFlight.has(name)) {
      this.inFlight.add(name);
      void this.schema.describeObject(root, name).finally(() => this.inFlight.delete(name));
    }
    return undefined;
  }
}

/** SOQL files: whole document is one query. */
class SoqlCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private readonly schema: SchemaManager, private readonly helper: CompletionHelper) { }

  provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
    const root = cwd();
    if (!root) {
      return [];
    }
    const linePrefix = document.lineAt(position).text.slice(0, position.character);
    return soqlCompletions(this.schema, this.helper, root, linePrefix, document.getText());
  }
}

/** Apex: inline `[ ... ]` SOQL, `var.`/`Object.` fields, otherwise SObject names. */
class ApexCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private readonly schema: SchemaManager, private readonly helper: CompletionHelper) { }

  provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
    const root = cwd();
    if (!root) {
      return [];
    }

    // 1. Inside an inline SOQL bracket?
    const offset = document.offsetAt(position);
    const before = document.getText().slice(0, offset);
    const open = before.lastIndexOf('[');
    const close = before.lastIndexOf(']');
    if (open > close && /select/i.test(before.slice(open))) {
      // Use the bracket scope before cursor for the FROM check; the whole line
      // for finding the FROM object (it may sit after the cursor).
      return soqlCompletions(this.schema, this.helper, root, before.slice(open), document.lineAt(position).text);
    }

    // 2. `Symbol.` member completion (SObject fields or custom Apex class members).
    const linePrefix = document.lineAt(position).text.slice(0, position.character);
    const dot = linePrefix.match(/(\w+)\.\w*$/);
    if (dot) {
      const symbol = dot[1];

      // a) Symbol is itself an SObject or a custom Apex class.
      if (this.schema.readObject(root, symbol)) {
        return this.schema.readObject(root, symbol)!.fields.map(fieldItem);
      }
      const directClass = this.schema.readApex(root, symbol);
      if (directClass) {
        return directClass.members.map(apexMemberItem);
      }

      // b) Symbol is a variable; resolve its declared type.
      const typeName = inferDeclaredType(document.getText(), symbol);
      if (typeName) {
        const obj = this.helper.ensureObject(root, typeName);
        if (obj) {
          return obj.fields.map(fieldItem);
        }
        const cls = this.schema.readApex(root, typeName);
        if (cls) {
          return cls.members.map(apexMemberItem);
        }
      }
      return [];
    }

    // 3. Otherwise offer SObject names + custom Apex class names.
    return [
      ...objectNames(this.schema, root).map(objectItem),
      ...this.schema.apexClassNames(root).map(apexClassItem)
    ];
  }
}

/**
 * LWC `.js`: suggests `@AuraEnabled` Apex methods as `@salesforce/apex` imports.
 *
 * `@salesforce/apex` imports are DEFAULT imports (no braces):
 *   import getAccount from '@salesforce/apex/AccountCardController.getAccount';
 *
 * Two contexts:
 *  a) Module path:  from '@salesforce/apex/<here>   -> complete `Class.method`.
 *  b) Default-import name:  import <here>            -> replace the partial name
 *     with the FULL import statement (correct SF syntax).
 */
class LwcApexImportProvider implements vscode.CompletionItemProvider {
  constructor(private readonly schema: SchemaManager) { }

  provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
    const root = cwd();
    // Only LWC component scripts (live under an `lwc/` folder).
    if (!root || !/[\\/]lwc[\\/]/.test(document.uri.fsPath)) {
      return [];
    }

    const map = this.schema.readAuraEnabled(root); // { Class: [ {name, ...} ] }
    const methods = Object.entries(map).flatMap(([cls, list]) =>
      list.map((m) => ({ cls, method: m.name, signature: m.signature, returnType: m.returnType }))
    );
    if (!methods.length) {
      return [];
    }

    const prefix = document.lineAt(position).text.slice(0, position.character);

    // a) Completing the module path: from '@salesforce/apex/<here>
    const pathMatch = prefix.match(/@salesforce\/apex\/([\w.]*)$/);
    if (pathMatch) {
      const start = position.translate(0, -pathMatch[1].length);
      const replace = new vscode.Range(start, position);
      return methods.map(({ cls, method, signature, returnType }) => {
        const item = new vscode.CompletionItem(`${cls}.${method}`, vscode.CompletionItemKind.Method);
        item.detail = returnType ? `${returnType} — @AuraEnabled` : '@AuraEnabled';
        item.documentation = signature;
        item.range = replace;
        return item;
      });
    }

    // b) Writing the import binding. Matches both styles being typed:
    //      import <partial>
    //      import { <partial>
    //    Accepting writes the full braced import and replaces the whole line so
    //    nothing typed so far is left dangling:
    //      import { getAccount } from '@salesforce/apex/Class.getAccount';
    const nameMatch = prefix.match(/^\s*import\s+\{?\s*(\w*)$/);
    if (nameMatch) {
      const lineRange = document.lineAt(position).range; // replace the whole line
      return methods.map(({ cls, method, signature, returnType }) => {
        const item = new vscode.CompletionItem(method, vscode.CompletionItemKind.Method);
        item.detail = `${cls}${returnType ? ` : ${returnType}` : ''} — @AuraEnabled`;
        item.documentation = new vscode.MarkdownString(
          `\`import { ${method} } from '@salesforce/apex/${cls}.${method}';\`\n\n\`${signature ?? `${cls}.${method}()`}\``
        );
        item.filterText = `import ${method}`; // so the typed "import …" still filters
        item.insertText = `import { ${method} } from '@salesforce/apex/${cls}.${method}';`;
        item.range = lineRange;
        item.sortText = `${cls}.${method}`;
        return item;
      });
    }

    return [];
  }
}

/** Finds the declared type of a local variable via a simple declaration scan. */
function inferDeclaredType(text: string, varName: string): string | undefined {
  const re = new RegExp(`\\b([A-Z][\\w.]*)\\s+${varName}\\s*(?:[=;)]|$)`, 'm');
  const m = text.match(re);
  return m?.[1];
}

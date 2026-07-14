/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { Commands } from '../commands';
import { SchemaManager, ObjectField, ObjectSchema, ApexMember } from '../core/schemaManager';
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

/**
 * Standard-library class name item (System.*, ConnectApi.*, …). Sorted after
 * local classes (sortText prefix) and detailed so it's distinguishable from a
 * project class in the list.
 */
function stdlibClassItem(name: string): vscode.CompletionItem {
  const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Class);
  item.detail = 'Apex Standard Library';
  item.sortText = `￿${name}`; // rank below project classes
  return item;
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
  // Typing the object right after FROM → object names.
  if (/\bFROM\s+\w*$/i.test(beforeCursor)) {
    return objectNames(schema, root).map(objectItem);
  }

  const fromMatch = fullScope.match(/\bFROM\s+(\w+)/i);
  if (!fromMatch) {
    return [];
  }
  const baseObject = fromMatch[1];

  // Relationship path in the SELECT? e.g. `SELECT Owner.` or `Owner.Profile.`.
  // Traverse from the FROM object and offer the resolved object's fields.
  const relMatch = beforeCursor.match(/([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\.\w*$/);
  if (relMatch) {
    const path = relMatch[1].split('.');
    const target = helper.resolveRelationshipPath(root, baseObject, path);
    return target ? relationshipFieldItems(target) : [];
  }

  // Anywhere in the SELECT clause (between SELECT and FROM), including right
  // after `SELECT ` or after a comma → offer the FROM object's fields. Ctrl+Space
  // with the cursor at `SELECT | FROM Account` lands here.
  const obj = helper.ensureObject(root, baseObject);
  if (obj && inSelectClause(beforeCursor)) {
    return relationshipFieldItems(obj);
  }
  // Fallback: still offer fields if we couldn't positively place the cursor but
  // there's a resolvable FROM object (keeps existing behavior).
  return obj ? relationshipFieldItems(obj) : [];
}

/**
 * True when `beforeCursor` ends inside the SELECT clause — i.e. there's a
 * `SELECT` keyword and no `FROM` after it yet. Handles `SELECT |`,
 * `SELECT Id, |`, and multi-line queries.
 */
function inSelectClause(beforeCursor: string): boolean {
  const selectIdx = beforeCursor.search(/\bSELECT\b/i);
  if (selectIdx < 0) {
    return false;
  }
  return !/\bFROM\b/i.test(beforeCursor.slice(selectIdx));
}

/**
 * Field items for an object, but relationship (lookup) fields are offered by
 * their RELATIONSHIP name (e.g. `Owner`, not `OwnerId`) so the user can keep
 * dotting into them — plus the raw field. Non-lookup fields are offered as-is.
 */
function relationshipFieldItems(obj: ObjectSchema): vscode.CompletionItem[] {
  const items: vscode.CompletionItem[] = [];
  for (const f of obj.fields) {
    items.push(fieldItem(f));
    if (f.referenceTo && f.referenceTo.length === 1) {
      // Offer the relationship name (`Account`) so the user can dot into it.
      // Use the described `relationshipName`, else derive `XxxId` → `Xxx` so this
      // works even on an object cached before relationshipName was captured.
      const relName = f.relationshipName ?? deriveRelationshipName(f.name);
      if (relName && relName !== f.name) {
        const rel = new vscode.CompletionItem(relName, vscode.CompletionItemKind.Reference);
        rel.detail = `→ ${f.referenceTo[0]} (relationship)`;
        items.push(rel);
      }
    }
  }
  return items;
}

/**
 * Derives a lookup field's relationship name from its API name for the standard
 * `Id`-suffixed pattern: `AccountId` → `Account`, `OwnerId` → `Owner`. Custom
 * relationships (`Foo__c` → `Foo__r`) aren't derivable this way and rely on the
 * described `relationshipName`; returns undefined when nothing sensible applies.
 */
function deriveRelationshipName(fieldName: string): string | undefined {
  if (/__c$/i.test(fieldName)) {
    return fieldName.replace(/__c$/i, '__r');
  }
  if (/Id$/.test(fieldName) && fieldName.length > 2) {
    return fieldName.slice(0, -2);
  }
  return undefined;
}

/** Describes objects on demand, de-duplicating in-flight requests. */
class CompletionHelper {
  private readonly inFlight = new Set<string>();
  /** name -> epoch ms until which we won't retry a failed describe. */
  private readonly failedUntil = new Map<string, number>();
  /** How long to suppress re-describing a name after a failed describe. */
  private static readonly FAIL_COOLDOWN_MS = 5 * 60 * 1000;
  constructor(private readonly schema: SchemaManager) { }

  /**
   * Follows a relationship path from a base object and returns the object the
   * path lands on — describing each parent on demand. E.g. from `Account` with
   * path `['Owner']` → the `User` object; `['Owner','Manager']` → the manager's
   * `User`. Returns undefined if any hop isn't a resolvable relationship (or its
   * parent isn't described yet — the describe is kicked off for next time).
   *
   * A path segment matches a field's `relationshipName` (e.g. `Owner` for the
   * `OwnerId` lookup); the parent object is the field's single `referenceTo`.
   * Polymorphic lookups (multiple referenceTo, e.g. `Owner` on some objects) are
   * skipped — there's no single parent to traverse into.
   */
  resolveRelationshipPath(root: string, baseObject: string, relPath: string[]) {
    let current = this.ensureObject(root, baseObject);
    for (const rel of relPath) {
      if (!current) {
        return undefined;
      }
      const relLower = rel.toLowerCase();
      // Match a lookup field by its relationship name (`Account`) OR its raw `Id`
      // field name (`AccountId`) — users type either. `relationshipName` may be
      // absent on an older cache entry; fall back to deriving `XxxId` → `Xxx`.
      const field = current.fields.find((f) => {
        if (!f.referenceTo || f.referenceTo.length !== 1) {
          return false;
        }
        const relName = (f.relationshipName ?? deriveRelationshipName(f.name))?.toLowerCase();
        return relName === relLower || f.name.toLowerCase() === relLower;
      });
      if (!field?.referenceTo) {
        return undefined;
      }
      current = this.ensureObject(root, field.referenceTo[0]);
    }
    return current;
  }

  ensureObject(root: string, name: string) {
    const cached = this.schema.readObject(root, name);
    if (cached) {
      return cached;
    }
    // Negative cache: a describe that failed (no access / offline / not a real
    // object) leaves readObject empty, which on the hot completion path would
    // re-fire the slow org describe on every keystroke. Back off for a while.
    const cooldown = this.failedUntil.get(name);
    if (cooldown && Date.now() < cooldown) {
      return undefined;
    }
    const known = this.schema.listObjects(root);
    if ((known.length === 0 || known.includes(name)) && !this.inFlight.has(name)) {
      this.inFlight.add(name);
      void this.schema.describeObject(root, name)
        .then((ok) => {
          if (ok) {
            this.failedUntil.delete(name);
          } else {
            this.failedUntil.set(name, Date.now() + CompletionHelper.FAIL_COOLDOWN_MS);
          }
        })
        .finally(() => this.inFlight.delete(name));
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

    // 2. `Chain.` member completion. The chain may be a single symbol
    // (`acc.`, `Account.`, `Database.`) or a dotted qualifier
    // (`Metadata.` namespace, `Metadata.Operations.` inner class).
    const linePrefix = document.lineAt(position).text.slice(0, position.character);
    const dotChain = linePrefix.match(/([A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)*)\s*\.\s*\w*$/);
    if (dotChain) {
      const chain = dotChain[1].replace(/\s+/g, '');
      const items = this.resolveChainMembers(root, document, chain);
      if (items) {
        return items;
      }
      return [];
    }

    // 3. Otherwise offer SObject names + custom Apex class names + the Apex
    // standard library (System.*, ConnectApi.*, …). Stdlib is empty until its
    // global cache is built, and sorts below project types.
    return [
      ...objectNames(this.schema, root).map(objectItem),
      ...this.schema.apexClassNames(root).map(apexClassItem),
      ...this.schema.stdlibClassNames().map(stdlibClassItem)
    ];
  }

  /**
   * Resolves what a dotted `chain.` should complete to. Returns the item list,
   * or `undefined` if the chain resolves to nothing (caller shows an empty
   * list). Handles, in order:
   *   1. an SObject                → its fields (`Account.`)
   *   2. a class (local or stdlib) → its members (`Database.`, `Metadata.Operations.`)
   *   3. a stdlib NAMESPACE        → its classes (`Metadata.`, `Schema.`)
   *   4. a variable                → its declared type's fields/members (`acc.`)
   */
  private resolveChainMembers(
    root: string,
    document: vscode.TextDocument,
    chain: string
  ): vscode.CompletionItem[] | undefined {
    const segments = chain.split('.');

    // 1. SObject field/relationship access. The base (first segment) is either an
    // SObject type (`Account.Owner.`) or a variable of an SObject type
    // (`acc.Owner.` where `Account acc`). Traverse any relationship path after it.
    const base = segments[0];
    const baseObject =
      (this.schema.readObject(root, base) && base) ||
      this.sobjectTypeOfVar(root, document, base);
    if (baseObject) {
      const relPath = segments.slice(1); // e.g. Account.Owner.Manager → [Owner, Manager]
      const target = relPath.length
        ? this.helper.resolveRelationshipPath(root, baseObject, relPath)
        : this.schema.readObject(root, baseObject);
      return target ? relationshipFieldItems(target) : undefined;
    }

    // 2 & 3. A class (local or stdlib) AND/OR a stdlib namespace. These overlap
    // when a namespace has a same-named class (`Metadata` the namespace vs the
    // `Metadata` class, `Schema`, `System`). In that case offer BOTH — the
    // namespace's classes (`Metadata.Operations`) plus the class's own members —
    // since the user could mean either. `readApex`+includeStdlib is keyed by
    // both bare and `Namespace.Class` names, so it also covers the qualified
    // `Metadata.Operations.` form.
    const cls = this.schema.readApex(root, chain, { includeStdlib: true });
    const nsClasses = !chain.includes('.') && this.schema.isStdlibNamespace(chain)
      ? this.schema.stdlibClassesInNamespace(chain)
      : [];
    if (cls || nsClasses.length) {
      return [
        ...nsClasses.map(stdlibClassItem),
        ...(cls ? cls.members.map(apexMemberItem) : [])
      ];
    }

    // 4. A variable of an Apex class type (single segment) → the class's members.
    // (SObject-typed variables were already handled in step 1.)
    if (!chain.includes('.')) {
      const typeName = inferDeclaredType(document.getText(), chain);
      if (typeName) {
        const typed = this.schema.readApex(root, typeName, { includeStdlib: true });
        if (typed) {
          return typed.members.map(apexMemberItem);
        }
      }
    }

    return undefined;
  }

  /**
   * If `varName` is a local variable declared with an SObject type
   * (`Account acc;`), returns that SObject's API name (when it's a known/
   * describable object); otherwise undefined.
   */
  private sobjectTypeOfVar(root: string, document: vscode.TextDocument, varName: string): string | undefined {
    const typeName = inferDeclaredType(document.getText(), varName);
    if (typeName && this.helper.ensureObject(root, typeName)) {
      return typeName;
    }
    return undefined;
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

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { SfExecutor } from './sfExecutor';
import { Logger } from './logger';

export interface ObjectField {
  name: string;
  label?: string;
  type?: string;
  referenceTo?: string[];
  picklistValues?: string[];
  required?: boolean;
}

export interface ObjectSchema {
  name: string;
  label?: string;
  custom?: boolean;
  fields: ObjectField[];
}

export interface ApexMember {
  name: string;
  kind: 'method' | 'property';
  returnType?: string;
  modifiers?: string[];
  annotations?: string[];
  /** 0-based line of the declaration. */
  line?: number;
  /** Raw declaration text, for hover. */
  signature?: string;
}

export interface ApexSchema {
  name: string;
  annotations: string[];
  members: ApexMember[];
  /** Absolute path of the source file. */
  filePath?: string;
  /** 0-based line of the top-level class declaration. */
  line?: number;
  /** Raw class declaration text. */
  signature?: string;
}

export interface LwcSchema {
  name: string;
  apiProperties: string[];
  isExposed?: boolean;
  targets: string[];
}

/** An `@AuraEnabled` Apex method callable from LWC/Aura. */
export interface AuraEnabledMethod {
  name: string;
  returnType?: string;
  signature?: string;
  line?: number;
  filePath?: string;
}

/** Map of Apex class name -> its AuraEnabled methods. */
export type AuraEnabledMap = Record<string, AuraEnabledMethod[]>;

/**
 * Builds and caches org/project schema as JSON under `.siid/schema/`.
 * The cache is the seam other consumers (completion, explorer, AI) read.
 */
export class SchemaManager {
  constructor(private readonly sf: SfExecutor, private readonly logger: Logger) { }

  private dir(projectRoot: string, sub: string): string {
    const d = path.join(projectRoot, '.siid', 'schema', sub);
    fs.mkdirSync(d, { recursive: true });
    return d;
  }

  private writeJson(file: string, data: unknown): void {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
  }

  private readJson<T>(file: string): T | undefined {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
    } catch {
      return undefined;
    }
  }

  private touchMeta(projectRoot: string, key: string): void {
    const metaPath = path.join(this.dir(projectRoot, ''), 'meta.json');
    const meta = this.readJson<Record<string, string>>(metaPath) ?? {};
    meta[key] = new Date().toISOString();
    this.writeJson(metaPath, meta);
  }

  // ---------------------------------------------------------------- Objects

  /** Caches the org's object index and describes project-local objects. */
  async refreshObjects(projectRoot: string, token?: vscode.CancellationToken): Promise<number> {
    const objectsDir = this.dir(projectRoot, 'objects');

    // 1. Full index of org object names.
    try {
      const { result } = await this.sf.run<string[]>(['sobject', 'list'], { cwd: projectRoot, token });
      if (Array.isArray(result)) {
        this.writeJson(path.join(objectsDir, '_index.json'), result.sort());
      }
    } catch (err: any) {
      this.logger.error(`refreshObjects index: ${err.message}`);
    }

    // 2. Describe objects present in the local project.
    const localNames = this.findLocalObjectNames(projectRoot);
    let described = 0;
    for (const name of localNames) {
      if (token?.isCancellationRequested) {
        break;
      }
      if (await this.describeObject(projectRoot, name, token)) {
        described++;
      }
    }
    this.touchMeta(projectRoot, 'objects');
    return described;
  }

  /** Describes a single SObject and caches a trimmed schema. */
  async describeObject(projectRoot: string, name: string, token?: vscode.CancellationToken): Promise<boolean> {
    try {
      const { result } = await this.sf.run<any>(['sobject', 'describe', '--sobject', name], { cwd: projectRoot, token });
      const schema: ObjectSchema = {
        name: result?.name ?? name,
        label: result?.label,
        custom: result?.custom,
        fields: (result?.fields ?? []).map((f: any) => ({
          name: f.name,
          label: f.label,
          type: f.type,
          referenceTo: f.referenceTo?.length ? f.referenceTo : undefined,
          picklistValues: f.picklistValues?.length ? f.picklistValues.map((p: any) => p.value) : undefined,
          required: f.nillable === false && f.defaultedOnCreate === false
        }))
      };
      this.writeJson(path.join(this.dir(projectRoot, 'objects'), `${schema.name}.json`), schema);
      return true;
    } catch (err: any) {
      this.logger.error(`describeObject ${name}: ${err.message}`);
      return false;
    }
  }

  private findLocalObjectNames(projectRoot: string): string[] {
    const names = new Set<string>();
    for (const objectsFolder of this.findDirs(projectRoot, 'objects')) {
      for (const entry of safeReaddir(objectsFolder)) {
        if (fs.statSync(path.join(objectsFolder, entry)).isDirectory()) {
          names.add(entry);
        }
      }
    }
    return [...names];
  }

  // ------------------------------------------------------------------ Apex

  /** Parses local `.cls` files into an Apex symbol cache. */
  refreshApex(projectRoot: string): number {
    const files = this.findFiles(projectRoot, (f) => f.endsWith('.cls'));
    const apexDir = this.dir(projectRoot, 'apex');
    const index: string[] = [];

    for (const file of files) {
      const schema = parseApex(fs.readFileSync(file, 'utf-8'), path.basename(file, '.cls'));
      schema.filePath = file;
      this.writeJson(path.join(apexDir, `${schema.name}.json`), schema);
      index.push(schema.name);
    }
    this.writeJson(path.join(apexDir, '_index.json'), [...new Set(index)].sort());
    this.refreshAuraEnabled(projectRoot);
    this.touchMeta(projectRoot, 'apex');
    return index.length;
  }

  /** Re-parses a single `.cls` file and updates its cache entry + index. */
  refreshApexFile(projectRoot: string, fsPath: string): string | undefined {
    if (!fs.existsSync(fsPath)) {
      return undefined;
    }
    const schema = parseApex(fs.readFileSync(fsPath, 'utf-8'), path.basename(fsPath, '.cls'));
    schema.filePath = fsPath;
    const apexDir = this.dir(projectRoot, 'apex');
    this.writeJson(path.join(apexDir, `${schema.name}.json`), schema);

    const idxPath = path.join(apexDir, '_index.json');
    const idx = this.readJson<string[]>(idxPath) ?? [];
    if (!idx.includes(schema.name)) {
      idx.push(schema.name);
      this.writeJson(idxPath, idx.sort());
    }
    return schema.name;
  }

  /** Removes a class from the apex cache (by file base name). */
  removeApexFile(projectRoot: string, fsPath: string): void {
    const name = path.basename(fsPath, '.cls');
    const apexDir = this.dir(projectRoot, 'apex');
    try { fs.unlinkSync(path.join(apexDir, `${name}.json`)); } catch { /* ignore */ }
    const idxPath = path.join(apexDir, '_index.json');
    const idx = this.readJson<string[]>(idxPath);
    if (idx) {
      this.writeJson(idxPath, idx.filter((n) => n !== name));
    }
  }

  // ------------------------------------------------------------------- LWC

  /** Parses local LWC component folders into a schema cache. */
  refreshLwc(projectRoot: string): number {
    const lwcDir = this.dir(projectRoot, 'lwc');
    const index: string[] = [];

    for (const lwcRoot of this.findDirs(projectRoot, 'lwc')) {
      for (const entry of safeReaddir(lwcRoot)) {
        const compDir = path.join(lwcRoot, entry);
        if (!fs.statSync(compDir).isDirectory()) {
          continue;
        }
        const jsFile = path.join(compDir, `${entry}.js`);
        const metaFile = path.join(compDir, `${entry}.js-meta.xml`);
        if (!fs.existsSync(jsFile)) {
          continue;
        }
        const schema = parseLwc(
          entry,
          fs.readFileSync(jsFile, 'utf-8'),
          fs.existsSync(metaFile) ? fs.readFileSync(metaFile, 'utf-8') : ''
        );
        this.writeJson(path.join(lwcDir, `${schema.name}.json`), schema);
        index.push(schema.name);
      }
    }
    this.writeJson(path.join(lwcDir, '_index.json'), index.sort());
    this.touchMeta(projectRoot, 'lwc');
    return index.length;
  }

  // --------------------------------------------------------------- Readers

  listObjects(projectRoot: string): string[] {
    return this.readJson<string[]>(path.join(this.dir(projectRoot, 'objects'), '_index.json')) ?? [];
  }
  readObject(projectRoot: string, name: string): ObjectSchema | undefined {
    return this.readJson<ObjectSchema>(path.join(this.dir(projectRoot, 'objects'), `${name}.json`));
  }
  cachedObjectNames(projectRoot: string): string[] {
    return safeReaddir(this.dir(projectRoot, 'objects'))
      .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
      .map((f) => f.replace(/\.json$/, ''));
  }
  listApex(projectRoot: string): ApexSchema[] {
    return this.cachedNames(projectRoot, 'apex').map((n) => this.readJson<ApexSchema>(path.join(this.dir(projectRoot, 'apex'), `${n}.json`))!).filter(Boolean);
  }
  apexClassNames(projectRoot: string): string[] {
    return this.readJson<string[]>(path.join(this.dir(projectRoot, 'apex'), '_index.json')) ?? this.cachedNames(projectRoot, 'apex');
  }
  readApex(projectRoot: string, name: string): ApexSchema | undefined {
    return this.readJson<ApexSchema>(path.join(this.dir(projectRoot, 'apex'), `${name}.json`));
  }
  listLwc(projectRoot: string): LwcSchema[] {
    return this.cachedNames(projectRoot, 'lwc').map((n) => this.readJson<LwcSchema>(path.join(this.dir(projectRoot, 'lwc'), `${n}.json`))!).filter(Boolean);
  }
  private cachedNames(projectRoot: string, sub: string): string[] {
    return safeReaddir(this.dir(projectRoot, sub))
      .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
      .map((f) => f.replace(/\.json$/, ''));
  }

  /** Rebuilds the AuraEnabled map (lwc/_apexMethods.json) from the apex cache. */
  refreshAuraEnabled(projectRoot: string): number {
    const map: AuraEnabledMap = {};
    for (const cls of this.listApex(projectRoot)) {
      const methods = cls.members.filter(
        (m) => m.kind === 'method' && m.annotations?.some((a) => a.toLowerCase() === 'auraenabled')
      );
      if (methods.length) {
        map[cls.name] = methods.map((m) => ({
          name: m.name,
          returnType: m.returnType,
          signature: m.signature,
          line: m.line,
          filePath: cls.filePath
        }));
      }
    }
    this.writeJson(path.join(this.dir(projectRoot, 'lwc'), '_apexMethods.json'), map);
    return Object.keys(map).length;
  }

  readAuraEnabled(projectRoot: string): AuraEnabledMap {
    return this.readJson<AuraEnabledMap>(path.join(this.dir(projectRoot, 'lwc'), '_apexMethods.json')) ?? {};
  }

  // -------------------------------------------------------- File utilities

  /** Recursively finds directories with the given base name (skips node_modules/.siid). */
  private findDirs(root: string, baseName: string): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const entry of safeReaddir(dir)) {
        if (entry === 'node_modules' || entry === '.siid' || entry === '.git') {
          continue;
        }
        const full = path.join(dir, entry);
        let isDir = false;
        try { isDir = fs.statSync(full).isDirectory(); } catch { continue; }
        if (isDir) {
          if (entry === baseName) {
            out.push(full);
          }
          walk(full);
        }
      }
    };
    walk(root);
    return out;
  }

  /** Recursively finds files matching a predicate. */
  private findFiles(root: string, match: (file: string) => boolean): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const entry of safeReaddir(dir)) {
        if (entry === 'node_modules' || entry === '.siid' || entry === '.git') {
          continue;
        }
        const full = path.join(dir, entry);
        let isDir = false;
        try { isDir = fs.statSync(full).isDirectory(); } catch { continue; }
        if (isDir) {
          walk(full);
        } else if (match(full)) {
          out.push(full);
        }
      }
    };
    walk(root);
    return out;
  }
}

function safeReaddir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * Heuristic Apex parser. The top-level class name is the file name (SFDX
 * enforces this), so inner-class declarations don't rename the entry. Skips
 * block comments. Collects methods/properties and the top-level annotations.
 */
function parseApex(text: string, fallbackName: string): ApexSchema {
  const lines = text.split(/\r?\n/);
  const name = fallbackName;
  const classAnnotations: string[] = [];
  const members: ApexMember[] = [];
  let classLine: number | undefined;
  let classSignature: string | undefined;

  let pendingAnnotations: string[] = [];
  let inBlockComment = false;
  let topClassSeen = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();

    // Block comments (/* ... */) — skip entirely so docs don't match.
    if (inBlockComment) {
      if (line.includes('*/')) {
        inBlockComment = false;
      }
      continue;
    }
    if (line.startsWith('/*')) {
      if (!line.includes('*/')) {
        inBlockComment = true;
      }
      continue;
    }
    if (!line || line.startsWith('//')) {
      continue;
    }

    const ann = line.match(/^@(\w+)/);
    if (ann) {
      pendingAnnotations.push(ann[1]);
      continue;
    }

    // The first class/interface/enum is the top-level type (== file name).
    const classMatch = line.match(/\b(?:class|interface|enum)\s+(\w+)/i);
    if (classMatch) {
      if (!topClassSeen) {
        classAnnotations.push(...pendingAnnotations);
        classLine = i;
        classSignature = line.replace(/\s*\{.*$/, '').trim();
        topClassSeen = true;
      }
      pendingAnnotations = [];
      continue;
    }

    // method: modifiers + returnType + name(
    const method = line.match(/^(?:(?:global|public|private|protected|static|override|virtual|testmethod|final|abstract)\s+)+([\w.<>\[\]]+)\s+(\w+)\s*\(/i);
    if (method) {
      members.push({ name: method[2], kind: 'method', returnType: method[1], line: i, signature: line.replace(/\s*\{.*$/, '').trim(), annotations: pendingAnnotations.length ? [...pendingAnnotations] : undefined });
      pendingAnnotations = [];
      continue;
    }
    // property: modifiers + type + name ; or { get; set; }
    const prop = line.match(/^(?:(?:global|public|private|protected|static|final|transient)\s+)+([\w.<>\[\]]+)\s+(\w+)\s*(?:[;={])/i);
    if (prop && !/\(/.test(line)) {
      members.push({ name: prop[2], kind: 'property', returnType: prop[1], line: i, signature: line.replace(/\s*[={].*$/, '').trim(), annotations: pendingAnnotations.length ? [...pendingAnnotations] : undefined });
      pendingAnnotations = [];
      continue;
    }
    pendingAnnotations = [];
  }

  return { name, annotations: classAnnotations, members, line: classLine, signature: classSignature };
}

/** Parses an LWC component's JS (@api props) and meta XML (targets/exposed). */
function parseLwc(name: string, js: string, meta: string): LwcSchema {
  const apiProperties: string[] = [];
  const re = /@api\s+(?:get\s+|set\s+)?(\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(js)) !== null) {
    if (!apiProperties.includes(m[1])) {
      apiProperties.push(m[1]);
    }
  }

  const isExposed = /<isExposed>\s*true\s*<\/isExposed>/i.test(meta);
  const targets: string[] = [];
  const tre = /<target>([^<]+)<\/target>/g;
  let tm: RegExpExecArray | null;
  while ((tm = tre.exec(meta)) !== null) {
    targets.push(tm[1].trim());
  }

  return { name, apiProperties, isExposed, targets };
}

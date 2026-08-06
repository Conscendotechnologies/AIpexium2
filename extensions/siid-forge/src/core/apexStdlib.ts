/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ApexSchema, parseApex } from './schemaManager';
import { openZip } from './zipReader';
import { Logger } from './logger';

/** One standard-library class, its namespace, and parsed schema. */
export interface StdlibClass {
  /** Fully-qualified name, e.g. `System.Database` or `ConnectApi.ChatterFeeds`. */
  qualifiedName: string;
  /** Namespace segment, e.g. `System`, `ConnectApi`. */
  namespace: string;
  /** Bare class name, e.g. `Database`. */
  name: string;
  schema: ApexSchema;
}

/**
 * The whole StandardApexLibrary as one document. `classes` is the mapping every
 * consumer reads: keyed by the qualified name AND (where unambiguous) the bare
 * class name, so `Database` and `System.Database` both resolve. Kept in memory
 * after the first load; persisted as a single JSON in global storage.
 */
export interface ApexStdlib {
  /** sha256 of the source jar this was built from. */
  jarHash: string;
  /** Namespace -> class names, for the Schema Explorer / browsing. */
  namespaces: Record<string, string[]>;
  /** Lookup key (qualified or bare) -> class. */
  classes: Record<string, StdlibClass>;
}

const STDLIB_PREFIX = 'StandardApexLibrary/';
const CACHE_DIRNAME = 'apex-stdlib';
const CACHE_FILENAME = 'stdlib.json';
/** Per-project pointer file, under `.siid/schema/apex/`. */
const POINTER_FILENAME = '_stdlib.json';

/**
 * Written into each project's `.siid/schema/apex/`. The stdlib CONTENT lives
 * globally (identical for every project); this small file just records which
 * global cache the project is bound to, so the project is self-describing and
 * can tell when the underlying jar has been upgraded.
 */
export interface StdlibPointer {
  /** Marks where the real data lives. */
  source: 'global';
  /** sha256 of the jar the bound global cache was built from. */
  jarHash: string;
  /** Namespace + class counts, for a quick at-a-glance sanity check. */
  namespaceCount: number;
  classCount: number;
  /** When this project was last pointed at the global cache. */
  boundAt: string;
}

/**
 * Builds and caches the Salesforce StandardApexLibrary (System.*, ConnectApi.*,
 * …) from the bundled `apex-jorje-lsp.jar`. This content is identical for every
 * project, so it is extracted/parsed ONCE into the extension's GLOBAL storage
 * (keyed by the jar's checksum) and shared across all workspaces. Projects hold
 * nothing of it on disk — consumers read this shared, in-memory map by class
 * name.
 *
 * Rebuilds automatically when the jar changes (the daily `update-apex-jar`
 * workflow bumps the checksum), pruning stale caches.
 */
export class ApexStdlibManager {
  private loaded: ApexStdlib | undefined;
  private building: Promise<ApexStdlib | undefined> | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly logger: Logger
  ) { }

  /** Absolute path to the bundled jar shipped in the extension. */
  private get jarPath(): string {
    return this.context.asAbsolutePath(path.join('jars', 'apex-jorje-lsp.jar'));
  }

  private get cacheRoot(): string {
    return path.join(this.context.globalStorageUri.fsPath, CACHE_DIRNAME);
  }

  /**
   * Ensures the stdlib cache for the current jar exists and is loaded, building
   * it if missing. Safe to call repeatedly and concurrently — the first call
   * does the work, the rest await it. Returns undefined if the jar is absent or
   * unreadable (feature simply stays empty; no user-facing error).
   */
  async ensure(): Promise<ApexStdlib | undefined> {
    if (this.loaded) {
      return this.loaded;
    }
    if (this.building) {
      return this.building;
    }
    this.building = this.load().finally(() => { this.building = undefined; });
    return this.building;
  }

  /** In-memory accessor; undefined until `ensure()` has completed. */
  get(): ApexStdlib | undefined {
    return this.loaded;
  }

  /** Resolves a class by qualified or bare name (case-insensitive fallback). */
  lookup(name: string): StdlibClass | undefined {
    const lib = this.loaded;
    if (!lib) {
      return undefined;
    }
    return lib.classes[name] ?? lib.classes[this.ciKey(lib, name)];
  }

  /** True if `name` is a stdlib namespace (e.g. `Metadata`, `System`). */
  isNamespace(name: string): boolean {
    return this.namespaceKey(name) !== undefined;
  }

  /**
   * Class names in a namespace (e.g. `Metadata` → Operations, CustomMetadata…),
   * or [] if it isn't a namespace. Case-insensitive on the namespace.
   */
  classesInNamespace(namespace: string): string[] {
    const lib = this.loaded;
    const key = lib && this.namespaceKey(namespace);
    return key ? lib!.namespaces[key] : [];
  }

  /** Canonical namespace key matching `name` case-insensitively, or undefined. */
  private namespaceKey(name: string): string | undefined {
    const lib = this.loaded;
    if (!lib) {
      return undefined;
    }
    if (lib.namespaces[name]) {
      return name;
    }
    const lower = name.toLowerCase();
    return Object.keys(lib.namespaces).find((k) => k.toLowerCase() === lower);
  }

  /**
   * Bare class names for completion (deduped, sorted). Bare rather than
   * qualified so `Data` → `Database`; ambiguous names still appear once. Empty
   * until the cache is built. Cached on first call.
   */
  private classNamesCache?: string[];
  classNames(): string[] {
    if (this.classNamesCache) {
      return this.classNamesCache;
    }
    const lib = this.loaded;
    if (!lib) {
      return [];
    }
    const names = new Set(Object.values(lib.classes).map((c) => c.name));
    this.classNamesCache = [...names].sort();
    return this.classNamesCache;
  }

  private ciKey(lib: ApexStdlib, name: string): string {
    const lower = name.toLowerCase();
    return Object.keys(lib.classes).find((k) => k.toLowerCase() === lower) ?? name;
  }

  /**
   * Binds a project to the current global stdlib cache by writing a small
   * pointer into `.siid/schema/apex/_stdlib.json`. The heavy data stays global;
   * this only records the jar hash + counts so the project is self-describing
   * and can tell when the underlying jar has been upgraded. No-op (returns
   * undefined) if the global cache isn't built yet.
   */
  writeProjectPointer(projectRoot: string): StdlibPointer | undefined {
    const lib = this.loaded;
    if (!lib) {
      return undefined;
    }
    const pointer: StdlibPointer = {
      source: 'global',
      jarHash: lib.jarHash,
      namespaceCount: Object.keys(lib.namespaces).length,
      classCount: new Set(Object.values(lib.classes).map((c) => c.qualifiedName)).size,
      boundAt: new Date().toISOString()
    };
    try {
      const dir = path.join(projectRoot, '.siid', 'schema', 'apex');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, POINTER_FILENAME), JSON.stringify(pointer, null, 2), 'utf-8');
    } catch (err: any) {
      this.logger.error(`[apex-stdlib] writing project pointer: ${err.message}`);
      return undefined;
    }
    return pointer;
  }

  /** Reads a project's stdlib pointer, or undefined if not bound yet. */
  readProjectPointer(projectRoot: string): StdlibPointer | undefined {
    try {
      const file = path.join(projectRoot, '.siid', 'schema', 'apex', POINTER_FILENAME);
      return JSON.parse(fs.readFileSync(file, 'utf-8')) as StdlibPointer;
    } catch {
      return undefined;
    }
  }

  private async load(): Promise<ApexStdlib | undefined> {
    const jarPath = this.jarPath;
    if (!fs.existsSync(jarPath)) {
      this.logger.info('[apex-stdlib] bundled jar not found; standard library unavailable');
      return undefined;
    }

    let jarHash: string;
    try {
      jarHash = sha256File(jarPath);
    } catch (err: any) {
      this.logger.error(`[apex-stdlib] hashing jar: ${err.message}`);
      return undefined;
    }

    const cacheFile = path.join(this.cacheRoot, jarHash, CACHE_FILENAME);

    // Fast path: a cache for exactly this jar already exists.
    const cached = this.readCache(cacheFile, jarHash);
    if (cached) {
      this.loaded = cached;
      this.logger.info(`[apex-stdlib] loaded ${Object.keys(cached.namespaces).length} namespace(s) from cache`);
      return cached;
    }

    // Build it. This is the one-time cost per jar version.
    try {
      const built = this.build(jarPath, jarHash);
      this.writeCache(cacheFile, built);
      this.pruneOldCaches(jarHash);
      this.loaded = built;
      this.logger.info(
        `[apex-stdlib] built cache: ${Object.keys(built.namespaces).length} namespace(s), ` +
        `${new Set(Object.values(built.classes).map((c) => c.qualifiedName)).size} class(es)`
      );
      return built;
    } catch (err: any) {
      this.logger.error(`[apex-stdlib] build failed: ${err.message}`);
      return undefined;
    }
  }

  /** Extracts every `StandardApexLibrary/**.cls` stub and parses it. */
  private build(jarPath: string, jarHash: string): ApexStdlib {
    const { entries, extractText } = openZip(jarPath);
    const namespaces: Record<string, string[]> = {};
    const classes: Record<string, StdlibClass> = {};
    // Bare names that map to more than one namespace stay qualified-only.
    const bareOwners = new Map<string, Set<string>>();

    for (const entry of entries) {
      if (!entry.name.startsWith(STDLIB_PREFIX) || !entry.name.endsWith('.cls')) {
        continue;
      }
      const rel = entry.name.slice(STDLIB_PREFIX.length); // e.g. System/Database.cls
      const segs = rel.split('/');
      if (segs.length < 2) {
        continue; // expect Namespace/Class.cls
      }
      const namespace = segs[0];
      const name = path.basename(segs[segs.length - 1], '.cls');
      const qualifiedName = `${namespace}.${name}`;

      const source = extractText(entry);
      const schema = parseApex(source, name);
      const cls: StdlibClass = { qualifiedName, namespace, name, schema };

      classes[qualifiedName] = cls;
      (namespaces[namespace] ??= []).push(name);

      if (!bareOwners.has(name)) {
        bareOwners.set(name, new Set());
      }
      bareOwners.get(name)!.add(qualifiedName);
    }

    // Index bare names only when unambiguous (a single owning class). Otherwise
    // callers must qualify (e.g. two `Order` classes across namespaces).
    for (const [bare, owners] of bareOwners) {
      if (owners.size === 1 && !classes[bare]) {
        classes[bare] = classes[[...owners][0]];
      }
    }
    for (const ns of Object.keys(namespaces)) {
      namespaces[ns].sort();
    }

    return { jarHash, namespaces, classes };
  }

  private readCache(cacheFile: string, jarHash: string): ApexStdlib | undefined {
    try {
      if (!fs.existsSync(cacheFile)) {
        return undefined;
      }
      const data = JSON.parse(fs.readFileSync(cacheFile, 'utf-8')) as ApexStdlib;
      // Guard against a truncated/older-format file: the hash must match.
      return data && data.jarHash === jarHash && data.classes ? data : undefined;
    } catch (err: any) {
      this.logger.error(`[apex-stdlib] reading cache: ${err.message}`);
      return undefined;
    }
  }

  private writeCache(cacheFile: string, lib: ApexStdlib): void {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(lib), 'utf-8');
  }

  /** Removes caches for other jar versions so global storage doesn't grow. */
  private pruneOldCaches(keepHash: string): void {
    try {
      for (const entry of fs.readdirSync(this.cacheRoot)) {
        if (entry !== keepHash) {
          fs.rmSync(path.join(this.cacheRoot, entry), { recursive: true, force: true });
        }
      }
    } catch { /* best-effort */ }
  }
}

function sha256File(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

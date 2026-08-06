/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { SfExecutor, SfResult, SfRunOptions } from './core/sfExecutor';
import { OrgManager, OrgInfo } from './core/orgManager';
import { CliManager } from './core/cliManager';
import { SchemaManager, ApexSchema, ObjectSchema } from './core/schemaManager';
import { ApexStdlibManager, StdlibClass } from './core/apexStdlib';
import { getWorkspaceCwd } from './core/workspace';
import { runApexTestClass, ApexTestRunOutcome, RunApexTestClassOptions } from './core/apexTestRunner';
import { scaffoldApexTestFromFile, ApexScaffoldResult } from './core/apexTestScaffold';
import { collectApexTestContext, buildApexTestPrompt, ApexStaticContext, ApexTestPrompt } from './core/apexTestContext';
import { generateApexTest, ApexGenerateResult, ApexGenerateOptions } from './core/apexTestGenerator';
import { getCoverage, ClassCoverageEntry } from './core/coverageStore';
import { evaluateFormula, evaluateFormulaMulti, fetchSampleRecords, FormulaEvalOptions, FormulaEvalResult, FormulaMultiResult, SampleRecord } from './core/formulaEval';
import { saveApexLogs } from './core/apexLogs';
import { analyzeLog, analysisToMarkdown, AnalyzeOptions, LogAnalysis } from './core/replay/logAnalyzer';
import { analyzeBatchJob, batchAnalysisToMarkdown, BatchJobAnalysis } from './core/replay/batchAnalyzer';
import { collectBatchJobLogs, BatchJobLogs, CollectBatchOptions } from './core/batchLogs';
import { saveRecordEdits, objectFromQuery, RecordEdit, RecordSaveResult } from './core/dataEditor';
import { resolveApiVersion } from './core/workspace';
import { apexClassScaffold, apexTriggerScaffold, lwcScaffold, auraScaffold, writeScaffold } from './core/scaffolds';
import * as fs from 'fs';
import * as path from 'path';
import {
  diffMetadataTypes, disposeTypeDiff, applyMetadataToLocal, applyFromDiffGroups, retrieveTypesToLocal,
  isDiffableMetadataType, findOrphanedMetaFiles,
  TypeDiffGroup, DiffMetadataTypesOptions, ApplyRef, ApplyResult
} from './core/typeDiff';
import { TraceManager } from './core/traceManager';
import { Logger } from './core/logger';
import { AiConfig } from './core/aiConfig';

/**
 * Result of a `create.*` call: the file to open/author next, plus every file the
 * scaffold wrote. `files` always includes the companion `-meta.xml` — that is the
 * point of the namespace, so callers can assert the pair landed.
 */
export interface CreateResult {
  /** Absolute path of the primary file (the `.cls`, `.trigger`, `.js`, `.cmp`). */
  primary: string;
  /** Absolute paths of ALL files written, including the `-meta.xml`. */
  files: string[];
}

/** Options for every `create.*` builder. */
export interface CreateOptions {
  /** Project root. Defaults to the active workspace. */
  projectRoot?: string;
  /** Output directory (absolute, or relative to the project root). Defaults per type. */
  outputDir?: string;
  /** Metadata API version. Defaults to the project's, then the org's, then a built-in. */
  apiVersion?: string;
  /**
   * Content for the PRIMARY file (`.cls`, `.trigger`, `.js`, `.cmp`). Omit for the
   * stub. The `-meta.xml` companion is generated either way, so passing `body`
   * still yields a complete, deployable bundle in a single call.
   */
  body?: string;
  /**
   * Override any file in the bundle by its path relative to the bundle root
   * (e.g. `MyCmp/MyCmp.html`, or `Foo.cls-meta.xml` to supply your own metadata).
   * Applied after `body`. Unknown relative paths are rejected rather than
   * silently ignored — a typo'd key must not look like a successful write.
   */
  files?: Record<string, string>;
}

/**
 * Public SDK surface for SIID Forge (plan §5.6 / §14 / §C). A stable, headless
 * API that OTHER extensions bind to via `extension.exports` — the same "one
 * engine, many consumers" seam the human UI and the AI agent use. Every method
 * returns structured data (no toasts, no editor/selection dependency).
 *
 * Versioned: `version` is the API contract version (semver). Consumers should
 * check it before relying on a method so we can evolve the surface safely.
 *
 * Bind from another extension:
 * ```ts
 * const ext = vscode.extensions.getExtension('ConscendoTechInc.siid-forge');
 * const forge = await ext?.activate() as SiidForgeApi;   // or ext.exports
 * const orgs = await forge.orgs.list();
 * ```
 */
export class SiidForgeApi {
  /** API contract version (semver). Bump on breaking changes.
   *  1.1.0 — `sf.run` gained real-time `onStatus` lifecycle callbacks.
   *  1.2.0 — added `orgs.authorizeWithToken` (session-id / access-token login).
   *  2.0.0 — `ApexStaticContext.triggers` is now `RelatedTrigger[]` (was string[]).
   *  2.1.0 — `orgs.list(force?)` is cached (TTL); `force` bypasses the cache.
   *  2.2.0 — added `diff.byMetadataTypes` (type-level org↔local diff).
   *  2.3.0 — added `diff.dispose`, `diff.applyToLocal` (orphan-immune pull),
   *          `diff.findOrphanedMeta`.
   *  2.4.0 — `byMetadataTypes` keeps the full org tree; added `diff.applyFromDiff`
   *          (apply by copy from the kept tree — no second org retrieve).
   *  2.5.0 — added `diff.retrieveTypes` (whole-type retrieve, no per-member args)
   *          and `diff.isDiffable` (split diffable vs retrieve-only types).
   *  2.6.0 — `DiffMetadataTypesOptions.onType` fires per-type as the diff
   *          progresses (drives a "Comparing <Type> (n of N)…" label). Additive
   *          and optional — older consumers are unaffected.
   *  2.7.0 — added `formula.evaluate` (Salesforce formula evaluation via the
   *          standard FormulaEval Apex library; no `sf` CLI command exists).
   *  2.8.0 — added `formula.sampleRecords` (list a few records of an object to
   *          pick one to evaluate against).
   *  2.9.0 — added `formula.evaluateMany` (evaluate one formula across several
   *          records in a single run → per-record result table).
   *  2.10.0 — added `schema.stdlib` (Salesforce StandardApexLibrary: System.*,
   *          ConnectApi.*, … parsed from the bundled Apex jar; shared globally,
   *          built on demand).
   *  2.11.0 — added `data` namespace: `query`, `objectOf`, `updateRecords`
   *          (edit queried records + write back per row).
   *  2.12.0 — added `logs` namespace: `analyze` / `analyzeFile` / `toMarkdown`
   *          (Apex debug-log analysis — governor limits, method timings, call
   *          tree, SOQL/DML, callouts, heap-over-time, insights, errors).
   *  2.13.0 — added the `not-finest` LogInsight kind (a DEBUG-level log now
   *          reports that its analysis is incomplete instead of looking clean).
   *  2.14.0 — added batch/async-job analysis to `logs`: `collectBatchJob`,
   *          `analyzeBatchJob`, `analyzeBatchJobById`, `batchToMarkdown` (roll a
   *          Batchable/Queueable job's many logs into one per-phase analysis).
   *  2.15.0 — `FormulaMultiResult` now documents `evaluated?`/`truncated?` in the
   *          public types (the runtime already returned them). Additive + optional;
   *          older consumers unaffected.
   *  2.16.0 — added `create` namespace: `apexClass`, `apexTrigger`, `lwc`, `aura`
   *          (local metadata scaffolding, no `sf` CLI). Each writes the COMPLETE
   *          bundle — the `-meta.xml` companion always included — or throws
   *          without writing anything. Exposed because an agent authoring files
   *          one at a time forgets the meta file, producing a class that cannot
   *          deploy; here that failure is structurally impossible. Additive. */
  readonly version = '2.16.0';

  constructor(
    private readonly sfExec: SfExecutor,
    private readonly orgMgr: OrgManager,
    private readonly cliMgr: CliManager,
    private readonly schemaMgr: SchemaManager,
    private readonly stdlibMgr: ApexStdlibManager,
    private readonly trace: TraceManager,
    private readonly logger: Logger,
    private readonly ai: AiConfig
  ) { }

  /** Resolves the active project root, or throws a clear error. */
  private root(explicit?: string): string {
    const r = explicit ?? getWorkspaceCwd();
    if (!r) {
      throw new Error('SIID Forge API: no workspace/project root. Pass an explicit projectRoot.');
    }
    return r;
  }

  // ───────────────────────────────── CLI ──────────────────────────────────
  readonly cli = {
    /** The installed `sf` CLI version, or undefined if not found. */
    getVersion: (): Promise<string | undefined> => this.cliMgr.getCurrentVersion(),
    /** True if the `sf` CLI is installed/resolvable. */
    isAvailable: async (): Promise<boolean> => !!(await this.cliMgr.getCurrentVersion())
  };

  // ─────────────────────────────── Raw CLI ────────────────────────────────
  readonly sf = {
    /**
     * Runs an arbitrary `sf … --json` command through the shared executor
     * (typed result, cancellation, injection-safe array args). The single
     * chokepoint every Forge feature uses — exposed so consumers never
     * re-implement `child_process`.
     */
    run: <T = unknown>(args: string[], opts?: SfRunOptions): Promise<SfResult<T>> => this.sfExec.run<T>(args, opts)
  };

  // ───────────────────────────────── Orgs ─────────────────────────────────
  readonly orgs = {
    /** All authorized orgs. Cached for a short TTL (instant on repeat calls);
     *  pass `force` to bypass the cache and re-run `sf org list`. */
    list: (force = false): Promise<OrgInfo[]> => this.orgMgr.listOrgs(force),
    /** The default (target) org alias, if any. */
    getDefault: (): Promise<string | undefined> => this.orgMgr.getDefaultOrg(),
    /** The default org's connected username. */
    getUsername: (): Promise<string | undefined> => this.orgMgr.getUsername(),
    /** The running user's Id (005…) for the default org. */
    getUserId: (): Promise<string | undefined> => this.orgMgr.getUserId(),
    /**
     * Authorize an org from an existing session id / access token (no browser).
     * The token is passed to the CLI via env, never logged. `instanceUrl` is
     * required; format is `<orgId>!<token>`.
     */
    authorizeWithToken: (accessToken: string, instanceUrl: string, alias?: string, setDefault = true): Promise<void> =>
      this.orgMgr.authorizeWithAccessToken(accessToken, instanceUrl, alias, setDefault),
    /** Fires when the default org changes. */
    onDidChangeDefault: this.orgMgr.onDidChangeDefaultOrg
  };

  // ──────────────────────────────── Schema ────────────────────────────────
  readonly schema = {
    /** Cached org object API names. */
    listObjects: (projectRoot?: string): string[] => this.schemaMgr.listObjects(this.root(projectRoot)),
    /** Cached describe for one object (fields, picklists, relationships). */
    readObject: (name: string, projectRoot?: string): ObjectSchema | undefined => this.schemaMgr.readObject(this.root(projectRoot), name),
    /** Local Apex class names (from the cache index). */
    apexClassNames: (projectRoot?: string): string[] => this.schemaMgr.apexClassNames(this.root(projectRoot)),
    /** Parsed schema for one Apex class (members, params, annotations). */
    readApex: (name: string, projectRoot?: string): ApexSchema | undefined => this.schemaMgr.readApex(this.root(projectRoot), name),
    /** Describe an object on demand (org round-trip) and cache it. */
    describeObject: (name: string, projectRoot?: string, token?: vscode.CancellationToken): Promise<boolean> =>
      this.schemaMgr.describeObject(this.root(projectRoot), name, token),

    /**
     * Salesforce StandardApexLibrary (System.*, ConnectApi.*, Schema.*, …),
     * parsed from the bundled Apex jar. Project-independent, so it is built once
     * into global storage and shared across workspaces.
     */
    stdlib: {
      /** Builds/loads the shared stdlib cache if needed. Idempotent. */
      ensure: (): Promise<void> => this.stdlibMgr.ensure().then(() => undefined),
      /** All stdlib namespaces → class names, or undefined until built. */
      namespaces: (): Record<string, string[]> | undefined => this.stdlibMgr.get()?.namespaces,
      /** Resolve one stdlib class by qualified (`System.Database`) or bare name. */
      lookup: (name: string): StdlibClass | undefined => this.stdlibMgr.lookup(name)
    }
  };

  // ─────────────────────────────── Coverage ───────────────────────────────
  readonly coverage = {
    /** Last recorded per-class coverage (covered/uncovered lines, percent). */
    get: (className: string, projectRoot?: string): ClassCoverageEntry | undefined => getCoverage(this.root(projectRoot), className)
  };

  // ─────────────────────────────── Diff ───────────────────────────────────
  readonly diff = {
    /**
     * Diffs whole metadata TYPES between the org and the local project. For each
     * type it enumerates the union of org members and local members, retrieves the
     * org copies, and returns one group per type with each member tagged
     * `new-in-org` / `changed` / `only-local` / `identical` (and `orgPath`/
     * `localPath` for a diff editor). `CustomObject` is reported as
     * `retrieved-not-compared` (decomposed-vs-inline format mismatch). Pass
     * `targetOrg` to diff against a specific org instead of the default.
     */
    byMetadataTypes: (types: string[], opts?: DiffMetadataTypesOptions & { projectRoot?: string }): Promise<TypeDiffGroup[]> =>
      diffMetadataTypes(this.sfExec, types, this.root(opts?.projectRoot), opts),

    /**
     * Releases the temp org files backing a diff result (the `orgPath`s). Call
     * once when the diff UI closes — the paths are invalid afterwards.
     */
    dispose: (groups: TypeDiffGroup[]): void => disposeTypeDiff(groups),

    /**
     * Pulls specific components into the local project WITHOUT a source-tracked
     * retrieve (which fails wholesale on any broken project component, e.g. an
     * orphaned `.cls-meta.xml`). Retrieves to a temp metadata dir and converts
     * into the package dir, overwriting local. Returns applied vs. missing.
     */
    applyToLocal: (refs: ApplyRef[], opts?: DiffMetadataTypesOptions & { projectRoot?: string }): Promise<ApplyResult> =>
      applyMetadataToLocal(this.sfExec, refs, this.root(opts?.projectRoot), opts),

    /**
     * Applies components by copying from an existing diff result's kept org trees
     * — NO second org retrieve (the compare step already retrieved them). Falls
     * back to a fresh retrieve for anything not in a live tree. This is what makes
     * "take org" instant. Pass the same `groups` returned by `byMetadataTypes`.
     */
    applyFromDiff: (groups: TypeDiffGroup[], refs: ApplyRef[], opts?: DiffMetadataTypesOptions & { projectRoot?: string }): Promise<ApplyResult> =>
      applyFromDiffGroups(this.sfExec, groups, refs, this.root(opts?.projectRoot), opts),

    /**
     * Retrieves WHOLE metadata types into the project — `--metadata <Type>` per
     * type (one arg), NOT per member. Use for retrieve-only types (CustomObject,
     * Report, …) where a member list would overflow the command line. Retrieves
     * to temp then mirrors into the package dir, overwriting local.
     */
    retrieveTypes: (types: string[], opts?: DiffMetadataTypesOptions & { projectRoot?: string }): Promise<{ types: string[] }> =>
      retrieveTypesToLocal(this.sfExec, types, this.root(opts?.projectRoot), opts),

    /**
     * Whether a type can be content-diffed. Split a selection with this: diffable
     * types → `byMetadataTypes` (compare + review); the rest → `retrieveTypes`.
     */
    isDiffable: (type: string): boolean => isDiffableMetadataType(type),

    /**
     * Finds orphaned `-meta.xml` sidecars (a content file's meta with the content
     * file missing) under the project's package dirs. These break `project
     * retrieve start` project-wide. Returns absolute paths.
     */
    findOrphanedMeta: (projectRoot?: string): string[] => findOrphanedMetaFiles(this.root(projectRoot))
  };

  // ────────────────────────────── Apex tests ──────────────────────────────
  readonly apexTests = {
    /**
     * Runs a class's Apex tests against the org and returns structured results
     * (pass/fail per method + coverage). Persists the report/coverage; no UI.
     */
    run: (className: string, opts?: RunApexTestClassOptions & { projectRoot?: string }): Promise<ApexTestRunOutcome> =>
      runApexTestClass(this.sfExec, this.orgMgr, this.trace, this.logger, this.root(opts?.projectRoot), className, opts),

    /** Generates a class-aware test skeleton (no AI) for a `.cls`. */
    scaffold: (clsPath: string, apiVersion = '62.0', projectRoot?: string): ApexScaffoldResult | undefined =>
      scaffoldApexTestFromFile(this.schemaMgr, this.root(projectRoot), clsPath, apiVersion),

    /**
     * Collects the deterministic static context for a class (related classes,
     * touched objects + required fields, active flows, triggers).
     */
    collectContext: (className: string, projectRoot?: string, token?: vscode.CancellationToken): Promise<ApexStaticContext> =>
      collectApexTestContext(this.sfExec, this.schemaMgr, this.root(projectRoot), className, token),

    /** Builds the hardened LLM prompt from a collected context. */
    buildPrompt: (ctx: ApexStaticContext, coverageTarget = 75): ApexTestPrompt => buildApexTestPrompt(ctx, coverageTarget),

    /**
     * Full coverage-driven generation loop: prompt → LLM → deploy (sandbox/dev
     * only) → run → self-correct. The caller supplies the LLM key/model (or omit
     * to use Forge's configured OpenRouter key). Returns the final result.
     */
    generate: async (
      clsPath: string,
      opts?: Partial<Pick<ApexGenerateOptions, 'apiKey' | 'model' | 'coverageTarget' | 'maxRetries' | 'signal' | 'onEvent'>> & { projectRoot?: string }
    ): Promise<ApexGenerateResult> => {
      const apiKey = opts?.apiKey ?? (await this.ai.getApiKey());
      if (!apiKey) {
        throw new Error('SIID Forge API: no OpenRouter API key (pass one, or set it via SIID Forge: Set OpenRouter API Key).');
      }
      return generateApexTest({
        sf: this.sfExec, orgs: this.orgMgr, trace: this.trace, schema: this.schemaMgr, logger: this.logger,
        projectRoot: this.root(opts?.projectRoot),
        clsPath,
        apiKey,
        model: opts?.model ?? this.ai.getModel(),
        coverageTarget: opts?.coverageTarget,
        maxRetries: opts?.maxRetries,
        signal: opts?.signal,
        onEvent: opts?.onEvent
      });
    }
  };

  // ───────────────────────────────── Formula ──────────────────────────────
  readonly formula = {
    /**
     * Evaluates a Salesforce formula against the org via the standard `FormulaEval`
     * Apex library (there is no `sf` CLI command for this). Self-contained: arms
     * the FINEST trace, runs the snippet through anonymous Apex, and reads the
     * result back from the debug log — returns structured data, no UI.
     */
    evaluate: (opts: FormulaEvalOptions & { projectRoot?: string }, token?: vscode.CancellationToken): Promise<FormulaEvalResult> => {
      const root = this.root(opts.projectRoot);
      return (async (): Promise<FormulaEvalResult> => {
        const username = await this.orgMgr.getUsername();
        if (username) {
          try { await this.trace.ensureTraceFlag(root, username); } catch (e: any) { this.logger.error(`trace: ${e.message}`); }
        }
        return evaluateFormula(this.sfExec, root, opts, async (runStart) => {
          const files = await saveApexLogs(this.sfExec, root, 'formula', runStart, 1, this.logger);
          return files[0] ? fs.readFileSync(files[0], 'utf-8') : undefined;
        }, token);
      })();
    },

    /**
     * Evaluates a formula against MANY records in one Apex run — pass explicit
     * `recordIds`, or omit to use the first `limit` records. Returns a per-record
     * table, the way to see behavior across varied data (blank vs. populated).
     */
    evaluateMany: (
      opts: Pick<FormulaEvalOptions, 'formula' | 'objectName' | 'returnType'> & { recordIds?: string[]; limit?: number; projectRoot?: string },
      token?: vscode.CancellationToken
    ): Promise<FormulaMultiResult> => {
      const root = this.root(opts.projectRoot);
      return (async (): Promise<FormulaMultiResult> => {
        const username = await this.orgMgr.getUsername();
        if (username) {
          try { await this.trace.ensureTraceFlag(root, username); } catch (e: any) { this.logger.error(`trace: ${e.message}`); }
        }
        return evaluateFormulaMulti(this.sfExec, root, opts, opts.recordIds ?? [], async (runStart) => {
          const files = await saveApexLogs(this.sfExec, root, 'formula', runStart, 1, this.logger);
          return files[0] ? fs.readFileSync(files[0], 'utf-8') : undefined;
        }, opts.limit, token);
      })();
    },

    /**
     * Fetches a few records of an object (Id + label) so a caller can pick one to
     * evaluate a formula against, instead of hand-typing a record Id.
     */
    sampleRecords: (
      objectName: string,
      opts?: { limit?: number; targetOrg?: string; projectRoot?: string },
      token?: vscode.CancellationToken
    ): Promise<SampleRecord[]> =>
      fetchSampleRecords(this.sfExec, this.root(opts?.projectRoot), objectName, opts?.limit, opts?.targetOrg, token)
  };

  // ────────────────────────────────── Data ────────────────────────────────
  readonly data = {
    /**
     * Runs a SOQL query and returns the raw records (same shape as the CLI's
     * `data query` result). The editable SOQL grid uses this + `updateRecords`.
     */
    query: async <T = Record<string, unknown>>(
      soql: string,
      opts?: { projectRoot?: string },
      token?: vscode.CancellationToken
    ): Promise<{ totalSize?: number; done?: boolean; records?: T[] }> => {
      const { result } = await this.sfExec.run<{ totalSize?: number; done?: boolean; records?: T[] }>(
        ['data', 'query', '--query', soql],
        { cwd: this.root(opts?.projectRoot), token }
      );
      return result;
    },

    /** The object a SOQL query targets (its `FROM` object), or undefined. */
    objectOf: (soql: string): string | undefined => objectFromQuery(soql),

    /**
     * Writes edited records back to the org — one `data update record` per row,
     * returning a per-record success/error. No production guard here (headless);
     * callers that need it check `orgs`/`getOrgKind` first, as the UI does.
     */
    updateRecords: (
      sobject: string,
      edits: RecordEdit[],
      opts?: { projectRoot?: string },
      token?: vscode.CancellationToken
    ): Promise<RecordSaveResult[]> =>
      saveRecordEdits(this.sfExec, this.root(opts?.projectRoot), sobject, edits, token)
  };

  // ──────────────────────────────── Create ────────────────────────────────
  /**
   * Local metadata scaffolding — the same files the Forge menu's "Create Apex
   * Class / Trigger / LWC / Aura" commands write, exposed headlessly.
   *
   * WHY THIS IS ON THE API: an Apex class is not one file, it is a file PAIR —
   * `Foo.cls` plus `Foo.cls-meta.xml`. A class without its meta file cannot be
   * deployed. An agent authoring files one at a time reliably forgets the second
   * one (observed: a generated test class deployed as "successful" while its
   * meta file was never written, so the test class never reached the org).
   *
   * These builders make that failure structurally impossible: each returns the
   * complete bundle, and `writeScaffold` pre-checks every target so a partial
   * bundle is never written — it either creates the whole set or throws.
   *
   * CONTENT: pass `body` to write real code instead of the stub. The companion
   * `-meta.xml` is still generated, so ONE call yields a complete, deployable
   * pair. This matters for an agent: authoring is the natural thing to want from
   * a "create" tool, and if `body` were ignored the caller would get a success
   * result over an empty stub — a silent wrong-content failure that deploys
   * cleanly and simply lacks the method. Omit `body` for a plain stub.
   *
   * For LWC/Aura, `body` fills the primary file (`.js` / `.cmp`); use `files` to
   * override any other member of the bundle by its relative path.
   *
   * `apiVersion` defaults to the project's (`sfdx-project.json`), falling back to
   * the org's, then a built-in default. `outputDir` defaults to the conventional
   * location for the type and is resolved relative to the project root.
   */
  readonly create = {
    /** Apex class (stub, or `body`) + its `.cls-meta.xml`. Returns the created paths. */
    apexClass: async (name: string, opts?: CreateOptions): Promise<CreateResult> => {
      const root = this.root(opts?.projectRoot);
      const scaffold = apexClassScaffold(name, opts?.apiVersion ?? (await resolveApiVersion(root, this.orgMgr)));
      return this.writeCreated(root, opts?.outputDir ?? 'force-app/main/default/classes', scaffold, opts);
    },

    /** Apex trigger on `sobject` (stub, or `body`) + its `.trigger-meta.xml`. */
    apexTrigger: async (name: string, sobject: string, opts?: CreateOptions): Promise<CreateResult> => {
      const root = this.root(opts?.projectRoot);
      const scaffold = apexTriggerScaffold(name, sobject, opts?.apiVersion ?? (await resolveApiVersion(root, this.orgMgr)));
      return this.writeCreated(root, opts?.outputDir ?? 'force-app/main/default/triggers', scaffold, opts);
    },

    /** LWC bundle: `<name>/<name>.js`, `.html`, and `.js-meta.xml`. */
    lwc: async (name: string, opts?: CreateOptions): Promise<CreateResult> => {
      const root = this.root(opts?.projectRoot);
      const scaffold = lwcScaffold(name, opts?.apiVersion ?? (await resolveApiVersion(root, this.orgMgr)));
      return this.writeCreated(root, opts?.outputDir ?? 'force-app/main/default/lwc', scaffold, opts);
    },

    /** Aura bundle: `<name>/<name>.cmp`, `.cmp-meta.xml`, and a controller. */
    aura: async (name: string, opts?: CreateOptions): Promise<CreateResult> => {
      const root = this.root(opts?.projectRoot);
      const scaffold = auraScaffold(name, opts?.apiVersion ?? (await resolveApiVersion(root, this.orgMgr)));
      return this.writeCreated(root, opts?.outputDir ?? 'force-app/main/default/aura', scaffold, opts);
    }
  };

  /**
   * Shared writer for the `create` namespace: applies any caller-supplied content,
   * resolves the output dir, writes the bundle atomically, and reports the paths.
   *
   * Content substitution happens BEFORE writing, so the meta companion is still part
   * of the same all-or-nothing bundle no matter what the caller overrode.
   */
  private writeCreated(
    root: string,
    outputDir: string,
    scaffold: { files: { relPath: string; content: string }[]; primary: string },
    opts?: CreateOptions
  ): CreateResult {
    const files = scaffold.files.map((f) => ({ ...f }));

    if (opts?.body !== undefined) {
      const primaryFile = files.find((f) => f.relPath === scaffold.primary);
      if (!primaryFile) {
        throw new Error(`SIID Forge API: scaffold has no primary file "${scaffold.primary}".`);
      }
      primaryFile.content = opts.body;
    }

    for (const [relPath, content] of Object.entries(opts?.files ?? {})) {
      const target = files.find((f) => f.relPath === relPath);
      if (!target) {
        // Reject rather than ignore: a mistyped key would otherwise report success
        // while writing the untouched stub.
        throw new Error(
          `SIID Forge API: "${relPath}" is not part of this bundle. Valid paths: ${files.map((f) => f.relPath).join(', ')}`
        );
      }
      target.content = content;
    }

    const baseDir = path.isAbsolute(outputDir) ? outputDir : path.join(root, outputDir);
    const primary = writeScaffold(baseDir, { files, primary: scaffold.primary });
    return {
      primary,
      files: files.map((f) => path.join(baseDir, f.relPath))
    };
  }

  readonly logs = {
    /**
     * Analyzes a raw Apex debug log into structured insight: governor-limit
     * usage, per-method timings (self/total + a call tree + hot spots), the
     * SOQL/DML breakdown, debug output, and exceptions with stack traces. Pure
     * and headless — the visual Log Analyzer panel renders this exact shape, and
     * the AI agent calls it to answer questions ("what's the slowest method?",
     * "did it hit a limit?", "how many SOQL?") without any UI.
     */
    analyze: (rawLog: string, options?: AnalyzeOptions): LogAnalysis => analyzeLog(rawLog, options),

    /**
     * Analyzes a saved log FILE (reads it, then {@link analyze}). Convenience for
     * callers holding a `.siid/logs/*.log` path.
     */
    analyzeFile: (logFilePath: string, options?: AnalyzeOptions): LogAnalysis => analyzeLog(fs.readFileSync(logFilePath, 'utf-8'), options),

    /**
     * Renders an analysis as a Markdown report (the same one the panel exports).
     * JSON export is just `JSON.stringify(analysis)`. Handy for the AI agent to
     * attach a readable log summary to its output.
     */
    toMarkdown: (analysis: LogAnalysis, logName?: string): string => analysisToMarkdown(analysis, logName),

    /**
     * Collects EVERY log of an async Apex job (Batchable/Queueable/Schedulable),
     * polling `AsyncApexJob` until it reaches a terminal state.
     *
     * Needed because a batch is not one transaction: `start`, each `execute`
     * chunk and `finish` run separately and each emit their own ApexLog — often
     * minutes after the call that enqueued the job returned, which is why a
     * plain "fetch the newest log" only ever sees one of them.
     */
    collectBatchJob: (jobId: string, opts?: CollectBatchOptions, projectRoot?: string, token?: vscode.CancellationToken): Promise<BatchJobLogs> =>
      collectBatchJobLogs(this.sfExec, this.root(projectRoot), jobId, opts, this.logger, token),

    /**
     * Rolls the collected logs of one async job into a single analysis with a
     * per-phase breakdown (start → chunks → finish), job-wide totals, the peak
     * per-chunk limit usage, and insights that only exist at job scope (e.g. a
     * per-chunk query cost multiplied across every chunk).
     */
    analyzeBatchJob: (job: BatchJobLogs, options?: AnalyzeOptions): BatchJobAnalysis => analyzeBatchJob(job, options),

    /**
     * Convenience: {@link collectBatchJob} then {@link analyzeBatchJob}.
     */
    analyzeBatchJobById: async (
      jobId: string,
      options?: AnalyzeOptions & CollectBatchOptions,
      projectRoot?: string,
      token?: vscode.CancellationToken
    ): Promise<BatchJobAnalysis> => {
      const job = await collectBatchJobLogs(this.sfExec, this.root(projectRoot), jobId, options, this.logger, token);
      return analyzeBatchJob(job, options);
    },

    /** Renders a whole-job analysis as a Markdown report. */
    batchToMarkdown: (analysis: BatchJobAnalysis): string => batchAnalysisToMarkdown(analysis)
  };
}

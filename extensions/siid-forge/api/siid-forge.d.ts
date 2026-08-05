/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Public SDK type declarations for the SIID Forge extension
 * (`ConscendoTechInc.siid-forge`), shipped as the `@conscendotech/siid-forge-api`
 * package. Depend on the package and import the type:
 *
 * ```ts
 * import type { SiidForgeApi } from '@conscendotech/siid-forge-api';
 * const ext = vscode.extensions.getExtension('ConscendoTechInc.siid-forge');
 * const forge = (await ext?.activate()) as SiidForgeApi | undefined;
 * ```
 *
 * The surface is versioned via `SiidForgeApi.version` (semver), and the package
 * version tracks it (a build-time guard fails if they drift). This file is
 * self-contained — it does NOT import Forge internals — so the package is
 * types-only and carries no runtime code.
 */

import type { CancellationToken, Event } from 'vscode';

// ─────────────────────────────── Shared types ───────────────────────────────

export interface SfResult<T = unknown> {
  status: number;
  result: T;
  warnings?: string[];
  message?: string;
  raw?: string;
}

/** Lifecycle phase of a running `sf` command. */
export type SfCommandPhase = 'started' | 'running' | 'succeeded' | 'failed' | 'cancelled';

/** A real-time status update for one `sf` invocation (via `onStatus`). */
export interface SfCommandStatus {
  phase: SfCommandPhase;
  /** The full command line being run (for display). */
  command: string;
  /** Milliseconds since the command started. */
  elapsedMs: number;
  /** The `sf` status/exit code — only on `succeeded`/`failed`. */
  status?: number;
  /** A short error summary — only on `failed`. */
  message?: string;
}

export interface SfRunOptions {
  cwd?: string;
  json?: boolean;
  timeoutMs?: number;
  token?: CancellationToken;
  maxBuffer?: number;
  /** Resolve (not reject) when the CLI exits non-zero (read the result anyway). */
  acceptNonZeroStatus?: boolean;
  /**
   * Real-time lifecycle callback: `started` → periodic `running` heartbeat →
   * one terminal `succeeded`/`failed`/`cancelled`. Drives a live "running… (Ns)"
   * indicator. Side-effect free — a throwing callback never affects the command.
   */
  onStatus?: (status: SfCommandStatus) => void;
  /** Heartbeat interval (ms) for `running` ticks. Default 1000. */
  statusHeartbeatMs?: number;
}

export interface OrgInfo {
  alias?: string;
  username: string;
  orgId?: string;
  isDefault?: boolean;
}

export interface ObjectField {
  name: string;
  label?: string;
  type?: string;
  referenceTo?: string[];
  /** Relationship name for a lookup field (e.g. `OwnerId` → `Owner`), for dot-path/SOQL traversal. */
  relationshipName?: string;
  picklistValues?: string[];
  required?: boolean;
  /** Whether the field is writable on update (from the describe's `updateable`). */
  updateable?: boolean;
}
export interface ObjectSchema {
  name: string;
  label?: string;
  custom?: boolean;
  fields: ObjectField[];
}

export interface ApexParam { type: string; name: string; }
export interface ApexMember {
  name: string;
  kind: 'method' | 'property';
  returnType?: string;
  modifiers?: string[];
  annotations?: string[];
  params?: ApexParam[];
  line?: number;
  signature?: string;
}
export interface ApexSchema {
  name: string;
  annotations: string[];
  members: ApexMember[];
  filePath?: string;
  line?: number;
  signature?: string;
}

/** One class from the Salesforce StandardApexLibrary (System.*, ConnectApi.*, …). */
export interface StdlibClass {
  /** Fully-qualified name, e.g. `System.Database` or `ConnectApi.ChatterFeeds`. */
  qualifiedName: string;
  /** Namespace segment, e.g. `System`, `ConnectApi`. */
  namespace: string;
  /** Bare class name, e.g. `Database`. */
  name: string;
  schema: ApexSchema;
}

export interface ClassCoverageEntry {
  name: string;
  totalLines: number;
  totalCovered: number;
  coveredPercent: number;
  covered: number[];
  uncovered: number[];
  capturedAt: string;
}

// ── Apex test run/scaffold/context/generate (structured, no UI) ──────────────

export interface ApexTestRunOutcome {
  result: unknown;
  reportPath: string;
  logFiles: string[];
  classCoverage?: ClassCoverageEntry;
  passing: number;
  failing: number;
  testsRan: number;
}
export interface RunApexTestClassOptions {
  tests?: string;
  debug?: boolean;
  token?: CancellationToken;
}

export interface ApexScaffoldResult {
  testPath: string;
  metaPath: string;
  content: string;
  meta: string;
  exists: boolean;
}

export interface RelatedClass { name: string; filePath?: string; signatures: string[]; }
export interface RelevantField { name: string; type?: string; required?: boolean; referenceTo?: string[]; picklistValues?: string[]; }
export interface TouchedObject { name: string; label?: string; custom?: boolean; kind: 'sobject' | 'customMetadata' | 'platformEvent'; fields: RelevantField[]; }
export interface RelatedFlow { label: string; apiName?: string; processType?: string; triggerType?: string; triggerObject?: string; }
export interface RelatedTrigger { name: string; object: string; handlers: string[]; viaSetup?: boolean; }
export interface ApexStaticContext {
  className: string;
  classFilePath?: string;
  relatedClasses: RelatedClass[];
  objects: TouchedObject[];
  flows: RelatedFlow[];
  /** Triggers on touched OR setup-implied objects (2.0.0: was `string[]`). */
  triggers: RelatedTrigger[];
}
export interface ApexTestPrompt { testName: string; text: string; }

export type ApexGenerateEvent =
  | { type: 'phase'; attempt: number; phase: 'generating' | 'deploying' | 'running' | 'fixing'; message: string }
  | { type: 'attempt-result'; attempt: number; passed: number; total: number; failed: number; coverage?: number; failures: string[] }
  | { type: 'usage'; attempt: number; promptTokens: number; completionTokens: number; totalTokens: number; cost?: number; cumulativeTokens: number; cumulativeCost: number }
  | { type: 'blocked'; reason: string }
  | { type: 'done'; success: boolean; attempts: number; passed: number; total: number; coverage?: number; totalTokens: number; totalCost: number };

export interface ApexGenerateResult {
  testPath: string;
  attempts: number;
  success: boolean;
  passed: number;
  total: number;
  failed: number;
  coverage?: number;
  totalTokens: number;
  totalCost: number;
  blockedReason?: string;
}

// ── Type-level diff (whole metadata type: org ∪ local) ───────────────────────

/** Per-member status in a type-level diff. */
export type TypeDiffStatus =
  | 'new-in-org'
  | 'changed'
  | 'only-local'
  | 'identical'
  | 'retrieved-not-compared';

export interface TypeDiffRow {
  /** Component API name (fullName). */
  fullName: string;
  status: TypeDiffStatus;
  /** Absolute path to the retrieved org copy (temp), when present. */
  orgPath?: string;
  /** Absolute path to the local copy, when present. */
  localPath?: string;
}

export interface TypeDiffGroup {
  /** Metadata API name, e.g. "ApexClass". */
  type: string;
  /** False when the type is not file-comparable (rows all `retrieved-not-compared`). */
  comparedByContent: boolean;
  rows: TypeDiffRow[];
  /** Releases this group's temp org files. Prefer `diff.dispose(groups)`. */
  dispose?: () => void;
  /** Internal: kept org retrieve root, used by `diff.applyFromDiff`. Do not touch. */
  _mdRoot?: string;
}

export interface DiffMetadataTypesOptions {
  /** Target a specific org (username/alias); omit for the default org. */
  targetOrg?: string;
  token?: CancellationToken;
  /** Streams each underlying `sf` command's lifecycle (list + retrieve per type). */
  onStatus?: (status: SfCommandStatus) => void;
  /**
   * Fired once as each type STARTS processing (API ≥ 2.6.0), so a consumer can
   * show which type is in flight and overall progress (e.g. "Comparing LWC
   * (3 of 7)…"). `index` is 0-based; `total` is the number of requested types.
   */
  onType?: (info: { type: string; index: number; total: number }) => void;
}

/** A component to pull into the local project. */
export interface ApplyRef { type: string; fullName: string; }

/** Result of an apply-to-local. */
export interface ApplyResult {
  /** Components successfully written into the project. */
  applied: ApplyRef[];
  /** Components the org reported as missing (not written). */
  missing: ApplyRef[];
}

// ─────────────────────────────── Formula eval ───────────────────────────────

export type FormulaReturnType =
  | 'STRING' | 'BOOLEAN' | 'INTEGER' | 'LONG' | 'DECIMAL' | 'DOUBLE' | 'DATE' | 'DATETIME' | 'TIME';

export interface FormulaEvalOptions {
  /** The formula expression (Flow `{!…}`/`$Record.` syntax is stripped for you). */
  formula: string;
  /** The SObject API name the formula is defined against (e.g. `Account`). */
  objectName: string;
  /** The formula's return type. */
  returnType: FormulaReturnType;
  /** A specific record Id to evaluate against; otherwise the first available record is used. */
  recordId?: string;
  /** Target org alias/username; defaults to the project's default org. */
  targetOrg?: string;
}

export interface FormulaEvalResult {
  success: boolean;
  /** The evaluated value (JSON-parsed when possible), when `success`. */
  value?: unknown;
  /** Field API names the formula referenced. */
  referencedFields: string[];
  /** A non-fatal note (e.g. "no records found, syntax is valid but not evaluated"). */
  warning?: string;
  /** The failure reason when `!success`. */
  error?: string;
  /** Wall-clock duration of the evaluation, in ms. */
  executionTimeMs: number;
}

export interface SampleRecord {
  id: string;
  /** A readable label (Name if the object has one, else the Id). */
  label: string;
}

/** A single field's new value for a record update. */
export interface FieldEdit { field: string; value: string; }
/** One record's pending edits. */
export interface RecordEdit { recordId: string; fields: FieldEdit[]; /** Target object; defaults to the base object (set for relationship-parent edits). */ sobject?: string; }
/** Per-record outcome of a save. */
export interface RecordSaveResult { recordId: string; success: boolean; error?: string; }

/** One governor limit from a log's CUMULATIVE_LIMIT_USAGE block. */
export interface LimitUsage { name: string; used: number; limit: number; /** used/limit as 0–100. */ percent: number; }
/** A method/code-unit node in the log's execution tree, with self + total time. */
export interface MethodNode { name: string; className?: string; line?: number; totalMs: number; selfMs: number; count: number; /** Folded consecutive identical calls (loop body): ×N. */ repeat?: number; children: MethodNode[]; }
/** One SOQL/SOSL/DML operation from a log. */
export interface DataOp { kind: 'SOQL' | 'SOSL' | 'DML'; line?: number; logLine?: number; className?: string; detail: string; ms?: number; rows?: number; }
/** One HTTP callout from a log. */
export interface Callout { line?: number; className?: string; request: string; response?: string; ms?: number; }
/** A USER_DEBUG line from a log. */
export interface DebugLine { line?: number; logLine?: number; level?: string; className?: string; message: string; }
/** An exception/fatal error with its (best-effort) Apex stack trace (top first). */
export interface LogError { kind: 'EXCEPTION' | 'FATAL'; line?: number; message: string; stack: string[]; }
/** A derived warning: loop query/DML, recursion, a limit near cap, or a log that
 *  can't be analyzed (`not-finest` — DEBUG-level logs omit SOQL/method/heap events). */
export interface LogInsight { kind: 'loop-soql' | 'loop-dml' | 'recursion' | 'limit' | 'unbounded-soql' | 'truncated' | 'limit-exception' | 'flow-db' | 'flow-slow' | 'flow-recursion' | 'not-finest'; severity: 'warn' | 'error'; message: string; detail?: string; count?: number; }
/** Which phase of an async Apex job a log came from. */
export type BatchPhase = 'start' | 'execute' | 'finish' | 'unknown';
/** One transaction's log within an async job. */
export interface BatchPhaseLog {
  id: string; phase: BatchPhase; chunkIndex?: number; startTime?: string;
  operation?: string; requestIdentifier?: string; durationMs?: number; file: string;
}
/** An async job plus every log it produced. */
export interface BatchJobLogs {
  jobId: string; status: string; jobType?: string; className?: string;
  itemsProcessed?: number; totalItems?: number; numberOfErrors?: number;
  createdDate?: string; completedDate?: string; logs: BatchPhaseLog[]; timedOut?: boolean;
}
/** Options for collecting an async job's logs. */
export interface CollectBatchOptions {
  /** Max wait for the job to finish. Default 5 minutes. */
  timeoutMs?: number;
  /** Gap between job-status polls. Default 3s. */
  pollIntervalMs?: number;
  onProgress?: (info: { status: string; itemsProcessed?: number; totalItems?: number; elapsedMs: number }) => void;
}
/** One transaction of an async job, analyzed on its own. */
export interface BatchPhaseAnalysis {
  phase: BatchPhase; chunkIndex?: number; logId: string; file: string; analysis: LogAnalysis;
}
/** A job-level insight; `phase`/`phaseCount` say where it came from. */
export interface BatchInsight extends LogInsight { phase?: BatchPhase; phaseCount?: number; }
/** A whole async job, rolled up with a per-phase breakdown. */
export interface BatchJobAnalysis {
  jobId: string; status: string; className?: string; jobType?: string;
  itemsProcessed?: number; totalItems?: number; numberOfErrors?: number;
  jobDurationMs?: number; phases: BatchPhaseAnalysis[];
  totals: { soql: number; dml: number; dbRows: number; callouts: number; cpuMs: number; transactionMs: number; errors: number; chunks: number; };
  peakLimits: Array<LimitUsage & { phase: BatchPhase; chunkIndex?: number }>;
  /**
   * False when the job's logs carry no usable governor data — async logs report
   * every limit as 0. When false, `peakLimits`/`totals.cpuMs` mean "not measured",
   * NOT "nothing used"; the SOQL/DML counts are still reliable (counted from events).
   */
  limitsUsable: boolean;
  insights: BatchInsight[]; truncated: boolean; isFinest: boolean;
}
/** One element that ran inside a flow interview. */
export interface FlowElement { type: string; name: string; }
/** A flow interview run (flows report DB work as aggregates, not per-op events). */
export interface FlowInterview { name: string; elements: FlowElement[]; soql?: number; dml?: number; cpuMs?: number; }
/** A flow element aggregated across runs, with wall + CPU timing. */
export interface FlowElementStat { type: string; name: string; flow: string; count: number; totalMs: number; cpuMs: number; isQuery: boolean; isDml: boolean; }
/** Tunable thresholds for log-analysis insight detection. */
export interface AnalyzeOptions { loopThreshold?: number; recursionThreshold?: number; }
/** Structured analysis of one Apex debug log (see `api.logs.analyze`). */
export interface LogAnalysis {
  apiVersion?: string;
  apexCodeLevel?: string;
  isFinest: boolean;
  /** True when the log was cut off at MAXIMUM DEBUG LOG SIZE (analysis partial). */
  truncated: boolean;
  durationMs: number;
  /** CPU time (ms) from the governor limit — what the 10s limit measures. */
  cpuMs?: number;
  entryPoint?: string;
  limits: LimitUsage[];
  tree: MethodNode[];
  hotMethods: MethodNode[];
  dataOps: DataOp[];
  callouts: Callout[];
  flows: FlowInterview[];
  flowElements: FlowElementStat[];
  debug: DebugLine[];
  errors: LogError[];
  insights: LogInsight[];
  counts: { soql: number; dml: number; dbRows: number; debug: number; methods: number; callouts: number };
}

export interface FormulaRowResult {
  recordId?: string;
  /** The evaluated value (JSON-parsed), when this record evaluated cleanly. */
  value?: unknown;
  /** Set when this specific record's evaluation threw. */
  error?: string;
}

export interface FormulaMultiResult {
  success: boolean;
  rows: FormulaRowResult[];
  referencedFields: string[];
  warning?: string;
  error?: string;
  /** How many records were actually evaluated (after the safety cap). */
  evaluated?: number;
  /** Set when the request exceeded the max-record cap and was truncated — `rows` is a prefix. */
  truncated?: boolean;
  executionTimeMs: number;
}

// ─────────────────────────────── The API ────────────────────────────────────

export interface SiidForgeApi {
  /** API contract version (semver). */
  readonly version: string;

  readonly cli: {
    getVersion(): Promise<string | undefined>;
    isAvailable(): Promise<boolean>;
  };

  readonly sf: {
    /** Run any `sf … --json` command through the shared executor. */
    run<T = unknown>(args: string[], opts?: SfRunOptions): Promise<SfResult<T>>;
  };

  readonly orgs: {
    /** All authorized orgs. Cached ~5 min, stale-while-revalidate: a call past the TTL returns the
     *  cached list instantly and refreshes in the background. Pass `force` to bypass and re-run
     *  `sf org list` synchronously. */
    list(force?: boolean): Promise<OrgInfo[]>;
    getDefault(): Promise<string | undefined>;
    getUsername(): Promise<string | undefined>;
    getUserId(): Promise<string | undefined>;
    /** Authorize from a session id / access token (`<orgId>!<token>`); token passed via env, never logged. */
    authorizeWithToken(accessToken: string, instanceUrl: string, alias?: string, setDefault?: boolean): Promise<void>;
    onDidChangeDefault: Event<string | undefined>;
  };

  readonly schema: {
    listObjects(projectRoot?: string): string[];
    readObject(name: string, projectRoot?: string): ObjectSchema | undefined;
    apexClassNames(projectRoot?: string): string[];
    readApex(name: string, projectRoot?: string): ApexSchema | undefined;
    describeObject(name: string, projectRoot?: string, token?: CancellationToken): Promise<boolean>;
    /**
     * Salesforce StandardApexLibrary, parsed from the bundled Apex jar. Shared
     * across projects (built once into global storage), so no `projectRoot`.
     */
    stdlib: {
      /** Build/load the shared cache if needed. Idempotent. */
      ensure(): Promise<void>;
      /** All namespaces → class names, or undefined until built. */
      namespaces(): Record<string, string[]> | undefined;
      /** Resolve a class by qualified (`System.Database`) or bare name. */
      lookup(name: string): StdlibClass | undefined;
    };
  };

  readonly coverage: {
    get(className: string, projectRoot?: string): ClassCoverageEntry | undefined;
  };

  readonly diff: {
    /**
     * Diff whole metadata TYPES between the org and the local project. Enumerates
     * org members ∪ local members per type, retrieves the org copies, and returns
     * one group per type with each member tagged and paths for a diff editor.
     * `CustomObject` comes back as `retrieved-not-compared`.
     */
    byMetadataTypes(
      types: string[],
      opts?: DiffMetadataTypesOptions & { projectRoot?: string }
    ): Promise<TypeDiffGroup[]>;
    /** Releases the temp org files backing a diff result. Call when the UI closes. */
    dispose(groups: TypeDiffGroup[]): void;
    /**
     * Pull specific components into the local project without a source-tracked
     * retrieve (immune to broken project components like an orphaned
     * `.cls-meta.xml`). Retrieves to temp + converts into the package dir.
     */
    applyToLocal(
      refs: ApplyRef[],
      opts?: DiffMetadataTypesOptions & { projectRoot?: string }
    ): Promise<ApplyResult>;
    /**
     * Apply by copying from an existing diff result's kept org trees — no second
     * org retrieve (compare already retrieved them). Falls back to a fresh
     * retrieve for anything not in a live tree. Makes "take org" instant. Pass the
     * same `groups` from `byMetadataTypes`.
     */
    applyFromDiff(
      groups: TypeDiffGroup[],
      refs: ApplyRef[],
      opts?: DiffMetadataTypesOptions & { projectRoot?: string }
    ): Promise<ApplyResult>;
    /** Absolute paths of orphaned `-meta.xml` sidecars under the package dirs. */
    findOrphanedMeta(projectRoot?: string): string[];
    /**
     * Retrieve WHOLE metadata types into the project — `--metadata <Type>` per
     * type (one arg), NOT per member. Use for retrieve-only types (CustomObject,
     * Report, …) where a member list would overflow the command line.
     */
    retrieveTypes(
      types: string[],
      opts?: DiffMetadataTypesOptions & { projectRoot?: string }
    ): Promise<{ types: string[] }>;
    /**
     * Whether a type can be content-diffed. Split a selection with this: diffable
     * types → `byMetadataTypes` (compare + review); the rest → `retrieveTypes`.
     */
    isDiffable(type: string): boolean;
  };

  readonly apexTests: {
    run(className: string, opts?: RunApexTestClassOptions & { projectRoot?: string }): Promise<ApexTestRunOutcome>;
    scaffold(clsPath: string, apiVersion?: string, projectRoot?: string): ApexScaffoldResult | undefined;
    collectContext(className: string, projectRoot?: string, token?: CancellationToken): Promise<ApexStaticContext>;
    buildPrompt(ctx: ApexStaticContext, coverageTarget?: number): ApexTestPrompt;
    generate(
      clsPath: string,
      opts?: {
        apiKey?: string;
        model?: string;
        coverageTarget?: number;
        maxRetries?: number;
        signal?: AbortSignal;
        onEvent?: (e: ApexGenerateEvent) => void;
        projectRoot?: string;
      }
    ): Promise<ApexGenerateResult>;
  };

  readonly formula: {
    /**
     * Evaluates a Salesforce formula against the org via the standard FormulaEval
     * Apex library (no `sf` CLI command exists). Arms the FINEST trace and reads
     * the result back from the debug log. Returns structured data, no UI.
     */
    evaluate(opts: FormulaEvalOptions & { projectRoot?: string }, token?: CancellationToken): Promise<FormulaEvalResult>;
    /** Evaluates one formula across several records in a single run → per-record table. */
    evaluateMany(
      opts: Pick<FormulaEvalOptions, 'formula' | 'objectName' | 'returnType'> & { recordIds?: string[]; limit?: number; projectRoot?: string },
      token?: CancellationToken
    ): Promise<FormulaMultiResult>;
    /** Lists a few records of an object (Id + label) to pick one to evaluate against. */
    sampleRecords(
      objectName: string,
      opts?: { limit?: number; targetOrg?: string; projectRoot?: string },
      token?: CancellationToken
    ): Promise<SampleRecord[]>;
  };

  readonly data: {
    /** Run a SOQL query; returns the raw records (same shape as `sf data query`). */
    query<T = Record<string, unknown>>(
      soql: string,
      opts?: { projectRoot?: string },
      token?: CancellationToken
    ): Promise<{ totalSize?: number; done?: boolean; records?: T[] }>;
    /** The object a SOQL query targets (its `FROM` object), or undefined. */
    objectOf(soql: string): string | undefined;
    /** Write edited records back — one update per row; per-record result. */
    updateRecords(
      sobject: string,
      edits: RecordEdit[],
      opts?: { projectRoot?: string },
      token?: CancellationToken
    ): Promise<RecordSaveResult[]>;
  };

  readonly logs: {
    /** Analyze a raw Apex debug log into limits/timings/SOQL-DML/debug/errors. */
    analyze(rawLog: string, options?: AnalyzeOptions): LogAnalysis;
    /** Analyze a saved `.siid/logs/*.log` file (reads it, then {@link analyze}). */
    analyzeFile(logFilePath: string, options?: AnalyzeOptions): LogAnalysis;
    /** Render an analysis as a Markdown report (JSON export = JSON.stringify). */
    toMarkdown(analysis: LogAnalysis, logName?: string): string;
    /**
     * Collect EVERY log of an async Apex job (Batchable/Queueable/Schedulable),
     * polling `AsyncApexJob` until it reaches a terminal state. A batch is not one
     * transaction — start, each execute chunk and finish each emit their own log,
     * often long after the enqueuing call returned.
     */
    collectBatchJob(jobId: string, opts?: CollectBatchOptions, projectRoot?: string, token?: CancellationToken): Promise<BatchJobLogs>;
    /** Roll a job's collected logs into one analysis with a per-phase breakdown. */
    analyzeBatchJob(job: BatchJobLogs, options?: AnalyzeOptions): BatchJobAnalysis;
    /** Convenience: {@link collectBatchJob} then {@link analyzeBatchJob}. */
    analyzeBatchJobById(jobId: string, options?: AnalyzeOptions & CollectBatchOptions, projectRoot?: string, token?: CancellationToken): Promise<BatchJobAnalysis>;
    /** Render a whole-job analysis as a Markdown report. */
    batchToMarkdown(analysis: BatchJobAnalysis): string;
  };
}

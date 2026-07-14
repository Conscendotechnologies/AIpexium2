/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Public SDK type declarations for the SIID Forge extension
 * (`ConscendoTechInc.siid-forge`). Copy this file into a dependent extension and
 * cast the resolved exports to `SiidForgeApi`:
 *
 * ```ts
 * import type { SiidForgeApi } from './siid-forge';
 * const ext = vscode.extensions.getExtension('ConscendoTechInc.siid-forge');
 * const forge = (await ext?.activate()) as SiidForgeApi | undefined;
 * ```
 *
 * The surface is versioned via `SiidForgeApi.version` (semver). This file is
 * self-contained — it does NOT import Forge internals.
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
  picklistValues?: string[];
  required?: boolean;
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
    /** All authorized orgs (cached ~30s; pass `force` to bypass and re-run `sf org list`). */
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
}

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
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { SfExecutor, SfResult, SfRunOptions } from './core/sfExecutor';
import { OrgManager, OrgInfo } from './core/orgManager';
import { CliManager } from './core/cliManager';
import { SchemaManager, ApexSchema, ObjectSchema } from './core/schemaManager';
import { getWorkspaceCwd } from './core/workspace';
import { runApexTestClass, ApexTestRunOutcome, RunApexTestClassOptions } from './core/apexTestRunner';
import { scaffoldApexTestFromFile, ApexScaffoldResult } from './core/apexTestScaffold';
import { collectApexTestContext, buildApexTestPrompt, ApexStaticContext, ApexTestPrompt } from './core/apexTestContext';
import { generateApexTest, ApexGenerateResult, ApexGenerateOptions } from './core/apexTestGenerator';
import { getCoverage, ClassCoverageEntry } from './core/coverageStore';
import { TraceManager } from './core/traceManager';
import { Logger } from './core/logger';
import { AiConfig } from './core/aiConfig';

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
  /** API contract version (semver). Bump on breaking changes. */
  readonly version = '1.0.0';

  constructor(
    private readonly sfExec: SfExecutor,
    private readonly orgMgr: OrgManager,
    private readonly cliMgr: CliManager,
    private readonly schemaMgr: SchemaManager,
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
    /** All authorized orgs (cached). */
    list: (): Promise<OrgInfo[]> => this.orgMgr.listOrgs(),
    /** The default (target) org alias, if any. */
    getDefault: (): Promise<string | undefined> => this.orgMgr.getDefaultOrg(),
    /** The default org's connected username. */
    getUsername: (): Promise<string | undefined> => this.orgMgr.getUsername(),
    /** The running user's Id (005…) for the default org. */
    getUserId: (): Promise<string | undefined> => this.orgMgr.getUserId(),
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
      this.schemaMgr.describeObject(this.root(projectRoot), name, token)
  };

  // ─────────────────────────────── Coverage ───────────────────────────────
  readonly coverage = {
    /** Last recorded per-class coverage (covered/uncovered lines, percent). */
    get: (className: string, projectRoot?: string): ClassCoverageEntry | undefined => getCoverage(this.root(projectRoot), className)
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
}

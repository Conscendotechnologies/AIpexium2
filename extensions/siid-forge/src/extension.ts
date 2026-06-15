/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { Commands } from './commands';
import { Logger } from './core/logger';
import { SfExecutor } from './core/sfExecutor';
import { OrgManager } from './core/orgManager';
import { TraceManager } from './core/traceManager';
import { CliManager } from './core/cliManager';
import { SchemaManager } from './core/schemaManager';
import { FeatureContext } from './features/types';
import { registerVersion } from './features/version';
import { registerProject } from './features/project';
import { registerApex } from './features/apex';
import { registerTestClass } from './features/testClass';
import { registerLwc } from './features/lwc';
import { registerTrigger } from './features/trigger';
import { registerAura } from './features/aura';
import { registerAnonApex } from './features/anonApex';
import { registerDeploy } from './features/deploy';
import { registerRetrieve } from './features/retrieve';
import { registerDeleteSource } from './features/deleteSource';
import { registerOrg } from './features/org';
import { registerOpenOrg } from './features/openOrg';
import { registerApexTest } from './features/apexTest';
import { registerCoverageDecorations } from './features/coverageDecorations';
import { registerSoql } from './features/soql';
import { registerRetrieveMetadata } from './features/retrieveMetadata';
import { registerSchema } from './features/schema';
import { registerCompletion } from './features/completion';
import { registerSignatureHelp } from './features/signatureHelp';
import { registerParamDiagnostics } from './features/paramDiagnostics';
import { registerNavigation } from './features/navigation';
import { registerReplayDebug } from './features/replayDebug';
import { ForgeMenuProvider } from './ui/forgeMenu';

export function activate(context: vscode.ExtensionContext) {
  const logger = new Logger();
  context.subscriptions.push({ dispose: () => logger.dispose() });
  logger.info('SIID Forge activated');

  const sf = new SfExecutor(logger);
  const orgs = new OrgManager(sf, logger);
  const trace = new TraceManager(sf, logger);
  const cli = new CliManager(sf, logger);
  const schema = new SchemaManager(sf, logger);
  const deps: FeatureContext = { context, sf, logger, orgs, trace, cli, schema };

  // Wire up every feature. Adding a feature = drop a file in features/ + register here.
  registerVersion(deps);
  registerProject(deps);
  registerApex(deps);
  registerTestClass(deps);
  registerLwc(deps);
  registerTrigger(deps);
  registerAura(deps);
  registerAnonApex(deps);
  registerDeploy(deps);
  registerRetrieve(deps);
  registerDeleteSource(deps);
  registerOrg(deps);
  registerOpenOrg(deps);
  registerApexTest(deps);
  registerCoverageDecorations(deps);
  registerSoql(deps);
  registerRetrieveMetadata(deps);
  registerSchema(deps);
  registerCompletion(deps);
  registerSignatureHelp(deps);
  registerParamDiagnostics(deps);
  registerNavigation(deps);
  registerReplayDebug(deps);

  // Activity-bar menu.
  const menuProvider = new ForgeMenuProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('siidForgeMenu', menuProvider),
    vscode.commands.registerCommand(Commands.refreshMenu, () => menuProvider.refresh())
  );
}

export function deactivate() { }

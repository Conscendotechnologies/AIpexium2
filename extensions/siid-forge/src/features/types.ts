/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { SfExecutor } from '../core/sfExecutor';
import { Logger } from '../core/logger';
import { OrgManager } from '../core/orgManager';
import { TraceManager } from '../core/traceManager';
import { CliManager } from '../core/cliManager';
import { SchemaManager } from '../core/schemaManager';

/**
 * Shared dependencies handed to every feature when it registers its commands.
 */
export interface FeatureContext {
  context: vscode.ExtensionContext;
  sf: SfExecutor;
  logger: Logger;
  orgs: OrgManager;
  trace: TraceManager;
  cli: CliManager;
  schema: SchemaManager;
}

/**
 * A feature is just a function that wires up its command handlers.
 */
export type Feature = (deps: FeatureContext) => void;

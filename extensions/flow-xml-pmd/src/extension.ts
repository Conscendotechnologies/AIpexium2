/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { FlowValidator } from './validator/flowValidator';
import { RuleManager } from './rules/ruleManager';
import { DiagnosticsManager } from './diagnostics/diagnosticsManager';
import { ConfigurationManager } from './config/configurationManager';
import { CommandManager } from './commands/commandManager';
import { Logger } from './utils/logger';

let diagnosticsManager: DiagnosticsManager;
let flowValidator: FlowValidator;
let ruleManager: RuleManager;
let configManager: ConfigurationManager;
let commandManager: CommandManager;
let statusBarButton: vscode.StatusBarItem;
let logger: Logger;

export function activate(context: vscode.ExtensionContext): void {
	// Initialize logger
	logger = Logger.getInstance();
	context.subscriptions.push(logger.getOutputChannel());

	logger.info('Flow XML PMD extension is now active');

	// Initialize managers
	configManager = new ConfigurationManager();
	ruleManager = new RuleManager(context, configManager);
	diagnosticsManager = new DiagnosticsManager(context);
	flowValidator = new FlowValidator(ruleManager, diagnosticsManager, configManager);
	commandManager = new CommandManager(context, flowValidator, ruleManager, diagnosticsManager, configManager);

	logger.info('All managers initialized successfully');

	// Create status bar button
	createStatusBarButton(context);

	// Register commands
	commandManager.registerCommands();

	// Register document listeners
	registerDocumentListeners(context);

	// Validate open documents
	validateOpenDocuments();
}

export function getLogger(): Logger {
	return logger;
}

function registerDocumentListeners(context: vscode.ExtensionContext): void {
	// Validate on open
	context.subscriptions.push(
		vscode.workspace.onDidOpenTextDocument((document) => {
			if (shouldValidateDocument(document) && configManager.isValidateOnOpenEnabled()) {
				logger.info(`Validating on open: ${document.fileName}`);
				flowValidator.validateDocument(document);
			}
		})
	);

	// Validate on save
	context.subscriptions.push(
		vscode.workspace.onDidSaveTextDocument((document) => {
			if (shouldValidateDocument(document) && configManager.isValidateOnSaveEnabled()) {
				logger.info(`Validating on save: ${document.fileName}`);
				flowValidator.validateDocument(document);
			}
		})
	);

	// Clear diagnostics on close
	context.subscriptions.push(
		vscode.workspace.onDidCloseTextDocument((document) => {
			if (shouldValidateDocument(document)) {
				logger.info(`Clearing diagnostics for: ${document.fileName}`);
				diagnosticsManager.clearDiagnostics(document.uri);
			}
		})
	);

	// Validate on change (debounced)
	let changeTimeout: NodeJS.Timeout | undefined;
	context.subscriptions.push(
		vscode.workspace.onDidChangeTextDocument((event) => {
			if (shouldValidateDocument(event.document)) {
				if (changeTimeout) {
					clearTimeout(changeTimeout);
				}
				changeTimeout = setTimeout(() => {
					logger.debug(`Validating on change: ${event.document.fileName}`);
					flowValidator.validateDocument(event.document);
				}, 500); // 500ms debounce
			}
		})
	);

	// Reload rules when configuration changes
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration('flowXmlPmd')) {
				logger.info('Configuration changed, reloading rules...');
				configManager.reload();
				ruleManager.reloadRules();
				validateOpenDocuments();
			}
		})
	);
}

function shouldValidateDocument(document: vscode.TextDocument): boolean {
	// Only validate Flow XML files
	return document.languageId === 'xml' &&
		document.fileName.endsWith('.flow-meta.xml') &&
		!document.isClosed;
}

function validateOpenDocuments(): void {
	vscode.workspace.textDocuments.forEach((document) => {
		if (shouldValidateDocument(document)) {
			flowValidator.validateDocument(document);
		}
	});
}

function createStatusBarButton(context: vscode.ExtensionContext): void {
	// Create status bar item (align to right, priority 100)
	statusBarButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	statusBarButton.command = 'flowXmlPmd.validateCurrentFile';
	statusBarButton.text = '$(check) Flow PMD';
	statusBarButton.tooltip = 'Validate Flow XML (Flow XML PMD)';

	context.subscriptions.push(statusBarButton);

	logger.info('Status bar button created');

	// Update button visibility based on active editor
	updateStatusBarVisibility();

	// Listen to editor changes to show/hide button
	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(() => {
			updateStatusBarVisibility();
		})
	);
}

function updateStatusBarVisibility(): void {
	const editor = vscode.window.activeTextEditor;

	logger.debug(`Checking status bar visibility. Editor: ${editor?.document.fileName}, Language: ${editor?.document.languageId}`);

	if (editor && shouldValidateDocument(editor.document)) {
		logger.info('Showing status bar button');
		statusBarButton.show();
	} else {
		logger.debug('Hiding status bar button');
		statusBarButton.hide();
	}
}

export function deactivate(): void {
	if (diagnosticsManager) {
		diagnosticsManager.dispose();
	}
	if (statusBarButton) {
		statusBarButton.dispose();
	}
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { FlowValidator } from '../validator/flowValidator';
import { RuleManager } from '../rules/ruleManager';
import { DiagnosticsManager } from '../diagnostics/diagnosticsManager';
import { ConfigurationManager, RuleConfig } from '../config/configurationManager';

/**
 * Manages all VS Code commands for the extension
 */
export class CommandManager {
	private context: vscode.ExtensionContext;
	private flowValidator: FlowValidator;
	private ruleManager: RuleManager;
	private diagnosticsManager: DiagnosticsManager;
	private configManager: ConfigurationManager;

	constructor(
		context: vscode.ExtensionContext,
		flowValidator: FlowValidator,
		ruleManager: RuleManager,
		diagnosticsManager: DiagnosticsManager,
		configManager: ConfigurationManager
	) {
		this.context = context;
		this.flowValidator = flowValidator;
		this.ruleManager = ruleManager;
		this.diagnosticsManager = diagnosticsManager;
		this.configManager = configManager;
	}

	/**
	 * Register all commands
	 */
	public registerCommands(): void {
		this.registerCommand('flowXmlPmd.validateCurrentFile', this.validateCurrentFile.bind(this));
		this.registerCommand('flowXmlPmd.validateWorkspace', this.validateWorkspace.bind(this));
		this.registerCommand('flowXmlPmd.clearDiagnostics', this.clearDiagnostics.bind(this));
		this.registerCommand('flowXmlPmd.showRules', this.showRules.bind(this));
		this.registerCommand('flowXmlPmd.configureRules', this.configureRules.bind(this));
		this.registerCommand('flowXmlPmd.addCustomRule', this.addCustomRule.bind(this));
		this.registerCommand('flowXmlPmd.showOutputChannel', this.showOutputChannel.bind(this));
	}

	private registerCommand(command: string, callback: (...args: any[]) => any): void {
		this.context.subscriptions.push(
			vscode.commands.registerCommand(command, callback)
		);
	}

	/**
	 * Validate current file
	 */
	private async validateCurrentFile(): Promise<void> {
		const editor = vscode.window.activeTextEditor;

		if (!editor) {
			vscode.window.showWarningMessage('No active editor found');
			return;
		}

		const document = editor.document;

		if (!document.fileName.endsWith('.flow-meta.xml')) {
			vscode.window.showWarningMessage('Current file is not a Flow XML file (.flow-meta.xml)');
			return;
		}

		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: 'Validating Flow XML...',
			cancellable: false
		}, async () => {
			await this.flowValidator.validateDocument(document);
		});

		const diagnosticCount = this.diagnosticsManager.getDiagnosticCount(document.uri);

		if (diagnosticCount === 0) {
			vscode.window.showInformationMessage('✓ Flow validation completed with no issues');
		} else {
			vscode.window.showWarningMessage(`Flow validation found ${diagnosticCount} issue(s)`);
		}
	}

	/**
	 * Validate all Flow files in workspace
	 */
	private async validateWorkspace(): Promise<void> {
		const flowFiles = await vscode.workspace.findFiles('**/*.flow-meta.xml', '**/node_modules/**');

		if (flowFiles.length === 0) {
			vscode.window.showInformationMessage('No Flow XML files found in workspace');
			return;
		}

		let totalIssues = 0;

		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: 'Validating Flow XML files...',
			cancellable: false
		}, async (progress) => {
			for (let i = 0; i < flowFiles.length; i++) {
				const file = flowFiles[i];
				const document = await vscode.workspace.openTextDocument(file);

				progress.report({
					increment: (100 / flowFiles.length),
					message: `${i + 1}/${flowFiles.length}: ${file.fsPath.split(/[\\/]/).pop()}`
				});

				await this.flowValidator.validateDocument(document);
				totalIssues += this.diagnosticsManager.getDiagnosticCount(file);
			}
		});

		if (totalIssues === 0) {
			vscode.window.showInformationMessage(`✓ Validated ${flowFiles.length} Flow(s) with no issues`);
		} else {
			vscode.window.showWarningMessage(`Validated ${flowFiles.length} Flow(s) and found ${totalIssues} issue(s)`);
		}
	}

	/**
	 * Clear all diagnostics
	 */
	private clearDiagnostics(): void {
		this.diagnosticsManager.clearAll();
		vscode.window.showInformationMessage('Cleared all Flow XML PMD diagnostics');
	}

	/**
	 * Show available rules
	 */
	private async showRules(): Promise<void> {
		const categories = this.ruleManager.getRuleCategories();
		const ruleCount = this.ruleManager.getRuleCount();

		// Build quick pick items
		const items: vscode.QuickPickItem[] = [];

		// Add summary
		items.push({
			label: `📊 Rules Summary`,
			description: `${ruleCount.active}/${ruleCount.total} active (${ruleCount.default} default, ${ruleCount.custom} custom)`,
			kind: vscode.QuickPickItemKind.Separator
		});

		// Add rules by category
		for (const [category, rules] of categories) {
			items.push({
				label: category,
				kind: vscode.QuickPickItemKind.Separator
			});

			for (const rule of rules) {
				const isEnabled = this.configManager.isRuleEnabled(rule.name);
				const severity = this.configManager.getRuleSeverity(rule.name, rule.severity);
				const icon = isEnabled ? '✓' : '✗';
				const severityIcon = severity === 'error' ? '🔴' : severity === 'warning' ? '🟡' : '🔵';

				items.push({
					label: `${icon} ${rule.label}`,
					description: `${severityIcon} ${rule.name}`,
					detail: rule.description
				});
			}
		}

		const selected = await vscode.window.showQuickPick(items, {
			placeHolder: 'Browse available Flow XML PMD rules',
			matchOnDescription: true,
			matchOnDetail: true
		});

		if (selected && selected.description && selected.description.includes('active')) {
			// User clicked on summary, show configuration
			await this.configureRules();
		}
	}

	/**
	 * Configure rules interactively
	 */
	private async configureRules(): Promise<void> {
		const allRules = this.ruleManager.getAllRules();

		// Build quick pick items
		const items = allRules.map(rule => {
			const isEnabled = this.configManager.isRuleEnabled(rule.name);
			const severity = this.configManager.getRuleSeverity(rule.name, rule.severity);

			return {
				label: rule.label,
				description: `${rule.name} [${severity}]`,
				detail: rule.description,
				picked: isEnabled,
				rule: rule
			};
		});

		const selected = await vscode.window.showQuickPick(items, {
			placeHolder: 'Select rules to enable/disable',
			canPickMany: true,
			matchOnDescription: true,
			matchOnDetail: true
		});

		if (!selected) {
			return;
		}

		// Update configuration
		const rules = this.configManager.getRulesConfig();
		const selectedNames = new Set(selected.map(s => s.rule.name));

		// Update enabled status for all rules
		for (const rule of allRules) {
			const isSelected = selectedNames.has(rule.name);

			if (!rules[rule.name]) {
				rules[rule.name] = {};
			}

			rules[rule.name].enabled = isSelected;
		}

		await this.configManager.updateRulesConfig(rules);

		vscode.window.showInformationMessage(`Updated ${selected.length} rule(s)`);

		// Re-validate open documents
		for (const document of vscode.workspace.textDocuments) {
			if (document.fileName.endsWith('.flow-meta.xml')) {
				await this.flowValidator.validateDocument(document);
			}
		}
	}

	/**
	 * Add a custom rule
	 */
	private async addCustomRule(): Promise<void> {
		const workspaceFolders = vscode.workspace.workspaceFolders;

		if (!workspaceFolders || workspaceFolders.length === 0) {
			vscode.window.showErrorMessage('No workspace folder open');
			return;
		}

		// Prompt for rule name
		const ruleName = await vscode.window.showInputBox({
			prompt: 'Enter custom rule name (PascalCase, e.g., MyCustomRule)',
			placeHolder: 'MyCustomRule',
			validateInput: (value) => {
				if (!value || !/^[A-Z][a-zA-Z0-9]*$/.test(value)) {
					return 'Rule name must be in PascalCase (e.g., MyCustomRule)';
				}
				return null;
			}
		});

		if (!ruleName) {
			return;
		}

		const template = this.generateCustomRuleTemplate(ruleName);

		// Show template in new editor
		const document = await vscode.workspace.openTextDocument({
			content: template,
			language: 'typescript'
		});

		await vscode.window.showTextDocument(document);

		vscode.window.showInformationMessage(
			`Custom rule template created. Save this file to the custom rules directory configured in settings.`,
			'Open Settings'
		).then(selection => {
			if (selection === 'Open Settings') {
				vscode.commands.executeCommand('workbench.action.openSettings', 'flowXmlPmd.customRulesPath');
			}
		});
	}

	private generateCustomRuleTemplate(ruleName: string): string {
		return `/*---------------------------------------------------------------------------------------------
 *  Custom Flow XML PMD Rule: ${ruleName}
 *--------------------------------------------------------------------------------------------*/

import { Flow, Violation } from '../models/flowModels';
import { RuleBase } from '../rules/ruleBase';

/**
 * Custom rule: ${ruleName}
 *
 * TODO: Add description of what this rule checks
 */
export default class ${ruleName}Rule extends RuleBase {
	constructor() {
		super({
			name: '${ruleName}',
			label: '${ruleName.replace(/([A-Z])/g, ' $1').trim()}',
			description: 'TODO: Describe what this rule validates',
			severity: 'warning', // 'error', 'warning', or 'note'
			isConfigurable: false, // Set to true if rule accepts configuration options
			supportedTypes: ['AutoLaunchedFlow', 'Flow', 'Screen'], // Flow types this rule applies to
			docRefs: [
				// Add documentation references
				// { label: 'Salesforce Docs', url: 'https://...' }
			]
		});
	}

	protected check(flow: Flow, options: any | undefined, suppressions: Set<string>): Violation[] {
		const violations: Violation[] = [];

		// TODO: Implement your rule logic here
		// Example: Check all flow elements
		for (const element of flow.elements) {
			if (suppressions.has(element.name)) {
				continue;
			}

			// TODO: Add your validation logic
			// if (/* condition */) {
			//     violations.push(this.createViolation(
			//         element.name,
			//         element.elementType,
			//         'node',
			//         { /* additional details */ }
			//     ));
			// }
		}

		return violations;
	}
}
`;
	}

	/**
	 * Show the output channel
	 */
	private showOutputChannel(): void {
		const { Logger } = require('../utils/logger');
		Logger.getInstance().show();
	}
}

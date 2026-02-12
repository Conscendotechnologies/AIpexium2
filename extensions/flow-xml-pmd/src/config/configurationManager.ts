/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export interface RuleConfig {
	severity?: 'error' | 'warning' | 'note';
	enabled?: boolean;
	expression?: string;
	[key: string]: any;
}

export interface RulesConfig {
	[ruleName: string]: RuleConfig;
}

export interface ExceptionsConfig {
	[flowName: string]: {
		[ruleName: string]: string[];
	};
}

export class ConfigurationManager {
	private config: vscode.WorkspaceConfiguration;

	constructor() {
		this.config = vscode.workspace.getConfiguration('flowXmlPmd');
	}

	reload(): void {
		this.config = vscode.workspace.getConfiguration('flowXmlPmd');
	}

	isEnabled(): boolean {
		return this.config.get<boolean>('enabled', true);
	}

	isValidateOnOpenEnabled(): boolean {
		return this.config.get<boolean>('validateOnOpen', true);
	}

	isValidateOnSaveEnabled(): boolean {
		return this.config.get<boolean>('validateOnSave', true);
	}

	getRuleMode(): 'merged' | 'isolated' {
		return this.config.get<'merged' | 'isolated'>('ruleMode', 'merged');
	}

	getRulesConfig(): RulesConfig {
		return this.config.get<RulesConfig>('rules', {});
	}

	getExceptionsConfig(): ExceptionsConfig {
		return this.config.get<ExceptionsConfig>('exceptions', {});
	}

	getCustomRulesPath(): string {
		return this.config.get<string>('customRulesPath', '');
	}

	async updateRulesConfig(rules: RulesConfig): Promise<void> {
		await this.config.update('rules', rules, vscode.ConfigurationTarget.Workspace);
	}

	async updateRuleConfig(ruleName: string, config: RuleConfig): Promise<void> {
		const rules = this.getRulesConfig();
		rules[ruleName] = config;
		await this.updateRulesConfig(rules);
	}

	async setRuleEnabled(ruleName: string, enabled: boolean): Promise<void> {
		const rules = this.getRulesConfig();
		if (!rules[ruleName]) {
			rules[ruleName] = {};
		}
		rules[ruleName].enabled = enabled;
		await this.updateRulesConfig(rules);
	}

	async setRuleSeverity(ruleName: string, severity: 'error' | 'warning' | 'note'): Promise<void> {
		const rules = this.getRulesConfig();
		if (!rules[ruleName]) {
			rules[ruleName] = {};
		}
		rules[ruleName].severity = severity;
		await this.updateRulesConfig(rules);
	}

	getRuleConfig(ruleName: string): RuleConfig | undefined {
		const rules = this.getRulesConfig();
		return rules[ruleName];
	}

	isRuleEnabled(ruleName: string): boolean {
		const ruleConfig = this.getRuleConfig(ruleName);
		if (ruleConfig && ruleConfig.enabled !== undefined) {
			return ruleConfig.enabled;
		}
		// Default to enabled if not specified
		return true;
	}

	getRuleSeverity(ruleName: string, defaultSeverity: 'error' | 'warning' | 'note' = 'error'): 'error' | 'warning' | 'note' {
		const ruleConfig = this.getRuleConfig(ruleName);
		return ruleConfig?.severity ?? defaultSeverity;
	}

	getRuleExpression(ruleName: string): string | undefined {
		const ruleConfig = this.getRuleConfig(ruleName);
		return ruleConfig?.expression;
	}

	isFlowExcepted(flowName: string, ruleName: string, elementName?: string): boolean {
		const exceptions = this.getExceptionsConfig();
		const flowExceptions = exceptions[flowName];

		if (!flowExceptions) {
			return false;
		}

		const ruleExceptions = flowExceptions[ruleName];

		if (!ruleExceptions) {
			return false;
		}

		// Check for wildcard exception (all violations of this rule are suppressed)
		if (ruleExceptions.includes('*')) {
			return true;
		}

		// Check for specific element exception
		if (elementName && ruleExceptions.includes(elementName)) {
			return true;
		}

		return false;
	}

	getTraceLevel(): string {
		return this.config.get<string>('trace.server', 'off');
	}
}

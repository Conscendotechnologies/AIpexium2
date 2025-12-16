/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { IRule } from './ruleBase';
import { ConfigurationManager } from '../config/configurationManager';

// Import default rules
import { HardcodedIdRule } from './impl/hardcodedIdRule';
import { DMLStatementInLoopRule, SOQLQueryInLoopRule, ActionCallsInLoopRule } from './impl/loopRules';
import { FlowDescriptionRule, APIVersionRule, FlowNameRule, InactiveFlowRule, ProcessTypeRule } from './impl/metadataRules';
import {
	MissingNullHandlerRule,
	MissingFaultPathRule,
	UnconnectedElementRule,
	MissingConnectorRule,
	UnusedVariableRule,
	MissingLabelRule,
	DuplicateAPINameRule,
	FlowDepthRule,
	TooManyElementsRule,
	MissingRecordFilterRule,
	ValidationBeforeDMLRule
} from './impl/qualityRules';

/**
 * Manages all Flow PMD rules (default + custom)
 */
export class RuleManager {
	private defaultRules: Map<string, IRule> = new Map();
	private customRules: Map<string, IRule> = new Map();
	private context: vscode.ExtensionContext;
	private configManager: ConfigurationManager;

	constructor(context: vscode.ExtensionContext, configManager: ConfigurationManager) {
		this.context = context;
		this.configManager = configManager;
		this.loadDefaultRules();
		this.loadCustomRules();
	}

	/**
	 * Load all built-in default rules
	 */
	private loadDefaultRules(): void {
		const rules: IRule[] = [
			// Performance & Governor Limit Rules
			new DMLStatementInLoopRule(),
			new SOQLQueryInLoopRule(),
			new ActionCallsInLoopRule(),

			// Best Practice Rules
			new HardcodedIdRule(),
			new MissingNullHandlerRule(),
			new MissingFaultPathRule(),
			new UnconnectedElementRule(),
			new MissingConnectorRule(),
			new MissingLabelRule(),
			new DuplicateAPINameRule(),
			new MissingRecordFilterRule(),
			new ValidationBeforeDMLRule(),

			// Complexity & Maintainability Rules
			new UnusedVariableRule(),
			new FlowDepthRule(),
			new TooManyElementsRule(),


			// Metadata Rules
			new FlowDescriptionRule(),
			new APIVersionRule(),
			new FlowNameRule(),
			new InactiveFlowRule(),
			new ProcessTypeRule()
		];

		for (const rule of rules) {
			this.defaultRules.set(rule.name, rule);
		}

		console.log(`Loaded ${this.defaultRules.size} default Flow PMD rules`);
	}

	/**
	 * Load custom rules from workspace
	 */
	private loadCustomRules(): void {
		this.customRules.clear();

		const customRulesPath = this.configManager.getCustomRulesPath();
		if (!customRulesPath) {
			return;
		}

		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			return;
		}

		const absolutePath = path.join(workspaceFolders[0].uri.fsPath, customRulesPath);

		if (!fs.existsSync(absolutePath)) {
			console.warn(`Custom rules path not found: ${absolutePath}`);
			return;
		}

		try {
			const files = fs.readdirSync(absolutePath);

			for (const file of files) {
				if (file.endsWith('.js') || file.endsWith('.ts')) {
					try {
						const rulePath = path.join(absolutePath, file);
						// Dynamic import of custom rule
						// Note: This requires the custom rule to export a default class that implements IRule
						const ruleModule = require(rulePath);
						const RuleClass = ruleModule.default || ruleModule;

						if (typeof RuleClass === 'function') {
							const ruleInstance = new RuleClass() as IRule;
							this.customRules.set(ruleInstance.name, ruleInstance);
							console.log(`Loaded custom rule: ${ruleInstance.name}`);
						}
					} catch (error) {
						console.error(`Error loading custom rule from ${file}:`, error);
					}
				}
			}

			console.log(`Loaded ${this.customRules.size} custom Flow PMD rules`);
		} catch (error) {
			console.error(`Error reading custom rules directory:`, error);
		}
	}

	/**
	 * Reload all rules
	 */
	public reloadRules(): void {
		this.loadDefaultRules();
		this.loadCustomRules();
	}

	/**
	 * Get all available rules (default + custom)
	 */
	public getAllRules(): IRule[] {
		const allRules = new Map<string, IRule>();

		// Add default rules
		for (const [name, rule] of this.defaultRules) {
			allRules.set(name, rule);
		}

		// Add/override with custom rules
		for (const [name, rule] of this.customRules) {
			allRules.set(name, rule);
		}

		return Array.from(allRules.values());
	}

	/**
	 * Get active rules based on configuration
	 */
	public getActiveRules(): IRule[] {
		const allRules = this.getAllRules();
		const ruleMode = this.configManager.getRuleMode();

		if (ruleMode === 'isolated') {
			// Only return rules that are explicitly configured
			const configuredRuleNames = Object.keys(this.configManager.getRulesConfig());
			return allRules.filter(rule => configuredRuleNames.includes(rule.name));
		} else {
			// Merged mode: return all rules unless explicitly disabled
			return allRules.filter(rule => this.configManager.isRuleEnabled(rule.name));
		}
	}

	/**
	 * Get a specific rule by name
	 */
	public getRule(name: string): IRule | undefined {
		// Check custom rules first (they can override default rules)
		if (this.customRules.has(name)) {
			return this.customRules.get(name);
		}

		return this.defaultRules.get(name);
	}

	/**
	 * Check if a rule exists
	 */
	public hasRule(name: string): boolean {
		return this.defaultRules.has(name) || this.customRules.has(name);
	}

	/**
	 * Get rule categories for UI display
	 */
	public getRuleCategories(): Map<string, IRule[]> {
		const categories = new Map<string, IRule[]>();

		const allRules = this.getAllRules();

		// Categorize rules based on naming patterns
		for (const rule of allRules) {
			let category = 'Other';

			if (rule.name.includes('Loop')) {
				category = 'Performance & Governor Limits';
			} else if (rule.name.includes('Missing') || rule.name.includes('Unconnected')) {
				category = 'Quality & Maintenance';
			} else if (rule.name.includes('Hardcoded') || rule.name.includes('Unsafe')) {
				category = 'Security & Best Practices';
			} else if (rule.name.includes('Flow') || rule.name.includes('API')) {
				category = 'Metadata & Documentation';
			}

			if (!categories.has(category)) {
				categories.set(category, []);
			}

			categories.get(category)!.push(rule);
		}

		return categories;
	}

	/**
	 * Get total rule count
	 */
	public getRuleCount(): { total: number; default: number; custom: number; active: number } {
		return {
			total: this.defaultRules.size + this.customRules.size,
			default: this.defaultRules.size,
			custom: this.customRules.size,
			active: this.getActiveRules().length
		};
	}
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { FlowXMLParser } from '../parser/flowXMLParser';
import { RuleManager } from '../rules/ruleManager';
import { DiagnosticsManager } from '../diagnostics/diagnosticsManager';
import { ConfigurationManager } from '../config/configurationManager';
import { Flow, RuleResult, ScanResult, Violation } from '../models/flowModels';
import { Logger } from '../utils/logger';

/**
 * Main validator class that coordinates parsing and rule execution
 */
export class FlowValidator {
	private parser: FlowXMLParser;
	private ruleManager: RuleManager;
	private diagnosticsManager: DiagnosticsManager;
	private configManager: ConfigurationManager;
	private logger: Logger;

	constructor(
		ruleManager: RuleManager,
		diagnosticsManager: DiagnosticsManager,
		configManager: ConfigurationManager
	) {
		this.parser = new FlowXMLParser();
		this.ruleManager = ruleManager;
		this.diagnosticsManager = diagnosticsManager;
		this.configManager = configManager;
		this.logger = Logger.getInstance();
	}

	/**
	 * Validate a text document
	 */
	public async validateDocument(document: vscode.TextDocument): Promise<void> {
		this.logger.info(`Starting validation for: ${document.fileName}`);

		if (!this.configManager.isEnabled()) {
			this.logger.warn('Flow XML PMD is disabled in configuration');
			return;
		}

		try {
			this.logger.debug('Parsing Flow XML...');
			// Parse the Flow XML
			const flow = this.parser.parse(document.getText());

			if (!flow) {
				this.logger.error(`Failed to parse Flow XML: ${document.uri.fsPath}`);
				return;
			}

			this.logger.debug(`Flow parsed successfully. Type: ${flow.processType}, Label: ${flow.label}`);

			// Set flow name from filename if not present
			if (!flow.fullName) {
				const fileName = document.fileName.split(/[\\/]/).pop() || '';
				flow.fullName = fileName.replace('.flow-meta.xml', '');
			}

			this.logger.info(`Flow name: ${flow.fullName}, Elements: ${flow.elements.length}`);

			// Run validation
			const scanResult = this.scan(flow, document.getText());

			// Update diagnostics
			this.diagnosticsManager.updateDiagnostics(document.uri, scanResult, document.getText());

		} catch (error) {
			this.logger.error(`Error validating Flow document:`, error as Error);
		}
	}

	/**
	 * Scan a flow with all active rules
	 */
	private scan(flow: Flow, xmlContent: string): ScanResult {
		const ruleResults: RuleResult[] = [];
		const activeRules = this.ruleManager.getActiveRules();

		this.logger.info(`Running ${activeRules.length} active rules`);

		for (const rule of activeRules) {
			try {
				this.logger.debug(`Executing rule: ${rule.name}`);

				// Check if flow type is supported by this rule
				if (flow.processType && !rule.supportedTypes.includes(flow.processType)) {
					this.logger.debug(`Skipping rule ${rule.name} - unsupported flow type: ${flow.processType}`);
					continue;
				}

				// Get rule configuration
				const ruleConfig = this.configManager.getRuleConfig(rule.name);
				const options = ruleConfig || {};

				// Get exceptions for this flow
				const exceptions = this.configManager.getExceptionsConfig();
				const flowExceptions = exceptions[flow.fullName || '']?.[rule.name] || [];

				// Execute rule
				const violations = rule.execute(flow, options, flowExceptions);

				this.logger.debug(`Rule ${rule.name} found ${violations.length} violations`);

				if (violations.length > 0) {
					this.logger.info(`Rule ${rule.name}: ${violations.length} violation(s) - ${violations.map(v => v.name).join(', ')}`);
				}

				// Enrich violations with line numbers
				const enrichedViolations = this.enrichViolationsWithLineNumbers(violations, xmlContent);

				// Get severity from configuration
				const severity = this.configManager.getRuleSeverity(rule.name, rule.severity);

				// Create rule result
				const ruleResult: RuleResult = {
					ruleName: rule.name,
					occurs: enrichedViolations.length > 0,
					details: enrichedViolations,
					severity: severity
				};

				ruleResults.push(ruleResult);

			} catch (error) {
				this.logger.error(`Error executing rule ${rule.name}:`, error as Error);

				// Add error result
				ruleResults.push({
					ruleName: rule.name,
					occurs: false,
					details: [],
					severity: rule.severity,
					errorMessage: `Rule execution failed: ${error}`
				});
			}
		}

		const totalViolations = ruleResults.reduce((sum, result) => sum + result.details.length, 0);
		this.logger.info(`Scan complete: ${totalViolations} total violation(s) found across ${ruleResults.filter(r => r.occurs).length} rule(s)`);

		return {
			flow,
			ruleResults
		};
	}

	/**
	 * Enrich violations with actual line numbers from XML
	 */
	private enrichViolationsWithLineNumbers(violations: Violation[], xmlContent: string): Violation[] {
		const lines = xmlContent.split('\n');

		for (const violation of violations) {
			// Try to find the line number based on the element name
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];

				// Look for element with name attribute matching violation name
				if (line.includes(`<name>${violation.name}</name>`)) {
					violation.lineNumber = i + 1;
					violation.columnNumber = line.indexOf(`<name>${violation.name}</name>`) + 1;
					break;
				}

				// Look for element name in tag
				if (line.includes(`name="${violation.name}"`)) {
					violation.lineNumber = i + 1;
					violation.columnNumber = line.indexOf(`name="${violation.name}"`) + 1;
					break;
				}

				// For attribute violations
				if (violation.metaType === 'attribute' && violation.details?.property) {
					const property = violation.details.property;
					if (line.includes(`<${property}>`) || line.includes(`${property}=`)) {
						violation.lineNumber = i + 1;
						violation.columnNumber = line.indexOf(property) + 1;
						break;
					}
				}
			}

			// Default to line 1 if not found
			if (violation.lineNumber === 0) {
				violation.lineNumber = 1;
				violation.columnNumber = 1;
			}
		}

		return violations;
	}

	/**
	 * Get scan summary
	 */
	public getScanSummary(scanResult: ScanResult): {
		flowName: string;
		totalViolations: number;
		errorCount: number;
		warningCount: number;
		noteCount: number;
		rulesExecuted: number;
	} {
		let totalViolations = 0;
		let errorCount = 0;
		let warningCount = 0;
		let noteCount = 0;

		for (const result of scanResult.ruleResults) {
			if (result.occurs) {
				totalViolations += result.details.length;

				switch (result.severity) {
					case 'error':
						errorCount += result.details.length;
						break;
					case 'warning':
						warningCount += result.details.length;
						break;
					case 'note':
						noteCount += result.details.length;
						break;
				}
			}
		}

		return {
			flowName: scanResult.flow.fullName || 'Unknown',
			totalViolations,
			errorCount,
			warningCount,
			noteCount,
			rulesExecuted: scanResult.ruleResults.length
		};
	}
}

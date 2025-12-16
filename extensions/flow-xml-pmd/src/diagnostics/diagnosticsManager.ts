/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ScanResult, RuleResult, Violation } from '../models/flowModels';
import { Logger } from '../utils/logger';

/**
 * Manages VS Code diagnostics for Flow PMD violations
 */
export class DiagnosticsManager {
	private diagnosticCollection: vscode.DiagnosticCollection;
	private logger: Logger;

	constructor(context: vscode.ExtensionContext) {
		this.diagnosticCollection = vscode.languages.createDiagnosticCollection('flowXmlPmd');
		context.subscriptions.push(this.diagnosticCollection);
		this.logger = Logger.getInstance();
	}

	/**
	 * Update diagnostics for a document
	 */
	public updateDiagnostics(uri: vscode.Uri, scanResult: ScanResult, xmlContent: string): void {
		this.logger.info(`Updating diagnostics for ${uri.fsPath}`);

		// Clear existing diagnostics first to prevent duplicates
		this.diagnosticCollection.delete(uri);
		this.logger.debug('Cleared existing diagnostics');

		const diagnostics: vscode.Diagnostic[] = [];

		for (const ruleResult of scanResult.ruleResults) {
			if (!ruleResult.occurs) {
				continue;
			}

			this.logger.debug(`Processing ${ruleResult.details.length} violations for rule: ${ruleResult.ruleName}`);

			for (const violation of ruleResult.details) {
				const diagnostic = this.createDiagnostic(violation, ruleResult, xmlContent);
				diagnostics.push(diagnostic);
				this.logger.debug(`Created diagnostic: ${ruleResult.ruleName} at line ${violation.lineNumber} - ${violation.name}`);
			}
		}

		this.logger.info(`Setting ${diagnostics.length} diagnostic(s) for ${uri.fsPath}`);
		this.diagnosticCollection.set(uri, diagnostics);

		if (diagnostics.length === 0) {
			this.logger.warn('No diagnostics were created - check if violations have line numbers');
		}
	}

	/**
	 * Create a VS Code diagnostic from a violation
	 */
	private createDiagnostic(violation: Violation, ruleResult: RuleResult, xmlContent: string): vscode.Diagnostic {
		// Create range
		const range = this.createRange(violation, xmlContent);

		// Create diagnostic
		const message = this.createMessage(violation, ruleResult);
		const severity = this.mapSeverity(ruleResult.severity);

		const diagnostic = new vscode.Diagnostic(range, message, severity);
		diagnostic.source = 'Flow XML PMD';
		diagnostic.code = ruleResult.ruleName;

		return diagnostic;
	}

	/**
	 * Create a range for the violation
	 */
	private createRange(violation: Violation, xmlContent: string): vscode.Range {
		const lines = xmlContent.split('\n');
		const lineIndex = Math.max(0, violation.lineNumber - 1);

		if (lineIndex >= lines.length) {
			return new vscode.Range(0, 0, 0, 0);
		}

		const line = lines[lineIndex];
		const startChar = violation.columnNumber > 0 ? violation.columnNumber - 1 : 0;

		// Try to find the end of the violation (e.g., end of element name or value)
		let endChar = startChar;

		// If we have details about what to highlight
		if (violation.details) {
			if (violation.details.expression || violation.details.value) {
				const searchStr = violation.details.expression || violation.details.value;
				const index = line.indexOf(searchStr, startChar);
				if (index >= 0) {
					endChar = index + searchStr.length;
				}
			} else if (violation.name) {
				const index = line.indexOf(violation.name, startChar);
				if (index >= 0) {
					endChar = index + violation.name.length;
				}
			}
		}

		// Default to highlighting the entire element name
		if (endChar === startChar) {
			const nameMatch = line.substring(startChar).match(/^[a-zA-Z_][\w]*/);
			if (nameMatch) {
				endChar = startChar + nameMatch[0].length;
			} else {
				endChar = Math.min(startChar + 20, line.length); // Default length
			}
		}

		return new vscode.Range(
			new vscode.Position(lineIndex, startChar),
			new vscode.Position(lineIndex, endChar)
		);
	}

	/**
	 * Create diagnostic message
	 */
	private createMessage(violation: Violation, ruleResult: RuleResult): string {
		let message = `[${ruleResult.ruleName}] `;

		// Build message based on violation type
		if (violation.metaType === 'attribute') {
			message += `Flow ${violation.details?.property || 'property'}`;
			if (violation.details?.value) {
				message += ` = '${violation.details.value}'`;
			}
			if (violation.details?.expected) {
				message += ` (expected: ${violation.details.expected})`;
			}
		} else {
			message += `Element '${violation.name}' (${violation.type})`;
		}

		// Add specific details based on rule type
		if (violation.details) {
			if (violation.details.inLoop) {
				message += ' is inside a loop';
			} else if (violation.details.missingNullCheck) {
				message += ' is missing null handler';
			} else if (violation.details.missingFaultPath) {
				message += ' is missing fault path';
			} else if (violation.details.unconnected) {
				message += ' is not connected to the flow';
			} else if (violation.details.filter || violation.details.field) {
				message += ` contains hardcoded ID`;
			}
		}

		return message;
	}

	/**
	 * Map our severity to VS Code severity
	 */
	private mapSeverity(severity: string): vscode.DiagnosticSeverity {
		switch (severity) {
			case 'error':
				return vscode.DiagnosticSeverity.Error;
			case 'warning':
				return vscode.DiagnosticSeverity.Warning;
			case 'note':
				return vscode.DiagnosticSeverity.Information;
			default:
				return vscode.DiagnosticSeverity.Warning;
		}
	}

	/**
	 * Clear diagnostics for a document
	 */
	public clearDiagnostics(uri: vscode.Uri): void {
		this.diagnosticCollection.delete(uri);
	}

	/**
	 * Clear all diagnostics
	 */
	public clearAll(): void {
		this.diagnosticCollection.clear();
	}

	/**
	 * Get diagnostic count for a document
	 */
	public getDiagnosticCount(uri: vscode.Uri): number {
		const diagnostics = this.diagnosticCollection.get(uri);
		return diagnostics ? diagnostics.length : 0;
	}

	/**
	 * Get all diagnostics
	 */
	public getAllDiagnostics(): [vscode.Uri, vscode.Diagnostic[]][] {
		const result: [vscode.Uri, vscode.Diagnostic[]][] = [];

		this.diagnosticCollection.forEach((uri, diagnostics) => {
			result.push([uri, [...diagnostics]]);
		});

		return result;
	}

	/**
	 * Dispose the diagnostic collection
	 */
	public dispose(): void {
		this.diagnosticCollection.dispose();
	}
}

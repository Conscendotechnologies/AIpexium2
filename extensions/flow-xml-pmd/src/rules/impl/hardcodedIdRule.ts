/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Flow, Violation } from '../../models/flowModels';
import { RuleBase } from '../ruleBase';

/**
 * Rule: Detects hardcoded Salesforce IDs in Flow elements
 *
 * Based on: https://github.com/Flow-Scanner/lightning-flow-scanner/blob/main/packages/core/src/main/rules/HardcodedId.ts
 */
export class HardcodedIdRule extends RuleBase {
	// Regex patterns for 15 and 18 character Salesforce IDs
	private readonly ID_PATTERN_15 = /\b[a-zA-Z0-9]{15}\b/g;
	private readonly ID_PATTERN_18 = /\b[a-zA-Z0-9]{18}\b/g;

	constructor() {
		super({
			name: 'HardcodedId',
			label: 'Hardcoded Salesforce ID',
			description: 'Avoid hard-coding IDs because they are org specific. Instead, pass them into variables at the start of the flow—via merge-field URL parameters or a Get Records element.',
			severity: 'error',
			docRefs: [
				{
					label: 'Flow Best Practices',
					url: 'https://help.salesforce.com/s/articleView?id=sf.flow_prep_bestpractices.htm&type=5'
				}
			]
		});
	}

	protected check(flow: Flow, options: any | undefined, suppressions: Set<string>): Violation[] {
		const violations: Violation[] = [];

		// Check variables, formulas, constants
		const allVariables = [
			...flow.variables,
			...flow.formulas,
			...flow.constants,
			...flow.textTemplates
		];

		for (const variable of allVariables) {
			if (suppressions.has(variable.name)) {
				continue;
			}

			// Check expression (for formulas)
			if (variable.expression && this.containsHardcodedId(variable.expression)) {
				violations.push(this.createViolation(
					variable.name,
					'formula',
					'formula',
					{ expression: variable.expression }
				));
			}

			// Check default value
			if (variable.defaultValue && typeof variable.defaultValue === 'string' && this.containsHardcodedId(variable.defaultValue)) {
				violations.push(this.createViolation(
					variable.name,
					'variable',
					'variable',
					{ defaultValue: variable.defaultValue }
				));
			}

			// Check value (for constants)
			if (variable.value && typeof variable.value === 'string' && this.containsHardcodedId(variable.value)) {
				violations.push(this.createViolation(
					variable.name,
					'constant',
					'constant',
					{ value: variable.value }
				));
			}
		}

		// Check flow elements
		for (const element of flow.elements) {
			if (suppressions.has(element.name)) {
				continue;
			}

			// Check Get Records filters
			if (element.elementType === 'recordLookups' && element.filters) {
				for (const filter of element.filters) {
					if (filter.value && typeof filter.value === 'string' && this.containsHardcodedId(filter.value)) {
						violations.push(this.createViolation(
							element.name,
							element.elementType,
							'node',
							{ filter: filter.field, value: filter.value }
						));
					}
				}
			}

			// Check Record Creates/Updates input assignments
			if ((element.elementType === 'recordCreates' || element.elementType === 'recordUpdates') && element.inputAssignments) {
				for (const assignment of element.inputAssignments) {
					if (assignment.value && typeof assignment.value === 'string' && this.containsHardcodedId(assignment.value)) {
						violations.push(this.createViolation(
							element.name,
							element.elementType,
							'node',
							{ field: assignment.field, value: assignment.value }
						));
					}
				}
			}

			// Check Assignments
			if (element.elementType === 'assignments' && element.assignmentItems) {
				for (const item of element.assignmentItems) {
					if (item.value && typeof item.value === 'string' && this.containsHardcodedId(item.value)) {
						violations.push(this.createViolation(
							element.name,
							element.elementType,
							'node',
							{ assignToReference: item.assignToReference, value: item.value }
						));
					}
				}
			}

			// Check Decision conditions
			if (element.elementType === 'decisions' && element.rules) {
				for (const rule of element.rules) {
					if (rule.conditions) {
						for (const condition of rule.conditions) {
							if (condition.rightValue && typeof condition.rightValue === 'string' && this.containsHardcodedId(condition.rightValue)) {
								violations.push(this.createViolation(
									element.name,
									element.elementType,
									'node',
									{ rule: rule.name, condition: condition.leftValueReference, value: condition.rightValue }
								));
							}
						}
					}
				}
			}
		}

		return violations;
	}

	private containsHardcodedId(value: string): boolean {
		// Check for 15-character IDs
		if (this.ID_PATTERN_15.test(value)) {
			return true;
		}

		// Check for 18-character IDs
		if (this.ID_PATTERN_18.test(value)) {
			return true;
		}

		return false;
	}
}

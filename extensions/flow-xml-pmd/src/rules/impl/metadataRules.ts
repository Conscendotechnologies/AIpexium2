/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Flow, Violation } from '../../models/flowModels';
import { RuleBase } from '../ruleBase';

/**
 * Rule: Checks for missing flow description
 *
 * Based on: https://github.com/Flow-Scanner/lightning-flow-scanner/blob/main/packages/core/src/main/rules/FlowDescription.ts
 */
export class FlowDescriptionRule extends RuleBase {
	constructor() {
		super({
			name: 'FlowDescription',
			label: 'Missing Flow Description',
			description: 'Descriptions play a vital role in documentation. It is highly recommended to include details about where a flow is used and its intended purpose.',
			severity: 'error',
			docRefs: []
		});
	}

	protected check(flow: Flow, options: any | undefined, suppressions: Set<string>): Violation[] {
		if (flow.description && flow.description.trim().length > 0) {
			return [];
		}

		return [
			this.createViolation(
				flow.fullName || 'Flow',
				'Flow',
				'attribute',
				{
					property: 'description',
					expected: '!== null',
					message: `Flow '${flow.fullName}' is missing a description. Add a clear description to help other developers understand the flow's purpose and business logic.`
				}
			)
		];
	}
}

/**
 * Rule: Checks API version
 *
 * Based on: https://github.com/Flow-Scanner/lightning-flow-scanner/blob/main/packages/core/src/main/rules/APIVersion.ts
 */
export class APIVersionRule extends RuleBase {
	constructor() {
		super({
			name: 'APIVersion',
			label: 'Outdated API Version',
			description: 'Introducing newer API components may lead to unexpected issues with older versions of Flows. It is strongly advised to regularly update and maintain API versions.',
			severity: 'warning',
			isConfigurable: true,
			docRefs: [
				{
					label: 'API Versioning',
					url: 'https://developer.salesforce.com/docs/atlas.en-us.api.meta/api/api_versioning.htm'
				}
			]
		});
	}

	protected check(flow: Flow, options: any | undefined, suppressions: Set<string>): Violation[] {
		const apiVersion = flow.apiVersion ? parseFloat(flow.apiVersion) : null;

		// No API version
		if (!apiVersion) {
			return [
				this.createViolation(
					flow.fullName || 'Flow',
					'Flow',
					'attribute',
					{
						property: 'apiVersion',
						value: 'missing',
						expected: '>= 49',
						message: `Flow '${flow.fullName}' has no API version specified. Using an outdated API version can cause compatibility issues. Update to API version 49 or later.`
					}
				)
			];
		}

		// Check custom expression if provided
		if (options?.expression) {
			const expression = options.expression as string;
			const match = expression.match(/^\s*(>=|<=|>|<|===|!==)\s*(\d+)\s*$/);

			if (!match) {
				return [
					this.createViolation(
						flow.fullName || 'Flow',
						'Flow',
						'attribute',
						{
							property: 'apiVersion',
							value: apiVersion,
							error: 'Invalid expression format',
							message: `Invalid API version rule expression: "${expression}". Use format like ">= 49" or "<= 60".`
						}
					)
				];
			}

			const operator = match[1];
			const threshold = parseFloat(match[2]);

			let violates = false;
			switch (operator) {
				case '>=':
					violates = apiVersion < threshold;
					break;
				case '<=':
					violates = apiVersion > threshold;
					break;
				case '>':
					violates = apiVersion <= threshold;
					break;
				case '<':
					violates = apiVersion >= threshold;
					break;
				case '===':
					violates = apiVersion !== threshold;
					break;
				case '!==':
					violates = apiVersion === threshold;
					break;
			}

			if (violates) {
				return [
					this.createViolation(
						flow.fullName || 'Flow',
						'Flow',
						'attribute',
						{
							property: 'apiVersion',
							value: apiVersion,
							expected: expression,
							message: `Flow '${flow.fullName}' API version ${apiVersion} does not meet the requirement ${expression}. Update the API version to match your organization's standards.`
						}
					)
				];
			}
		}

		return [];
	}
}

/**
 * Rule: Checks flow naming convention
 *
 * Based on: https://github.com/Flow-Scanner/lightning-flow-scanner/blob/main/packages/core/src/main/rules/FlowName.ts
 */
export class FlowNameRule extends RuleBase {
	constructor() {
		super({
			name: 'FlowName',
			label: 'Flow Naming Convention',
			description: 'The readability of a flow is paramount. Establishing a naming convention significantly enhances findability, searchability, and overall consistency.',
			severity: 'error',
			isConfigurable: true,
			docRefs: []
		});
	}

	protected check(flow: Flow, options: any | undefined, suppressions: Set<string>): Violation[] {
		const flowName = flow.fullName || '';

		// Check if expression is provided
		if (options?.expression) {
			try {
				const regex = new RegExp(options.expression as string);
				if (!regex.test(flowName)) {
					return [
						this.createViolation(
							flowName,
							'Flow',
							'attribute',
							{
								property: 'name',
								value: flowName,
								expected: options.expression,
								message: `Flow name '${flowName}' does not match naming convention '${options.expression}'. Use consistent naming for better findability and searchability.`
							}
						)
					];
				}
			} catch (error) {
				// Invalid regex
				return [
					this.createViolation(
						flowName,
						'Flow',
						'attribute',
						{
							property: 'name',
							value: flowName,
							error: 'Invalid regex expression',
							message: `Invalid naming convention regex pattern: "${options.expression}". Check the pattern syntax.`
						}
					)
				];
			}
		}

		return [];
	}
}

/**
 * Rule: Checks for inactive flows
 *
 * Based on: https://github.com/Flow-Scanner/lightning-flow-scanner/blob/main/packages/core/src/main/rules/InactiveFlow.ts
 */
export class InactiveFlowRule extends RuleBase {
	constructor() {
		super({
			name: 'InactiveFlow',
			label: 'Inactive Flow',
			description: 'Like cleaning out your closet: deleting unused flows is essential. Inactive flows can still cause trouble—such as accidentally deleting records during testing.',
			severity: 'warning',
			docRefs: []
		});
	}

	protected check(flow: Flow, options: any | undefined, suppressions: Set<string>): Violation[] {
		if (flow.status !== 'Active') {
			return [
				this.createViolation(
					flow.fullName || 'Flow',
					'Flow',
					'attribute',
					{
						property: 'status',
						value: flow.status,
						expected: 'Active',
						message: `Flow '${flow.fullName}' is not active (current status: ${flow.status}). Inactive flows can cause unintended behavior. Activate the flow or delete it if no longer needed.`
					}
				)
			];
		}

		return [];
	}
}

/**
 * Rule: Checks for valid processType value
 * Validates that the processType matches one of the allowed FlowProcessType enumeration values
 */
export class ProcessTypeRule extends RuleBase {
	private static readonly VALID_PROCESS_TYPES = new Set([
		'AutoLaunchedFlow',
		'Flow',
		'Workflow',
		'CustomEvent',
		'InvocableProcess',
		'LoginFlow',
		'ActionPlan',
		'JourneyBuilderIntegration',
		'UserProvisioningFlow',
		'Survey',
		'SurveyEnrich',
		'Appointments',
		'FSCLending',
		'DigitalForm',
		'FieldServiceMobile',
		'OrchestrationFlow',
		'FieldServiceWeb',
		'TransactionSecurityFlow',
		'ContactRequestFlow',
		'ManagedContentFlow',
		'CheckoutFlow',
		'CartAsyncFlow',
		'DataCaptureFlow',
		'CustomerLifecycle',
		'Journey',
		'RecommendationStrategy',
		'Orchestrator',
		'RoutingFlow',
		'ServiceCatalogItemFlow',
		'EvaluationFlow',
		'LoyaltyManagementFlow',
		'ManagedContentAuthoringWorkflow',
		'ActionCadenceAutolaunchedFlow',
		'ActionCadenceStepFlow',
		'IndicatorResultFlow',
		'IndividualObjectLinkingFlow',
		'PromptFlow',
		'ApprovalWorkflow',
		'DcvrFrameworkDataCaptureFlow',
		'ActivityObjectMatchingFlow',
		'ActionableEventManagementFlow',
		'StageManagementEvaluationFlow',
		'IdentityUserRegistrationFlow',
		'AgxBackgroundFlow',
		'AgxScreenDataFlow',
		'AgxScreenFlow',
		'AgxOrchestrationFlow'
	]);

	constructor() {
		super({
			name: 'ProcessType',
			label: 'Invalid Process Type',
			description: 'The processType must be a valid FlowProcessType enumeration value. Use "Flow" for screen flows and "AutoLaunchedFlow" for record-triggered flows.',
			severity: 'error',
			docRefs: [
				{
					label: 'Salesforce Flow Metadata API',
					url: 'https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_visual_workflow.htm'
				}
			]
		});
	}

	protected check(flow: Flow, options: any | undefined, suppressions: Set<string>): Violation[] {
		const processType = flow.processType;

		// Check if processType is missing
		if (!processType) {
			return [
				this.createViolation(
					flow.fullName || 'Flow',
					'Flow',
					'attribute',
					{
						property: 'processType',
						value: 'missing',
						expected: 'One of: Flow (screen flows), AutoLaunchedFlow (record-triggered flows), or other valid FlowProcessType value',
						message: 'processType is required'
					}
				)
			];
		}

		// Check if processType is valid
		if (!ProcessTypeRule.VALID_PROCESS_TYPES.has(processType)) {
			let suggestion = '';

			// Provide helpful suggestions based on common scenarios
			if (flow.interactionType === 'Screen') {
				suggestion = ' Use "Flow" for screen flows.';
			} else if (flow.start?.triggerType === 'RecordAfterSave' || flow.start?.triggerType === 'RecordBeforeSave') {
				suggestion = ' Use "AutoLaunchedFlow" for record-triggered flows.';
			} else {
				suggestion = ' Common values: "Flow" (screen flows), "AutoLaunchedFlow" (record-triggered flows).';
			}

			return [
				this.createViolation(
					flow.fullName || 'Flow',
					'Flow',
					'attribute',
					{
						property: 'processType',
						value: processType,
						expected: 'Valid FlowProcessType enumeration value',
						message: `Invalid processType: "${processType}".${suggestion}`
					}
				)
			];
		}

		return [];
	}
}

/**
 * Rule: Validates FlowAssignmentOperator values
 * Checks that assignment operators in Assignment elements use valid enumeration values
 */
export class FlowAssignmentOperatorRule extends RuleBase {
	private static readonly VALID_OPERATORS = new Set([
		'None',
		'Assign',
		'Add',
		'Subtract',
		'AddItem',
		'RemoveFirst',
		'RemoveBeforeFirst',
		'RemoveAfterFirst',
		'RemoveAll',
		'AddAtStart',
		'RemoveUncommon',
		'AssignCount',
		'RemovePosition'
	]);

	constructor() {
		super({
			name: 'FlowAssignmentOperator',
			label: 'Invalid Assignment Operator',
			description: 'Assignment operators must be valid FlowAssignmentOperator enumeration values. Using invalid operators will cause flow deployment errors.',
			severity: 'error',
			docRefs: [
				{
					label: 'Salesforce Flow Metadata API',
					url: 'https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_visual_workflow.htm'
				}
			]
		});
	}

	protected check(flow: Flow, options: any | undefined, suppressions: Set<string>): Violation[] {
		const violations: Violation[] = [];

		// Find all assignment elements
		const assignmentElements = flow.elements.filter(e => e.elementType === 'assignments');

		for (const element of assignmentElements) {
			if (this.isSuppressed(element.name, suppressions)) {
				continue;
			}

			// Check each assignment item within the element
			if (element.assignmentItems) {
				for (let i = 0; i < element.assignmentItems.length; i++) {
					const item = element.assignmentItems[i];
					const operator = item.operator;

					if (!operator) {
						violations.push(
							this.createViolation(
								element.name,
								'Assignment',
								'node',
								{
									property: 'operator',
									value: 'missing',
									expected: 'Valid FlowAssignmentOperator value',
									message: `Assignment element '${element.name}' is missing an operator. Specify a valid operator like 'Assign', 'Add', 'AddItem', etc.`,
									assignmentIndex: i
								}
							)
						);
					} else if (!FlowAssignmentOperatorRule.VALID_OPERATORS.has(operator)) {
						const suggestion = this.getSuggestion(operator, Array.from(FlowAssignmentOperatorRule.VALID_OPERATORS));
						violations.push(
							this.createViolation(
								element.name,
								'Assignment',
								'node',
								{
									property: 'operator',
									value: operator,
									expected: 'Valid FlowAssignmentOperator value',
									message: `Assignment element '${element.name}' has invalid operator '${operator}'.${suggestion}`,
									assignmentIndex: i
								}
							)
						);
					}
				}
			}
		}

		return violations;
	}

	private getSuggestion(invalid: string, valid: string[]): string {
		// Simple fuzzy matching for suggestions
		const lower = invalid.toLowerCase();
		const suggestions = valid.filter(v => v.toLowerCase().includes(lower) || lower.includes(v.toLowerCase()));
		if (suggestions.length > 0) {
			return ` Did you mean: ${suggestions.slice(0, 3).join(', ')}?`;
		}
		return ` Valid operators: ${valid.slice(0, 5).join(', ')}, etc.`;
	}
}

/**
 * Rule: Validates FlowComparisonOperator values
 * Checks that comparison operators in Decision conditions use valid enumeration values
 */
export class FlowComparisonOperatorRule extends RuleBase {
	private static readonly VALID_OPERATORS = new Set([
		'None',
		'EqualTo',
		'NotEqualTo',
		'GreaterThan',
		'LessThan',
		'GreaterThanOrEqualTo',
		'LessThanOrEqualTo',
		'StartsWith',
		'EndsWith',
		'Contains',
		'IsNull',
		'IsChanged',
		'WasSet',
		'WasSelected',
		'WasVisited',
		'In',
		'NotIn',
		'IsBlank',
		'IsEmpty',
		'HasError'
	]);

	constructor() {
		super({
			name: 'FlowComparisonOperator',
			label: 'Invalid Comparison Operator',
			description: 'Comparison operators in Decision elements must be valid FlowComparisonOperator enumeration values. Using invalid operators will cause flow deployment errors.',
			severity: 'error',
			docRefs: [
				{
					label: 'Salesforce Flow Metadata API',
					url: 'https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_visual_workflow.htm'
				}
			]
		});
	}

	protected check(flow: Flow, options: any | undefined, suppressions: Set<string>): Violation[] {
		const violations: Violation[] = [];

		// Find all decision elements
		const decisionElements = flow.elements.filter(e => e.elementType === 'decisions');

		for (const element of decisionElements) {
			if (this.isSuppressed(element.name, suppressions)) {
				continue;
			}

			// Check each rule within the decision
			if (element.rules) {
				for (let ruleIndex = 0; ruleIndex < element.rules.length; ruleIndex++) {
					const rule = element.rules[ruleIndex];

					// Check each condition within the rule
					if (rule.conditions) {
						for (let condIndex = 0; condIndex < rule.conditions.length; condIndex++) {
							const condition = rule.conditions[condIndex];
							const operator = condition.operator;

							if (!operator) {
								violations.push(
									this.createViolation(
										element.name,
										'Decision',
										'node',
										{
											property: 'operator',
											value: 'missing',
											expected: 'Valid FlowComparisonOperator value',
											message: `Decision element '${element.name}' rule '${rule.name}' is missing a comparison operator. Specify an operator like 'EqualTo', 'GreaterThan', 'IsNull', etc.`,
											ruleName: rule.name,
											conditionIndex: condIndex
										}
									)
								);
							} else if (!FlowComparisonOperatorRule.VALID_OPERATORS.has(operator)) {
								const suggestion = this.getSuggestion(operator, Array.from(FlowComparisonOperatorRule.VALID_OPERATORS));
								violations.push(
									this.createViolation(
										element.name,
										'Decision',
										'node',
										{
											property: 'operator',
											value: operator,
											expected: 'Valid FlowComparisonOperator value',
											message: `Decision element '${element.name}' rule '${rule.name}' has invalid operator '${operator}'.${suggestion}`,
											ruleName: rule.name,
											conditionIndex: condIndex
										}
									)
								);
							}
						}
					}
				}
			}
		}

		return violations;
	}

	private getSuggestion(invalid: string, valid: string[]): string {
		// Simple fuzzy matching for suggestions
		const lower = invalid.toLowerCase();
		const suggestions = valid.filter(v => v.toLowerCase().includes(lower) || lower.includes(v.toLowerCase()));
		if (suggestions.length > 0) {
			return ` Did you mean: ${suggestions.slice(0, 3).join(', ')}?`;
		}
		return ` Valid operators: ${valid.slice(0, 5).join(', ')}, etc.`;
	}
}

/**
 * Rule: Validates FlowRecordFilterOperator values
 * Checks that filter operators in Get Records elements use valid enumeration values
 */
export class FlowRecordFilterOperatorRule extends RuleBase {
	private static readonly VALID_OPERATORS = new Set([
		'EqualTo',
		'NotEqualTo',
		'GreaterThan',
		'LessThan',
		'GreaterThanOrEqualTo',
		'LessThanOrEqualTo',
		'StartsWith',
		'EndsWith',
		'Contains',
		'IsNull',
		'IsChanged',
		'In',
		'NotIn'
	]);

	constructor() {
		super({
			name: 'FlowRecordFilterOperator',
			label: 'Invalid Record Filter Operator',
			description: 'Filter operators in Get Records elements must be valid FlowRecordFilterOperator enumeration values. Using invalid operators will cause flow deployment errors.',
			severity: 'error',
			docRefs: [
				{
					label: 'Salesforce Flow Metadata API',
					url: 'https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_visual_workflow.htm'
				}
			]
		});
	}

	protected check(flow: Flow, options: any | undefined, suppressions: Set<string>): Violation[] {
		const violations: Violation[] = [];

		// Find all Get Records elements
		const recordLookupElements = flow.elements.filter(e => e.elementType === 'recordLookups');

		for (const element of recordLookupElements) {
			if (this.isSuppressed(element.name, suppressions)) {
				continue;
			}

			// Check each filter within the element
			if (element.filters) {
				for (let i = 0; i < element.filters.length; i++) {
					const filter = element.filters[i];
					const operator = filter.operator;

					if (!operator) {
						violations.push(
							this.createViolation(
								element.name,
								'Get Records',
								'node',
								{
									property: 'operator',
									value: 'missing',
									expected: 'Valid FlowRecordFilterOperator value',
									message: `Get Records element '${element.name}' filter on field '${filter.field}' is missing an operator. Specify an operator like 'EqualTo', 'Contains', 'IsNull', etc.`,
									filterField: filter.field,
									filterIndex: i
								}
							)
						);
					} else if (!FlowRecordFilterOperatorRule.VALID_OPERATORS.has(operator)) {
						const suggestion = this.getSuggestion(operator, Array.from(FlowRecordFilterOperatorRule.VALID_OPERATORS));
						violations.push(
							this.createViolation(
								element.name,
								'Get Records',
								'node',
								{
									property: 'operator',
									value: operator,
									expected: 'Valid FlowRecordFilterOperator value',
									message: `Get Records element '${element.name}' filter on field '${filter.field}' has invalid operator '${operator}'.${suggestion}`,
									filterField: filter.field,
									filterIndex: i
								}
							)
						);
					}
				}
			}
		}

		return violations;
	}

	private getSuggestion(invalid: string, valid: string[]): string {
		// Simple fuzzy matching for suggestions
		const lower = invalid.toLowerCase();
		const suggestions = valid.filter(v => v.toLowerCase().includes(lower) || lower.includes(v.toLowerCase()));
		if (suggestions.length > 0) {
			return ` Did you mean: ${suggestions.slice(0, 3).join(', ')}?`;
		}
		return ` Valid operators: ${valid.slice(0, 5).join(', ')}, etc.`;
	}
}

/**
 * Rule: Validates that Decision elements have a defaultConnectorLabel
 * Ensures all decision elements specify a label for the default outcome path
 */
export class DefaultConnectorLabelRule extends RuleBase {
	constructor() {
		super({
			name: 'DefaultConnectorLabel',
			label: 'Missing Default Connector Label',
			description: 'Decision elements must have a defaultConnectorLabel to clearly identify the default outcome path. This improves flow readability and helps developers understand the decision logic.',
			severity: 'error',
			docRefs: [
				{
					label: 'Salesforce Flow Best Practices',
					url: 'https://help.salesforce.com/s/articleView?id=sf.flow_prep_bestpractices.htm&type=5'
				}
			]
		});
	}

	protected check(flow: Flow, options: any | undefined, suppressions: Set<string>): Violation[] {
		const violations: Violation[] = [];

		// Find all decision elements
		const decisionElements = flow.elements.filter(e => e.elementType === 'decisions');

		for (const element of decisionElements) {
			if (this.isSuppressed(element.name, suppressions)) {
				continue;
			}

			// Check if default outcome is connected to any next element
			const hasDefaultConnector = element.defaultConnector?.targetReference;

			// If default connector is not connected, defaultConnectorLabel is required
			if (!hasDefaultConnector) {
				const hasDefaultConnectorLabel = element.element?.defaultConnectorLabel;

				if (!hasDefaultConnectorLabel) {
					violations.push(
						this.createViolation(
							element.name,
							'Decision',
							'node',
							{
								property: 'defaultConnectorLabel',
								value: 'missing',
								expected: 'A descriptive label for the default outcome',
								message: `Decision element '${element.name}' is missing a defaultConnectorLabel. Since the default outcome is not connected to any next element, add a label like 'Default Outcome', 'Otherwise', or 'No Match' to clarify what happens when no rules match.`
							}
						)
					);
				}
			}
		}

		return violations;
	}
}

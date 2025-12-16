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
				{ property: 'description', expected: '!== null' }
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
					{ property: 'apiVersion', value: 'missing', expected: '>= 49' }
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
						{ property: 'apiVersion', value: apiVersion, error: 'Invalid expression format' }
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
						{ property: 'apiVersion', value: apiVersion, expected: expression }
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
							{ property: 'name', value: flowName, expected: options.expression }
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
						{ property: 'name', value: flowName, error: 'Invalid regex expression' }
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
					{ property: 'status', value: flow.status, expected: 'Active' }
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

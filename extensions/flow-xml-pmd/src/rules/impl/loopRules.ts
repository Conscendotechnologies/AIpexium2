/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Flow, Violation } from '../../models/flowModels';
import { LoopRuleBase } from '../ruleBase';

/**
 * Rule: Detects DML operations inside loops
 *
 * Based on: https://github.com/Flow-Scanner/lightning-flow-scanner/blob/main/packages/core/src/main/rules/DMLStatementInLoop.ts
 */
export class DMLStatementInLoopRule extends LoopRuleBase {
	constructor() {
		super({
			name: 'DMLStatementInLoop',
			label: 'DML Statement In A Loop',
			description: 'To prevent exceeding Apex governor limits, consolidate all your database operations—record creation, updates, or deletions—at the conclusion of the flow.',
			severity: 'error',
			docRefs: [
				{
					label: 'Flow Best Practices',
					url: 'https://help.salesforce.com/s/articleView?id=sf.flow_prep_bestpractices.htm&type=5'
				},
				{
					label: 'Apex Governor Limits',
					url: 'https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_gov_limits.htm'
				}
			]
		});
	}

	protected getStatementTypes(): string[] {
		return ['recordCreates', 'recordUpdates', 'recordDeletes'];
	}

	protected check(flow: Flow, options: any | undefined, suppressions: Set<string>): Violation[] {
		const violations = super.check(flow, options, suppressions);

		// Add helpful context to each violation
		return violations.map(v => ({
			...v,
			details: {
				...v.details,
				message: `DML operation '${v.name}' is inside a loop. This will hit governor limits. Move DML operations outside the loop and process records in bulk.`
			}
		}));
	}
}

/**
 * Rule: Detects SOQL queries inside loops
 *
 * Based on: https://github.com/Flow-Scanner/lightning-flow-scanner/blob/main/packages/core/src/main/rules/SOQLQueryInLoop.ts
 */
export class SOQLQueryInLoopRule extends LoopRuleBase {
	constructor() {
		super({
			name: 'SOQLQueryInLoop',
			label: 'SOQL Query In A Loop',
			description: 'To prevent exceeding Apex governor limits, consolidate all SOQL queries at the end of the flow.',
			severity: 'error',
			docRefs: [
				{
					label: 'Flow Best Practices',
					url: 'https://help.salesforce.com/s/articleView?id=sf.flow_prep_bestpractices.htm&type=5'
				}
			]
		});
	}

	protected getStatementTypes(): string[] {
		return ['recordLookups'];
	}

	protected check(flow: Flow, options: any | undefined, suppressions: Set<string>): Violation[] {
		const violations = super.check(flow, options, suppressions);

		// Add helpful context to each violation
		return violations.map(v => ({
			...v,
			details: {
				...v.details,
				message: `Get Records element '${v.name}' is inside a loop and will execute multiple SOQL queries. This quickly hits SOQL governor limits. Move queries outside the loop.`
			}
		}));
	}
}

/**
 * Rule: Detects action calls inside loops
 *
 * Based on: https://github.com/Flow-Scanner/lightning-flow-scanner/blob/main/packages/core/src/main/rules/ActionCallsInLoop.ts
 */
export class ActionCallsInLoopRule extends LoopRuleBase {
	constructor() {
		super({
			name: 'ActionCallsInLoop',
			label: 'Action Calls In Loop',
			description: 'To prevent exceeding Apex governor limits, it is advisable to consolidate and bulkify your apex calls, utilizing a single action call containing a collection variable at the end of the loop.',
			severity: 'error',
			docRefs: [
				{
					label: 'Flow Best Practices',
					url: 'https://help.salesforce.com/s/articleView?id=sf.flow_prep_bestpractices.htm&type=5'
				}
			]
		});
	}

	protected getStatementTypes(): string[] {
		return ['actionCalls', 'apexPluginCalls'];
	}

	protected check(flow: Flow, options: any | undefined, suppressions: Set<string>): Violation[] {
		const violations = super.check(flow, options, suppressions);

		// Add helpful context to each violation
		return violations.map(v => ({
			...v,
			details: {
				...v.details,
				message: `Action call '${v.name}' is inside a loop and will execute multiple times. Bulkify by collecting records in a collection variable and calling the action once after the loop.`
			}
		}));
	}
}

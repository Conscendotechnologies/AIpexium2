/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Flow, Violation } from '../../models/flowModels';
import { RuleBase } from '../ruleBase';

/**
 * Rule: Checks for missing null handler after Get Records
 *
 * Based on: https://github.com/Flow-Scanner/lightning-flow-scanner/blob/main/packages/core/src/main/rules/MissingNullHandler.ts
 */
export class MissingNullHandlerRule extends RuleBase {
	constructor() {
		super({
			name: 'MissingNullHandler',
			label: 'Missing Null Handler',
			description: 'When a Get Records operation finds no data, it returns null. Validate data by using a Decision element to check for a non-null result.',
			severity: 'warning',
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
		const getRecordsElements = flow.elements.filter((e: any) => e.elementType === 'recordLookups');
		const decisionElements = flow.elements.filter((e: any) => e.elementType === 'decisions');

		for (const getRecords of getRecordsElements) {
			if (suppressions.has(getRecords.name)) {
				continue;
			}

			// Skip if assignNullValuesIfNoRecordsFound is not true
			if (!getRecords.assignNullValuesIfNoRecordsFound) {
				continue;
			}

			// Check if there's a fault connector
			if (getRecords.faultConnector?.targetReference) {
				continue;
			}

			// Check if the next element is a decision that checks for null
			const nextRef = getRecords.connector?.targetReference;
			if (nextRef) {
				const nextElement = flow.elements.find((e: any) => e.name === nextRef);
				if (nextElement && nextElement.elementType === 'decisions') {
					// Check if any condition references the Get Records output
					const hasNullCheck = nextElement.rules?.some((rule: any) =>
						rule.conditions?.some((cond: any) =>
							cond.leftValueReference === getRecords.name ||
							cond.leftValueReference?.startsWith(getRecords.name + '.')
						)
					);

					if (hasNullCheck) {
						continue;
					}
				}
			}

			violations.push(this.createViolation(
				getRecords.name,
				getRecords.elementType,
				'node',
				{ missingNullCheck: true }
			));
		}

		return violations;
	}
}

/**
 * Rule: Checks for missing fault path on DML and actions
 *
 * Based on: https://github.com/Flow-Scanner/lightning-flow-scanner/blob/main/packages/core/src/main/rules/MissingFaultPath.ts
 */
export class MissingFaultPathRule extends RuleBase {
	private readonly APPLICABLE_ELEMENTS = [
		'recordLookups',
		'recordDeletes',
		'recordUpdates',
		'recordCreates',
		'waits',
		'actionCalls',
		'apexPluginCalls'
	];

	constructor() {
		super({
			name: 'MissingFaultPath',
			label: 'Missing Fault Path',
			description: 'A flow may fail to execute an operation as intended. By default, the flow displays an error to the user. You can customize this behavior by incorporating a Fault Path.',
			severity: 'warning',
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

		for (const element of flow.elements) {
			if (suppressions.has(element.name)) {
				continue;
			}

			// Check only applicable element types
			if (!this.APPLICABLE_ELEMENTS.includes(element.elementType)) {
				continue;
			}

			// Check if fault connector exists
			if (!element.faultConnector?.targetReference) {
				violations.push(this.createViolation(
					element.name,
					element.elementType,
					'node',
					{ missingFaultPath: true }
				));
			}
		}

		return violations;
	}
}

/**
 * Rule: Checks for unconnected elements
 *
 * Based on: https://github.com/Flow-Scanner/lightning-flow-scanner/blob/main/packages/core/src/main/rules/UnconnectedElement.ts
 */
export class UnconnectedElementRule extends RuleBase {
	constructor() {
		super({
			name: 'UnconnectedElement',
			label: 'Unconnected Element',
			description: 'Avoid unconnected elements that are not used by the flow to keep flows efficient and maintainable.',
			severity: 'warning',
			docRefs: []
		});
	}

	protected check(flow: Flow, options: any | undefined, suppressions: Set<string>): Violation[] {
		const violations: Violation[] = [];
		const connectedElements = this.getReachableElements(flow);

		for (const element of flow.elements) {
			if (suppressions.has(element.name)) {
				continue;
			}

			if (!connectedElements.has(element.name)) {
				violations.push(this.createViolation(
					element.name,
					element.elementType,
					'node',
					{ unconnected: true }
				));
			}
		}

		return violations;
	}

	private getReachableElements(flow: Flow): Set<string> {
		const reachable = new Set<string>();
		const visited = new Set<string>();

		// Start from the start element
		const startRef = flow.startElementReference;
		if (!startRef) {
			return reachable;
		}

		// BFS traversal
		const queue: string[] = [startRef];
		visited.add(startRef);

		while (queue.length > 0) {
			const currentRef = queue.shift()!;
			const element = flow.elements.find((e: any) => e.name === currentRef);

			if (!element) {
				continue;
			}

			reachable.add(currentRef);

			// Collect all outgoing connectors
			const connectors: (string | undefined)[] = [
				element.connector?.targetReference,
				element.faultConnector?.targetReference,
				element.nextValueConnector?.targetReference,
				element.noMoreValuesConnector?.targetReference,
				element.defaultConnector?.targetReference,
				...(element.rules?.map((r: any) => r.connector?.targetReference) ?? [])
			];

			for (const ref of connectors) {
				if (ref && !visited.has(ref)) {
					visited.add(ref);
					queue.push(ref);
				}
			}
		}

		return reachable;
	}
}

/**
 * Rule: Checks that all elements have valid connectors
 * All elements (except the last one) must have a connector, and the connector must point to an existing element
 */
export class MissingConnectorRule extends RuleBase {
	constructor() {
		super({
			name: 'MissingConnector',
			label: 'Missing or Invalid Connector',
			description: 'All flow elements (except the last one) must have a connector property that points to an existing element. This ensures proper flow execution and prevents runtime errors.',
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

		// Build a set of all element names for quick lookup
		const elementNames = new Set(flow.elements.map((e: any) => e.name));

		// Find terminal elements (elements that are valid endpoints)
		const terminalElements = this.findTerminalElements(flow);

		for (const element of flow.elements) {
			if (suppressions.has(element.name)) {
				continue;
			}

			// Skip if this is a terminal element (valid endpoint)
			if (terminalElements.has(element.name)) {
				continue;
			}

			// Collect all possible connectors for this element
			const connectors = this.getElementConnectors(element);

			// Check if element has at least one connector
			if (connectors.length === 0) {
				violations.push(this.createViolation(
					element.name,
					element.elementType,
					'node',
					{
						property: 'connector',
						message: `Element "${element.name}" is missing a connector. All non-terminal elements must have a connector.`
					}
				));
				continue;
			}

			// Validate that all connectors point to existing elements
			for (const connector of connectors) {
				if (connector.targetReference && !elementNames.has(connector.targetReference)) {
					violations.push(this.createViolation(
						element.name,
						element.elementType,
						'node',
						{
							property: 'connector',
							value: connector.targetReference,
							message: `Connector points to non-existent element "${connector.targetReference}"`
						}
					));
				}
			}
		}

		return violations;
	}

	/**
	 * Get all connectors from an element
	 */
	private getElementConnectors(element: any): any[] {
		const connectors: any[] = [];

		// Regular connector
		if (element.connector) {
			connectors.push(element.connector);
		}

		// Fault connector
		if (element.faultConnector) {
			connectors.push(element.faultConnector);
		}

		// Loop connectors
		if (element.nextValueConnector) {
			connectors.push(element.nextValueConnector);
		}
		if (element.noMoreValuesConnector) {
			connectors.push(element.noMoreValuesConnector);
		}

		// Decision default connector
		if (element.defaultConnector) {
			connectors.push(element.defaultConnector);
		}

		// Decision rule connectors
		if (element.rules) {
			for (const rule of element.rules) {
				if (rule.connector) {
					connectors.push(rule.connector);
				}
			}
		}

		return connectors.filter(c => c && c.targetReference);
	}

	/**
	 * Find elements that are valid terminal elements (endpoints)
	 * These can be the last element in a flow path and don't need connectors
	 */
	private findTerminalElements(flow: Flow): Set<string> {
		const terminals = new Set<string>();

		// An element is terminal if no other element points to anything after it
		// We'll identify elements that have no outgoing connectors as potential terminals
		const elementsWithOutgoing = new Set<string>();

		for (const element of flow.elements) {
			const connectors = this.getElementConnectors(element);
			if (connectors.length > 0) {
				elementsWithOutgoing.add(element.name);
			}
		}

		// Elements without outgoing connectors are terminal
		for (const element of flow.elements) {
			if (!elementsWithOutgoing.has(element.name)) {
				terminals.add(element.name);
			}
		}

		return terminals;
	}
}

/**
 * Rule: Checks for unused variables, formulas, constants
 */
export class UnusedVariableRule extends RuleBase {
	constructor() {
		super({
			name: 'UnusedVariable',
			label: 'Unused Variable',
			description: 'Variables, formulas, constants, and text templates that are declared but never used add unnecessary complexity and should be removed.',
			severity: 'warning',
			docRefs: []
		});
	}

	protected check(flow: Flow, options: any | undefined, suppressions: Set<string>): Violation[] {
		const violations: Violation[] = [];

		// Collect all variable-like resources
		const allResources = [
			...flow.variables.map(v => ({ name: v.name, type: 'variable' })),
			...flow.formulas.map(f => ({ name: f.name, type: 'formula' })),
			...flow.constants.map(c => ({ name: c.name, type: 'constant' })),
			...flow.textTemplates.map(t => ({ name: t.name, type: 'textTemplate' }))
		];

		for (const resource of allResources) {
			if (suppressions.has(resource.name)) {
				continue;
			}

			// Check if resource is used anywhere in the flow
			const isUsed = this.isResourceUsed(resource.name, flow);

			if (!isUsed) {
				violations.push(this.createViolation(
					resource.name,
					resource.type,
					'attribute',
					{
						property: 'name',
						message: `${resource.type} '${resource.name}' is declared but never used`
					}
				));
			}
		}

		return violations;
	}

	private isResourceUsed(resourceName: string, flow: Flow): boolean {
		const flowStr = JSON.stringify(flow.xmldata);

		// Check if resource name appears in any element, assignment, or expression
		// Simple text search - resource name should appear somewhere other than its declaration
		const regex = new RegExp(`[^a-zA-Z0-9_]${resourceName}[^a-zA-Z0-9_]`, 'g');
		const matches = flowStr.match(regex);

		// Should appear at least twice (declaration + usage)
		return matches ? matches.length > 1 : false;
	}
}

/**
 * Rule: Checks for missing labels on elements
 */
export class MissingLabelRule extends RuleBase {
	constructor() {
		super({
			name: 'MissingLabel',
			label: 'Missing Element Label',
			description: 'All flow elements should have descriptive labels to improve readability and maintainability.',
			severity: 'warning',
			docRefs: []
		});
	}

	protected check(flow: Flow, options: any | undefined, suppressions: Set<string>): Violation[] {
		const violations: Violation[] = [];

		for (const element of flow.elements) {
			if (suppressions.has(element.name)) {
				continue;
			}

			if (!element.label || element.label.trim().length === 0) {
				violations.push(this.createViolation(
					element.name,
					element.elementType,
					'node',
					{
						property: 'label',
						message: `Element '${element.name}' is missing a label`
					}
				));
			}
		}

		return violations;
	}
}

/**
 * Rule: Checks for duplicate API names
 */
export class DuplicateAPINameRule extends RuleBase {
	constructor() {
		super({
			name: 'DuplicateAPIName',
			label: 'Duplicate API Name',
			description: 'Each element must have a unique API name. Duplicate names will cause deployment failures.',
			severity: 'error',
			docRefs: []
		});
	}

	protected check(flow: Flow, options: any | undefined, suppressions: Set<string>): Violation[] {
		const violations: Violation[] = [];
		const nameCount = new Map<string, number>();

		// Count occurrences of each name
		for (const element of flow.elements) {
			nameCount.set(element.name, (nameCount.get(element.name) || 0) + 1);
		}

		// Report duplicates
		for (const element of flow.elements) {
			if (suppressions.has(element.name)) {
				continue;
			}

			const count = nameCount.get(element.name) || 0;
			if (count > 1) {
				violations.push(this.createViolation(
					element.name,
					element.elementType,
					'node',
					{
						property: 'name',
						value: element.name,
						message: `Duplicate API name '${element.name}' found ${count} times`
					}
				));
			}
		}

		return violations;
	}
}

/**
 * Rule: Checks flow complexity depth
 */
export class FlowDepthRule extends RuleBase {
	constructor() {
		super({
			name: 'FlowDepth',
			label: 'Excessive Flow Depth',
			description: 'Deeply nested flows are hard to understand and maintain. Consider breaking complex logic into subflows.',
			severity: 'warning',
			isConfigurable: true,
			docRefs: []
		});
	}

	protected check(flow: Flow, options: any | undefined, suppressions: Set<string>): Violation[] {
		const violations: Violation[] = [];
		const maxDepth = options?.maxDepth || 5;

		// Calculate depth for each element
		const depths = this.calculateDepths(flow);

		for (const [elementName, depth] of depths.entries()) {
			if (suppressions.has(elementName)) {
				continue;
			}

			if (depth > maxDepth) {
				const element = flow.elements.find(e => e.name === elementName);
				if (element) {
					violations.push(this.createViolation(
						element.name,
						element.elementType,
						'node',
						{
							property: 'depth',
							value: depth,
							expected: `<= ${maxDepth}`,
							message: `Element at depth ${depth} exceeds maximum depth of ${maxDepth}. Consider refactoring into subflows.`
						}
					));
				}
			}
		}

		return violations;
	}

	private calculateDepths(flow: Flow): Map<string, number> {
		const depths = new Map<string, number>();
		const startRef = flow.startElementReference;

		if (!startRef) {
			return depths;
		}

		// BFS to calculate depth
		const queue: Array<{ ref: string; depth: number }> = [{ ref: startRef, depth: 1 }];
		const visited = new Set<string>();

		while (queue.length > 0) {
			const { ref, depth } = queue.shift()!;

			if (visited.has(ref)) {
				continue;
			}
			visited.add(ref);

			const element = flow.elements.find(e => e.name === ref);
			if (!element) {
				continue;
			}

			depths.set(ref, depth);

			// Get all outgoing connectors
			const connectors: (string | undefined)[] = [
				element.connector?.targetReference,
				element.faultConnector?.targetReference,
				element.nextValueConnector?.targetReference,
				element.noMoreValuesConnector?.targetReference,
				element.defaultConnector?.targetReference,
				...(element.rules?.map((r: any) => r.connector?.targetReference) ?? [])
			];

			for (const nextRef of connectors) {
				if (nextRef && !visited.has(nextRef)) {
					queue.push({ ref: nextRef, depth: depth + 1 });
				}
			}
		}

		return depths;
	}
}

/**
 * Rule: Checks for too many elements in a flow
 */
export class TooManyElementsRule extends RuleBase {
	constructor() {
		super({
			name: 'TooManyElements',
			label: 'Too Many Elements',
			description: 'Flows with too many elements become difficult to maintain. Consider splitting into multiple flows or subflows.',
			severity: 'warning',
			isConfigurable: true,
			docRefs: []
		});
	}

	protected check(flow: Flow, options: any | undefined, suppressions: Set<string>): Violation[] {
		const maxElements = options?.maxElements || 50;
		const elementCount = flow.elements.length;

		if (elementCount > maxElements) {
			return [
				this.createViolation(
					flow.fullName || 'Flow',
					'Flow',
					'attribute',
					{
						property: 'elementCount',
						value: elementCount,
						expected: `<= ${maxElements}`,
						message: `Flow has ${elementCount} elements, exceeding the recommended maximum of ${maxElements}. Consider refactoring.`
					}
				)
			];
		}

		return [];
	}
}

/**
 * Rule: Checks for Get Records without filters
 */
export class MissingRecordFilterRule extends RuleBase {
	constructor() {
		super({
			name: 'MissingRecordFilter',
			label: 'Missing Record Filter',
			description: 'Get Records operations without filters can return too many records and hit governor limits. Always add filters to limit the query scope.',
			severity: 'warning',
			docRefs: []
		});
	}

	protected check(flow: Flow, options: any | undefined, suppressions: Set<string>): Violation[] {
		const violations: Violation[] = [];
		const getRecordsElements = flow.elements.filter((e: any) => e.elementType === 'recordLookups');

		for (const element of getRecordsElements) {
			if (suppressions.has(element.name)) {
				continue;
			}

			// Check if element has filters or filterLogic
			const hasFilters = element.filters && Array.isArray(element.filters) && element.filters.length > 0;

			if (!hasFilters && !element.getFirstRecordOnly) {
				violations.push(this.createViolation(
					element.name,
					element.elementType,
					'node',
					{
						property: 'filters',
						message: `Get Records '${element.name}' has no filters and may return excessive records. Add filters to limit the query scope.`
					}
				));
			}
		}

		return violations;
	}
}

/**
 * Rule: Checks for validation before DML operations
 */
export class ValidationBeforeDMLRule extends RuleBase {
	constructor() {
		super({
			name: 'ValidationBeforeDML',
			label: 'Missing Validation Before DML',
			description: 'DML operations should be preceded by validation logic to ensure data quality and prevent errors.',
			severity: 'note',
			docRefs: []
		});
	}

	protected check(flow: Flow, options: any | undefined, suppressions: Set<string>): Violation[] {
		const violations: Violation[] = [];
		const dmlElements = flow.elements.filter((e: any) =>
			e.elementType === 'recordCreates' ||
			e.elementType === 'recordUpdates' ||
			e.elementType === 'recordDeletes'
		);

		for (const dmlElement of dmlElements) {
			if (suppressions.has(dmlElement.name)) {
				continue;
			}

			// Check if there's a decision element pointing to this DML
			const hasValidation = this.hasPrecedingValidation(dmlElement.name, flow);

			if (!hasValidation) {
				violations.push(this.createViolation(
					dmlElement.name,
					dmlElement.elementType,
					'node',
					{
						message: `DML operation '${dmlElement.name}' is not preceded by validation. Consider adding a Decision element to validate data before DML.`
					}
				));
			}
		}

		return violations;
	}

	private hasPrecedingValidation(dmlElementName: string, flow: Flow): boolean {
		// Find elements that point to this DML element
		for (const element of flow.elements) {
			// Check all connector types
			const connectors = [
				element.connector?.targetReference,
				element.faultConnector?.targetReference,
				element.nextValueConnector?.targetReference,
				element.noMoreValuesConnector?.targetReference,
				element.defaultConnector?.targetReference,
				...(element.rules?.map((r: any) => r.connector?.targetReference) ?? [])
			];

			if (connectors.includes(dmlElementName)) {
				// If the preceding element is a decision, validation exists
				if (element.elementType === 'decisions') {
					return true;
				}
			}
		}

		return false;
	}
}

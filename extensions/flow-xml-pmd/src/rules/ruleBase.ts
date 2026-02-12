/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Flow, Violation } from '../models/flowModels';

/**
 * Interface that all Flow PMD rules must implement
 */
export interface IRule {
	/** Unique rule name */
	readonly name: string;

	/** Human-readable label */
	readonly label: string;

	/** Rule description */
	readonly description: string;

	/** Default severity */
	readonly severity: 'error' | 'warning' | 'note';

	/** Whether rule is configurable (has options) */
	readonly isConfigurable: boolean;

	/** Supported flow types */
	readonly supportedTypes: string[];

	/** Documentation references */
	readonly docRefs: Array<{ label: string; url: string }>;

	/**
	 * Execute the rule against a flow
	 * @param flow The flow to validate
	 * @param options Rule-specific configuration options
	 * @param suppressions List of element names to suppress
	 * @returns Array of violations found
	 */
	execute(flow: Flow, options?: any, suppressions?: string[]): Violation[];
}

/**
 * Base class for all Flow PMD rules
 */
export abstract class RuleBase implements IRule {
	public readonly name: string;
	public readonly label: string;
	public readonly description: string;
	public readonly severity: 'error' | 'warning' | 'note';
	public readonly isConfigurable: boolean;
	public readonly supportedTypes: string[];
	public readonly docRefs: Array<{ label: string; url: string }>;

	constructor(config: {
		name: string;
		label: string;
		description: string;
		severity?: 'error' | 'warning' | 'note';
		isConfigurable?: boolean;
		supportedTypes?: string[];
		docRefs?: Array<{ label: string; url: string }>;
	}) {
		this.name = config.name;
		this.label = config.label;
		this.description = config.description;
		this.severity = config.severity ?? 'error';
		this.isConfigurable = config.isConfigurable ?? false;
		this.supportedTypes = config.supportedTypes ?? ['AutoLaunchedFlow', 'Flow', 'Workflow', 'ScreenFlow', 'Screen', 'CustomEvent', 'InvocableProcess'];
		this.docRefs = config.docRefs ?? [];
	}

	/**
	 * Execute the rule
	 */
	public execute(flow: Flow, options?: any, suppressions: string[] = []): Violation[] {
		// Check if flow type is supported
		if (flow.processType && !this.supportedTypes.includes(flow.processType)) {
			return [];
		}

		// Wildcard suppression disables entire rule
		if (suppressions.includes('*')) {
			return [];
		}

		// Create suppression set for efficient lookup
		const suppSet = new Set(suppressions);

		// Call the actual check logic
		let violations = this.check(flow, options, suppSet);

		// Filter out suppressed violations
		violations = violations.filter(v => !suppSet.has(v.name));

		return violations;
	}

	/**
	 * Implement the actual rule logic
	 */
	protected abstract check(flow: Flow, options: any | undefined, suppressions: Set<string>): Violation[];

	/**
	 * Helper to check if an element is suppressed
	 */
	protected isSuppressed(name: string, suppressions: Set<string>): boolean {
		return suppressions.has(name);
	}

	/**
	 * Helper to create a violation
	 */
	protected createViolation(
		name: string,
		type: string,
		metaType: 'node' | 'variable' | 'attribute' | 'formula' | 'constant',
		details?: any
	): Violation {
		return {
			name,
			type,
			metaType,
			lineNumber: 0, // Will be enriched later with actual line number
			columnNumber: 0,
			details
		};
	}
}

/**
 * Base class for rules that check for elements inside loops
 */
export abstract class LoopRuleBase extends RuleBase {
	/**
	 * Get the element types this rule should check for inside loops
	 */
	protected abstract getStatementTypes(): string[];

	protected check(flow: Flow, options: any | undefined, suppressions: Set<string>): Violation[] {
		const violations: Violation[] = [];
		const loopElements = this.findLoopElements(flow);

		if (loopElements.length === 0) {
			return violations;
		}

		const statementsInLoops = this.findStatementsInLoops(flow, loopElements);

		for (const statement of statementsInLoops) {
			if (!suppressions.has(statement.name)) {
				violations.push(this.createViolation(
					statement.name,
					statement.elementType,
					'node',
					{ inLoop: true }
				));
			}
		}

		return violations;
	}

	private findLoopElements(flow: Flow): typeof flow.elements {
		return flow.elements.filter(e => e.elementType === 'loops');
	}

	private findStatementsInLoops(flow: Flow, loopElements: typeof flow.elements): typeof flow.elements {
		const statementsInLoops: typeof flow.elements = [];
		const targetTypes = new Set(this.getStatementTypes());

		for (const loop of loopElements) {
			const reachableInLoop = this.getReachableElementsInLoop(flow, loop);

			for (const element of reachableInLoop) {
				if (targetTypes.has(element.elementType)) {
					statementsInLoops.push(element);
				}
			}
		}

		return statementsInLoops;
	}

	private getReachableElementsInLoop(flow: Flow, loopElement: typeof flow.elements[0]): typeof flow.elements {
		const reachable: typeof flow.elements = [];
		const visited = new Set<string>();

		// Start from loop's nextValueConnector
		const startRef = loopElement.nextValueConnector?.targetReference;
		if (!startRef) {
			return reachable;
		}

		// End at loop's noMoreValuesConnector
		const endRef = loopElement.noMoreValuesConnector?.targetReference;

		// BFS to find all reachable elements
		const queue: string[] = [startRef];
		visited.add(startRef);

		while (queue.length > 0) {
			const currentRef = queue.shift()!;

			// Stop if we've reached the end of the loop
			if (currentRef === endRef || currentRef === loopElement.name) {
				continue;
			}

			const element = flow.elements.find(e => e.name === currentRef);
			if (!element) {
				continue;
			}

			reachable.push(element);

			// Add connected elements to queue
			const connectors = [
				element.connector?.targetReference,
				element.faultConnector?.targetReference,
				element.defaultConnector?.targetReference,
				...(element.rules?.map(r => r.connector?.targetReference) ?? [])
			].filter((ref): ref is string => !!ref && !visited.has(ref));

			for (const ref of connectors) {
				visited.add(ref);
				queue.push(ref);
			}
		}

		return reachable;
	}
}

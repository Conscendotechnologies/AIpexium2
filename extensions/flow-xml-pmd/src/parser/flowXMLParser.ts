/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { XMLParser } from 'fast-xml-parser';
import { Flow, FlowElement, FlowVariable } from '../models/flowModels';
import { Logger } from '../utils/logger';

/**
 * Parser for Salesforce Flow XML files
 */
export class FlowXMLParser {
	private parser: XMLParser;
	private logger: Logger;

	constructor() {
		this.parser = new XMLParser({
			ignoreAttributes: false,
			attributeNamePrefix: '@_',
			parseAttributeValue: true,
			trimValues: true,
			allowBooleanAttributes: true
		});
		this.logger = Logger.getInstance();
	}

	/**
	 * Parse Flow XML content into a Flow object
	 */
	parse(xmlContent: string): Flow | null {
		try {
			this.logger.debug('Starting XML parse...');
			const parsed = this.parser.parse(xmlContent);

			if (!parsed.Flow) {
				this.logger.error('No Flow element found in XML');
				return null;
			}

			const flowData = parsed.Flow;
			this.logger.debug(`Flow element found. Process Type: ${flowData.processType}, Status: ${flowData.status}`);

			// Extract flow metadata
			const flow: Flow = {
				fullName: flowData.fullName,
				processType: flowData.processType || 'Flow',
				status: flowData.status || 'Draft',
				apiVersion: flowData.apiVersion,
				description: flowData.description,
				label: flowData.label,
				interviewLabel: flowData.interviewLabel,
				runInMode: flowData.runInMode,
				interactionType: flowData.interactionType,
				triggerType: flowData.triggerType,
				start: flowData.start ? {
					triggerType: flowData.start.triggerType,
					object: flowData.start.object
				} : undefined,
				startElementReference: flowData.startElementReference ||
					flowData.start?.connector?.targetReference ||
					flowData.start?.targetReference,
				elements: [],
				variables: [],
				formulas: [],
				constants: [],
				textTemplates: [],
				choices: [],
				stages: [],
				xmldata: flowData
			};

			// Parse elements (nodes)
			this.parseElements(flow, flowData);

			// Parse variables
			this.parseVariables(flow, flowData);

			this.logger.info(`Parse complete: ${flow.elements.length} elements, ${flow.variables.length} variables, ${flow.formulas.length} formulas, ${flow.constants.length} constants`);
			this.logger.debug(`Start element reference: ${flow.startElementReference}`);

			return flow;
		} catch (error) {
			this.logger.error('Error parsing Flow XML:', error as Error);
			return null;
		}
	}

	private parseElements(flow: Flow, flowData: any): void {
		const elementTypes = [
			'actionCalls',
			'recordCreates',
			'recordUpdates',
			'recordDeletes',
			'recordLookups',
			'decisions',
			'loops',
			'assignments',
			'screens',
			'subflows',
			'waits',
			'collectionProcessors',
			'apexPluginCalls',
			'customErrors',
			'orchestratedStages',
			'transforms'
		];

		for (const elementType of elementTypes) {
			const elements = flowData[elementType];
			if (!elements) {
				continue;
			}

			// Handle both single element and array
			const elementArray = Array.isArray(elements) ? elements : [elements];

			for (const element of elementArray) {
				const flowElement = this.parseFlowElement(element, elementType);
				if (flowElement) {
					flow.elements.push(flowElement);
				}
			}
		}
	}

	private parseFlowElement(element: any, elementType: string): FlowElement | null {
		try {
			return {
				name: element.name,
				elementType: elementType,
				subtype: elementType,
				label: element.label,
				description: element.description,
				locationX: element.locationX?.toString(),
				locationY: element.locationY?.toString(),
				connector: element.connector ? {
					targetReference: element.connector.targetReference
				} : undefined,
				faultConnector: element.faultConnector ? {
					targetReference: element.faultConnector.targetReference
				} : undefined,
				nextValueConnector: element.nextValueConnector ? {
					targetReference: element.nextValueConnector.targetReference
				} : undefined,
				noMoreValuesConnector: element.noMoreValuesConnector ? {
					targetReference: element.noMoreValuesConnector.targetReference
				} : undefined,
				defaultConnector: element.defaultConnector ? {
					targetReference: element.defaultConnector.targetReference
				} : undefined,
				rules: this.parseRules(element.rules),
				object: element.object,
				filters: this.parseFilters(element.filters),
				filterLogic: element.filterLogic,
				assignNullValuesIfNoRecordsFound: element.assignNullValuesIfNoRecordsFound,
				getFirstRecordOnly: element.getFirstRecordOnly,
				storeOutputAutomatically: element.storeOutputAutomatically,
				inputAssignments: this.parseInputAssignments(element.inputAssignments),
				inputReference: element.inputReference,
				collectionReference: element.collectionReference,
				iterationOrder: element.iterationOrder,
				actionName: element.actionName,
				actionType: element.actionType,
				flowName: element.flowName,
				inputParameters: this.parseParameters(element.inputParameters),
				outputParameters: this.parseParameters(element.outputParameters),
				assignmentItems: this.parseAssignmentItems(element.assignmentItems),
				element: element
			};
		} catch (error) {
			console.error(`Error parsing element ${element.name}:`, error);
			return null;
		}
	}

	private parseRules(rules: any): any[] | undefined {
		if (!rules) {
			return undefined;
		}
		const ruleArray = Array.isArray(rules) ? rules : [rules];
		return ruleArray.map(rule => ({
			name: rule.name,
			label: rule.label,
			connector: rule.connector ? {
				targetReference: rule.connector.targetReference
			} : undefined,
			conditions: this.parseConditions(rule.conditions)
		}));
	}

	private parseConditions(conditions: any): any[] | undefined {
		if (!conditions) {
			return undefined;
		}
		const conditionArray = Array.isArray(conditions) ? conditions : [conditions];
		return conditionArray.map(cond => ({
			leftValueReference: cond.leftValueReference,
			operator: cond.operator,
			rightValue: cond.rightValue
		}));
	}

	private parseFilters(filters: any): any[] | undefined {
		if (!filters) {
			return undefined;
		}
		const filterArray = Array.isArray(filters) ? filters : [filters];
		return filterArray.map(filter => ({
			field: filter.field,
			operator: filter.operator,
			value: filter.value
		}));
	}

	private parseInputAssignments(assignments: any): any[] | undefined {
		if (!assignments) {
			return undefined;
		}
		const assignmentArray = Array.isArray(assignments) ? assignments : [assignments];
		return assignmentArray.map(assignment => ({
			field: assignment.field,
			value: assignment.value
		}));
	}

	private parseParameters(parameters: any): any[] | undefined {
		if (!parameters) {
			return undefined;
		}
		const paramArray = Array.isArray(parameters) ? parameters : [parameters];
		return paramArray.map(param => ({
			name: param.name,
			value: param.value
		}));
	}

	private parseAssignmentItems(items: any): any[] | undefined {
		if (!items) {
			return undefined;
		}
		const itemArray = Array.isArray(items) ? items : [items];
		return itemArray.map(item => ({
			assignToReference: item.assignToReference,
			operator: item.operator,
			value: item.value
		}));
	}

	private parseVariables(flow: Flow, flowData: any): void {
		// Variables
		this.parseVariableType(flow.variables, flowData.variables);

		// Formulas
		this.parseVariableType(flow.formulas, flowData.formulas);

		// Constants
		this.parseVariableType(flow.constants, flowData.constants);

		// Text Templates
		this.parseVariableType(flow.textTemplates, flowData.textTemplates);

		// Choices
		this.parseVariableType(flow.choices, flowData.choices);

		// Stages
		this.parseVariableType(flow.stages, flowData.stages);
	}

	private parseVariableType(targetArray: FlowVariable[], sourceData: any): void {
		if (!sourceData) {
			return;
		}

		const variableArray = Array.isArray(sourceData) ? sourceData : [sourceData];

		for (const variable of variableArray) {
			targetArray.push({
				name: variable.name,
				dataType: variable.dataType,
				isCollection: variable.isCollection,
				isInput: variable.isInput,
				isOutput: variable.isOutput,
				objectType: variable.objectType,
				description: variable.description,
				value: variable.value,
				expression: variable.expression,
				defaultValue: variable.defaultValue
			});
		}
	}
}

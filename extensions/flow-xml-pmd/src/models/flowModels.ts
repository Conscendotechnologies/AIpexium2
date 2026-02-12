/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Represents a parsed Salesforce Flow XML structure
 */
export interface Flow {
	/** Flow full name (API name) */
	fullName?: string;
	/** Flow type (e.g., AutoLaunchedFlow, Screen, RecordTriggeredFlow) */
	processType?: string;
	/** Flow status (Active, Draft, Obsolete, InvalidDraft) */
	status?: string;
	/** API version */
	apiVersion?: string;
	/** Flow description */
	description?: string;
	/** Flow label */
	label?: string;
	/** Interview label */
	interviewLabel?: string;
	/** Running context (SystemModeWithoutSharing, SystemModeWithSharing, DefaultMode) */
	runInMode?: string;
	/** Interaction type (e.g., Screen for screen flows) */
	interactionType?: string;
	/** Trigger type for record-triggered flows */
	triggerType?: string;
	/** Start element configuration */
	start?: {
		triggerType?: string;
		object?: string;
	};
	/** Start element reference */
	startElementReference?: string;
	/** All flow elements (nodes) */
	elements: FlowElement[];
	/** Flow variables */
	variables: FlowVariable[];
	/** Flow formulas */
	formulas: FlowVariable[];
	/** Flow constants */
	constants: FlowVariable[];
	/** Flow text templates */
	textTemplates: FlowVariable[];
	/** Flow choices */
	choices: FlowVariable[];
	/** Flow stages */
	stages: FlowVariable[];
	/** Original XML data */
	xmldata: any;
}

/**
 * Represents a Flow element/node
 */
export interface FlowElement {
	/** Element name/API name */
	name: string;
	/** Element type (e.g., recordCreates, recordUpdates, decisions, loops, actionCalls) */
	elementType: string;
	/** Element subtype for categorization */
	subtype: string;
	/** Label */
	label?: string;
	/** Description */
	description?: string;
	/** Location X coordinate */
	locationX?: string;
	/** Location Y coordinate */
	locationY?: string;
	/** Connectors */
	connector?: FlowConnector;
	/** Fault connector (error handling) */
	faultConnector?: FlowConnector;
	/** Next value connector (for loops) */
	nextValueConnector?: FlowConnector;
	/** No more values connector (for loops) */
	noMoreValuesConnector?: FlowConnector;
	/** Default connector (for decisions) */
	defaultConnector?: FlowConnector;
	/** Rules (for decisions) */
	rules?: DecisionRule[];
	/** Object being queried/created/updated */
	object?: string;
	/** Filters (for Get Records) */
	filters?: RecordFilter[];
	/** Filter logic */
	filterLogic?: string;
	/** Assign null values if no records found */
	assignNullValuesIfNoRecordsFound?: boolean;
	/** Get all fields */
	getFirstRecordOnly?: boolean;
	/** Store output automatically */
	storeOutputAutomatically?: boolean;
	/** Input assignments (for Record Creates/Updates) */
	inputAssignments?: FieldAssignment[];
	/** Input reference (for Record Updates/Deletes) */
	inputReference?: string;
	/** Collection reference (for loops) */
	collectionReference?: string;
	/** Iteration order (for loops) */
	iterationOrder?: string;
	/** Action name (for Action Calls) */
	actionName?: string;
	/** Action type (for Action Calls) */
	actionType?: string;
	/** Flow API name (for Subflow calls) */
	flowName?: string;
	/** Input parameters */
	inputParameters?: Parameter[];
	/** Output parameters */
	outputParameters?: Parameter[];
	/** Assignments (for Assignment elements) */
	assignmentItems?: AssignmentItem[];
	/** Original element data */
	element: any;
}

export interface FlowConnector {
	/** Target element reference */
	targetReference?: string;
}

export interface DecisionRule {
	/** Rule name */
	name: string;
	/** Rule label */
	label?: string;
	/** Connector */
	connector?: FlowConnector;
	/** Conditions */
	conditions?: RuleCondition[];
}

export interface RuleCondition {
	/** Left value reference */
	leftValueReference?: string;
	/** Operator */
	operator?: string;
	/** Right value */
	rightValue?: any;
}

export interface RecordFilter {
	/** Field */
	field: string;
	/** Operator */
	operator: string;
	/** Value */
	value?: any;
}

export interface FieldAssignment {
	/** Field */
	field: string;
	/** Value */
	value?: any;
}

export interface Parameter {
	/** Name */
	name: string;
	/** Value */
	value?: any;
}

export interface AssignmentItem {
	/** Assignee reference */
	assignToReference: string;
	/** Operator */
	operator: string;
	/** Value */
	value?: any;
}

/**
 * Represents a Flow variable, formula, constant, etc.
 */
export interface FlowVariable {
	/** Variable name */
	name: string;
	/** Data type */
	dataType: string;
	/** Is collection */
	isCollection?: boolean;
	/** Is input */
	isInput?: boolean;
	/** Is output */
	isOutput?: boolean;
	/** Object type (for sObject variables) */
	objectType?: string;
	/** Description */
	description?: string;
	/** Value (for constants) */
	value?: any;
	/** Expression (for formulas) */
	expression?: string;
	/** Default value */
	defaultValue?: any;
}

/**
 * Represents a violation/issue found in a Flow
 */
export interface Violation {
	/** Element name where violation occurred */
	name: string;
	/** Element type */
	type: string;
	/** Meta type (node, variable, attribute) */
	metaType: string;
	/** Line number in XML */
	lineNumber: number;
	/** Column number in XML */
	columnNumber: number;
	/** Additional details */
	details?: any;
}

/**
 * Represents the result of applying a rule to a flow
 */
export interface RuleResult {
	/** Rule name */
	ruleName: string;
	/** Whether violations occurred */
	occurs: boolean;
	/** List of violations */
	details: Violation[];
	/** Severity level */
	severity: 'error' | 'warning' | 'note';
	/** Error message (if rule execution failed) */
	errorMessage?: string;
}

/**
 * Represents the result of scanning a flow
 */
export interface ScanResult {
	/** Flow that was scanned */
	flow: Flow;
	/** Results from all rules */
	ruleResults: RuleResult[];
}

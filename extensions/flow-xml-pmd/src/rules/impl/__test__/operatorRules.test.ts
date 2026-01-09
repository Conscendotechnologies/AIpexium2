/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Test cases for operator validation rules
 *
 * This file demonstrates the three new operator validation rules:
 * 1. FlowAssignmentOperatorRule
 * 2. FlowComparisonOperatorRule
 * 3. FlowRecordFilterOperatorRule
 */

import { Flow, FlowElement, FlowVariable, RecordFilter, AssignmentItem, DecisionRule, RuleCondition } from '../../../models/flowModels';
import { FlowAssignmentOperatorRule, FlowComparisonOperatorRule, FlowRecordFilterOperatorRule } from '../metadataRules';

/**
 * Helper to create a basic flow for testing
 */
function createTestFlow(elements: FlowElement[]): Flow {
	return {
		fullName: 'Test_Flow',
		processType: 'AutoLaunchedFlow',
		status: 'Active',
		apiVersion: '65.0',
		elements,
		variables: [],
		formulas: [],
		constants: [],
		textTemplates: [],
		choices: [],
		stages: [],
		xmldata: {}
	};
}

/**
 * Test FlowAssignmentOperatorRule
 */
function testAssignmentOperatorRule() {
	const rule = new FlowAssignmentOperatorRule();

	// Test 1: Valid operator
	const validElement: FlowElement = {
		name: 'Set_Account_Name',
		elementType: 'assignments',
		subtype: 'assignment',
		assignmentItems: [
			{
				assignToReference: 'AccountName',
				operator: 'Assign', // Valid
				value: { stringValue: 'Acme Corp' }
			}
		],
		element: {}
	};

	// Test 2: Invalid operator
	const invalidElement: FlowElement = {
		name: 'Set_Counter',
		elementType: 'assignments',
		subtype: 'assignment',
		assignmentItems: [
			{
				assignToReference: 'Counter',
				operator: 'Equals', // Invalid - should be 'Assign' or 'Add'
				value: { numberValue: 1 }
			}
		],
		element: {}
	};

	// Test 3: Missing operator
	const missingOpElement: FlowElement = {
		name: 'Add_To_List',
		elementType: 'assignments',
		subtype: 'assignment',
		assignmentItems: [
			{
				assignToReference: 'AccountList',
				operator: '', // Missing
				value: { elementReference: 'Account' }
			}
		],
		element: {}
	};

	const validFlow = createTestFlow([validElement]);
	const invalidFlow = createTestFlow([invalidElement]);
	const missingFlow = createTestFlow([missingOpElement]);

	console.log('Testing FlowAssignmentOperatorRule:');
	console.log('Valid flow violations:', rule.execute(validFlow)); // Should be []
	console.log('Invalid flow violations:', rule.execute(invalidFlow)); // Should have 1 violation
	console.log('Missing operator violations:', rule.execute(missingFlow)); // Should have 1 violation
}

/**
 * Test FlowComparisonOperatorRule
 */
function testComparisonOperatorRule() {
	const rule = new FlowComparisonOperatorRule();

	// Test 1: Valid operator
	const validElement: FlowElement = {
		name: 'Check_Status',
		elementType: 'decisions',
		subtype: 'decision',
		rules: [
			{
				name: 'Is_Active',
				conditions: [
					{
						leftValueReference: 'Account.Status__c',
						operator: 'EqualTo', // Valid
						rightValue: { stringValue: 'Active' }
					}
				]
			}
		],
		element: {}
	};

	// Test 2: Invalid operator
	const invalidElement: FlowElement = {
		name: 'Check_Amount',
		elementType: 'decisions',
		subtype: 'decision',
		rules: [
			{
				name: 'Is_Greater',
				conditions: [
					{
						leftValueReference: 'Amount',
						operator: 'GreatherThan', // Typo - should be 'GreaterThan'
						rightValue: { numberValue: 1000 }
					}
				]
			}
		],
		element: {}
	};

	// Test 3: Missing operator
	const missingOpElement: FlowElement = {
		name: 'Check_Name',
		elementType: 'decisions',
		subtype: 'decision',
		rules: [
			{
				name: 'Has_Name',
				conditions: [
					{
						leftValueReference: 'Name',
						operator: '', // Missing
						rightValue: { elementReference: 'ExpectedName' }
					}
				]
			}
		],
		element: {}
	};

	const validFlow = createTestFlow([validElement]);
	const invalidFlow = createTestFlow([invalidElement]);
	const missingFlow = createTestFlow([missingOpElement]);

	console.log('Testing FlowComparisonOperatorRule:');
	console.log('Valid flow violations:', rule.execute(validFlow)); // Should be []
	console.log('Invalid flow violations:', rule.execute(invalidFlow)); // Should have 1 violation
	console.log('Missing operator violations:', rule.execute(missingFlow)); // Should have 1 violation
}

/**
 * Test FlowRecordFilterOperatorRule
 */
function testRecordFilterOperatorRule() {
	const rule = new FlowRecordFilterOperatorRule();

	// Test 1: Valid operator
	const validElement: FlowElement = {
		name: 'Get_Active_Accounts',
		elementType: 'recordLookups',
		subtype: 'recordLookup',
		object: 'Account',
		filters: [
			{
				field: 'Status__c',
				operator: 'EqualTo', // Valid
				value: { stringValue: 'Active' }
			}
		],
		element: {}
	};

	// Test 2: Invalid operator
	const invalidElement: FlowElement = {
		name: 'Get_Recent_Opportunities',
		elementType: 'recordLookups',
		subtype: 'recordLookup',
		object: 'Opportunity',
		filters: [
			{
				field: 'CreatedDate',
				operator: 'GreaterThanOrEqual', // Invalid - should be 'GreaterThanOrEqualTo'
				value: { dateValue: '2024-01-01' }
			}
		],
		element: {}
	};

	// Test 3: Missing operator
	const missingOpElement: FlowElement = {
		name: 'Get_Contacts',
		elementType: 'recordLookups',
		subtype: 'recordLookup',
		object: 'Contact',
		filters: [
			{
				field: 'Email',
				operator: '', // Missing
				value: { elementReference: 'SearchEmail' }
			}
		],
		element: {}
	};

	const validFlow = createTestFlow([validElement]);
	const invalidFlow = createTestFlow([invalidElement]);
	const missingFlow = createTestFlow([missingOpElement]);

	console.log('Testing FlowRecordFilterOperatorRule:');
	console.log('Valid flow violations:', rule.execute(validFlow)); // Should be []
	console.log('Invalid flow violations:', rule.execute(invalidFlow)); // Should have 1 violation
	console.log('Missing operator violations:', rule.execute(missingFlow)); // Should have 1 violation
}

/**
 * Run all tests
 */
export function runOperatorValidationTests() {
	console.log('=== Operator Validation Rules Tests ===\n');
	testAssignmentOperatorRule();
	console.log('\n');
	testComparisonOperatorRule();
	console.log('\n');
	testRecordFilterOperatorRule();
	console.log('\n=== Tests Complete ===');
}

// Example usage of the rules
export function exampleUsage() {
	// These rules are automatically loaded by RuleManager
	// and will be applied when validating flows

	// To use manually:
	const assignmentRule = new FlowAssignmentOperatorRule();
	const comparisonRule = new FlowComparisonOperatorRule();
	const filterRule = new FlowRecordFilterOperatorRule();

	// Create a test flow and validate
	const testFlow: Flow = {
		fullName: 'Example_Flow',
		processType: 'Flow',
		status: 'Active',
		apiVersion: '65.0',
		elements: [
			// Add elements to test
		],
		variables: [],
		formulas: [],
		constants: [],
		textTemplates: [],
		choices: [],
		stages: [],
		xmldata: {}
	};

	const violations = [
		...assignmentRule.execute(testFlow),
		...comparisonRule.execute(testFlow),
		...filterRule.execute(testFlow)
	];

	console.log('Total violations found:', violations.length);
	violations.forEach(v => {
		console.log(`- ${v.name}: ${v.details?.message}`);
	});
}

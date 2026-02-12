# Flow Operator Validation Rules

## Overview

Three new validation rules have been added to the Flow XML PMD extension to validate operator values used in Salesforce Flow elements. These rules ensure that only valid operator enumeration values from the Salesforce Metadata API are used, preventing deployment errors.

## Rules

### 1. FlowAssignmentOperatorRule

**Name:** `FlowAssignmentOperator`
**Label:** Invalid Assignment Operator
**Severity:** Error

#### Description
Validates that assignment operators in Assignment elements use valid `FlowAssignmentOperator` enumeration values from the Salesforce Metadata API.

#### Valid Operators
- `None`
- `Assign` - Sets the value
- `Add` - Adds numeric values
- `Subtract` - Subtracts numeric values
- `AddItem` - Adds an item to a collection
- `RemoveFirst` - Removes first occurrence from collection
- `RemoveBeforeFirst` - Removes all items before first match
- `RemoveAfterFirst` - Removes all items after first match
- `RemoveAll` - Removes all matching items from collection
- `AddAtStart` - Adds item at the start of collection
- `RemoveUncommon` - Removes items not in both collections
- `AssignCount` - Assigns the count of collection items
- `RemovePosition` - Removes item at specific position

#### What It Checks
- Validates all assignment items within Assignment elements
- Ensures operators are present (not missing)
- Verifies operators match valid enumeration values
- Provides suggestions for similar valid operators when invalid ones are detected

#### Example Violations

```xml
<!-- Missing operator -->
<assignments>
    <name>Set_Account_Name</name>
    <assignmentItems>
        <assignToReference>AccountName</assignToReference>
        <!-- Missing operator -->
        <value>
            <stringValue>Acme Corp</stringValue>
        </value>
    </assignmentItems>
</assignments>

<!-- Invalid operator -->
<assignments>
    <name>Set_Account_Name</name>
    <assignmentItems>
        <assignToReference>AccountName</assignToReference>
        <operator>Equals</operator> <!-- Should be "Assign" -->
        <value>
            <stringValue>Acme Corp</stringValue>
        </value>
    </assignmentItems>
</assignments>
```

---

### 2. FlowComparisonOperatorRule

**Name:** `FlowComparisonOperator`
**Label:** Invalid Comparison Operator
**Severity:** Error

#### Description
Validates that comparison operators in Decision element conditions use valid `FlowComparisonOperator` enumeration values from the Salesforce Metadata API.

#### Valid Operators
- `None`
- `EqualTo` - Checks equality
- `NotEqualTo` - Checks inequality
- `GreaterThan` - Numeric/date greater than
- `LessThan` - Numeric/date less than
- `GreaterThanOrEqualTo` - Greater than or equal
- `LessThanOrEqualTo` - Less than or equal
- `StartsWith` - String starts with value
- `EndsWith` - String ends with value
- `Contains` - String contains value
- `IsNull` - Value is null
- `IsChanged` - Value changed (record-triggered flows)
- `WasSet` - Field was populated (screen flows)
- `WasSelected` - Choice was selected (screen flows)
- `WasVisited` - Screen was visited (screen flows)
- `In` - Value is in collection
- `NotIn` - Value is not in collection
- `IsBlank` - Text field is blank
- `IsEmpty` - Collection is empty
- `HasError` - Element has error

#### What It Checks
- Validates all conditions within Decision element rules
- Ensures operators are present in each condition
- Verifies operators match valid enumeration values
- Provides helpful suggestions for misspelled operators

#### Example Violations

```xml
<!-- Missing operator -->
<decisions>
    <name>Check_Status</name>
    <rules>
        <name>Is_Active</name>
        <conditions>
            <leftValueReference>Account.Status__c</leftValueReference>
            <!-- Missing operator -->
            <rightValue>
                <stringValue>Active</stringValue>
            </rightValue>
        </conditions>
    </rules>
</decisions>

<!-- Invalid operator -->
<decisions>
    <name>Check_Status</name>
    <rules>
        <name>Is_Active</name>
        <conditions>
            <leftValueReference>Account.Status__c</leftValueReference>
            <operator>Equals</operator> <!-- Should be "EqualTo" -->
            <rightValue>
                <stringValue>Active</stringValue>
            </rightValue>
        </conditions>
    </rules>
</decisions>
```

---

### 3. FlowRecordFilterOperatorRule

**Name:** `FlowRecordFilterOperator`
**Label:** Invalid Record Filter Operator
**Severity:** Error

#### Description
Validates that filter operators in Get Records elements use valid `FlowRecordFilterOperator` enumeration values from the Salesforce Metadata API.

#### Valid Operators
- `EqualTo` - Field equals value
- `NotEqualTo` - Field does not equal value
- `GreaterThan` - Field is greater than value
- `LessThan` - Field is less than value
- `GreaterThanOrEqualTo` - Field is >= value
- `LessThanOrEqualTo` - Field is <= value
- `StartsWith` - Field starts with value
- `EndsWith` - Field ends with value
- `Contains` - Field contains value
- `IsNull` - Field is null
- `IsChanged` - Field changed (record-triggered flows)
- `In` - Field value in list
- `NotIn` - Field value not in list

#### What It Checks
- Validates all filters within Get Records (recordLookups) elements
- Ensures operators are present for each filter
- Verifies operators match valid enumeration values
- Provides context including the field being filtered

#### Example Violations

```xml
<!-- Missing operator -->
<recordLookups>
    <name>Get_Active_Accounts</name>
    <object>Account</object>
    <filters>
        <field>Status__c</field>
        <!-- Missing operator -->
        <value>
            <stringValue>Active</stringValue>
        </value>
    </filters>
</recordLookups>

<!-- Invalid operator -->
<recordLookups>
    <name>Get_Active_Accounts</name>
    <object>Account</object>
    <filters>
        <field>Status__c</field>
        <operator>Equals</operator> <!-- Should be "EqualTo" -->
        <value>
            <stringValue>Active</stringValue>
        </value>
    </filters>
</recordLookups>
```

---

## Features

### Smart Suggestions
All three rules include intelligent suggestion mechanisms:
- **Fuzzy matching** - Suggests similar valid operators (e.g., "Equals" → "EqualTo")
- **Context-aware** - Shows the most relevant operators based on common usage
- **Helpful messages** - Clear explanations with element and field names

### Detailed Context
Violations include rich contextual information:
- Element name where violation occurred
- For assignments: assignment item index
- For decisions: rule name and condition index
- For filters: field name and filter index

### Suppression Support
All rules support the standard suppression mechanism:
- Suppress by element name
- Wildcard suppression (`*`) to disable entire rule

## Configuration

### Enable/Disable Rules

Add to `.vscode/settings.json`:

```json
{
  "flowXmlPmd.rules.FlowAssignmentOperator.enabled": true,
  "flowXmlPmd.rules.FlowComparisonOperator.enabled": true,
  "flowXmlPmd.rules.FlowRecordFilterOperator.enabled": true
}
```

### Rule Severity

These rules are set to **error** severity by default since using invalid operators will cause Salesforce deployment failures.

## Benefits

1. **Early Detection** - Catch operator errors during development, not deployment
2. **Clear Feedback** - Detailed messages explain exactly what's wrong and how to fix it
3. **Time Savings** - Avoid deployment failures and debugging invalid operators
4. **Standards Compliance** - Ensures flows use only Salesforce-approved operators
5. **Learning Tool** - Helpful suggestions teach developers the correct operator names

## Implementation Details

### Architecture
- All three rules extend `RuleBase`
- Use static Sets for efficient operator validation
- Include private `getSuggestion()` helper for fuzzy matching
- Follow existing rule patterns for consistency

### Performance
- O(1) validation using Set lookups
- No external dependencies
- Minimal memory footprint (static operator sets)

### Testing
To test these rules, create flows with:
- Missing operators
- Misspelled operators (e.g., "Equals" instead of "EqualTo")
- Invalid operator names
- Multiple violations in single elements

## References

- [Salesforce Flow Metadata API](https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_visual_workflow.htm)
- [Flow Assignment Operators](https://help.salesforce.com/s/articleView?id=sf.flow_ref_elements_assignment_operators.htm)
- [Flow Comparison Operators](https://help.salesforce.com/s/articleView?id=sf.flow_ref_operators_decision.htm)
- [SOQL Filter Operators](https://developer.salesforce.com/docs/atlas.en-us.soql_sosl.meta/soql_sosl/sforce_api_calls_soql_select_comparisonoperators.htm)

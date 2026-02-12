# Flow XML PMD

PMD-style validation and linting for Salesforce Flow XML files, inspired by [Lightning Flow Scanner](https://github.com/Flow-Scanner/lightning-flow-scanner).

## Features

- **Real-time validation** of Flow XML files as you edit
- **21+ built-in rules** covering performance, security, and best practices
- **Dynamic rule loading** - add your own custom rules
- **Configurable severity levels** - error, warning, or note
- **Exception handling** - suppress rules for specific flows or elements
- **Rule modes** - merged (default + custom) or isolated (only configured)

## Built-in Rules

### Performance & Governor Limits

#### DMLStatementInLoop 🔴
**Severity:** Error
**Description:** Detects DML operations (Create, Update, Delete Records) inside loops. This violates Salesforce governor limits as DML operations should be bulkified.
**Supported Flow Types:** All
**Why it matters:** Each DML operation consumes from your per-transaction limit (150 DML statements). Performing DML in a loop can quickly exhaust this limit.
**How to fix:** Collect records in a collection variable inside the loop, then perform a single DML operation after the loop completes.
**Configuration Options:** None

#### SOQLQueryInLoop 🔴
**Severity:** Error
**Description:** Detects SOQL queries (Get Records) inside loops. This violates Salesforce governor limits as queries should be performed outside loops.
**Supported Flow Types:** All
**Why it matters:** Each SOQL query consumes from your per-transaction limit (100 SOQL queries). Running queries in loops can exhaust this limit and cause runtime failures.
**How to fix:** Move Get Records elements outside the loop and use filters to retrieve all necessary records at once. Use collections to process the results.
**Configuration Options:** None

#### ActionCallsInLoop 🔴
**Severity:** Error
**Description:** Detects action/subflow calls inside loops. Repeated action calls in loops can hit governor limits and cause performance issues.
**Supported Flow Types:** All
**Why it matters:** Actions may perform DML/SOQL internally, multiplying governor limit consumption. Each invocation consumes from limits (100 callouts, 150 DML statements, etc.).
**How to fix:** Refactor to batch process records before invoking actions, or redesign the action to accept collections.
**Configuration Options:** None

#### MissingRecordFilter 🟡
**Severity:** Warning
**Description:** Warns when Get Records operations lack filter criteria. Unfiltered queries can retrieve excessive records, causing performance issues.
**Supported Flow Types:** All
**Why it matters:** Queries without filters may return large result sets, consuming heap memory and causing slow performance or heap size exceptions.
**How to fix:** Add filter conditions to Get Records to retrieve only necessary records. Use indexed fields in filters for better performance.
**Configuration Options:** None

---

### Security & Best Practices

#### HardcodedId 🔴
**Severity:** Error
**Description:** Detects hardcoded Salesforce IDs (15 or 18 character alphanumeric strings). Hardcoded IDs break when deploying between orgs (sandbox → production).
**Supported Flow Types:** All
**Why it matters:** Salesforce IDs are org-specific and will differ between environments, causing runtime failures in other orgs.
**How to fix:** Use Custom Metadata Types, Custom Labels, or dynamic SOQL queries to retrieve IDs at runtime based on names or unique external identifiers.
**Configuration Options:** None

#### MissingNullHandler 🟡
**Severity:** Warning
**Description:** Checks if Get Records operations are followed by null checks (Decision elements). Failing to check for null results can cause NullPointerExceptions.
**Supported Flow Types:** All
**Why it matters:** When no records are found, proceeding without null checks causes errors. Always verify records exist before processing.
**How to fix:** Add a Decision element after Get Records to check if the result is null or empty before proceeding with record processing.
**Configuration Options:** None

#### MissingFaultPath 🟡
**Severity:** Warning
**Description:** Checks if DML operations and action calls have fault paths (error handling). Missing error handling causes flows to fail silently or expose errors to users.
**Supported Flow Types:** All
**Why it matters:** Runtime errors (permission issues, validation rules, etc.) cause flows to fail. Fault paths allow graceful error handling and logging.
**How to fix:** Configure the Fault Connector on DML/Action elements to route to error handling logic (notifications, logging, user messages).
**Configuration Options:** None

---

### Quality & Maintenance

#### UnconnectedElement 🟡
**Severity:** Warning
**Description:** Detects flow elements that are not connected to the flow execution path. These "orphaned" elements are never executed and clutter the flow.
**Supported Flow Types:** All
**Why it matters:** Unconnected elements indicate incomplete development, confuse maintainers, increase flow complexity, and waste metadata storage.
**How to fix:** Either connect the element to the flow path, or delete it if no longer needed. Review flow logic to ensure all elements serve a purpose.
**Configuration Options:** None

#### MissingConnector 🔴
**Severity:** Error
**Description:** Ensures all non-terminal elements have valid outbound connectors. Elements without connectors create dead-ends in flow execution.
**Supported Flow Types:** All
**Why it matters:** Elements without connectors halt flow execution unexpectedly. Every non-terminal element should connect to the next step.
**How to fix:** Add a connector from the element to the next flow element. Terminal elements (like assignments at the end) don't need connectors.
**Configuration Options:** None

#### MissingLabel 🟡
**Severity:** Warning
**Description:** Ensures all flow elements have descriptive labels. Missing labels make flows harder to understand and maintain.
**Supported Flow Types:** All
**Why it matters:** Labels appear in Flow Builder UI and help developers understand element purpose. Clear labels improve maintainability and debugging.
**How to fix:** Add meaningful labels to all flow elements that describe their purpose (e.g., "Get Active Accounts" instead of leaving blank).
**Configuration Options:** None

#### DuplicateAPIName 🔴
**Severity:** Error
**Description:** Detects multiple elements with identical API names. Duplicate names cause deployment failures and ambiguous references.
**Supported Flow Types:** All
**Why it matters:** Salesforce requires unique API names for all elements. Duplicates cause metadata deployment errors and make debugging difficult.
**How to fix:** Rename duplicate elements with unique, descriptive names (e.g., "Get_Account_1", "Get_Account_2" or better: "Get_Billing_Account", "Get_Shipping_Account").
**Configuration Options:** None

#### FlowDescription 🔴
**Severity:** Error
**Description:** Ensures flows have descriptions. Descriptions help developers understand flow purpose and business logic.
**Supported Flow Types:** All
**Why it matters:** Without descriptions, developers must read the entire flow to understand its purpose. Good documentation improves maintainability.
**How to fix:** Add a clear description in Flow Properties explaining what the flow does, when it runs, and any important business context.
**Configuration Options:** None

#### InactiveFlow 🟡
**Severity:** Warning
**Description:** Flags flows with status "Draft" or "Obsolete". Inactive flows in production indicate incomplete work or technical debt.
**Supported Flow Types:** All
**Why it matters:** Draft flows aren't executed. Obsolete flows waste storage. Both clutter the org and confuse developers.
**How to fix:** Activate draft flows when ready, or delete them. Archive or delete obsolete flows. Keep only active flows in production.
**Configuration Options:** None

#### ValidationBeforeDML 🔵
**Severity:** Note
**Description:** Suggests adding validation (Decision elements) before DML operations. Validation prevents unnecessary DML and ensures data quality.
**Supported Flow Types:** All
**Why it matters:** Performing DML without validation can create invalid records, trigger validation rule errors, or waste governor limits.
**How to fix:** Add Decision elements before DML operations to validate record data, check required fields, and enforce business rules.
**Configuration Options:** None

---

### Complexity & Maintainability

#### UnusedVariable 🟡
**Severity:** Warning
**Description:** Detects unused variables, formulas, constants, and text templates. Unused resources clutter flows and consume metadata storage.
**Supported Flow Types:** All
**Why it matters:** Unused resources confuse developers, increase maintenance burden, and waste metadata limits. Clean flows are easier to understand and maintain.
**How to fix:** Delete unused variables/formulas/constants, or use them if they serve a purpose. Review formula dependencies before deletion.
**Configuration Options:** None

#### FlowDepth 🟡
**Severity:** Warning
**Description:** Calculates flow depth (nesting levels) using breadth-first search. Warns when depth exceeds threshold, indicating overly complex flows.
**Supported Flow Types:** All
**Why it matters:** Deeply nested flows are hard to understand, debug, and maintain. High complexity increases risk of logic errors and makes testing difficult.
**How to fix:** Refactor complex logic into subflows. Break down monolithic flows into smaller, focused flows. Consider using invocable actions for reusable logic.
**Configuration Options:**
- `maxDepth` (default: 5) - Maximum allowed nesting depth before warning

#### TooManyElements 🟡
**Severity:** Warning
**Description:** Warns when total element count exceeds threshold. Large flows are difficult to maintain and perform poorly in Flow Builder.
**Supported Flow Types:** All
**Why it matters:** Flows with many elements are slow to load in Flow Builder, hard to understand, and difficult to debug. They indicate poor separation of concerns.
**How to fix:** Split large flows into multiple focused flows. Extract reusable logic into subflows. Consider using invocable Apex for complex operations.
**Configuration Options:**
- `maxElements` (default: 50) - Maximum elements before warning

---

### Metadata & Documentation

#### APIVersion 🟡
**Severity:** Warning
**Description:** Validates flow API version against configured expression. Ensures flows use modern API versions with latest features and fixes.
**Supported Flow Types:** All
**Why it matters:** Older API versions may lack features, have known bugs, or use deprecated behavior. Using current API versions ensures best practices.
**How to fix:** Update flow API version in Flow Properties to meet minimum version requirement (typically latest GA version).
**Configuration Options:**
- `expression` (default: ">=50") - Version comparison expression (>=, >, <=, <, ===, !==)

#### FlowName 🔴
**Severity:** Error
**Description:** Validates flow names against regex pattern. Enforces naming conventions for consistency across the org.
**Supported Flow Types:** All
**Why it matters:** Consistent naming conventions improve discoverability, indicate flow purpose/category, and support governance policies.
**How to fix:** Rename flow to match required pattern (e.g., "ObjectName_Purpose_Flow" or "Department_ProcessName").
**Configuration Options:**
- `expression` (default: "[A-Za-z0-9]+") - Regex pattern for valid flow names

#### ProcessType 🔴
**Severity:** Error
**Description:** Validates `processType` against allowed Salesforce FlowProcessType values. Invalid types cause deployment failures.
**Supported Flow Types:** All
**Why it matters:** `processType` must match valid Salesforce values: AutoLaunchedFlow, Flow, Workflow, CustomEvent, InvocableProcess, etc. Invalid values break deployment.
**How to fix:** Set `processType` to a valid value based on flow trigger type:
- Screen Flows: `Flow`
- Autolaunched: `AutoLaunchedFlow`
- Record-Triggered: `AutoLaunchedFlow`
- Platform Events: `CustomEvent`
- Processes: `Workflow` (legacy)
**Configuration Options:** None

---

🔴 Error | 🟡 Warning | 🔵 Note

## Usage

### Automatic Validation
Flow XML files are automatically validated when:
- Opened in the editor
- Saved
- Modified (with 500ms debounce)

### Status Bar Button
A **"✓ Flow PMD"** button appears in the status bar when a Flow XML file (`.flow-meta.xml`) is open:
- Click to manually trigger validation
- Shows/hides automatically based on active editor
- Quick access without using command palette

### Commands

**Flow XML PMD: Validate Current File**
- Validate the currently open Flow XML file
- Also accessible via status bar button
- Keyboard shortcut: Configure in VS Code

**Flow XML PMD: Validate All Flow Files**
- Scan all `.flow-meta.xml` files in workspace
- Shows progress notification

**Flow XML PMD: Show Available Rules**
- Browse all available rules with descriptions
- See which rules are active

**Flow XML PMD: Configure Rules**
- Enable/disable rules interactively
- Quick configuration via UI

**Flow XML PMD: Clear All Diagnostics**
- Clear all validation markers

**Flow XML PMD: Add Custom Rule**
- Generate custom rule template
- Scaffold new rule with boilerplate

## Configuration

### Basic Settings

\`\`\`json
{
  "flowXmlPmd.enabled": true,
  "flowXmlPmd.validateOnOpen": true,
  "flowXmlPmd.validateOnSave": true,
  "flowXmlPmd.ruleMode": "merged"
}
\`\`\`

### Rule Configuration

\`\`\`json
{
  "flowXmlPmd.rules": {
    "HardcodedId": {
      "severity": "error",
      "enabled": true
    },
    "APIVersion": {
      "severity": "warning",
      "enabled": true,
      "expression": ">=50"
    },
    "FlowName": {
      "severity": "error",
      "enabled": true,
      "expression": "[A-Za-z0-9]+_[A-Za-z0-9]+"
    },
    "DMLStatementInLoop": {
      "severity": "error",
      "enabled": true
    }
  }
}
\`\`\`

### Exception Configuration

Suppress specific rules for specific flows:

\`\`\`json
{
  "flowXmlPmd.exceptions": {
    "Account_Automation_Flow": {
      "HardcodedId": ["Legacy_Account_Lookup"],
      "MissingNullHandler": ["*"]
    }
  }
}
\`\`\`

### Rule Modes

**Merged Mode** (default)
- All default rules are active
- Custom configuration overrides defaults
- Disable specific rules by setting `enabled: false`

**Isolated Mode**
- Only explicitly configured rules run
- Useful for gradual adoption

\`\`\`json
{
  "flowXmlPmd.ruleMode": "isolated"
}
\`\`\`

## Custom Rules

### Creating Custom Rules

1. Set custom rules path:
   \`\`\`json
   {
     "flowXmlPmd.customRulesPath": ".flowpmd/rules"
   }
   \`\`\`

2. Use command: **Flow XML PMD: Add Custom Rule**

3. Implement rule logic:

\`\`\`typescript
import { Flow, Violation } from '../models/flowModels';
import { RuleBase } from '../rules/ruleBase';

export default class MyCustomRule extends RuleBase {
    constructor() {
        super({
            name: 'MyCustomRule',
            label: 'My Custom Rule',
            description: 'Validates custom business logic',
            severity: 'warning',
            supportedTypes: ['AutoLaunchedFlow', 'Flow'],
            docRefs: []
        });
    }

    protected check(flow: Flow, options: any, suppressions: Set<string>): Violation[] {
        const violations: Violation[] = [];

        // Your validation logic here
        for (const element of flow.elements) {
            if (/* condition */) {
                violations.push(this.createViolation(
                    element.name,
                    element.elementType,
                    'node'
                ));
            }
        }

        return violations;
    }
}
\`\`\`

4. Save file in custom rules directory

5. Reload VS Code or trigger rule reload

### Custom Rule API

**Base Classes:**
- `RuleBase` - Standard rule implementation
- `LoopRuleBase` - Specialized for detecting elements in loops

**Available Models:**
- `Flow` - Complete flow structure
- `FlowElement` - Individual flow elements (nodes)
- `FlowVariable` - Variables, formulas, constants
- `Violation` - Rule violation/issue

**Helper Methods:**
- `createViolation(name, type, metaType, details?)` - Create violation
- `isSuppressed(name, suppressions)` - Check if suppressed

## Rule Configuration Reference

### Configurable Expressions

**APIVersion**
- Operators: `>=`, `<=`, `>`, `<`, `===`, `!==`
- Example: `"expression": ">=58"`

**FlowName**
- Regular expression pattern
- Example: `"expression": "[A-Za-z0-9]+_[A-Za-z0-9]+"`

### Severity Levels
- `error` 🔴 - Critical issues that should be fixed
- `warning` 🟡 - Important issues that should be reviewed
- `note` 🔵 - Suggestions and informational items

## Integration

### With Salesforce DX

Add to `.sfdx/sfdx-config.json`:

\`\`\`json
{
  "customTooling": {
    "flowValidation": true
  }
}
\`\`\`

### With CI/CD

The extension uses standard VS Code diagnostics that can be captured in CI pipelines.

## Inspired By

This extension is inspired by the excellent [Lightning Flow Scanner](https://github.com/Flow-Scanner/lightning-flow-scanner) project. We've adapted many of their rules and patterns while integrating deeply with the VS Code IDE experience.

## Contributing

Contributions welcome! Key areas:
- Additional rules from Flow Scanner
- Performance optimizations
- Enhanced diagnostics
- Better XML line number detection

## License

MIT License - See LICENSE file for details

## Feedback

Report issues or suggest features on the GitHub repository.

---

**Made with ❤️ for Salesforce Flow developers**

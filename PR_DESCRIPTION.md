# Flow XML PMD Extension

## Summary

Adds a comprehensive PMD-style validation and linting extension for Salesforce Flow XML files. This extension provides real-time validation, configurable rules, and custom rule support to help developers write better, more maintainable Salesforce Flows.

**Inspired by:** [Lightning Flow Scanner](https://github.com/Flow-Scanner/lightning-flow-scanner)

## Key Features

### 🎯 Real-Time Validation
- Automatic validation on file open, save, and edit (with 500ms debounce)
- Status bar button for manual validation
- Workspace-wide validation command
- VS Code diagnostics integration with inline error markers

### 📋 11+ Built-In Rules

**Performance & Governor Limits:**
- `DMLStatementInLoop` - Detects DML operations inside loops
- `SOQLQueryInLoop` - Detects SOQL queries inside loops
- `ActionCallsInLoop` - Detects action/subflow calls inside loops

**Security & Best Practices:**
- `HardcodedId` - Detects hardcoded Salesforce IDs
- `MissingNullHandler` - Ensures Get Records operations have null checks
- `MissingFaultPath` - Ensures DML/actions have error handling

**Quality & Maintenance:**
- `UnconnectedElement` - Detects orphaned flow elements
- `FlowDescription` - Ensures flows have descriptions
- `InactiveFlow` - Flags draft/obsolete flows

**Metadata & Documentation:**
- `APIVersion` - Validates API version (configurable expression)
- `FlowName` - Validates flow naming conventions (regex pattern)

### ⚙️ Flexible Configuration

```json
{
  "flowXmlPmd.enabled": true,
  "flowXmlPmd.validateOnOpen": true,
  "flowXmlPmd.validateOnSave": true,
  "flowXmlPmd.ruleMode": "merged",
  "flowXmlPmd.rules": {
    "HardcodedId": {
      "severity": "error",
      "enabled": true
    },
    "APIVersion": {
      "severity": "warning",
      "enabled": true,
      "expression": ">=50"
    }
  },
  "flowXmlPmd.exceptions": {
    "Example_Flow": {
      "HardcodedId": ["Specific_Element_Name"]
    }
  }
}
```

### 🔧 Custom Rules Support
- Dynamic rule loading from custom directory
- Command to scaffold new rule templates
- Base classes: `RuleBase` and `LoopRuleBase`
- Full access to flow structure and elements

### 🎨 User Experience
- Status bar integration with "✓ Flow PMD" button
- 7 interactive commands via command palette
- Context menu integration for Flow XML files
- Comprehensive documentation with rule examples

## Architecture

### Core Components

1. **Configuration Manager** (`config/configurationManager.ts`)
   - Handles VS Code settings integration
   - Provides rule configuration and exceptions
   - Supports merged/isolated rule modes

2. **XML Parser** (`parser/flowXMLParser.ts`)
   - Fast XML parsing using `fast-xml-parser`
   - Converts XML to structured Flow models
   - Preserves metadata for diagnostics

3. **Rule System** (`rules/`)
   - `ruleBase.ts` - Base class for standard rules
   - `ruleManager.ts` - Dynamic rule loading and execution
   - `impl/` - Built-in rule implementations
     - `hardcodedIdRule.ts` - ID detection
     - `loopRules.ts` - Loop-based violations
     - `metadataRules.ts` - Metadata validation
     - `qualityRules.ts` - Quality checks

4. **Validator** (`validator/flowValidator.ts`)
   - Orchestrates rule execution
   - Enriches violations with line numbers
   - Handles exception filtering

5. **Diagnostics Manager** (`diagnostics/diagnosticsManager.ts`)
   - VS Code diagnostics collection
   - Severity mapping (error/warning/note)
   - Document-level diagnostic management

6. **Command Manager** (`commands/commandManager.ts`)
   - Registers 7 interactive commands
   - Status bar button management
   - File and workspace validation

### Commands

- `flowXmlPmd.validateCurrentFile` - Validate active file
- `flowXmlPmd.validateWorkspace` - Validate all flows in workspace
- `flowXmlPmd.clearDiagnostics` - Clear all diagnostics
- `flowXmlPmd.showRules` - Browse available rules
- `flowXmlPmd.configureRules` - Interactive rule configuration
- `flowXmlPmd.addCustomRule` - Generate custom rule template
- `flowXmlPmd.showOutputChannel` - Show extension logs

## Technical Details

### Dependencies
- `fast-xml-parser` (^4.3.2) - High-performance XML parsing

### Build Integration
- Added to `build/gulpfile.extensions.js` compilation pipeline
- Added to `build/npm/dirs.js` for npm script execution
- TypeScript compilation with strict mode

### Files Changed
- **Modified:** 2 build configuration files
- **Added:** 23 new files (5000+ insertions)
  - Extension core (6 TypeScript modules)
  - Rule implementations (4 modules)
  - Documentation (README, TODO, 2 rule docs)
  - Configuration (package.json, tsconfig.json, settings.json)

## Testing Plan

- [ ] Test each built-in rule with sample Flow XML files
- [ ] Verify configuration scenarios (merged/isolated modes)
- [ ] Test custom rule loading mechanism
- [ ] Validate status bar button behavior
- [ ] Test all 7 commands
- [ ] Verify diagnostic display and clearing
- [ ] Test exception handling
- [ ] Performance testing with large Flow files

## Future Enhancements

### Planned Features (TODO.md)
- Port remaining 14+ rules from Flow Scanner
- Quick fixes/code actions for common issues
- Rule documentation hover tooltips
- Enhanced XML line number detection
- Settings UI webview
- SARIF export for CI/CD integration

### Additional Rules to Port
- HardcodedUrl
- CopyAPIName
- AutoLayout
- CyclomaticComplexity
- DuplicateDMLOperation
- GetRecordAllFields
- UnusedVariable
- And more...

## Documentation

Comprehensive documentation provided:
- [README.md](extensions/flow-xml-pmd/README.md) - Full feature documentation with examples
- [TODO.md](extensions/flow-xml-pmd/TODO.md) - Implementation status and roadmap
- [docs/rules/MissingConnector.md](extensions/flow-xml-pmd/docs/rules/MissingConnector.md) - Detailed rule documentation
- [docs/rules/ProcessType.md](extensions/flow-xml-pmd/docs/rules/ProcessType.md) - ProcessType validation

## Breaking Changes

None - This is a new extension addition.

## Related Issues

<!-- Link any related issues here -->

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)

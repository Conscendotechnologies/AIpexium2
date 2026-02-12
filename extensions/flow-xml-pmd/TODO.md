# Flow XML PMD Extension - TODO

## Implementation Status

### ✅ Completed
- [x] Extension architecture and structure
- [x] Configuration management system
- [x] XML parser using fast-xml-parser
- [x] Rule base classes (RuleBase, LoopRuleBase)
- [x] Core rule implementations (11 rules)
- [x] Rule manager with dynamic loading
- [x] Flow validator with line number enrichment
- [x] Diagnostics manager
- [x] Command manager with 6 commands
- [x] README documentation

### 🔄 In Progress
- [ ] Testing and validation
- [ ] Icon creation (flow-pmd.png)
- [ ] Additional rules from Flow Scanner

### 📋 Planned
- [ ] Quick fixes/code actions
- [ ] Rule documentation hover
- [ ] Enhanced XML line detection
- [ ] Performance optimizations
- [ ] Settings UI webview

## Rules Implemented (11/25+)

### Implemented Rules
1. ✅ HardcodedId
2. ✅ DMLStatementInLoop
3. ✅ SOQLQueryInLoop
4. ✅ ActionCallsInLoop
5. ✅ FlowDescription
6. ✅ APIVersion
7. ✅ FlowName
8. ✅ InactiveFlow
9. ✅ MissingNullHandler
10. ✅ MissingFaultPath
11. ✅ UnconnectedElement

### Rules to Port from Flow Scanner
- [ ] HardcodedUrl
- [ ] CopyAPIName
- [ ] AutoLayout
- [ ] CyclomaticComplexity
- [ ] DuplicateDMLOperation
- [ ] GetRecordAllFields
- [ ] ProcessBuilder
- [ ] UnsafeRunningContext
- [ ] UnusedVariable
- [ ] MissingMetadataDescription
- [ ] MissingFilterRecordTrigger
- [ ] RecursiveAfterUpdate
- [ ] SameRecordFieldUpdates
- [ ] TriggerOrder
- [ ] TransformInsteadOfLoop
- [ ] RecordIdAsString

## Next Steps

1. **Testing**
   - Create sample Flow XML files
   - Test each rule individually
   - Test configuration scenarios
   - Test custom rule loading

2. **Icon Creation**
   - Create extension icon (128x128 PNG)
   - Add to icons/ directory

3. **Additional Rules**
   - Port remaining rules from Flow Scanner
   - Prioritize high-value rules first

4. **Enhancement Features**
   - Quick fixes for common issues
   - Hover documentation for violations
   - Settings UI with webview

5. **Build & Packaging**
   - Compile TypeScript
   - Test in development
   - Package as VSIX
   - Integration testing

## Development Commands

\`\`\`bash
# Compile
npm run compile

# Watch mode
npm run watch

# Package
vsce package
\`\`\`

## Configuration Schema

The extension supports:
- ✅ Rule enable/disable
- ✅ Severity configuration
- ✅ Expression-based rules (APIVersion, FlowName)
- ✅ Exception handling (flow-level, element-level)
- ✅ Rule modes (merged, isolated)
- ✅ Custom rules path

## Custom Rule Template

Custom rules can:
- Extend RuleBase or LoopRuleBase
- Access full Flow structure
- Configure severity and options
- Use suppression lists
- Report violations with line numbers

## Known Limitations

1. Line number detection is best-effort (searches for element names in XML)
2. Custom rules require TypeScript/JavaScript knowledge
3. No auto-fixes yet (planned)
4. Limited to .flow-meta.xml files

## Future Enhancements

- Code actions / quick fixes
- Rule marketplace/sharing
- VS Code web support
- SARIF export
- Flow documentation generation
- Integration with Salesforce CLI

# MissingConnector Rule

## Description
Ensures that all flow elements (except terminal elements) have a connector property and that the connector points to an existing element. This prevents runtime errors and ensures proper flow execution.

## Severity
🔴 **Error**

## Why This Matters
Flow elements must be properly connected to ensure the flow executes correctly. Missing or invalid connectors cause:
- **Runtime failures** - Flow execution stops unexpectedly
- **Deployment errors** - Salesforce validates connector integrity
- **User experience issues** - Incomplete flows don't meet business requirements
- **Maintenance problems** - Broken references are hard to debug

## What Gets Checked

### Connector Presence
All non-terminal elements must have at least one connector:
- Regular `connector` - Standard next element
- `faultConnector` - Error handling path
- `nextValueConnector` - Loop iteration
- `noMoreValuesConnector` - Loop completion
- `defaultConnector` - Decision default path
- Rule `connector` - Decision rule paths

### Connector Validity
All connectors must point to existing elements in the flow.

### Terminal Elements
Elements without any outgoing connectors are considered terminal (end points) and don't require connectors.

## Examples

### ❌ Invalid Examples

#### Missing Connector
```xml
<recordCreates>
    <name>Create_Account</name>
    <label>Create Account</label>
    <object>Account</object>
    <!-- ❌ Missing connector - what happens next? -->
</recordCreates>
```

#### Invalid Connector Reference
```xml
<recordCreates>
    <name>Create_Account</name>
    <label>Create Account</label>
    <connector>
        <targetReference>NonExistent_Element</targetReference>
        <!-- ❌ Points to element that doesn't exist -->
    </connector>
    <object>Account</object>
</recordCreates>
```

#### Decision Without Connectors
```xml
<decisions>
    <name>Check_Status</name>
    <label>Check Status</label>
    <rules>
        <name>Is_Active</name>
        <label>Is Active</label>
        <!-- ❌ Rule has no connector -->
    </rules>
    <!-- ❌ No default connector -->
</decisions>
```

### ✅ Valid Examples

#### Record Create with Connector
```xml
<recordCreates>
    <name>Create_Account</name>
    <label>Create Account</label>
    <connector>
        <targetReference>Send_Email</targetReference>
    </connector>
    <object>Account</object>
</recordCreates>

<actionCalls>
    <name>Send_Email</name>
    <label>Send Email</label>
    <!-- ✅ Referenced element exists -->
</actionCalls>
```

#### Decision with All Paths
```xml
<decisions>
    <name>Check_Status</name>
    <label>Check Status</label>
    <rules>
        <name>Is_Active</name>
        <label>Is Active</label>
        <connector>
            <targetReference>Active_Path</targetReference>
            <!-- ✅ Rule has connector -->
        </connector>
    </rules>
    <defaultConnector>
        <targetReference>Inactive_Path</targetReference>
        <!-- ✅ Default path defined -->
    </defaultConnector>
</decisions>
```

#### Loop with Proper Connectors
```xml
<loops>
    <name>Loop_Accounts</name>
    <label>Loop Through Accounts</label>
    <collectionReference>AccountList</collectionReference>
    <iterationOrder>Asc</iterationOrder>
    <nextValueConnector>
        <targetReference>Process_Account</targetReference>
        <!-- ✅ Next iteration path -->
    </nextValueConnector>
    <noMoreValuesConnector>
        <targetReference>Loop_Complete</targetReference>
        <!-- ✅ Completion path -->
    </noMoreValuesConnector>
</loops>
```

#### Terminal Element (Valid)
```xml
<screens>
    <name>Final_Screen</name>
    <label>Completion Message</label>
    <!-- ✅ Terminal element - no connector needed -->
    <fields>
        <name>Success_Message</name>
        <label>Success!</label>
    </fields>
</screens>
```

## Common Fixes

### Add Missing Connector
```xml
<!-- Before -->
<recordCreates>
    <name>Create_Lead</name>
    <object>Lead</object>
</recordCreates>

<!-- After -->
<recordCreates>
    <name>Create_Lead</name>
    <connector>
        <targetReference>Next_Step</targetReference>
    </connector>
    <object>Lead</object>
</recordCreates>
```

### Fix Invalid Reference
```xml
<!-- Before -->
<connector>
    <targetReference>Old_Element_Name</targetReference>
</connector>

<!-- After -->
<connector>
    <targetReference>Correct_Element_Name</targetReference>
</connector>
```

### Add Decision Connectors
```xml
<!-- Before -->
<decisions>
    <name>Check_Value</name>
    <rules>
        <name>Greater_Than_100</name>
    </rules>
</decisions>

<!-- After -->
<decisions>
    <name>Check_Value</name>
    <rules>
        <name>Greater_Than_100</name>
        <connector>
            <targetReference>High_Value_Path</targetReference>
        </connector>
    </rules>
    <defaultConnector>
        <targetReference>Default_Path</targetReference>
    </defaultConnector>
</decisions>
```

## Configuration

This rule is enabled by default with `error` severity.

```json
{
  "flowXmlPmd.rules": {
    "MissingConnector": {
      "severity": "error",
      "enabled": true
    }
  }
}
```

## Exception Handling

Suppress this rule for specific elements that intentionally have no connectors:

```json
{
  "flowXmlPmd.exceptions": {
    "My_Flow": {
      "MissingConnector": ["Terminal_Action", "Final_Screen"]
    }
  }
}
```

## Best Practices

1. **Always connect elements** - Every element should lead somewhere unless it's the final step
2. **Use fault connectors** - Add error handling paths for DML and external operations
3. **Complete decision paths** - Ensure all decision outcomes have connectors
4. **Loop completeness** - Loops need both iteration and completion connectors
5. **Validate references** - Ensure connector targets exist before saving

## Related Rules
- **UnconnectedElement** - Detects elements that nothing points to
- **MissingFaultPath** - Checks for error handling connectors

## References
- [Salesforce Flow Elements](https://help.salesforce.com/s/articleView?id=sf.flow_ref_elements.htm)
- [Flow Best Practices](https://help.salesforce.com/s/articleView?id=sf.flow_prep_bestpractices.htm)

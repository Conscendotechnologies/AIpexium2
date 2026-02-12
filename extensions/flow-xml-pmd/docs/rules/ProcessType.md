# ProcessType Rule

## Description
Validates that the `processType` field contains a valid FlowProcessType enumeration value according to Salesforce metadata API specifications.

## Severity
🔴 **Error**

## Why This Matters
Using an invalid processType will cause deployment failures and prevent the Flow from functioning correctly in Salesforce. The processType determines how the Flow is triggered and executed.

## Valid ProcessType Values

### Common Values
- **Flow** - Screen Flows (interactive user flows)
- **AutoLaunchedFlow** - Record-Triggered Flows, Platform Event Flows
- **Workflow** - Legacy Workflow Rules converted to Flow
- **CustomEvent** - Custom Event-Triggered Flows
- **InvocableProcess** - Invocable Flows (called from Apex or Process Builder)

### Specialized Values
- **LoginFlow** - Login Flows
- **ActionPlan** - Action Plans
- **ScreenFlow** - Screen Flow (alternative to "Flow")
- **OrchestrationFlow** - Orchestration Flows
- **TransactionSecurityFlow** - Transaction Security Flows
- **CheckoutFlow** - Commerce Checkout Flows
- **Survey** - Survey Flows
- **PromptFlow** - Prompt Flows (Einstein AI)
- **AgxScreenFlow** - Agentforce Screen Flows
- **AgxBackgroundFlow** - Agentforce Background Flows

And 30+ other specialized types for specific Salesforce features.

## Examples

### ❌ Invalid Examples

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <processType>ScreenFlow123</processType>
    <!-- ❌ Invalid: ScreenFlow123 is not a valid processType -->
</Flow>
```

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <processType>RecordTriggered</processType>
    <!-- ❌ Invalid: Should be "AutoLaunchedFlow" for record-triggered flows -->
</Flow>
```

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <!-- ❌ Missing processType field -->
    <label>My Flow</label>
</Flow>
```

### ✅ Valid Examples

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <processType>Flow</processType>
    <!-- ✅ Correct for Screen Flows -->
    <interactionType>Screen</interactionType>
</Flow>
```

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <processType>AutoLaunchedFlow</processType>
    <!-- ✅ Correct for Record-Triggered Flows -->
    <start>
        <triggerType>RecordAfterSave</triggerType>
        <object>Account</object>
    </start>
</Flow>
```

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <processType>InvocableProcess</processType>
    <!-- ✅ Correct for Invocable Flows -->
</Flow>
```

## Common Fixes

### For Screen Flows
```xml
<!-- Change from -->
<processType>ScreenFlow</processType>

<!-- To -->
<processType>Flow</processType>
```

### For Record-Triggered Flows
```xml
<!-- Change from -->
<processType>RecordTriggered</processType>

<!-- To -->
<processType>AutoLaunchedFlow</processType>
```

## Configuration

This rule is enabled by default with `error` severity.

```json
{
  "flowXmlPmd.rules": {
    "ProcessType": {
      "severity": "error",
      "enabled": true
    }
  }
}
```

## References
- [Salesforce Flow Metadata API](https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_visual_workflow.htm)
- [Flow Types in Salesforce](https://help.salesforce.com/s/articleView?id=sf.flow_concepts_type.htm)

## Complete List of Valid Values

```
AutoLaunchedFlow, Flow, Workflow, CustomEvent, InvocableProcess, LoginFlow,
ActionPlan, JourneyBuilderIntegration, UserProvisioningFlow, Survey, SurveyEnrich,
Appointments, FSCLending, DigitalForm, FieldServiceMobile, OrchestrationFlow,
FieldServiceWeb, TransactionSecurityFlow, ContactRequestFlow, ManagedContentFlow,
CheckoutFlow, CartAsyncFlow, DataCaptureFlow, CustomerLifecycle, Journey,
RecommendationStrategy, Orchestrator, RoutingFlow, ServiceCatalogItemFlow,
EvaluationFlow, LoyaltyManagementFlow, ManagedContentAuthoringWorkflow,
ActionCadenceAutolaunchedFlow, ActionCadenceStepFlow, IndicatorResultFlow,
IndividualObjectLinkingFlow, PromptFlow, ApprovalWorkflow, DcvrFrameworkDataCaptureFlow,
ActivityObjectMatchingFlow, ActionableEventManagementFlow, StageManagementEvaluationFlow,
IdentityUserRegistrationFlow, AgxBackgroundFlow, AgxScreenDataFlow, AgxScreenFlow,
AgxOrchestrationFlow
```

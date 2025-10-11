# Bundled Extensions

This folder contains VSIX files for required extensions that are bundled with the Siid Marketplace.

## Structure

Place VSIX files with the following naming convention:
- `{extensionId}-{version}.vsix`
- Example: `ConscendoTechInc.siid-code-1.0.0.vsix`

## Required Extensions

Based on product.json configuration:

1. **ConscendoTechInc.siid-code** - Siid Roo Cline Extension
2. **salesforce.salesforcedx-vscode-core** - Salesforce CLI Integration
3. **salesforce.salesforcedx-vscode-apex** - Apex
4. **salesforcedx-apex-replay-debugger** - Apex Replay Debug Adapter
5. **salesforcedx-vscode-lightning** - Aura Components
6. **salesforcedx-vscode-visualforce** - Visualforce
7. **salesforcedx-vscode-lwc** - Lightning Web Components
8. **salesforcedx-vscode-soql** - SOQL

## Usage

The BundledExtensionManager will:
1. Scan this folder for VSIX files
2. Use bundled versions for initial installation
3. Check GitHub for updates after installation

# SF Project Retriever - VS Code Extension

A VS Code extension for Salesforce developers that provides seamless source retrieval from Salesforce orgs with status bar integration and progress tracking.

## Features

- **Status Bar Integration**: Always-visible status bar item showing current org and retrieve status
- **One-Click Retrieve**: Click the status bar to retrieve source from your default org
- **Progress Tracking**: Visual progress notification with cancellation support
- **Smart Validation**: Validates CLI installation, org authentication, and manifest presence
- **Comprehensive Error Handling**: Actionable error messages with retry options
- **Configurable**: Settings for auto-retrieve on startup and notification preferences
- **Output Logging**: Dedicated output channel for detailed operation logs

## Status Bar States

The status bar item displays different states:

- **Idle**: `$(cloud-download) SF: org-name` - Click to retrieve
- **Retrieving**: `$(sync~spin) Retrieving...` - Operation in progress
- **Success**: `$(check) Retrieved` - Briefly shown after successful retrieve
- **Error**: `$(error) Retrieve Failed` - Click to retry or view output
- **No Org**: `$(warning) No Org Set` - Click to configure

## Commands

All commands are accessible via the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

- **SF: Retrieve Project Source from Org** - Manually trigger retrieve operation
- **SF: Show SF Retriever Output** - Open the output channel
- **SF: Change Target Org** - Select a different default org

## Configuration

Configure the extension via VS Code settings:

```json
{
  // Automatically retrieve source when workspace opens
  "sfProjectRetriever.autoRetrieveOnStartup": false,

  // Show notifications for retrieve operations
  "sfProjectRetriever.showNotifications": true
}
```

## Requirements

- **Salesforce CLI**: Must have `sf` CLI installed and available in PATH
- **Manifest File**: Workspace must contain `manifest/package.xml`
- **Authorized Org**: At least one org must be authorized and set as default in `.sf/config.json`

## How It Works

1. **Activation**: Extension activates when a workspace contains `manifest/package.xml`
2. **Validation**: Checks for SF CLI installation, manifest, and default org
3. **Status Display**: Shows current org in status bar with tooltip showing last retrieve time
4. **Retrieve**: Click status bar or run command to retrieve using `sf project retrieve start`
5. **Progress**: Shows cancellable progress notification during retrieval
6. **Result**: Updates status bar and shows notification on success/failure

## Installation

### From Source

1. Clone or download this extension
2. Install dependencies:
   ```bash
   npm install
   ```
3. Compile TypeScript:
   ```bash
   npm run compile
   ```
4. Package the extension:
   ```bash
   npx vsce package
   ```
5. Install the generated `.vsix` file in VS Code

### Development Mode

1. Open the extension folder in VS Code
2. Press `F5` to launch Extension Development Host
3. Test the extension in the new window

## Architecture

The extension is organized into modular components:

- **extension.ts**: Main activation and command registration
- **sfCli.ts**: Salesforce CLI wrapper with safe command execution
- **configManager.ts**: Configuration and workspace state management
- **statusBarManager.ts**: Status bar UI state management

## Best Practices

- Uses `execFile` for safe command execution (no shell injection)
- Implements cancellation tokens for long-running operations
- Proper error handling with actionable user guidance
- Localization support via `vscode.l10n`
- Follows VS Code extension guidelines and coding standards

## Troubleshooting

### Status bar not showing
- Ensure `manifest/package.xml` exists in your workspace
- Check that you have a workspace folder open

### "SF CLI not found" error
- Install Salesforce CLI: https://developer.salesforce.com/tools/sfdxcli
- Verify `sf` command works in terminal

### "No default org set" warning
- Run `sf org login web` to authorize an org
- Ensure `.sf/config.json` contains `"target-org"` setting

### Retrieve fails
- Check output channel (View → Output → SF Project Retriever)
- Verify org is still authenticated: `sf org display`
- Ensure manifest contains valid metadata

## License

MIT


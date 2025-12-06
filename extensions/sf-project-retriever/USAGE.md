# SF Project Retriever - Quick Start Guide

## Overview
The extension has been completely refactored with modern VS Code best practices and enhanced UX.

## What Changed

### ✅ **Before** → **After**
- ❌ Modal popup → ✅ Status bar integration
- ❌ `exec()` (unsafe) → ✅ `execFile()` (safe)
- ❌ No progress UI → ✅ `withProgress` API with cancellation
- ❌ console.log → ✅ OutputChannel for logging
- ❌ No validation → ✅ CLI, org, and manifest validation
- ❌ Hardcoded strings → ✅ Localized with vscode.l10n
- ❌ Monolithic file → ✅ Modular architecture (4 files)
- ❌ Basic errors → ✅ Comprehensive error handling
- ❌ No settings → ✅ User configuration options

## New Architecture

```
src/
├── extension.ts         - Main activation & commands
├── sfCli.ts            - CLI wrapper (safe execution)
├── configManager.ts    - Config & workspace state
└── statusBarManager.ts - Status bar UI management
```

## Status Bar Features

### States
1. **Idle**: Shows org name, clickable to retrieve
2. **Retrieving**: Animated spinner during operation
3. **Success**: Green checkmark (auto-reverts to idle)
4. **Error**: Red error icon, clickable to retry
5. **No Org**: Warning when org not configured

### Tooltip
- Shows current org username
- Displays last retrieve time
- Updates dynamically

### Click Behavior
- **Left-click**: Triggers retrieve operation
- **Command Palette**: Access additional commands

## Available Commands

| Command | Description |
|---------|-------------|
| `SF: Retrieve Project Source from Org` | Start retrieve operation |
| `SF: Show SF Retriever Output` | View detailed logs |
| `SF: Change Target Org` | Select different default org |

## Configuration Settings

Add to your `settings.json`:

```json
{
  // Auto-retrieve when workspace opens (default: false)
  "sfProjectRetriever.autoRetrieveOnStartup": false,

  // Show success/error notifications (default: true)
  "sfProjectRetriever.showNotifications": true
}
```

## User Experience Flow

1. **Extension Activates** when workspace contains `manifest/package.xml`
2. **Status Bar Shows** current org from `.sf/config.json`
3. **Click Status Bar** to start retrieve
4. **Progress Notification** appears (cancellable)
5. **Status Updates** during operation
6. **Result Shown** via notification + status bar

## Error Handling

The extension provides actionable guidance for common issues:

| Error | Action Offered |
|-------|----------------|
| CLI not installed | Link to installation guide |
| No default org | Authorize or set default org |
| Org not authenticated | Re-authenticate instructions |
| Retrieve failed | Show output + retry option |
| No manifest | Clear error message |

## Safety Improvements

1. **Command Injection Prevention**: Uses `execFile` instead of `exec`
2. **Timeout Protection**: 5-minute timeout on retrieve operations
3. **Cancellation Support**: User can cancel long-running operations
4. **Large Buffer**: 50MB buffer for large projects (vs 10MB before)
5. **Error Isolation**: Errors don't crash extension

## Localization Support

All user-facing strings use `vscode.l10n.t()` for future multi-language support.

Example:
```typescript
vscode.l10n.t('Retrieving from org: {0}', orgName)
```

## Testing the Extension

### In Development Mode
1. Open extension folder in VS Code
2. Press `F5` to launch Extension Development Host
3. Open a Salesforce project with manifest
4. Look for status bar item in bottom-left

### Manual Testing Checklist
- [ ] Status bar appears when manifest exists
- [ ] Click status bar triggers retrieve
- [ ] Progress notification shows with cancel button
- [ ] Success updates status bar to green checkmark
- [ ] Error shows retry option
- [ ] Output channel logs all operations
- [ ] Settings control behavior correctly

## Performance

- **Lazy Loading**: Services initialized only when needed
- **Efficient Updates**: Status bar updates don't re-render entire HTML
- **Async Operations**: All CLI calls are non-blocking
- **Resource Cleanup**: Proper disposal of resources on deactivate

## Next Steps for Production

1. Add telemetry for usage tracking
2. Implement unit tests
3. Add integration tests with mock CLI
4. Create marketplace listing assets
5. Add CI/CD pipeline for automated builds
6. Consider adding deploy functionality

## Troubleshooting

### Status bar not visible
```bash
# Check if manifest exists
ls manifest/package.xml

# Check extension is activated
> Developer: Show Running Extensions
```

### Compilation errors
```bash
# In extension directory
npm run compile

# Watch mode for development
npm run watch
```

### CLI not found
```bash
# Verify SF CLI installed
sf --version

# Add to PATH if needed (Windows)
$env:PATH += ";C:\Program Files\sf"
```

## Files Modified/Created

### New Files
- `src/sfCli.ts` - CLI service
- `src/configManager.ts` - Config manager
- `src/statusBarManager.ts` - Status bar UI
- `package.nls.json` - Localization strings
- `USAGE.md` - This file

### Modified Files
- `src/extension.ts` - Complete rewrite
- `package.json` - Added commands & settings
- `README.md` - Updated documentation

## Code Quality

✅ Follows VS Code extension guidelines
✅ TypeScript strict mode enabled
✅ Proper error handling throughout
✅ Resource disposal on deactivate
✅ Microsoft copyright headers
✅ JSDoc comments for public APIs
✅ Modular, testable architecture

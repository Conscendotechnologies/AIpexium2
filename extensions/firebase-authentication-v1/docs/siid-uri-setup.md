# SIID URI Protocol Setup Guide

Since SIID is a fork of VS Code, you need to configure the operating system to properly handle URI callbacks for the Firebase authentication extension.

## Problem
- `vscode://` URLs open the official VS Code (which doesn't have your extension)
- `siid://` URLs open a new SIID instance instead of routing to the existing one

## Solution Options

### Option 1: Override vscode:// Protocol (Recommended)

This makes SIID handle `vscode://` URLs instead of the official VS Code.

1. **Run as Administrator**: Right-click PowerShell and select "Run as Administrator"
2. **Apply Registry Changes**:
   ```powershell
   cd "c:\Users\Aman\Documents\DEV\AIpexium2\extensions\firebase-authentication-v1"
   .\register-siid-protocol.reg
   ```
3. **Confirm**: Click "Yes" to add the registry entries
4. **Test**: Try the deep link test page again

### Option 2: Custom siid:// Protocol

This creates a new `siid://` protocol specifically for your SIID IDE.

1. **Apply Custom Protocol Registry**:
   ```powershell
   cd "c:\Users\Aman\Documents\DEV\AIpexium2\extensions\firebase-authentication-v1"
   .\register-siid-custom-protocol.reg
   ```

2. **Update Extension Configuration**: If you choose this option, you'll need to update the extension to use `siid://` scheme:
   - Change `package.json` uriHandlers protocol to "siid"
   - Update `uriHandler.ts` to generate `siid://` URLs
   - Update test page to use `siid://` URLs

## Recommended Approach

**Use Option 1** because:
- ✅ Minimal changes to the extension code
- ✅ Works with existing VS Code URI handling logic
- ✅ No need to modify the extension for protocol differences
- ✅ Most compatible with VS Code ecosystem

## Testing After Setup

1. **Start SIID** with the extension loaded:
   ```powershell
   cd c:\Users\Aman\Documents\DEV\AIpexium2
   .\scripts\code.bat --extensionDevelopmentPath="c:\Users\Aman\Documents\DEV\AIpexium2\extensions\firebase-authentication-v1"
   ```

2. **Open Test Page**:
   ```
   http://localhost:8080/test-deeplink.html
   ```

3. **Test Basic Deep Link**: Click "Test Basic Deep Link" button
   - Should route to your existing SIID instance
   - Should not open a new instance
   - Should not open official VS Code

4. **Check Extension Logs**: In SIID, go to View → Output → Firebase Authentication

## Troubleshooting

### If deep links still open VS Code:
- Ensure you ran the registry file as Administrator
- Restart your browser after applying registry changes
- Check that the path in the registry points to your SIID executable

### If deep links open new SIID instance:
- The registry might be pointing to a launcher script instead of the main executable
- Try updating the registry to point directly to your SIID.exe file
- Check if SIID has proper single-instance handling

### Registry Path Updates

Update the registry files if your SIID is located elsewhere:

1. **Find SIID executable location**
2. **Edit registry files** and replace the path:
   ```
   @="\"C:\\Path\\To\\Your\\SIID\\siid.exe\" --open-url \"%1\""
   ```
3. **Reapply registry changes**

## Alternative: Programmatic Registration

If you prefer to register the protocol programmatically, you can add this to your SIID startup code:

```javascript
// In your SIID main process
const { app, protocol } = require('electron');

app.setAsDefaultProtocolClient('vscode');
// or
app.setAsDefaultProtocolClient('siid'); // for custom protocol
```

## Success Criteria

After proper setup:
- ✅ `vscode://` URLs open your SIID instance (not official VS Code)
- ✅ Deep links route to existing SIID window (no new instances)
- ✅ Firebase extension receives and processes URI callbacks
- ✅ Authentication flow works end-to-end

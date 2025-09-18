# Firebase Authentication Extension - Testing Guide

## Overview

This document provides step-by-step instructions for testing the Firebase Authentication extension that uses external web page + deep link approach.

## Phase 1: Basic Deep Link Testing

### Prerequisites
1. VS Code development environment running with the extension loaded
2. HTTP server serving the test page at `http://localhost:8080/test-deeplink.html`

### Test Steps

#### 1. Extension Installation Test
1. Open VS Code
2. Check that the Firebase Authentication extension is loaded
3. Open Command Palette (`Ctrl+Shift+P`)
4. Type "Firebase" and verify the following commands are available:
   - `Firebase: Sign In`
   - `Firebase: Sign Out`
   - `Firebase: Show Profile`
   - `Firebase: Refresh Session`
   - `Firebase: Show Auth Status`

#### 2. Deep Link Reception Test
1. Open the test page: `http://localhost:8080/test-deeplink.html`
2. Click "Test Basic Deep Link" button
3. Expected: VS Code should receive the deep link and the extension should log the URI reception
4. Check the Output panel in VS Code (View → Output → Firebase Authentication) for logs

#### 3. Authentication Callback Test
1. On the test page, click "Test Success Callback"
2. Expected: VS Code should process the callback and show authentication success/failure message
3. Click "Test Error Callback" to test error handling
4. Check logs for proper error handling

## Phase 2: Firebase Configuration

### Setup Firebase Configuration
1. Open VS Code Settings (`Ctrl+,`)
2. Search for "firebase-authentication-v1"
3. Configure the following settings:
   ```
   firebase-authentication-v1.apiKey: YOUR_API_KEY
   firebase-authentication-v1.authDomain: YOUR_PROJECT.firebaseapp.com
   firebase-authentication-v1.projectId: YOUR_PROJECT_ID
   firebase-authentication-v1.storageBucket: YOUR_PROJECT.appspot.com
   firebase-authentication-v1.messagingSenderId: YOUR_SENDER_ID
   firebase-authentication-v1.appId: YOUR_APP_ID
   ```

## Phase 3: External Web Page Integration

### Modify User's Firebase Auth Page

Your existing Firebase authentication page needs minimal modifications to work with VS Code:

#### Required URL Parameters
The extension will open your auth page with these parameters:
- `callback=vscode` - Indicates this is for VS Code
- `redirect_uri=vscode://ConscendoTechInc.firebase-authentication-v1/auth-callback` - Deep link URI
- `state=<encoded_state>` - CSRF protection state
- `session=<session_id>` - Session identifier
- `provider=<provider>` (optional) - Specific provider to use

#### Required Response Format
After successful authentication, redirect to the `redirect_uri` with these parameters:
- `token` or `idToken` - Firebase authentication token
- `refreshToken` - Firebase refresh token
- `state` - The same state parameter received
- `provider` - Provider used for authentication
- `user` - JSON-encoded user information (optional)

For errors, redirect with:
- `error` - Error message
- `state` - The same state parameter received

#### Example Redirect URLs

**Success:**
```
vscode://ConscendoTechInc.firebase-authentication-v1/auth-callback?token=abc123&refreshToken=def456&state={"csrfToken":"xyz"}&provider=google&user={"uid":"123","email":"user@example.com"}
```

**Error:**
```
vscode://ConscendoTechInc.firebase-authentication-v1/auth-callback?error=authentication_failed&state={"csrfToken":"xyz"}
```

## Phase 4: End-to-End Testing

### Complete Authentication Flow
1. Run command: `Firebase: Sign In`
2. Choose a provider from the quick pick
3. VS Code opens your external auth page in the browser
4. Complete authentication on your page
5. Page redirects back to VS Code
6. VS Code processes the authentication and shows success message

### Verify Authentication State
1. Run command: `Firebase: Show Auth Status`
2. Should show authenticated status with user information
3. Run command: `Firebase: Show Profile`
4. Should display detailed user profile information

### Test Session Management
1. Run command: `Firebase: Refresh Session`
2. Should extend session expiration
3. Run command: `Firebase: Sign Out`
4. Should clear authentication state

## Troubleshooting

### Common Issues

#### Deep Links Not Working
- Check that the extension is properly registered in VS Code
- Verify the URI scheme matches exactly: `vscode://ConscendoTechInc.firebase-authentication-v1/auth-callback`
- Check VS Code Output panel for error messages

#### Authentication Callback Fails
- Verify state parameter validation
- Check that all required parameters are included in the callback URL
- Look for CSRF token mismatch errors

#### Firebase Initialization Fails
- Verify Firebase configuration in VS Code settings
- Check that all required configuration fields are provided
- Ensure Firebase project is properly configured

### Debug Mode
Enable debug logging by setting:
```
firebase-authentication-v1.enableDebugLogging: true
```

### Log Locations
- Extension logs: VS Code Output panel → Firebase Authentication
- Browser logs: Browser developer console
- VS Code debug logs: Help → Toggle Developer Tools → Console

## Next Steps

Once basic testing is complete:
1. Update the `authPageUrl` in `webAuthFlow.ts` to point to your actual Firebase auth page
2. Test with real Firebase configuration
3. Test across different operating systems (Windows, macOS, Linux)
4. Add error handling for edge cases
5. Implement token refresh logic
6. Add proper session persistence

## Security Considerations

- Always validate the state parameter to prevent CSRF attacks
- Use HTTPS for your external auth page
- Implement proper token expiration handling
- Consider implementing additional security measures like nonce validation

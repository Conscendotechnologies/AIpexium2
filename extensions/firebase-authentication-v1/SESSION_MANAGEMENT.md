# Firebase Authentication - Session Management

This document explains the session management features implemented in the Firebase Authentication extension.

## Overview

The Firebase Auth extension now includes comprehensive session management with:

- ✅ **Persistent Sessions** - Sessions survive VS Code restarts
- ✅ **Secure Storage** - Tokens stored encrypted using VS Code's SecretStorage
- ✅ **Cross-Extension API** - Other extensions can access authentication state
- ✅ **VS Code Authentication Provider** - Standard VS Code auth integration
- ✅ **Title Bar Integration** - Quick access to auth status and actions
- ✅ **Session Lifecycle Management** - Auto-refresh, expiration handling

## Architecture

### Core Components

1. **SessionManager** (`src/sessionManager.ts`)
   - Handles VS Code storage APIs (`globalState`, `secrets`)
   - Manages session persistence and expiration
   - Provides secure token storage

2. **FirebaseVSCodeAuthProvider** (`src/authenticationProvider.ts`)
   - Implements VS Code's `AuthenticationProvider` interface
   - Enables cross-extension session sharing
   - Registered as `firebase` authentication provider

3. **TitleBarIntegration** (`src/titleBarIntegration.ts`)
   - Status bar item showing login state
   - Quick login/logout actions
   - User menu with account info

4. **CrossExtensionAPI** (`src/crossExtensionAPI.ts`)
   - Direct API for other extensions
   - Event emitters for auth state changes
   - Session status queries

## Storage Strategy

### SecretStorage (Encrypted)
```typescript
{
  "firebase-authentication-v1.tokens": {
    accessToken: string,
    refreshToken: string,
    idToken: string,
    expiresAt: number
  }
}
```

### GlobalState (Persistent)
```typescript
{
  "firebase-authentication-v1.session": {
    uid: string,
    email: string,
    displayName: string,
    photoURL: string,
    providerId: string,
    lastLogin: number,
    expiresAt: number
  }
}
```

## Usage for Other Extensions

### Method 1: VS Code Authentication API (Recommended)

```typescript
import * as vscode from 'vscode';

// Get Firebase session
const session = await vscode.authentication.getSession('firebase', ['firebase'], {
  createIfNone: true // Triggers login if not authenticated
});

console.log('User:', session.account.label);
console.log('Token:', session.accessToken);

// Listen to auth changes
vscode.authentication.onDidChangeSessions((e) => {
  if (e.provider.id === 'firebase') {
    console.log('Firebase auth changed:', e);
  }
});
```

### Method 2: Direct Extension API

```typescript
import * as vscode from 'vscode';
import { FirebaseAuthAPI } from './types';

const firebaseExt = vscode.extensions.getExtension('firebase-auth');
if (firebaseExt?.isActive) {
  const firebaseAPI: FirebaseAuthAPI = firebaseExt.exports;

  // Check authentication
  if (firebaseAPI.isAuthenticated()) {
    const user = firebaseAPI.getCurrentUser();
    console.log('Current user:', user);
  }

  // Listen to changes
  firebaseAPI.onAuthStateChanged((user) => {
    console.log('Auth state changed:', user);
  });

  // Trigger login
  const user = await firebaseAPI.login();
}
```

## Extension Dependencies

Other extensions should declare dependency in `package.json`:

```json
{
  "extensionDependencies": ["firebase-auth"],
  "contributes": {
    "commands": [
      {
        "command": "myExtension.premiumFeature",
        "title": "Premium Feature",
        "when": "firebase-authentication-v1.authenticated"
      }
    ]
  }
}
```

## Session Lifecycle

### Startup
1. Extension activates
2. SessionManager checks for stored session
3. If valid session found, restores auth state
4. Updates title bar and context

### Login
1. User triggers login (webview, command, or title bar)
2. Firebase authentication flow completes
3. SessionManager stores user data and tokens
4. Auth state change events fired
5. Other extensions notified

### Session Refresh
1. Automatic refresh before expiration
2. Manual refresh via title bar menu
3. Token validation and renewal
4. Session expiry extension

### Logout
1. User triggers logout
2. Firebase sign out
3. SessionManager clears all stored data
4. Auth state change events fired
5. Title bar updated

## Security Features

- **Encrypted Token Storage** - Uses VS Code's SecretStorage
- **Session Expiration** - 24-hour default timeout
- **Token Validation** - Checks token expiry
- **Secure Cleanup** - Clears sensitive data on logout
- **Cross-Window Sync** - Sessions sync across VS Code windows

## Title Bar Features

### Status Indicators
- **Signed In**: `$(account) User Name` - Green background
- **Signed Out**: `$(sign-in) Sign In` - Warning background

### User Menu (when authenticated)
- Account Information
- Refresh Session
- Sign Out

### Quick Actions
- Click status bar to access user menu or login
- Command palette integration
- Context-aware menu items

## Configuration

### Extension Settings
```json
{
  "firebase-authentication-v1.apiKey": "your-api-key",
  "firebase-authentication-v1.authDomain": "your-domain.firebaseapp.com",
  "firebase-authentication-v1.projectId": "your-project-id"
}
```

### Context Keys
- `firebase-authentication-v1.authenticated` - Boolean indicating auth state
- Used for conditional command/menu visibility

## Troubleshooting

### Session Not Persisting
1. Check VS Code storage permissions
2. Verify SecretStorage is available
3. Check console for storage errors

### Cross-Extension Issues
1. Ensure extension dependency declared
2. Check extension activation order
3. Verify API exports are available

### Token Expiration
1. Sessions auto-refresh before expiry
2. Manual refresh via title bar menu
3. Re-authentication if refresh fails

## Development

### Testing Session Management
```typescript
// Check stored session
const sessionManager = new SessionManager(context);
const session = await sessionManager.getStoredSession();
console.log('Stored session:', session);

// Check tokens
const tokens = await sessionManager.getStoredTokens();
console.log('Stored tokens:', tokens);
```

### Debugging
- Enable Firebase debug logging
- Check VS Code developer console
- Monitor storage API calls
- Verify auth state events

## Future Enhancements

- [ ] Multi-account support
- [ ] Custom token refresh logic
- [ ] Enhanced security options
- [ ] Session analytics
- [ ] Offline session handling

# Firebase Authentication Flow for VS Code Extension

## Overview
This document outlines the authentication flow that uses VS Code's built-in authentication API with Firebase custom tokens.

## Authentication Flow

### 1. Initial Sign-In
```
User clicks "Sign In"
    ↓
Extension calls vscode.authentication.getSession('github', ['user:email'])
    ↓
VS Code opens browser for GitHub OAuth
    ↓
User authenticates with GitHub
    ↓
VS Code receives OAuth tokens
    ↓
Extension receives AuthenticationSession with accessToken
    ↓
Extension exchanges GitHub token for Firebase custom token
    ↓
Extension calls Firebase signInWithCustomToken()
    ↓
Firebase creates user session
    ↓
Extension stores session in VS Code secure storage
```

### 2. Session Management
- **Token Refresh**: VS Code handles OAuth token refresh automatically
- **Session Persistence**: VS Code stores sessions securely across restarts
- **Session Validation**: Extension validates Firebase tokens on startup

### 3. Sign-Out Flow
```
User clicks "Sign Out"
    ↓
Extension calls Firebase signOut()
    ↓
Extension clears VS Code authentication session
    ↓
Extension notifies auth state listeners
```

## Implementation Components

### 1. VS Code Authentication Provider
- Register as VS Code authentication provider
- Handle session creation/management
- Integrate with VS Code's auth UI

### 2. Token Exchange Service
- Exchange OAuth tokens for Firebase custom tokens
- Handle token validation and errors
- Manage token refresh cycles

### 3. Firebase Manager Updates
- Remove browser-specific auth methods
- Implement signInWithCustomToken
- Add proper error handling

### 4. Session Manager
- Store session data securely
- Handle session restoration
- Manage session lifecycle

## Benefits of This Approach

1. **Native VS Code Experience**: Uses VS Code's built-in auth UI
2. **Secure Token Storage**: VS Code handles token storage securely
3. **Automatic Token Refresh**: VS Code manages OAuth token refresh
4. **Cross-Platform**: Works on all VS Code platforms
5. **Standard Pattern**: Follows VS Code extension best practices
6. **Firebase Integration**: Maintains full Firebase feature set

## Security Considerations

1. **Token Exchange**: OAuth tokens never stored directly, only exchanged
2. **Custom Tokens**: Short-lived Firebase custom tokens
3. **Secure Storage**: VS Code's secure storage for session data
4. **Token Validation**: Regular validation of Firebase tokens
5. **Error Handling**: Proper cleanup on auth failures

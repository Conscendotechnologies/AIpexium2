# Current Authentication Structure Analysis

## Problem Statement
Users are getting logged out after some time because:
1. External site handles Firebase login and returns the UID
2. The IDE's Firebase Auth SDK is not actually logged in (which is by design for this scenario)
3. The current session expiration logic logs users out automatically
4. We need to keep auth state logged in until the user explicitly logs out

---

## Current Authentication Flow

### 1. **Sign In Process** (`authManager.ts`)
```
User clicks "Sign In"
  ↓
AuthManager.signIn()
  ↓
WebAuthFlow.initiateAuthFlow()
  ↓
Opens external auth page (https://api.conscendo.tech/vscode-oauth)
  ↓
User authenticates on external site
  ↓
External site redirects back with: siid://auth/callback?uid=...&idToken=...&state=...
  ↓
UriHandler.handleAuthCallback()
  ↓
FirebaseManager.processAuthResult()
  ↓
Creates AuthSession and stores it
```

### 2. **AuthSession Structure** (`auth.types.ts`)
```typescript
export interface AuthSession {
	uid: string;
	idToken: string;
	expiresAt: number;        // ⚠️ THIS IS THE PROBLEM
	user?: FirebaseUser;
}
```

### 3. **Session Expiration Logic**

#### Storage Layer (`storage.ts` - Line 54-61)
```typescript
public async isAuthenticated(): Promise<boolean> {
	const session = await this.getAuthSession();
	if (!session) {
		return false;
	}

	// ⚠️ ISSUE: Checks if session is expired
	return Date.now() < session.expiresAt;
}
```

#### FirebaseManager Layer (`firebaseManager.ts` - Line 163, 203-207)
```typescript
// When creating session (Line 163):
expiresAt: Date.now() + (60 * 60 * 1000), // 1 hour ⚠️

// When checking session (Line 203-207):
if (Date.now() >= session.expiresAt) {
	await this.storage.clearAuthSession();
	return null;
}
```

### 4. **Session Creation Points**

**A. Normal Authentication** (`firebaseManager.ts` - Line 163)
- Creates session with 1 hour expiry
- Expiry: `Date.now() + (60 * 60 * 1000)`

**B. Test Mode** (`firebaseManager.ts` - Line 113)
- Creates session with 24 hour expiry
- Expiry: `Date.now() + (24 * 60 * 60 * 1000)`

**C. Refresh Session** (`authManager.ts` - Line 203)
- Extends session by 1 hour
- Expiry: `Date.now() + (60 * 60 * 1000)`

### 5. **Extension Activation** (`extension.ts`)

**Current Behavior:**
```typescript
// Line 100: Sets authenticated to false on startup
vscode.commands.executeCommand('setContext', 'firebase-service.authenticated', false);

// Line 103-107: Only fires when auth state changes
authManager.onDidChangeAuthState(async (isAuthenticated) => {
	vscode.commands.executeCommand('setContext', 'firebase-service.authenticated', isAuthenticated);
	treeDataProvider.refresh();
	statusBarManager.refresh();
});
```

**⚠️ Issue:**
- On extension activation, `firebase-service.authenticated` is set to `false`
- Auth state change event is NOT fired during activation
- Even if a valid session exists in storage, the UI shows "Not Authenticated"
- The session might still be valid but the context is not updated

---

## Problem Areas

### 1. **Session Expiration**
- Sessions expire after 1 hour (or 24 hours in test mode)
- `storage.isAuthenticated()` returns false when session expires
- `firebaseManager.getCurrentSession()` clears session when expired
- User is forcefully logged out

### 2. **No Automatic Session Restoration on Startup**
- Extension activates with `authenticated = false`
- No code checks if a valid session exists in storage
- Auth state is not restored from previous session
- User appears logged out even with valid stored session

### 3. **Firebase Auth SDK Not Used**
- External auth returns only UID and idToken
- No actual Firebase Auth session in the IDE
- Cannot use Firebase's built-in token refresh
- No way to validate if token is still valid with Firebase

### 4. **Refresh Session is Manual**
- User must manually click "Refresh Session"
- Only extends expiry by 1 hour
- Doesn't validate token with Firebase
- Doesn't update token from external auth

---

## Files Involved

### Core Authentication Files:
1. **`src/auth/authManager.ts`** - Main auth orchestration
   - Line 47-67: Sign in process
   - Line 77-103: Handle auth callback
   - Line 113-125: Sign out
   - Line 193-211: Refresh session

2. **`src/auth/firebaseManager.ts`** - Firebase integration
   - Line 103-180: Process auth result and create session
   - Line 163: **Session expiry set to 1 hour**
   - Line 203-207: **Check and clear expired session**

3. **`src/utils/storage.ts`** - Session storage
   - Line 30-35: Store session
   - Line 40-43: Get session
   - Line 48-51: Clear session
   - Line 54-61: **Check if authenticated (expiry check)**

4. **`src/auth/auth.types.ts`** - Type definitions
   - Line 24-30: AuthSession interface with `expiresAt` field

5. **`src/extension.ts`** - Extension lifecycle
   - Line 100: Sets authenticated to false on startup
   - Line 103-107: Auth state change listener

---

## Current Workarounds

### 1. **Manual Refresh** (`authManager.ts` - Line 193-211)
```typescript
public async refreshSession(): Promise<void> {
	const session = await this.getCurrentUser();
	if (!session) {
		vscode.window.showWarningMessage('No active session to refresh');
		return;
	}

	// Just extends the current session
	session.expiresAt = Date.now() + (60 * 60 * 1000); // 1 hour
	await this.storage.storeAuthSession(session);

	vscode.window.showInformationMessage('Session refreshed successfully');
}
```

**Issues:**
- User must remember to refresh
- Only extends by 1 hour
- No validation with Firebase

### 2. **Test Mode** (`firebaseManager.ts` - Line 108-122)
```typescript
if (isTestUid) {
	// 24 hour expiry for test users
	expiresAt: Date.now() + (24 * 60 * 60 * 1000)
}
```

**Issues:**
- Only for test UIDs starting with "test_"
- Not a real solution for production

---

## Summary

### Root Causes:
1. ✅ **Session expiration is enforced** - Sessions expire after 1 hour
2. ✅ **No session restoration on startup** - Valid sessions are ignored on extension activation
3. ✅ **External auth model** - Firebase SDK is not used, can't auto-refresh tokens
4. ✅ **Manual intervention required** - Users must manually refresh sessions

### Key Decision Points:
We need to decide:
1. **Should sessions expire at all?** (Since user is authenticated externally)
2. **Should we restore sessions on startup?** (Check storage and fire auth state change)
3. **How long should sessions last?** (1 hour, 24 hours, indefinite?)
4. **Should we auto-refresh?** (Periodically extend expiry or never expire?)
5. **What about token validation?** (Trust the stored session or validate somehow?)

---

## Next Steps

Based on the requirement "keep auth state logged in until user logged out by itself", we have several options:

### Option 1: Never Expire Sessions
- Remove expiry checks from `storage.isAuthenticated()`
- Remove expiry clearing from `firebaseManager.getCurrentSession()`
- Keep `expiresAt` field but don't enforce it
- Sessions last forever until user signs out

### Option 2: Very Long Expiry
- Change from 1 hour to 30 days or 90 days
- Still have expiry but much longer
- User unlikely to hit expiry in normal usage

### Option 3: Restore Session on Startup
- On extension activation, check if valid session exists
- Fire auth state change event if session found
- Update UI to show authenticated state
- Keep current 1 hour expiry but restore on each startup

### Option 4: Combination
- Never expire sessions (Option 1)
- Restore on startup (Option 3)
- Keep refresh command for re-validation if needed

**Recommendation:** Option 4 - No expiry + Restore on startup
This matches the requirement and provides the best UX.

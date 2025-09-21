# Firebase Authentication Extension - Auth Page Integration Schemas

This document outlines the communication schemas between the VS Code Firebase Authentication extension and external authentication pages.

## 📨 Incoming Request Schema (What Auth Page Receives)

The VS Code extension will send users to your auth page with this simple URL format:

### URL Pattern
```
https://your-auth-page.com/auth?provider={provider}
```

### Query Parameters Schema
```typescript
interface IncomingAuthRequest {
  provider?: string;  // Optional: "google", "github", "email", etc.
}
```

### Examples
- `https://your-auth-page.com/auth?provider=google`
- `https://your-auth-page.com/auth?provider=github`
- `https://your-auth-page.com/auth` (no provider = show all options)

---

## 📤 Outgoing Response Schema (What Auth Page Should Send Back)

After successful authentication, redirect the user back to VS Code with this format:

### Redirect URL Pattern
```
siid://ConscendoTechInc.firebase-authentication-v1/auth-callback?uid={uid}&state={state}
```

### Query Parameters Schema
```typescript
interface OutgoingAuthResponse {
  uid: string;        // Required: Unique user identifier from Firebase
  state?: string;     // Optional: CSRF protection token (can be omitted)
  error?: string;     // Optional: Error message if authentication failed
}
```

### Success Response Example
```
siid://ConscendoTechInc.firebase-authentication-v1/auth-callback?uid=firebase_user_12345&state=csrf_token_abc123
```

### Error Response Example
```
siid://ConscendoTechInc.firebase-authentication-v1/auth-callback?error=authentication_cancelled
```

---

## 🔄 Complete Flow Example

### Step 1: VS Code → Auth Page
```
User clicks "Sign In" in VS Code
↓
VS Code opens: https://your-auth-page.com/auth?provider=google
```

### Step 2: Auth Page Processing
```javascript
// Your auth page receives:
const urlParams = new URLSearchParams(window.location.search);
const provider = urlParams.get('provider'); // "google"

// Perform Firebase authentication...
// Get the authenticated user's UID
const uid = user.uid; // e.g., "firebase_user_12345"
```

### Step 3: Auth Page → VS Code
```javascript
// Redirect back to VS Code with the UID
const redirectUrl = `siid://ConscendoTechInc.firebase-authentication-v1/auth-callback?uid=${uid}`;
window.location.href = redirectUrl;
```

---

## 🛡️ Security Notes

1. **UID Only**: We only pass the Firebase UID, no sensitive tokens
2. **State Parameter**: Optional CSRF protection (can be omitted for simplicity)
3. **Error Handling**: Use `error` parameter for failed authentication
4. **HTTPS**: Your auth page should use HTTPS in production

---

## 🚀 Implementation Tips

### For Your Auth Page
1. Parse the `provider` parameter to show relevant sign-in options
2. Perform Firebase authentication using your preferred method
3. Extract the user's `uid` from the Firebase User object
4. Redirect back to VS Code with the `uid` parameter

### Error Handling
If authentication fails, redirect with an error:
```javascript
const errorUrl = `siid://ConscendoTechInc.firebase-authentication-v1/auth-callback?error=user_cancelled`;
window.location.href = errorUrl;
```

### Testing
You can test the callback by manually opening this URL in your browser:
```
siid://ConscendoTechInc.firebase-authentication-v1/auth-callback?uid=test_user_123
```

---

## 📋 Configuration

Make sure your VS Code extension is configured with your auth page URL:

```json
{
  "firebase-authentication-v1.authPageUrl": "https://your-auth-page.com/auth"
}
```

This simplified schema makes integration straightforward - your auth page just needs to:
1. Receive an optional provider hint
2. Authenticate the user with Firebase
3. Send back the user's UID

That's it! 🎉

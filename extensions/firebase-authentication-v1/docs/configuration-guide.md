# Firebase Authentication Extension - Configuration

## Quick Setup

This extension requires Firebase project configuration. Follow these steps to configure the extension:

### 1. Firebase Project Setup

If you don't have a Firebase project yet:
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project or select existing project
3. Enable Authentication in the Firebase console
4. Configure authentication providers (Google, GitHub, etc.)

### 2. Get Firebase Configuration

1. In Firebase console, go to Project Settings (gear icon)
2. Scroll to "Your apps" section
3. Click "Web app" configuration icon
4. Copy the Firebase configuration values

### 3. Configure VS Code Settings

Open VS Code Settings (`Ctrl+,` or `Cmd+,`) and search for "firebase-authentication-v1":

```json
{
  "firebase-authentication-v1.apiKey": "AIzaSyC...",
  "firebase-authentication-v1.authDomain": "your-project.firebaseapp.com",
  "firebase-authentication-v1.projectId": "your-project-id",
  "firebase-authentication-v1.storageBucket": "your-project.appspot.com",
  "firebase-authentication-v1.messagingSenderId": "123456789",
  "firebase-authentication-v1.appId": "1:123456789:web:abcdef",
  "firebase-authentication-v1.measurementId": "G-XXXXXXXXXX",
  "firebase-authentication-v1.enableDebugLogging": true
}
```

### 4. External Authentication Page Setup

You need to host a web page that handles Firebase authentication. The extension will redirect users to this page.

#### Minimal Implementation

Your authentication page should:
1. Initialize Firebase with the same configuration
2. Handle authentication with desired providers
3. Redirect back to VS Code with authentication result

#### URL Parameters Received

When VS Code opens your auth page, it will include these parameters:
- `callback=vscode` - Indicates VS Code origin
- `redirect_uri=vscode://...` - Where to redirect after auth
- `state=<encoded_state>` - Security state (must be returned unchanged)
- `provider=<provider>` - Optional specific provider
- `session=<session_id>` - Session identifier

#### Example Implementation

```html
<!DOCTYPE html>
<html>
<head>
    <title>Firebase Authentication</title>
    <script src="https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/10.7.1/firebase-auth-compat.js"></script>
</head>
<body>
    <div id="auth-container">
        <h2>Authenticate with Firebase</h2>
        <button onclick="signInWithGoogle()">Sign in with Google</button>
        <button onclick="signInWithGitHub()">Sign in with GitHub</button>
    </div>

    <script>
        // Initialize Firebase
        const firebaseConfig = {
            apiKey: "YOUR_API_KEY",
            authDomain: "YOUR_PROJECT.firebaseapp.com",
            projectId: "YOUR_PROJECT_ID",
            // ... other config
        };

        firebase.initializeApp(firebaseConfig);
        const auth = firebase.auth();

        // Get URL parameters
        const urlParams = new URLSearchParams(window.location.search);
        const redirectUri = urlParams.get('redirect_uri');
        const state = urlParams.get('state');
        const requestedProvider = urlParams.get('provider');

        async function signInWithGoogle() {
            const provider = new firebase.auth.GoogleAuthProvider();
            try {
                const result = await auth.signInWithPopup(provider);
                handleAuthSuccess(result, 'google');
            } catch (error) {
                handleAuthError(error);
            }
        }

        async function signInWithGitHub() {
            const provider = new firebase.auth.GithubAuthProvider();
            try {
                const result = await auth.signInWithPopup(provider);
                handleAuthSuccess(result, 'github');
            } catch (error) {
                handleAuthError(error);
            }
        }

        function handleAuthSuccess(result, provider) {
            const user = result.user;
            const token = result.user.accessToken;

            // Build redirect URL
            const params = new URLSearchParams({
                token: token,
                idToken: user.za, // ID token
                refreshToken: user.refreshToken,
                state: state,
                provider: provider,
                user: JSON.stringify({
                    uid: user.uid,
                    email: user.email,
                    displayName: user.displayName,
                    photoURL: user.photoURL,
                    emailVerified: user.emailVerified,
                    providerId: provider
                })
            });

            window.location.href = redirectUri + '?' + params.toString();
        }

        function handleAuthError(error) {
            const params = new URLSearchParams({
                error: error.message,
                state: state
            });

            window.location.href = redirectUri + '?' + params.toString();
        }

        // Auto-redirect if specific provider requested
        if (requestedProvider === 'google') {
            signInWithGoogle();
        } else if (requestedProvider === 'github') {
            signInWithGitHub();
        }
    </script>
</body>
</html>
```

### 5. Test Configuration

1. Start with the test page: `http://localhost:8080/test-deeplink.html`
2. Test deep link reception first
3. Configure your external auth page
4. Test end-to-end authentication flow

### 6. Production Deployment

1. Deploy your authentication page to a public URL
2. Update the `authPageUrl` in the extension configuration
3. Test thoroughly across different platforms
4. Enable proper HTTPS and security headers

## Security Notes

- Always use HTTPS for your authentication page in production
- Validate the state parameter to prevent CSRF attacks
- Consider implementing additional security measures
- Keep Firebase configuration secure

## Troubleshooting

### Common Issues

1. **Deep links don't work**
   - Check URI scheme registration in package.json
   - Verify VS Code recognizes the extension
   - Test with simple deep link first

2. **Authentication fails**
   - Verify Firebase configuration
   - Check browser console for errors
   - Ensure authentication providers are enabled in Firebase console

3. **Redirect doesn't work**
   - Verify redirect_uri format
   - Check that state parameter is preserved
   - Test browser's handling of custom URI schemes

### Debug Mode

Enable debug logging:
```json
{
  "firebase-authentication-v1.enableDebugLogging": true
}
```

Check logs in VS Code Output panel (View → Output → Firebase Authentication).

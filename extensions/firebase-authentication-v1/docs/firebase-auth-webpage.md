<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Firebase Auth with GitHub and Google</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }

        .container {
            background: white;
            border-radius: 16px;
            padding: 40px;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
            max-width: 400px;
            width: 100%;
            text-align: center;
        }

        .logo {
            width: 80px;
            height: 80px;
            background: linear-gradient(135deg, #ff6b6b, #ee5a24);
            border-radius: 20px;
            margin: 0 auto 30px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 32px;
            font-weight: bold;
        }

        h1 {
            color: #333;
            margin-bottom: 10px;
            font-size: 28px;
        }

        .subtitle {
            color: #666;
            margin-bottom: 40px;
            font-size: 16px;
        }

        .auth-section {
            margin-bottom: 30px;
        }

        .input-group {
            margin-bottom: 20px;
            text-align: left;
        }

        label {
            display: block;
            margin-bottom: 5px;
            color: #555;
            font-weight: 500;
        }

        input {
            width: 100%;
            padding: 12px 16px;
            border: 2px solid #e1e5e9;
            border-radius: 8px;
            font-size: 16px;
            transition: border-color 0.3s ease;
        }

        input:focus {
            outline: none;
            border-color: #667eea;
        }

        .btn {
            width: 100%;
            padding: 14px;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            margin-bottom: 15px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
        }

        .btn-primary {
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: white;
        }

        .btn-primary:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(102, 126, 234, 0.4);
        }

        .btn-github {
            background: #24292e;
            color: white;
        }

        .btn-github:hover {
            background: #1a1e22;
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(36, 41, 46, 0.4);
        }

        .btn-google {
            background: #fff;
            color: #333;
            border: 2px solid #e1e5e9;
        }

        .btn-google:hover {
            background: #f8f9fa;
            border-color: #dadce0;
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(0, 0, 0, 0.1);
        }

        .btn-secondary {
            background: #f8f9fa;
            color: #495057;
            border: 2px solid #e9ecef;
        }

        .btn-secondary:hover {
            background: #e9ecef;
        }

        .divider {
            margin: 30px 0;
            position: relative;
            text-align: center;
        }

        .divider::before {
            content: '';
            position: absolute;
            top: 50%;
            left: 0;
            right: 0;
            height: 1px;
            background: #e1e5e9;
        }

        .divider span {
            background: white;
            padding: 0 20px;
            color: #666;
            font-size: 14px;
        }

        .user-info {
            text-align: left;
            background: #f8f9fa;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 20px;
        }

        .user-avatar {
            width: 60px;
            height: 60px;
            border-radius: 50%;
            margin-bottom: 15px;
        }

        .toggle-auth {
            color: #667eea;
            cursor: pointer;
            font-size: 14px;
            text-decoration: underline;
        }

        .error-message {
            background: #fee;
            color: #c53030;
            padding: 10px;
            border-radius: 6px;
            margin-bottom: 20px;
            font-size: 14px;
            border: 1px solid #fecaca;
        }

        .success-message {
            background: #f0fff4;
            color: #22543d;
            padding: 10px;
            border-radius: 6px;
            margin-bottom: 20px;
            font-size: 14px;
            border: 1px solid #c6f6d5;
        }

        .loading {
            opacity: 0.7;
            pointer-events: none;
        }

        .hidden {
            display: none;
        }

        .redirect-info {
            background: #e3f2fd;
            color: #1565c0;
            padding: 10px;
            border-radius: 6px;
            margin-bottom: 20px;
            font-size: 14px;
            border: 1px solid #bbdefb;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="logo">🔐</div>
        <h1>Welcome</h1>
        <p class="subtitle">Sign in to your account</p>

        <div id="redirect-info" class="redirect-info hidden"></div>
        <div id="error-message" class="error-message hidden"></div>
        <div id="success-message" class="success-message hidden"></div>

        <!-- Login/Register Form -->
        <div id="auth-form" class="auth-section">
            <form id="email-auth-form">
                <div class="input-group">
                    <label for="email">Email</label>
                    <input type="email" id="email" required>
                </div>
                <div class="input-group">
                    <label for="password">Password</label>
                    <input type="password" id="password" required>
                </div>
                <button type="submit" class="btn btn-primary" id="email-auth-btn">
                    Sign In
                </button>
            </form>

            <div class="divider">
                <span>or</span>
            </div>

            <button class="btn btn-google" id="google-auth-btn">
                <svg width="20" height="20" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Continue with Google
            </button>

            <button class="btn btn-github" id="github-auth-btn">
                <svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                </svg>
                Continue with GitHub
            </button>

            <p style="margin-top: 20px; color: #666; font-size: 14px;">
                <span id="auth-toggle-text">Don't have an account?</span>
                <span class="toggle-auth" id="auth-toggle">Sign up</span>
            </p>
        </div>

        <!-- User Dashboard -->
        <div id="user-dashboard" class="auth-section hidden">
            <div class="user-info">
                <img id="user-avatar" class="user-avatar" src="" alt="User Avatar">
                <h3 id="user-name"></h3>
                <p id="user-email" style="color: #666; font-size: 14px;"></p>
            </div>
            <button class="btn btn-secondary" id="sign-out-btn">
                Sign Out
            </button>
        </div>
    </div>

    <!-- Firebase SDK -->
    <script type="module">
        // Import Firebase modules
        import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
        import {
            getAuth,
            signInWithEmailAndPassword,
            createUserWithEmailAndPassword,
            signInWithPopup,
            GithubAuthProvider,
            GoogleAuthProvider,
            signOut,
            onAuthStateChanged
        } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
        import {
            getFirestore,
            doc,
            setDoc
        } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

        // Firebase configuration - Replace with your actual config
        const firebaseConfig = {
            apiKey: "AIzaSyCWlxqKOJL97X-NFRmigOWX8dZuCUwkP8s",
            authDomain: "salesforce-ide-c1761.firebaseapp.com",
            projectId: "salesforce-ide-c1761",
            storageBucket: "salesforce-ide-c1761.firebasestorage.app",
            messagingSenderId: "676849933137",
            appId: "1:676849933137:web:5794af7bd7582a0e1cd170",
            measurementId: "G-853MW5VR9D"
        };

        // Initialize Firebase
        const app = initializeApp(firebaseConfig);
        const auth = getAuth(app);
        const db = getFirestore(app);
        const githubProvider = new GithubAuthProvider();
        const googleProvider = new GoogleAuthProvider();

        // Get URL parameters for VSCode extension flow
        const urlParams = new URLSearchParams(window.location.search);
        const sessionId = urlParams.get('session');     // e.g., "session_1234567890_abc123"
        const provider = urlParams.get('provider');     // "google" or "github"
        const callback = urlParams.get('callback');     // "vscode"
        const redirectUri = urlParams.get('redirect_uri'); // Keep for backward compatibility
        const state = urlParams.get('state');

        console.log('Redirect URI:', redirectUri);
        console.log('State:', state);

        // DOM elements
        const authForm = document.getElementById('auth-form');
        const userDashboard = document.getElementById('user-dashboard');
        const emailAuthForm = document.getElementById('email-auth-form');
        const emailInput = document.getElementById('email');
        const passwordInput = document.getElementById('password');
        const emailAuthBtn = document.getElementById('email-auth-btn');
        const githubAuthBtn = document.getElementById('github-auth-btn');
        const googleAuthBtn = document.getElementById('google-auth-btn');
        const signOutBtn = document.getElementById('sign-out-btn');
        const authToggle = document.getElementById('auth-toggle');
        const authToggleText = document.getElementById('auth-toggle-text');
        const errorMessage = document.getElementById('error-message');
        const successMessage = document.getElementById('success-message');
        const redirectInfo = document.getElementById('redirect-info');
        const userAvatar = document.getElementById('user-avatar');
        const userName = document.getElementById('user-name');
        const userEmail = document.getElementById('user-email');

        let isSignUp = false;

        // Parse only if it's a valid URL scheme
        let domainText;
        if (redirectUri.startsWith("http")) {
            const domain = new URL(redirectUri).origin;
            domainText = `After login, you'll be redirected back to ${domain}`;
        } else {
            // For custom schemes like siid://
            domainText = `After login, you'll be redirected back to your app (${redirectUri})`;
        }

        redirectInfo.textContent = domainText;
        redirectInfo.classList.remove("hidden");

        // Utility functions
        function showError(message) {
            errorMessage.textContent = message;
            errorMessage.classList.remove('hidden');
            successMessage.classList.add('hidden');
        }

        function showSuccess(message) {
            successMessage.innerHTML = message;
            successMessage.classList.remove('hidden');
            errorMessage.classList.add('hidden');
        }

        function hideMessages() {
            errorMessage.classList.add('hidden');
            successMessage.classList.add('hidden');
        }

        function setLoading(element, loading) {
            if (loading) {
                element.classList.add('loading');
                element.textContent = 'Loading...';
            } else {
                element.classList.remove('loading');
                element.textContent = isSignUp ? 'Sign Up' : 'Sign In';
            }
        }

        // Generate auth code for OAuth-like flow
        function generateAuthCode() {
            return 'auth_code_' + Math.random().toString(36).substr(2, 16) + '_' + Date.now();
        }

        // Create user data object
        function createUserData(user) {
            return {
                userInfo: {
                    uid: user.uid,
                    email: user.email,
                    displayName: user.displayName || user.email?.split('@')[0] || 'User',
                    photoURL: user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName || user.email)}&background=667eea&color=fff`,
                    emailVerified: user.emailVerified,
                    createdAt: user.metadata.creationTime,
                    lastSignIn: user.metadata.lastSignInTime
                },
                accessToken: user.accessToken || 'firebase_token_' + Date.now(),
                refreshToken: user.refreshToken || 'firebase_refresh_' + Date.now(),
                expiresAt: Date.now() + (60 * 60 * 1000) // 1 hour from now
            };
        }

        // Handle successful authentication and redirect
        async function handleAuthSuccess(user, method = 'email') {
            try {
                // Check if this is a VSCode extension request
                if (redirectUri) {
                    // Original redirect logic for non-VSCode flows
                    const userData = createUserData(user);
                    const authCode = generateAuthCode();
                    // Build callback URL safely
                    const callbackUrl = new URL(redirectUri, "https://dummy-base.com");
                    callbackUrl.searchParams.set("code", authCode);
                    callbackUrl.searchParams.set("state", state || "success");
                    callbackUrl.searchParams.set("user_data", btoa(JSON.stringify(userData)));
                    console.log('Final callback URL:', callbackUrl.toString());


                    const successMessage = `Authentication successful! Redirecting back to your application...\n If you are not redirected, please click here.<a href='${callbackUrl}'>Click here</a>`;
                    showSuccess(successMessage);
                    setTimeout(() => {
                        window.location.href = callbackUrl.toString();
                    }, 2000);
                } else {
                    showSuccess(`Signed in successfully with ${method}!`);
                }
            } catch (error) {
                console.error('Error handling auth success:', error);

                // If VSCode session, redirect with error
                if (sessionId && callback === 'vscode') {
                    const errorMessage = encodeURIComponent(error.message);
                    window.location.href = `${callback_ide}://firebase-auth/auth-complete?session=${sessionId}&error=storage_failed&error_description=${errorMessage}`;
                } else {
                    showError('Authentication successful, but redirect failed. Please try again.');
                }
            }
        }

        function updateUserDisplay(user) {
            if (user) {
                authForm.classList.add('hidden');
                userDashboard.classList.remove('hidden');

                userName.textContent = user.displayName || 'User';
                userEmail.textContent = user.email;
                userAvatar.src = user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName || user.email)}&background=667eea&color=fff`;

                hideMessages();

                // If there's a redirect URI, handle the redirect after showing user info
                if (redirectUri) {
                    handleAuthSuccess(user, 'existing_session');
                }
            } else {
                authForm.classList.remove('hidden');
                userDashboard.classList.add('hidden');
            }
        }

        // Auth state observer
        onAuthStateChanged(auth, (user) => {
            updateUserDisplay(user);

            // Handle existing session for VSCode
            if (user && sessionId && callback === 'vscode') {
                handleAuthSuccess(user, 'existing_session');
            }
        });
        // Handle authentication errors for VSCode
        window.addEventListener('beforeunload', () => {
            if (sessionId && callback === 'vscode' && !document.querySelector('.success-message:not(.hidden)')) {
                // User is leaving without completing auth - send cancel signal
                navigator.sendBeacon(`${callback_ide}://firebase-auth/auth-cancel?session=${sessionId}`);
            }
        });

        // Email/Password Authentication
        emailAuthForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            hideMessages();

            const email = emailInput.value;
            const password = passwordInput.value;

            if (!email || !password) {
                showError('Please fill in all fields');
                return;
            }

            setLoading(emailAuthBtn, true);

            try {
                let result;
                if (isSignUp) {
                    result = await createUserWithEmailAndPassword(auth, email, password);
                } else {
                    result = await signInWithEmailAndPassword(auth, email, password);
                }

                emailInput.value = '';
                passwordInput.value = '';

                // Handle successful authentication with redirect
                await handleAuthSuccess(result.user, 'email');

            } catch (error) {
                let errorMsg = 'Authentication failed';

                switch (error.code) {
                    case 'auth/user-not-found':
                        errorMsg = 'No account found with this email';
                        break;
                    case 'auth/wrong-password':
                        errorMsg = 'Incorrect password';
                        break;
                    case 'auth/email-already-in-use':
                        errorMsg = 'Email already in use';
                        break;
                    case 'auth/weak-password':
                        errorMsg = 'Password should be at least 6 characters';
                        break;
                    case 'auth/invalid-email':
                        errorMsg = 'Invalid email address';
                        break;
                    case 'auth/too-many-requests':
                        errorMsg = 'Too many failed attempts. Please try again later.';
                        break;
                    default:
                        errorMsg = error.message;
                }

                showError(errorMsg);
            } finally {
                setLoading(emailAuthBtn, false);
            }
        });

        // Google Authentication
        googleAuthBtn.addEventListener('click', async () => {
            hideMessages();

            const originalHTML = googleAuthBtn.innerHTML;
            googleAuthBtn.textContent = 'Connecting...';
            googleAuthBtn.classList.add('loading');

            try {
                const result = await signInWithPopup(auth, googleProvider);
                await handleAuthSuccess(result.user, 'Google');
            } catch (error) {
                let errorMsg = 'Google sign-in failed';

                switch (error.code) {
                    case 'auth/account-exists-with-different-credential':
                        errorMsg = 'An account already exists with this email using a different sign-in method';
                        break;
                    case 'auth/cancelled-popup-request':
                        errorMsg = 'Sign-in cancelled';
                        break;
                    case 'auth/popup-blocked':
                        errorMsg = 'Popup was blocked by the browser';
                        break;
                    case 'auth/popup-closed-by-user':
                        errorMsg = 'Sign-in popup was closed';
                        break;
                    default:
                        errorMsg = error.message;
                }

                showError(errorMsg);
            } finally {
                googleAuthBtn.innerHTML = originalHTML;
                googleAuthBtn.classList.remove('loading');
            }
        });

        // GitHub Authentication
        githubAuthBtn.addEventListener('click', async () => {
            hideMessages();

            const originalHTML = githubAuthBtn.innerHTML;
            githubAuthBtn.textContent = 'Connecting...';
            githubAuthBtn.classList.add('loading');

            try {
                const result = await signInWithPopup(auth, githubProvider);
                await handleAuthSuccess(result.user, 'GitHub');
            } catch (error) {
                let errorMsg = 'GitHub sign-in failed';

                switch (error.code) {
                    case 'auth/account-exists-with-different-credential':
                        errorMsg = 'An account already exists with this email using a different sign-in method';
                        break;
                    case 'auth/cancelled-popup-request':
                        errorMsg = 'Sign-in cancelled';
                        break;
                    case 'auth/popup-blocked':
                        errorMsg = 'Popup was blocked by the browser';
                        break;
                    case 'auth/popup-closed-by-user':
                        errorMsg = 'Sign-in popup was closed';
                        break;
                    default:
                        errorMsg = error.message;
                }

                showError(errorMsg);
            } finally {
                githubAuthBtn.innerHTML = originalHTML;
                githubAuthBtn.classList.remove('loading');
            }
        });

        // Sign Out
        signOutBtn.addEventListener('click', async () => {
            hideMessages();

            try {
                await signOut(auth);
                showSuccess('Signed out successfully!');
            } catch (error) {
                showError('Error signing out: ' + error.message);
            }
        });

        // Toggle between Sign In and Sign Up
        authToggle.addEventListener('click', () => {
            isSignUp = !isSignUp;
            hideMessages();

            if (isSignUp) {
                emailAuthBtn.textContent = 'Sign Up';
                authToggleText.textContent = 'Already have an account?';
                authToggle.textContent = 'Sign in';
            } else {
                emailAuthBtn.textContent = 'Sign In';
                authToggleText.textContent = "Don't have an account?";
                authToggle.textContent = 'Sign up';
            }
        });

        // Show setup instructions
        console.log('🔥 Firebase Auth with Redirect Setup Instructions:');
        console.log('1. Go to https://console.firebase.google.com/');
        console.log('2. Create a new project or select existing one');
        console.log('3. Enable Authentication and configure GitHub + Google providers');
        console.log('4. Replace the firebaseConfig object with your actual config');
        console.log('5. Add your domain to authorized domains in Firebase Console');
        console.log('6. For Google: Add your domain to authorized JavaScript origins');
        console.log('7. Test with URL parameters: ?redirect_uri=https://yourapp.com/callback&state=abc123');
    </script>
</body>
</html>

<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Firebase Auth with GitHub and Google</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <div class="container">
        <div class="logo">🔐</div>
        <h1>Welcome</h1>
        <p class="subtitle">Sign in to your account</p>

        <div id="redirect-info" class="redirect-info hidden"></div>
        <div id="provider-info" class="provider-info hidden"></div>
        <div id="auto-login-info" class="auto-login-info hidden"></div>
        <div id="error-message" class="error-message hidden"></div>
        <div id="success-message" class="success-message hidden"></div>

        <!-- Auto Login Section -->
        <div id="auto-login-section" class="auth-section hidden">
            <div class="spinner"></div>
            <p>Initiating <span id="provider-name"></span> login...</p>
        </div>

        <!-- Manual Auth Form -->
        <div id="auth-form" class="auth-section">
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
    <script type="module" src="script.js"></script>
</body>
</html>

// Import Firebase modules
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import {
    getAuth,
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


// Import Firebase configuration
import { firebaseConfig, securityConfig } from './config.js';

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Configure providers with security settings
const githubProvider = new GithubAuthProvider();
securityConfig.oauthConfig.github.scopes.forEach(scope => {
    githubProvider.addScope(scope);
});

const googleProvider = new GoogleAuthProvider();
securityConfig.oauthConfig.google.scopes.forEach(scope => {
    googleProvider.addScope(scope);
});

// Get URL parameters
const urlParams = new URLSearchParams(window.location.search);
const sessionId = urlParams.get('session');
const provider = urlParams.get('provider');
const callback = urlParams.get('callback');
const redirectUri = urlParams.get('redirect_uri');
const state = urlParams.get('state');

console.log('URL Parameters:', { sessionId, provider, callback, redirectUri, state });

// DOM elements
const authForm = document.getElementById('auth-form');
const userDashboard = document.getElementById('user-dashboard');
const autoLoginSection = document.getElementById('auto-login-section');
const githubAuthBtn = document.getElementById('github-auth-btn');
const googleAuthBtn = document.getElementById('google-auth-btn');
const signOutBtn = document.getElementById('sign-out-btn');
const errorMessage = document.getElementById('error-message');
const successMessage = document.getElementById('success-message');
const redirectInfo = document.getElementById('redirect-info');
const providerInfo = document.getElementById('provider-info');
const autoLoginInfo = document.getElementById('auto-login-info');
const providerName = document.getElementById('provider-name');
const userAvatar = document.getElementById('user-avatar');
const userName = document.getElementById('user-name');
const userEmail = document.getElementById('user-email');

// Initialize page based on URL parameters
function initializePage() {
    // Show redirect info if redirect URI is provided
    if (redirectUri) {
        let domainText;
        if (redirectUri.startsWith("http")) {
            const domain = new URL(redirectUri).origin;
            domainText = `After login, you'll be redirected back to ${domain}`;
        } else {
            domainText = `After login, you'll be redirected back to your app (${redirectUri})`;
        }
        redirectInfo.textContent = domainText;
        redirectInfo.classList.remove("hidden");
    }

    // Show provider info and auto-login if provider is specified
    if (provider) {
        const providerDisplayName = provider === 'google' ? 'Google' : 'GitHub';
        providerInfo.textContent = `Provider: ${providerDisplayName}`;
        providerInfo.classList.remove("hidden");

        // Auto-initiate login if provider is specified
        autoInitiateLogin(provider);
    }
}

// Auto-initiate login based on provider parameter
async function autoInitiateLogin(providerType) {
    const providerDisplayName = providerType === 'google' ? 'Google' : 'GitHub';

    // Show auto-login UI
    authForm.classList.add('hidden');
    autoLoginSection.classList.remove('hidden');
    providerName.textContent = providerDisplayName;

    autoLoginInfo.textContent = `Automatically starting ${providerDisplayName} authentication...`;
    autoLoginInfo.classList.remove('hidden');

    // Wait a moment to show the UI, then initiate login
    setTimeout(async () => {
        try {
            if (providerType === 'google') {
                await authenticateWithGoogle();
            } else if (providerType === 'github') {
                await authenticateWithGitHub();
            }
        } catch (error) {
            console.error('Auto-login failed:', error);
            // Hide auto-login UI and show manual options
            autoLoginSection.classList.add('hidden');
            authForm.classList.remove('hidden');
            showError(`Auto-login with ${providerDisplayName} failed. Please try manually.`);
        }
    }, 1500);
}

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
async function handleAuthSuccess(user, method = 'provider') {
    try {
        // Hide auto-login UI
        autoLoginSection.classList.add('hidden');

        if (redirectUri) {
            const userData = createUserData(user);
            const authCode = generateAuthCode();

            // Build callback URL safely
            const callbackUrl = new URL(redirectUri, "https://dummy-base.com");
            callbackUrl.searchParams.set("code", authCode);
            callbackUrl.searchParams.set("state", state || "success");
            callbackUrl.searchParams.set("user_data", btoa(JSON.stringify(userData)));

            console.log('Final callback URL:', callbackUrl.toString());

            const successMessage = `Authentication successful! Redirecting back to your application...<br>If you are not redirected, <a href='${callbackUrl}'>click here</a>.`;
            showSuccess(successMessage);

            setTimeout(() => {
                window.location.href = callbackUrl.toString();
            }, 2000);
        } else {
            showSuccess(`Signed in successfully with ${method}!`);
        }
    } catch (error) {
        console.error('Error handling auth success:', error);
        showError('Authentication successful, but redirect failed. Please try again.');
    }
}

function updateUserDisplay(user) {
    if (user) {
        authForm.classList.add('hidden');
        autoLoginSection.classList.add('hidden');
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
        if (!provider) {
            authForm.classList.remove('hidden');
        }
        userDashboard.classList.add('hidden');
        autoLoginSection.classList.add('hidden');
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

// Google Authentication
async function authenticateWithGoogle() {
    hideMessages();

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

        throw new Error(errorMsg);
    }
}

// GitHub Authentication
async function authenticateWithGitHub() {
    hideMessages();

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

        throw new Error(errorMsg);
    }
}

// Manual Google Authentication
googleAuthBtn.addEventListener('click', async () => {
    const originalHTML = googleAuthBtn.innerHTML;
    googleAuthBtn.textContent = 'Connecting...';
    googleAuthBtn.classList.add('loading');

    try {
        await authenticateWithGoogle();
    } catch (error) {
        showError(error.message);
    } finally {
        googleAuthBtn.innerHTML = originalHTML;
        googleAuthBtn.classList.remove('loading');
    }
});

// Manual GitHub Authentication
githubAuthBtn.addEventListener('click', async () => {
    const originalHTML = githubAuthBtn.innerHTML;
    githubAuthBtn.textContent = 'Connecting...';
    githubAuthBtn.classList.add('loading');

    try {
        await authenticateWithGitHub();
    } catch (error) {
        showError(error.message);
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

// Initialize the page
initializePage();

// Setup instructions
console.log('🔥 Firebase Auth Setup Instructions:');
console.log('1. Go to https://console.firebase.google.com/');
console.log('2. Create a new project or select existing one');
console.log('3. Enable Authentication and configure GitHub + Google providers');
console.log('4. Add your domain to authorized domains in Firebase Console');
console.log('5. For Google: Add your domain to authorized JavaScript origins');
console.log('6. Test with URL parameters: ?provider=google&redirect_uri=siid://...&state=abc123');

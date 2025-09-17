import * as vscode from 'vscode';
import { initializeApp, FirebaseApp } from '@firebase/app';
import {
	getAuth,
	Auth,
	User,
	signInWithCustomToken,
	signOut,
	onAuthStateChanged,
	Unsubscribe
} from '@firebase/auth';
import {
	getFirestore,
	Firestore,
	doc,
	getDoc,
	deleteDoc,
	Timestamp
} from '@firebase/firestore';
import { getFirebaseConfig, validateFirebaseConfig } from './firebaseConfig';

interface PendingAuth {
	resolve: (user: User) => void;
	reject: (error: Error) => void;
	timestamp: number;
}

interface AuthSessionData {
	uid: string;
	email: string | null;
	displayName: string | null;
	photoURL: string | null;
	accessToken?: string;
	idToken?: string;
	timestamp: number;
}

export class FirebaseAuthProvider implements vscode.Disposable {
	private app: FirebaseApp | null = null;
	private auth: Auth | null = null;
	private firestore: Firestore | null = null;
	private currentUser: User | null = null;
	private authStateUnsubscribe: Unsubscribe | null = null;
	private authStateChangeHandlers: ((user: User | null) => void)[] = [];
	private pendingAuth: Record<string, PendingAuth> = {};
	private readonly AUTH_SESSIONS_COLLECTION = 'auth_sessions';
	private readonly SESSION_TIMEOUT = 300000; // 5 minutes

	constructor(private context: vscode.ExtensionContext) {
		this.initialize();
		this.cleanupExpiredSessions();
	}

	private async initialize(): Promise<void> {
		// Get Firebase configuration
		let firebaseConfig = getFirebaseConfig();

		// Allow workspace override for development
		const workspaceConfig = vscode.workspace.getConfiguration('firebase-auth');
		const workspaceApiKey = workspaceConfig.get<string>('apiKey');

		if (workspaceApiKey) {
			firebaseConfig = {
				...firebaseConfig,
				apiKey: workspaceApiKey,
				authDomain: workspaceConfig.get<string>('authDomain') || firebaseConfig.authDomain!,
				projectId: workspaceConfig.get<string>('projectId') || firebaseConfig.projectId!
			};
		}

		// Validate configuration
		if (!validateFirebaseConfig(firebaseConfig)) {
			vscode.window.showErrorMessage(
				'Firebase configuration is invalid or not properly set up in the IDE. Please contact the IDE provider.'
			);
			return;
		}

		try {
			this.app = initializeApp(firebaseConfig);
			this.auth = getAuth(this.app);
			this.firestore = getFirestore(this.app);

			// Listen to auth state changes
			this.authStateUnsubscribe = onAuthStateChanged(this.auth, (user) => {
				this.currentUser = user;
				this.authStateChangeHandlers.forEach(handler => handler(user));
			});

			console.log('Firebase initialized successfully for custom IDE');

		} catch (error) {
			vscode.window.showErrorMessage(`Firebase initialization failed: ${error}`);
		}
	}

	public async signInWithGoogle(): Promise<User> {
		return this.initiateAuthFlow('google');
	}

	public async signInWithGitHub(): Promise<User> {
		return this.initiateAuthFlow('github');
	}

	private async initiateAuthFlow(provider: 'google' | 'github'): Promise<User> {
		if (!this.auth) {
			throw new Error('Firebase not initialized');
		}

		try {
			// Generate unique session ID
			const sessionId = this.generateSessionId();

			// Build auth URL
			const authUrl = this.buildHostedAuthUrl(sessionId, provider);

			// Create pending auth promise
			const authPromise = new Promise<User>((resolve, reject) => {
				this.pendingAuth[sessionId] = {
					resolve,
					reject,
					timestamp: Date.now()
				};

				// Set timeout
				setTimeout(() => {
					if (this.pendingAuth[sessionId]) {
						delete this.pendingAuth[sessionId];
						reject(new Error('Authentication timeout - please try again'));
					}
				}, this.SESSION_TIMEOUT);
			});

			// Open hosted auth page
			await vscode.env.openExternal(vscode.Uri.parse(authUrl));

			// Show user notification
			vscode.window.showInformationMessage(
				`🔥 Firebase Authentication\n\nComplete the ${provider === 'google' ? 'Google' : 'GitHub'} sign-in in your browser. You'll be redirected back automatically.`,
				{ modal: false }
			);

			return await authPromise;

		} catch (error: any) {
			throw new Error(`${provider === 'google' ? 'Google' : 'GitHub'} sign-in failed: ${error.message}`);
		}
	}

	private buildHostedAuthUrl(sessionId: string, provider: 'google' | 'github'): string {
		const baseUrl = 'https://salesforce-ide-c1761.web.app'; // Your hosted login page
		const params = new URLSearchParams({
			session: sessionId,
			provider: provider,
			callback: 'vscode', // Indicates this is from VSCode extension,
			redirect_uri: 'siid://firebase-auth/auth-complete'
		});

		return `${baseUrl}?${params.toString()}`;
	}

	private generateSessionId(): string {
		const timestamp = Date.now();
		const randomBytes = Math.random().toString(36).substring(2);
		return `session_${timestamp}_${randomBytes}`;
	}

	public async completeAuthWithSession(sessionId: string): Promise<void> {
		if (!this.auth || !this.firestore) {
			throw new Error('Firebase not initialized');
		}

		try {
			// Get pending auth promise
			const pendingAuth = this.pendingAuth[sessionId];
			if (!pendingAuth) {
				throw new Error('No pending authentication found for this session');
			}

			// Fetch session data from Firestore
			const sessionDoc = doc(this.firestore, this.AUTH_SESSIONS_COLLECTION, sessionId);
			const sessionSnapshot = await getDoc(sessionDoc);

			if (!sessionSnapshot.exists()) {
				throw new Error('Authentication session not found or expired');
			}

			const sessionData = sessionSnapshot.data() as AuthSessionData;

			// Validate session age
			const sessionAge = Date.now() - sessionData.timestamp;
			if (sessionAge > this.SESSION_TIMEOUT) {
				await deleteDoc(sessionDoc);
				throw new Error('Authentication session expired');
			}

			// Sign in with custom token (if available) or create user from session data
			let user: User;

			if (sessionData.idToken) {
				// If we have an ID token, use it to sign in
				const result = await signInWithCustomToken(this.auth, sessionData.idToken);
				user = result.user;
			} else {
				// This would require implementing custom token generation on your backend
				// For now, we'll throw an error indicating backend implementation needed
				throw new Error('Custom token authentication requires backend implementation');
			}

			// Clean up session
			await deleteDoc(sessionDoc);
			delete this.pendingAuth[sessionId];

			// Resolve the pending promise
			pendingAuth.resolve(user);

			vscode.window.showInformationMessage(
				`✅ Successfully authenticated as ${user.displayName || user.email}!`
			);

		} catch (error: any) {
			console.error('Auth completion error:', error);

			// Reject pending promise if it exists
			const pendingAuth = this.pendingAuth[sessionId];
			if (pendingAuth) {
				delete this.pendingAuth[sessionId];
				pendingAuth.reject(error);
			}

			throw error;
		}
	}

	public async handleAuthError(sessionId: string, error: string, errorDescription?: string): Promise<void> {
		const pendingAuth = this.pendingAuth[sessionId];
		if (pendingAuth) {
			delete this.pendingAuth[sessionId];
			pendingAuth.reject(new Error(`Authentication failed: ${error} - ${errorDescription || 'Unknown error'}`));
		}
	}

	public async handleAuthCancel(sessionId: string): Promise<void> {
		const pendingAuth = this.pendingAuth[sessionId];
		if (pendingAuth) {
			delete this.pendingAuth[sessionId];
			pendingAuth.reject(new Error('Authentication was cancelled by user'));
		}
	}

	private async cleanupExpiredSessions(): Promise<void> {
		// Clean up expired pending auth promises
		const now = Date.now();
		for (const [sessionId, pendingAuth] of Object.entries(this.pendingAuth)) {
			if (now - pendingAuth.timestamp > this.SESSION_TIMEOUT) {
				delete this.pendingAuth[sessionId];
				pendingAuth.reject(new Error('Authentication session expired'));
			}
		}

		// Schedule next cleanup
		setTimeout(() => this.cleanupExpiredSessions(), 60000); // Every minute
	}

	public async signOut(): Promise<void> {
		if (!this.auth) {
			throw new Error('Firebase not initialized');
		}

		try {
			await signOut(this.auth);
		} catch (error: any) {
			throw new Error(`Sign out failed: ${error.message}`);
		}
	}

	public getCurrentUser(): User | null {
		return this.currentUser;
	}

	public onAuthStateChanged(handler: (user: User | null) => void): void {
		this.authStateChangeHandlers.push(handler);
	}

	public isAuthenticated(): boolean {
		return !!this.currentUser;
	}

	public dispose(): void {
		if (this.authStateUnsubscribe) {
			this.authStateUnsubscribe();
		}

		// Reject all pending auth promises
		for (const [sessionId, pendingAuth] of Object.entries(this.pendingAuth)) {
			pendingAuth.reject(new Error('Extension is being disposed'));
		}

		this.authStateChangeHandlers = [];
		this.pendingAuth = {};
	}
}

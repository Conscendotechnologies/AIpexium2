import * as vscode from 'vscode';
import { initializeApp, FirebaseApp } from '@firebase/app';
import { getFirestore, Firestore, doc, setDoc, getDoc, deleteDoc, collection } from '@firebase/firestore';
import { AuthSession, AuthState } from '../types/auth.types';

export class Storage {
	private readonly context: vscode.ExtensionContext;
	private firebaseApp: FirebaseApp | null = null;
	private firestore: Firestore | null = null;
	private static readonly AUTH_SESSION_KEY = 'firebase-auth-session';
	private static readonly AUTH_STATE_KEY = 'firebase-auth-state';
	private static readonly COLLECTION_SESSIONS = 'auth-sessions';
	private static readonly COLLECTION_STATES = 'auth-states';

	constructor(context: vscode.ExtensionContext) {
		this.context = context;
		this.initializeFirestore();
	}

	/**
	 * Initialize Firestore connection
	 */
	private initializeFirestore(): void {
		try {
			const firebaseConfig = this.getFirebaseConfig();

			if (!this.isConfigValid(firebaseConfig)) {
				console.warn('Firebase configuration is incomplete. Falling back to local storage.');
				return;
			}

			this.firebaseApp = initializeApp(firebaseConfig);
			this.firestore = getFirestore(this.firebaseApp);
			console.log('Firestore initialized successfully');
		} catch (error) {
			console.error('Failed to initialize Firestore:', error);
			console.warn('Falling back to local storage');
		}
	}

	/**
	 * Get Firebase configuration from environment or VS Code settings
	 */
	private getFirebaseConfig() {
		// Try environment variables first
		const envConfig = {
			apiKey: process.env.FIREBASE_API_KEY || '',
			authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
			projectId: process.env.FIREBASE_PROJECT_ID || '',
			storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
			messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
			appId: process.env.FIREBASE_APP_ID || ''
		};

		// If environment variables are available, use them
		if (envConfig.apiKey && envConfig.authDomain && envConfig.projectId) {
			return envConfig;
		}

		// Fall back to VS Code settings
		const config = vscode.workspace.getConfiguration('firebase-authentication-v1');
		return {
			apiKey: config.get('apiKey', ''),
			authDomain: config.get('authDomain', ''),
			projectId: config.get('projectId', ''),
			storageBucket: config.get('storageBucket', ''),
			messagingSenderId: config.get('messagingSenderId', ''),
			appId: config.get('appId', '')
		};
	}

	/**
	 * Validate Firebase configuration
	 */
	private isConfigValid(config: any): boolean {
		return !!(
			config.apiKey &&
			config.authDomain &&
			config.projectId &&
			config.storageBucket &&
			config.messagingSenderId &&
			config.appId
		);
	}

	/**
	 * Get unique device/session identifier
	 */
	private getDeviceId(): string {
		// Use VS Code's machine ID as a unique identifier
		return vscode.env.machineId;
	}

	/**
	 * Store authentication session
	 */
	public async storeAuthSession(session: AuthSession): Promise<void> {
		try {
			if (this.firestore) {
				// Store in Firestore using device ID as document ID
				const deviceId = this.getDeviceId();
				const sessionDoc = doc(this.firestore, Storage.COLLECTION_SESSIONS, deviceId);
				await setDoc(sessionDoc, {
					...session,
					updatedAt: new Date(),
					deviceId: deviceId
				});
				console.log('Session stored in Firestore');
			} else {
				// Fallback to local storage
				await this.context.globalState.update(Storage.AUTH_SESSION_KEY, session);
				console.log('Session stored in local storage (Firestore not available)');
			}
		} catch (error) {
			console.error('Failed to store session in Firestore, falling back to local storage:', error);
			await this.context.globalState.update(Storage.AUTH_SESSION_KEY, session);
		}
	}

	/**
	 * Retrieve authentication session
	 */
	public async getAuthSession(): Promise<AuthSession | undefined> {
		try {
			if (this.firestore) {
				// Retrieve from Firestore
				const deviceId = this.getDeviceId();
				const sessionDoc = doc(this.firestore, Storage.COLLECTION_SESSIONS, deviceId);
				const docSnap = await getDoc(sessionDoc);

				if (docSnap.exists()) {
					const data = docSnap.data();
					// Remove Firestore-specific fields and return AuthSession
					const { updatedAt, deviceId: _deviceId, ...session } = data;
					console.log('Session retrieved from Firestore');
					return session as AuthSession;
				} else {
					console.log('No session found in Firestore');
					return undefined;
				}
			} else {
				// Fallback to local storage
				const session = this.context.globalState.get<AuthSession>(Storage.AUTH_SESSION_KEY);
				console.log('Session retrieved from local storage (Firestore not available)');
				return session;
			}
		} catch (error) {
			console.error('Failed to retrieve session from Firestore, falling back to local storage:', error);
			return this.context.globalState.get<AuthSession>(Storage.AUTH_SESSION_KEY);
		}
	}

	/**
	 * Clear authentication session
	 */
	public async clearAuthSession(): Promise<void> {
		try {
			if (this.firestore) {
				// Delete from Firestore
				const deviceId = this.getDeviceId();
				const sessionDoc = doc(this.firestore, Storage.COLLECTION_SESSIONS, deviceId);
				await deleteDoc(sessionDoc);
				console.log('Session cleared from Firestore');
			} else {
				// Fallback to local storage
				await this.context.globalState.update(Storage.AUTH_SESSION_KEY, undefined);
				console.log('Session cleared from local storage (Firestore not available)');
			}
		} catch (error) {
			console.error('Failed to clear session from Firestore, falling back to local storage:', error);
			await this.context.globalState.update(Storage.AUTH_SESSION_KEY, undefined);
		}
	}

	/**
	 * Store pending auth state for validation
	 */
	public async storePendingAuthState(state: AuthState): Promise<void> {
		try {
			if (this.firestore) {
				// Store in Firestore using device ID as document ID
				const deviceId = this.getDeviceId();
				const stateDoc = doc(this.firestore, Storage.COLLECTION_STATES, deviceId);
				await setDoc(stateDoc, {
					...state,
					updatedAt: new Date(),
					deviceId: deviceId
				});
				console.log('Auth state stored in Firestore');
			} else {
				// Fallback to local storage
				await this.context.globalState.update(Storage.AUTH_STATE_KEY, state);
				console.log('Auth state stored in local storage (Firestore not available)');
			}
		} catch (error) {
			console.error('Failed to store auth state in Firestore, falling back to local storage:', error);
			await this.context.globalState.update(Storage.AUTH_STATE_KEY, state);
		}
	}

	/**
	 * Retrieve pending auth state
	 */
	public async getPendingAuthState(): Promise<AuthState | undefined> {
		try {
			if (this.firestore) {
				// Retrieve from Firestore
				const deviceId = this.getDeviceId();
				const stateDoc = doc(this.firestore, Storage.COLLECTION_STATES, deviceId);
				const docSnap = await getDoc(stateDoc);

				if (docSnap.exists()) {
					const data = docSnap.data();
					// Remove Firestore-specific fields and return AuthState
					const { updatedAt, deviceId: _deviceId, ...state } = data;
					console.log('Auth state retrieved from Firestore');
					return state as AuthState;
				} else {
					console.log('No auth state found in Firestore');
					return undefined;
				}
			} else {
				// Fallback to local storage
				const state = this.context.globalState.get<AuthState>(Storage.AUTH_STATE_KEY);
				console.log('Auth state retrieved from local storage (Firestore not available)');
				return state;
			}
		} catch (error) {
			console.error('Failed to retrieve auth state from Firestore, falling back to local storage:', error);
			return this.context.globalState.get<AuthState>(Storage.AUTH_STATE_KEY);
		}
	}

	/**
	 * Clear pending auth state
	 */
	public async clearPendingAuthState(): Promise<void> {
		try {
			if (this.firestore) {
				// Delete from Firestore
				const deviceId = this.getDeviceId();
				const stateDoc = doc(this.firestore, Storage.COLLECTION_STATES, deviceId);
				await deleteDoc(stateDoc);
				console.log('Auth state cleared from Firestore');
			} else {
				// Fallback to local storage
				await this.context.globalState.update(Storage.AUTH_STATE_KEY, undefined);
				console.log('Auth state cleared from local storage (Firestore not available)');
			}
		} catch (error) {
			console.error('Failed to clear auth state from Firestore, falling back to local storage:', error);
			await this.context.globalState.update(Storage.AUTH_STATE_KEY, undefined);
		}
	}

	/**
	 * Check if user is currently authenticated
	 */
	public async isAuthenticated(): Promise<boolean> {
		const session = await this.getAuthSession();
		if (!session) {
			return false;
		}

		// Check if session is expired
		return Date.now() < session.expiresAt;
	}

	/**
	 * Get current user if authenticated
	 */
	public async getCurrentUser() {
		if (!(await this.isAuthenticated())) {
			return null;
		}

		const session = await this.getAuthSession();
		return session?.user || null;
	}
}

import * as vscode from 'vscode';
import { initializeApp, FirebaseApp } from '@firebase/app';
import { getAuth, signInWithCustomToken, Auth, User } from '@firebase/auth';
import { AuthResult, AuthSession, FirebaseConfig, FirebaseUser } from '../types/auth.types';
import { Logger } from '../utils/logger';
import { Storage } from '../utils/storage';

export class FirebaseManager {
	private readonly logger: Logger;
	private readonly storage: Storage;
	private firebaseApp: FirebaseApp | null = null;
	private auth: Auth | null = null;

	constructor(logger: Logger, storage: Storage) {
		this.logger = logger;
		this.storage = storage;
	}

	/**
	 * Initialize Firebase with configuration from VS Code settings
	 */
	public async initialize(): Promise<void> {
		try {
			const config = this.getFirebaseConfig();

			if (!this.isConfigValid(config)) {
				throw new Error('Firebase configuration is incomplete. Please check your VS Code settings.');
			}

			this.firebaseApp = initializeApp(config);
			this.auth = getAuth(this.firebaseApp);

			this.logger.info('Firebase initialized successfully');
		} catch (error) {
			this.logger.error('Failed to initialize Firebase', error);
			throw error;
		}
	}

	/**
	 * Process authentication result from external auth page
	 */
	public async processAuthResult(authResult: AuthResult): Promise<AuthSession> {
		if (!this.auth) {
			await this.initialize();
		}

		if (!this.auth) {
			throw new Error('Firebase not initialized');
		}

		try {
			let user: User | null = null;

			// Check if this is a test scenario (mock tokens)
			const isTestToken = authResult.token?.startsWith('mock_') || authResult.idToken?.startsWith('mock_');

			if (isTestToken) {
				// For testing, create a mock user session without actual Firebase authentication
				this.logger.info('🧪 Test mode: Creating mock user session');

				// Create auth session with mock user data
				const session: AuthSession = {
					user: {
						uid: 'test-user-123',
						email: 'test@example.com',
						displayName: 'Test User',
						photoURL: undefined,
						emailVerified: true,
						providerId: authResult.provider || 'google'
					},
					token: authResult.token || authResult.idToken || '',
					refreshToken: authResult.refreshToken || 'mock_refresh_token',
					expiresAt: Date.now() + (60 * 60 * 1000) // 1 hour from now
				};

				// Store session
				await this.storage.storeAuthSession(session);

				this.logger.info('🧪 Test user session created successfully');
				return session;
			}

			// Real authentication flow for production
			if (authResult.idToken) {
				// Sign in with ID token (if using custom token flow)
				user = (await signInWithCustomToken(this.auth, authResult.idToken)).user;
			} else if (authResult.token) {
				// Sign in with custom token
				user = (await signInWithCustomToken(this.auth, authResult.token)).user;
			} else {
				throw new Error('No valid authentication token provided');
			}

			// Create auth session
			const session: AuthSession = {
				user: this.convertFirebaseUser(user),
				token: authResult.token || authResult.idToken || '',
				refreshToken: authResult.refreshToken || user.refreshToken,
				expiresAt: Date.now() + (60 * 60 * 1000) // 1 hour from now
			};

			// Store session
			await this.storage.storeAuthSession(session);

			this.logger.info(`User signed in successfully: ${user.email}`);
			return session;

		} catch (error) {
			this.logger.error('Failed to process auth result', error);
			throw error;
		}
	}

	/**
	 * Sign out current user
	 */
	public async signOut(): Promise<void> {
		try {
			if (this.auth) {
				await this.auth.signOut();
			}

			await this.storage.clearAuthSession();
			this.logger.info('User signed out successfully');
		} catch (error) {
			this.logger.error('Failed to sign out', error);
			throw error;
		}
	}

	/**
	 * Get current user session
	 */
	public getCurrentSession(): AuthSession | null {
		return this.storage.getAuthSession() || null;
	}

	/**
	 * Check if user is currently authenticated
	 */
	public isAuthenticated(): boolean {
		return this.storage.isAuthenticated();
	}

	/**
	 * Refresh current authentication session
	 */
	public async refreshSession(): Promise<AuthSession | null> {
		const currentSession = this.getCurrentSession();
		if (!currentSession) {
			return null;
		}

		try {
			// In a real implementation, you would refresh the token here
			// For now, just extend the expiration time
			const refreshedSession: AuthSession = {
				...currentSession,
				expiresAt: Date.now() + (60 * 60 * 1000) // 1 hour from now
			};

			await this.storage.storeAuthSession(refreshedSession);
			this.logger.info('Session refreshed successfully');
			return refreshedSession;

		} catch (error) {
			this.logger.error('Failed to refresh session', error);
			throw error;
		}
	}

	/**
	 * Get Firebase configuration from VS Code settings
	 */
	private getFirebaseConfig(): FirebaseConfig {
		// Try to load from environment variables first (from .env file)
		const envConfig = {
			apiKey: process.env.FIREBASE_API_KEY || '',
			authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
			projectId: process.env.FIREBASE_PROJECT_ID || '',
			storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
			messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
			appId: process.env.FIREBASE_APP_ID || '',
			measurementId: process.env.FIREBASE_MEASUREMENT_ID
		};

		// If environment variables are available, use them
		if (envConfig.apiKey && envConfig.authDomain && envConfig.projectId) {
			this.logger.info('Loading Firebase config from environment variables');
			return envConfig;
		}

		// Fall back to VS Code settings
		this.logger.info('Loading Firebase config from VS Code settings');
		const config = vscode.workspace.getConfiguration('firebase-authentication-v1');

		return {
			apiKey: config.get('apiKey', ''),
			authDomain: config.get('authDomain', ''),
			projectId: config.get('projectId', ''),
			storageBucket: config.get('storageBucket', ''),
			messagingSenderId: config.get('messagingSenderId', ''),
			appId: config.get('appId', ''),
			measurementId: config.get('measurementId')
		};
	}

	/**
	 * Validate Firebase configuration
	 */
	private isConfigValid(config: FirebaseConfig): boolean {
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
	 * Convert Firebase User to our FirebaseUser type
	 */
	private convertFirebaseUser(user: User): FirebaseUser {
		return {
			uid: user.uid,
			email: user.email || undefined,
			displayName: user.displayName || undefined,
			photoURL: user.photoURL || undefined,
			emailVerified: user.emailVerified,
			providerId: user.providerData[0]?.providerId || 'unknown'
		};
	}
}

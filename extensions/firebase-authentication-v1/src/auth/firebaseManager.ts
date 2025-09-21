import * as vscode from 'vscode';
import { initializeApp, FirebaseApp } from '@firebase/app';
import { getFirestore, Firestore, doc, getDoc, setDoc } from '@firebase/firestore';
import { AuthResult, AuthSession, FirebaseUser } from '../types/auth.types';
import { Logger } from '../utils/logger';
import { Storage } from '../utils/storage';

export class FirebaseManager {
	private readonly logger: Logger;
	private readonly storage: Storage;
	private firebaseApp: FirebaseApp | null = null;
	private firestore: Firestore | null = null;

	constructor(logger: Logger, storage: Storage) {
		this.logger = logger;
		this.storage = storage;
		this.initializeFirebase();
	}

	/**
	 * Initialize Firebase for database access
	 */
	private initializeFirebase(): void {
		try {
			const firebaseConfig = this.getFirebaseConfig();

			if (!this.isConfigValid(firebaseConfig)) {
				this.logger.warn('Firebase configuration is incomplete. User data fetching will be limited.');
				return;
			}

			this.firebaseApp = initializeApp(firebaseConfig);
			this.firestore = getFirestore(this.firebaseApp);
			this.logger.info('Firebase initialized successfully for user data access');
		} catch (error) {
			this.logger.error('Failed to initialize Firebase:', error);
			this.logger.warn('Will use fallback user data creation');
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
	 * Process authentication result from external auth page (simplified - only uid)
	 */
	public async processAuthResult(authResult: AuthResult): Promise<AuthSession> {
		try {
			// Check if this is a test scenario
			const isTestUid = authResult.uid?.startsWith('test_');

			if (isTestUid) {
				// For testing, create a mock user session
				this.logger.info('🧪 Test mode: Creating mock user session');

				const session: AuthSession = {
					user: {
						uid: authResult.uid || 'test-user-123',
						email: 'test@example.com',
						displayName: 'Test User',
						photoURL: undefined,
						emailVerified: true,
						providerId: 'test'
					},
					token: 'mock_token',
					refreshToken: 'mock_refresh_token',
					expiresAt: Date.now() + (60 * 60 * 1000) // 1 hour from now
				};

				// Store session
				await this.storage.storeAuthSession(session);

				this.logger.info('🧪 Test user session created successfully');
				return session;
			}

			// Real authentication flow - fetch user data from Firestore
			if (!authResult.uid) {
				throw new Error('No user ID provided');
			}

			// Fetch user data from Firestore database
			const userData = await this.getUserDataFromDatabase(authResult.uid);
			this.logger.info('Fetched user data from database:', userData);
			// Create session with real user data from database
			const session: AuthSession = {
				user: {
					uid: userData.uid,
					email: userData.email || `user-${authResult.uid}@firebase.com`,
					displayName: userData.displayName || `User ${authResult.uid}`,
					photoURL: userData.photoURL,
					emailVerified: userData.emailVerified || false,
					providerId: userData.provider || 'firebase'
				},
				token: 'simplified_token',
				refreshToken: 'simplified_refresh_token',
				expiresAt: Date.now() + (60 * 60 * 1000) // 1 hour from now
			};

			// Store session
			await this.storage.storeAuthSession(session);

			this.logger.info(`User signed in successfully with UID: ${authResult.uid}`);
			this.logger.info(`User email: ${session.user.email}, Display name: ${session.user.displayName}`);
			return session;

		} catch (error) {
			this.logger.error('Failed to process auth result', error);
			throw error;
		}
	}

	/**
	 * Fetch user data from Firestore database
	 */
	private async getUserDataFromDatabase(uid: string): Promise<any> {
		try {
			if (!this.firestore) {
				this.logger.warn('Firestore not initialized, using fallback user data');
				return this.createFallbackUserData(uid);
			}

			// Fetch user document from users collection
			const userDocRef = doc(this.firestore, 'users', uid);
			const userDocSnap = await getDoc(userDocRef);

			if (userDocSnap.exists()) {
				const userData = userDocSnap.data();
				this.logger.info(`Successfully fetched user data from database for UID: ${uid}`);

				// Update lastLoginAt timestamp
				await this.updateLastLoginTime(uid);

				return userData;
			} else {
				this.logger.warn(`User document not found in database for UID: ${uid}`);
				return this.createFallbackUserData(uid);
			}

		} catch (error) {
			this.logger.error('Failed to fetch user data from database:', error);
			return this.createFallbackUserData(uid);
		}
	}

	/**
	 * Update user's last login time
	 */
	private async updateLastLoginTime(uid: string): Promise<void> {
		try {
			if (!this.firestore) {
				return;
			}

			const userDocRef = doc(this.firestore, 'users', uid);
			const now = new Date().toISOString();

			// Note: Using setDoc with merge to update only specific fields
			// In a real implementation, you might want to use updateDoc instead
			await setDoc(userDocRef, {
				lastLoginAt: now,
				'metadata.lastSignInTime': now
			}, { merge: true });

			this.logger.info(`Updated last login time for user: ${uid}`);
		} catch (error) {
			this.logger.error('Failed to update last login time:', error);
			// Don't throw error here as it's not critical for authentication
		}
	}

	/**
	 * Create fallback user data when database fetch fails
	 */
	private createFallbackUserData(uid: string): any {
		this.logger.info(`Creating fallback user data for UID: ${uid}`);

		return {
			uid: uid,
			email: `user-${uid}@firebase.com`,
			displayName: `User ${uid}`,
			photoURL: undefined,
			provider: 'firebase',
			emailVerified: false,
			phoneNumber: undefined,
			createdAt: new Date().toISOString(),
			lastLoginAt: new Date().toISOString(),
			metadata: {
				creationTime: new Date().toISOString(),
				lastSignInTime: new Date().toISOString()
			},
			providerData: {
				providerId: 'firebase',
				tokenResponse: {
					kind: 'identitytoolkit#VerifyPasswordResponse',
					localId: uid,
					emailVerified: false,
					displayName: `User ${uid}`,
					providerId: 'firebase'
				}
			}
		};
	}

	/**
	 * Sign out current user
	 */
	public async signOut(): Promise<void> {
		try {
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
	public async getCurrentSession(): Promise<AuthSession | null> {
		return await this.storage.getAuthSession() || null;
	}

	/**
	 * Check if user is currently authenticated
	 */
	public async isAuthenticated(): Promise<boolean> {
		return await this.storage.isAuthenticated();
	}

	/**
	 * Refresh current authentication session
	 */
	public async refreshSession(): Promise<AuthSession | null> {
		const currentSession = await this.getCurrentSession();
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
}

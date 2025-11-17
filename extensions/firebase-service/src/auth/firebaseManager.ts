import * as vscode from 'vscode';
import { initializeApp, FirebaseApp } from '@firebase/app';
import { getFirestore, Firestore, doc, getDoc, setDoc } from '@firebase/firestore';
import { ExternalAuthResult, AuthSession, FirebaseUser } from './auth.types';
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

			this.firebaseApp = initializeApp(firebaseConfig, 'firebase-service-app');
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
		const config = vscode.workspace.getConfiguration('firebase-service');
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
	 * Process authentication result from external auth page
	 */
	public async processAuthResult(authResult: ExternalAuthResult): Promise<AuthSession> {
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
						photoURL: null,
						emailVerified: true,
						providerId: 'test'
					},
					token: 'mock-token-' + Date.now(),
					refreshToken: 'mock-refresh-token',
					expiresAt: Date.now() + (24 * 60 * 60 * 1000) // 24 hours
				};

				await this.storage.storeAuthSession(session);
				return session;
			}

			// For real authentication, try to fetch user data from Firestore
			let user: FirebaseUser;

			if (this.firestore) {
				user = await this.fetchUserFromFirestore(authResult.uid!);
			} else {
				// Fallback: create basic user object with just UID
				user = {
					uid: authResult.uid!,
					email: null,
					displayName: null,
					photoURL: null,
					emailVerified: false,
					providerId: 'external'
				};
			}

			// Create session object
			const session: AuthSession = {
				user,
				token: authResult.idToken || `external-token-${authResult.uid}`,
				refreshToken: `refresh-token-${authResult.uid}`,
				expiresAt: Date.now() + (24 * 60 * 60 * 1000) // 24 hours
			};

			// Store session
			await this.storage.storeAuthSession(session);

			this.logger.info(`Created auth session for user: ${user.uid}`);
			return session;

		} catch (error) {
			this.logger.error('Failed to process auth result', error);
			throw error;
		}
	}

	/**
	 * Fetch user data from Firestore
	 */
	private async fetchUserFromFirestore(uid: string): Promise<FirebaseUser> {
		if (!this.firestore) {
			throw new Error('Firestore not initialized');
		}

		try {
			const userDoc = doc(this.firestore, 'users', uid);
			const docSnap = await getDoc(userDoc);

			if (docSnap.exists()) {
				const userData = docSnap.data();
				return {
					uid,
					email: userData.email || null,
					displayName: userData.displayName || null,
					photoURL: userData.photoURL || null,
					emailVerified: userData.emailVerified || false,
					providerId: userData.providerId || 'external'
				};
			} else {
				// User document doesn't exist, create basic user object
				const user: FirebaseUser = {
					uid,
					email: null,
					displayName: null,
					photoURL: null,
					emailVerified: false,
					providerId: 'external'
				};

				// Optionally create user document in Firestore
				await setDoc(userDoc, {
					uid,
					createdAt: Date.now(),
					lastLoginAt: Date.now()
				});

				return user;
			}
		} catch (error) {
			this.logger.error(`Failed to fetch user data for ${uid}`, error);
			// Return basic user object as fallback
			return {
				uid,
				email: null,
				displayName: null,
				photoURL: null,
				emailVerified: false,
				providerId: 'external'
			};
		}
	}

	/**
	 * Check if user is currently authenticated
	 */
	public async isAuthenticated(): Promise<boolean> {
		return await this.storage.isAuthenticated();
	}

	/**
	 * Get current authentication session
	 */
	public async getCurrentSession(): Promise<AuthSession | null> {
		const session = await this.storage.getAuthSession();

		if (!session) {
			return null;
		}

		// Check if session is expired
		if (Date.now() >= session.expiresAt) {
			await this.storage.clearAuthSession();
			return null;
		}

		return session;
	}

	/**
	 * Sign out user
	 */
	public async signOut(): Promise<void> {
		await this.storage.clearAuthSession();
		this.logger.info('User signed out successfully');
	}

	/**
	 * Get Firestore instance for database operations (authenticated)
	 */
	public getFirestore(): Firestore | null {
		return this.firestore;
	}

	/**
	 * Get Firebase app instance
	 */
	public getApp(): FirebaseApp | null {
		return this.firebaseApp;
	}
}

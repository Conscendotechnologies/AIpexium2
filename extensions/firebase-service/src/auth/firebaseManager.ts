import * as vscode from 'vscode';
import { initializeApp, FirebaseApp } from '@firebase/app';
import { getFirestore, Firestore } from '@firebase/firestore';
import { getAuth, Auth } from '@firebase/auth';
import { ExternalAuthResult, AuthSession, FirebaseUser } from './auth.types';
import { Logger } from '../utils/logger';
import { Storage } from '../utils/storage';

export class FirebaseManager {
	private readonly logger: Logger;
	private readonly storage: Storage;
	private firebaseApp: FirebaseApp | null = null;
	private firestore: Firestore | null = null;
	private auth: Auth | null = null;
	private firestoreService: any = null; // Will be set after FirestoreService is initialized

	constructor(logger: Logger, storage: Storage) {
		this.logger = logger;
		this.storage = storage;
		this.initializeFirebase();
	}

	/**
	 * Set FirestoreService instance (called after it's initialized)
	 */
	public setFirestoreService(firestoreService: any): void {
		this.firestoreService = firestoreService;
		this.logger.info('FirestoreService set in FirebaseManager');
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
			this.auth = getAuth(this.firebaseApp);
			this.logger.info('Firebase initialized successfully for user data access and authentication');
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
					uid: authResult.uid || 'test-user-123',
					idToken: 'mock-token-' + Date.now(),
					expiresAt: Date.now() + (365 * 24 * 60 * 60 * 1000), // 1 year (not enforced)
					user: {
						uid: authResult.uid || 'test-user-123',
						email: 'test@example.com',
						displayName: 'Test User',
						photoURL: null,
						provider: 'test'
					}
				};

				await this.storage.storeAuthSession(session);
				return session;
			}

			// Validate required fields
			if (!authResult.uid || !authResult.idToken) {
				throw new Error('Missing required uid or idToken in auth result');
			}

			this.logger.info(`Processing auth result for uid: ${authResult.uid}`);

			// Fetch user data from Firestore using FirestoreService
			let userData: FirebaseUser | undefined;
			if (this.firestoreService) {
				try {
					this.logger.info('Fetching user data from Firestore...');
					const firestoreData = await this.firestoreService.getUserDataByUid(authResult.uid);
					if (firestoreData) {
						userData = {
							uid: firestoreData.uid,
							email: firestoreData.email || null,
							displayName: firestoreData.displayName || null,
							photoURL: firestoreData.photoURL || null,
							provider: firestoreData.provider,
							lastLoginAt: firestoreData.lastLoginAt,
							updatedAt: firestoreData.updatedAt
						};
						this.logger.info(`Retrieved user data from Firestore: ${userData.email || userData.uid}`);
					}
				} catch (error) {
					this.logger.warn('Failed to fetch user data from Firestore, will use minimal data', error);
				}
			} else {
				this.logger.warn('FirestoreService not available, using minimal user data');
			}

			// Create session object with the idToken and user data
			const session: AuthSession = {
				uid: authResult.uid,
				idToken: authResult.idToken,
				expiresAt: Date.now() + (365 * 24 * 60 * 60 * 1000), // 1 year (not enforced, for reference only)
				user: userData || {
					uid: authResult.uid,
					email: null,
					displayName: null,
					photoURL: null,
					provider: 'external'
				}
			};

			// Store session
			await this.storage.storeAuthSession(session);

			this.logger.info(`Created auth session for user: ${authResult.uid}`);
			return session;

		} catch (error) {
			this.logger.error('Failed to process auth result', error);
			throw error;
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
	 * Note: Session expiry is not enforced - users stay logged in until explicit sign-out
	 */
	public async getCurrentSession(): Promise<AuthSession | null> {
		const session = await this.storage.getAuthSession();

		if (!session) {
			return null;
		}

		// Return session without checking expiry (sessions don't auto-expire)
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
	 * Get Firebase Auth instance
	 */
	public getAuth(): Auth | null {
		return this.auth;
	}

	/**
	 * Get Firebase app instance
	 */
	public getApp(): FirebaseApp | null {
		return this.firebaseApp;
	}
}

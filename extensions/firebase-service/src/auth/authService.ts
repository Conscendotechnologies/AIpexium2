// LEGACY AUTH SERVICE - Kept for backward compatibility
// New external OAuth flow is handled by AuthManager, not this service
// This service now primarily handles Firebase Auth state monitoring for internal services

import {
	getAuth,
	signInWithEmailAndPassword,
	signOut as firebaseSignOut,
	onAuthStateChanged,
	signInWithCustomToken,
	User,
	Auth
} from '@firebase/auth';
import * as vscode from 'vscode';
import { Logger } from '../utils/logger';
import { AuthUser, AuthState, SignInOptions, AuthResult } from './auth.types';

export class AuthService {
	private auth: Auth | null = null;
	private logger: Logger;
	private currentUser: AuthUser | null = null;
	private authStateListeners: ((state: AuthState) => void)[] = [];

	constructor(logger: Logger) {
		this.logger = logger;
	}

	async initialize(): Promise<void> {
		try {
			this.logger.info('Initializing Firebase Auth...');

			// Get auth instance (will be initialized when Firebase app is ready)
			// We'll set this up when the Firebase app is initialized
			this.logger.info('Firebase Auth initialized successfully');
		} catch (error) {
			this.logger.error('Failed to initialize Firebase Auth', error);
			throw error;
		}
	}

	setAuth(auth: Auth): void {
		this.auth = auth;

		// Set up auth state listener
		onAuthStateChanged(this.auth, (user) => {
			this.handleAuthStateChange(user);
		});
	}

	private handleAuthStateChange(user: User | null): void {
		const previousUser = this.currentUser;
		this.currentUser = user ? this.mapFirebaseUserToAuthUser(user) : null;

		const authState: AuthState = {
			isAuthenticated: !!user,
			user: this.currentUser,
			isLoading: false,
			error: null
		};

		// Notify listeners
		this.authStateListeners.forEach(listener => {
			try {
				listener(authState);
			} catch (error) {
				this.logger.error('Error in auth state listener', error);
			}
		});

		// Log auth state changes
		if (previousUser !== this.currentUser) {
			if (user) {
				this.logger.info(`User signed in: ${user.email || user.uid}`);
			} else {
				this.logger.info('User signed out');
			}
		}
	}

	private mapFirebaseUserToAuthUser(user: User): AuthUser {
		return {
			uid: user.uid,
			email: user.email,
			displayName: user.displayName,
			photoURL: user.photoURL,
			emailVerified: user.emailVerified,
			isAnonymous: user.isAnonymous,
			metadata: {
				creationTime: user.metadata.creationTime || undefined,
				lastSignInTime: user.metadata.lastSignInTime || undefined
			}
		};
	}

	/**
	 * @deprecated Use AuthManager for external OAuth flow instead
	 * This method now only supports email/password and custom token sign-in
	 */
	async signIn(options: SignInOptions = {}): Promise<AuthResult> {
		try {
			this.logger.warn('AuthService.signIn is deprecated. Use AuthManager for OAuth providers.');

			if (!this.auth) {
				throw new Error('Auth not initialized. Call setAuth() first.');
			}

			let userCredential;

			if (options.provider === 'email' && options.email && options.password) {
				// Email/password sign-in still supported
				userCredential = await signInWithEmailAndPassword(this.auth, options.email, options.password);
			} else if (options.provider === 'google' || options.provider === 'github') {
				// OAuth providers no longer supported in extension host environment
				throw new Error(
					`OAuth provider '${options.provider}' is not supported in VS Code extension environment. ` +
					'Please use the external authentication flow via firebase-service.signIn command.'
				);
			} else {
				throw new Error(
					'Unsupported authentication method. Use AuthManager for external OAuth or provide email/password.'
				);
			}

			const authUser = this.mapFirebaseUserToAuthUser(userCredential.user);

			this.logger.info(`Sign in successful for user: ${authUser.email || authUser.uid}`);

			return {
				success: true,
				user: authUser
			};
		} catch (error: any) {
			this.logger.error('Sign in failed', error);

			let errorMessage = 'Sign in failed';
			if (error.code === 'auth/operation-not-supported-in-this-environment') {
				errorMessage = 'This authentication method is not supported in VS Code extensions. Please use the external authentication flow.';
			} else if (error.message) {
				errorMessage = error.message;
			}

			return {
				success: false,
				error: errorMessage
			};
		}
	}

	/**
	 * Sign in with custom token (for integration with external auth)
	 */
	async signInWithToken(customToken: string): Promise<AuthResult> {
		try {
			this.logger.info('Signing in with custom token');

			if (!this.auth) {
				throw new Error('Auth not initialized. Call setAuth() first.');
			}

			const userCredential = await signInWithCustomToken(this.auth, customToken);
			const authUser = this.mapFirebaseUserToAuthUser(userCredential.user);

			this.logger.info(`Custom token sign in successful for user: ${authUser.email || authUser.uid}`);

			return {
				success: true,
				user: authUser
			};
		} catch (error: any) {
			this.logger.error('Custom token sign in failed', error);

			return {
				success: false,
				error: error.message || 'Custom token sign in failed'
			};
		}
	}

	async signOut(): Promise<AuthResult> {
		try {
			this.logger.info('Starting sign out process');

			if (!this.auth) {
				throw new Error('Auth not initialized');
			}

			await firebaseSignOut(this.auth);

			this.logger.info('Sign out successful');

			return {
				success: true
			};
		} catch (error: any) {
			this.logger.error('Sign out failed', error);

			return {
				success: false,
				error: error.message || 'Sign out failed'
			};
		}
	}

	getCurrentUser(): AuthUser | null {
		return this.currentUser;
	}

	isAuthenticated(): boolean {
		return !!this.currentUser;
	}

	onAuthStateChange(listener: (state: AuthState) => void): () => void {
		this.authStateListeners.push(listener);

		// Return unsubscribe function
		return () => {
			const index = this.authStateListeners.indexOf(listener);
			if (index > -1) {
				this.authStateListeners.splice(index, 1);
			}
		};
	}

	dispose(): void {
		this.authStateListeners = [];
		this.currentUser = null;
		this.logger.info('Auth service disposed');
	}
}

import { AuthManager } from './auth/authManager';

export class FirebaseServiceAPI {
	constructor(private authManager: AuthManager) { }

	/**
	 * Event that fires when authentication state changes
	 */
	get onAuthStateChanged() {
		return this.authManager.onDidChangeAuthState;
	}

	/**
	 * Initiate sign in process
	 */
	async signIn(provider?: string): Promise<void> {
		return this.authManager.signIn(provider);
	}

	/**
	 * Sign out current user
	 */
	async signOut(): Promise<void> {
		return this.authManager.signOut();
	}

	/**
	 * Get current user information
	 */
	async getCurrentUser() {
		return this.authManager.getCurrentUser();
	}

	/**
	 * Check if user is authenticated
	 */
	async isAuthenticated(): Promise<boolean> {
		return this.authManager.isAuthenticated();
	}

	/**
	 * Show current authentication status
	 */
	async showAuthStatus(): Promise<void> {
		return this.authManager.showAuthStatus();
	}

	/**
	 * Refresh authentication session
	 */
	async refreshSession(): Promise<void> {
		return this.authManager.refreshSession();
	}

	/**
	 * Test authentication flow (for debugging)
	 */
	async testAuthFlow(): Promise<void> {
		return this.authManager.testAuthFlow();
	}

	/**
	 * Get Firebase manager for database operations
	 */
	getFirebaseManager() {
		return this.authManager.getFirebaseManager();
	}

	/**
	 * Get current auth page URL (for configuration)
	 */
	getAuthPageUrl(): string {
		return this.authManager.getAuthPageUrl();
	}
}

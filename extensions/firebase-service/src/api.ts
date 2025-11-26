import { AuthManager } from './auth/authManager';
import { FirestoreService } from './firestore/firestoreService';

export class FirebaseServiceAPI {
	constructor(
		private authManager: AuthManager,
		private firestoreService: FirestoreService
	) { }

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

	/**
	 * Get user properties from Firestore (users/{uid})
	 * @param propertyNames Optional array of property names to retrieve. If not provided, returns all data.
	 * @returns User data object with requested properties or null if not found
	 * @example
	 * // Get specific properties
	 * const userData = await api.getUserProperties(['displayName', 'email']);
	 * console.log(userData.displayName, userData.email);
	 *
	 * // Get all properties
	 * const allData = await api.getUserProperties();
	 */
	async getUserProperties(propertyNames?: string[]): Promise<any | null> {
		return this.firestoreService.getUserProperties(propertyNames);
	}
	/**
	 * Get admin API key from Firestore
	 * @returns Admin API key or null if not found
	 * @example
	 * const apiKey = await api.getAdminApiKey();
	 */
	async getAdminApiKey(): Promise<any | null> {
		return this.firestoreService.getAdminApiKey();
	}

	/**
	 * Update user properties in Firestore (users/{uid})
	 * Can update one or multiple key-value pairs
	 * @param updates Object containing field names and values to update
	 * @example
	 * // Update single field
	 * await api.updateUserProperties({ displayName: 'John Doe' });
	 *
	 * // Update multiple fields
	 * await api.updateUserProperties({
	 *   displayName: 'John Doe',
	 *   email: 'john@example.com',
	 *   preferences: { theme: 'dark' }
	 * });
	 */
	async updateUserProperties(updates: Record<string, any>): Promise<void> {
		return this.firestoreService.updateUserProperties(updates);
	}
}

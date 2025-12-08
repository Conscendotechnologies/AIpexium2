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
	 * Store data in any Firestore document (generic setter)
	 * @param collectionName The collection name
	 * @param documentId The document ID
	 * @param data The data to store
	 * @example
	 * await api.storeData('user_api_keys', userId, { apiKey: 'abc123', createdAt: new Date() });
	 */
	async storeData(collectionName: string, documentId: string, data: Record<string, any>): Promise<void> {
		return this.firestoreService.storeData(collectionName, documentId, data);
	}

	/**
	 * Get raw data from any Firestore document (generic getter)
	 * @param collectionName The collection name
	 * @param documentId The document ID
	 * @returns The raw document data or null if not found
	 * @example
	 * const data = await api.getData('static-data', 'siid-code');
	 * console.log(data.adminApiKey);
	 */
	async getData(collectionName: string, documentId: string): Promise<any | null> {
		return this.firestoreService.getData(collectionName, documentId);
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

	/**
	 * Get bug report configuration from Firestore (app-config/bug-report)
	 * @returns Bug report configuration object with email, subject, and body or null if not found
	 * @example
	 * const config = await api.getBugReportConfig();
	 * if (config) {
	 *   console.log(config.email, config.subject, config.body);
	 * }
	 */
	async getBugReportConfig(): Promise<{ email: string; subject: string; body: string } | null> {
		try {
			const result = await this.firestoreService.getData('app-config', 'bug-report');
			if (result && result.data) {
				return {
					email: result.data.email || '',
					subject: result.data.subject || 'Bug Report',
					body: result.data.body || 'Please describe the issue here...'
				};
			}
			return null;
		} catch (error) {
			// Return null if data not found or any error occurs
			return null;
		}
	}
}

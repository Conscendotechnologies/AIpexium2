import * as vscode from 'vscode';
import { ExternalAuthState, AuthSession } from '../auth/auth.types';

export class Storage {
	private readonly context: vscode.ExtensionContext;

	constructor(context: vscode.ExtensionContext) {
		this.context = context;
	}

	/**
	 * Store pending auth state for validation during callback
	 */
	public async storePendingAuthState(authState: ExternalAuthState): Promise<void> {
		await this.context.globalState.update('firebase.pendingAuthState', authState);
	}

	/**
	 * Get and clear pending auth state
	 */
	public async getPendingAuthState(): Promise<ExternalAuthState | undefined> {
		const authState = this.context.globalState.get<ExternalAuthState>('firebase.pendingAuthState');
		if (authState) {
			// Clear it after retrieval for security
			await this.context.globalState.update('firebase.pendingAuthState', undefined);
		}
		return authState;
	}

	/**
	 * Store authentication session
	 */
	public async storeAuthSession(session: AuthSession): Promise<void> {
		await this.context.globalState.update('firebase.authSession', session);
	}

	/**
	 * Get stored authentication session
	 */
	public async getAuthSession(): Promise<AuthSession | undefined> {
		return this.context.globalState.get<AuthSession>('firebase.authSession');
	}

	/**
	 * Clear authentication session (for sign out)
	 */
	public async clearAuthSession(): Promise<void> {
		await this.context.globalState.update('firebase.authSession', undefined);
	}

	/**
	 * Check if user is authenticated (has valid session)
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
	 * Store user preferences
	 */
	public async storeUserPreference(key: string, value: any): Promise<void> {
		await this.context.globalState.update(`firebase.user.${key}`, value);
	}

	/**
	 * Get user preference
	 */
	public async getUserPreference<T>(key: string): Promise<T | undefined> {
		return this.context.globalState.get<T>(`firebase.user.${key}`);
	}

	/**
	 * Clear all stored data (for debugging/reset)
	 */
	public async clearAll(): Promise<void> {
		await this.clearAuthSession();
		await this.context.globalState.update('firebase.pendingAuthState', undefined);
		// Clear any other firebase-related data as needed
	}
}

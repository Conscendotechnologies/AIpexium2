import * as vscode from 'vscode';
import { AuthSession, AuthState } from '../types/auth.types';

export class Storage {
	private readonly context: vscode.ExtensionContext;
	private static readonly AUTH_SESSION_KEY = 'firebase-auth-session';
	private static readonly AUTH_STATE_KEY = 'firebase-auth-state';

	constructor(context: vscode.ExtensionContext) {
		this.context = context;
	}

	/**
	 * Store authentication session
	 */
	public async storeAuthSession(session: AuthSession): Promise<void> {
		await this.context.globalState.update(Storage.AUTH_SESSION_KEY, session);
	}

	/**
	 * Retrieve authentication session
	 */
	public getAuthSession(): AuthSession | undefined {
		return this.context.globalState.get<AuthSession>(Storage.AUTH_SESSION_KEY);
	}

	/**
	 * Clear authentication session
	 */
	public async clearAuthSession(): Promise<void> {
		await this.context.globalState.update(Storage.AUTH_SESSION_KEY, undefined);
	}

	/**
	 * Store pending auth state for validation
	 */
	public async storePendingAuthState(state: AuthState): Promise<void> {
		await this.context.globalState.update(Storage.AUTH_STATE_KEY, state);
	}

	/**
	 * Retrieve pending auth state
	 */
	public getPendingAuthState(): AuthState | undefined {
		return this.context.globalState.get<AuthState>(Storage.AUTH_STATE_KEY);
	}

	/**
	 * Clear pending auth state
	 */
	public async clearPendingAuthState(): Promise<void> {
		await this.context.globalState.update(Storage.AUTH_STATE_KEY, undefined);
	}

	/**
	 * Check if user is currently authenticated
	 */
	public isAuthenticated(): boolean {
		const session = this.getAuthSession();
		if (!session) {
			return false;
		}

		// Check if session is expired
		return Date.now() < session.expiresAt;
	}

	/**
	 * Get current user if authenticated
	 */
	public getCurrentUser() {
		if (!this.isAuthenticated()) {
			return null;
		}

		const session = this.getAuthSession();
		return session?.user || null;
	}
}

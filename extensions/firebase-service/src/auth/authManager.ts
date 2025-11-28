import * as vscode from 'vscode';
import { Logger } from '../utils/logger';
import { Storage } from '../utils/storage';
import { UriHandler } from './uriHandler';
import { WebAuthFlow } from './webAuthFlow';
import { FirebaseManager } from './firebaseManager';
import { ExternalAuthResult, AuthSession } from './auth.types';

export class AuthManager {
	private readonly logger: Logger;
	private readonly storage: Storage;
	private readonly uriHandler: UriHandler;
	private readonly webAuthFlow: WebAuthFlow;
	private readonly firebaseManager: FirebaseManager;

	// Event emitter for authentication state changes
	private readonly authStateChangeEmitter = new vscode.EventEmitter<boolean>();
	public readonly onDidChangeAuthState = this.authStateChangeEmitter.event;

	constructor(context: vscode.ExtensionContext, logger: Logger) {
		this.logger = logger;
		this.storage = new Storage(context);
		this.uriHandler = new UriHandler(logger, this.storage);
		this.webAuthFlow = new WebAuthFlow(logger, this.storage, this.uriHandler);
		this.firebaseManager = new FirebaseManager(logger, this.storage);
	}

	/**
	 * Initiate sign in process
	 */
	public async signIn(provider?: string): Promise<void> {
		this.logger.info(`Starting sign in process for provider: ${provider || 'default'}`);

		try {
			// Check if already authenticated
			if (await this.firebaseManager.isAuthenticated()) {
				const session = await this.firebaseManager.getCurrentSession();
				vscode.window.showInformationMessage(`Already signed in as ${session?.user?.email || session?.user?.displayName || session?.uid || 'unknown user'}`);
				return;
			}

			// Show provider selection if none specified
			if (!provider) {
				provider = await this.showProviderSelection();
				if (!provider) {
					return; // User cancelled
				}
			}

			// Initiate web auth flow
			await this.webAuthFlow.initiateAuthFlow(provider);

			// Show status message
			vscode.window.showInformationMessage(
				'Authentication started. Please complete the process in your browser and you will be redirected back to VS Code.'
			);

		} catch (error) {
			this.logger.error('Sign in failed', error);
			vscode.window.showErrorMessage(`Sign in failed: ${error}`);
			throw error;
		}
	}

	/**
	 * Handle authentication callback from external page
	 */
	public async handleAuthCallback(uri: vscode.Uri): Promise<void> {
		this.logger.info('Processing authentication callback');

		try {
			// Process callback URI to get uid and state
			const authResult: ExternalAuthResult = await this.uriHandler.handleAuthCallback(uri);
			this.logger.info(`Received auth result: ${JSON.stringify(authResult)}`);

			// Process with Firebase using the uid
			const session = await this.firebaseManager.processAuthResult(authResult);
			this.logger.info(`Processed auth result and obtained session: ${JSON.stringify(session)}`);

			// Show success message
			vscode.window.showInformationMessage(
				`Successfully signed in as ${session.user?.email || session.user?.displayName || session.uid}!`
			);

			// Fire auth state change event
			this.logger.info('Firing auth state change event (true)');
			this.authStateChangeEmitter.fire(true);

			this.logger.info(`Authentication completed successfully for user: ${session.uid}`);

		} catch (error) {
			this.logger.error('Authentication callback failed', error);
			vscode.window.showErrorMessage(`Authentication failed: ${error}`);

			// Fire auth state change event (failed)
			this.logger.info('Firing auth state change event (false) due to error');
			this.authStateChangeEmitter.fire(false);
		}
	}

	/**
	 * Sign out current user
	 */
	public async signOut(): Promise<void> {
		try {
			await this.firebaseManager.signOut();

			vscode.window.showInformationMessage('Successfully signed out');

			// Fire auth state change event
			this.logger.info('Firing auth state change event (false)');
			this.authStateChangeEmitter.fire(false);

			this.logger.info('User signed out successfully');

		} catch (error) {
			this.logger.error('Sign out failed', error);
			vscode.window.showErrorMessage(`Sign out failed: ${error}`);
		}
	}

	/**
	 * Get current user information
	 */
	public async getCurrentUser(): Promise<AuthSession | null> {
		return await this.firebaseManager.getCurrentSession();
	}

	/**
	 * Check if user is authenticated
	 */
	public async isAuthenticated(): Promise<boolean> {
		return await this.firebaseManager.isAuthenticated();
	}

	/**
	 * Show provider selection dialog
	 */
	private async showProviderSelection(): Promise<string | undefined> {
		const providers = [
			{ label: 'Google', value: 'google' },
			{ label: 'GitHub', value: 'github' },
			{ label: 'Email/Password', value: 'email' }
		];

		const selected = await vscode.window.showQuickPick(providers, {
			placeHolder: 'Select authentication provider',
			canPickMany: false
		});

		return selected?.value;
	}

	/**
	 * Show current authentication status
	 */
	public async showAuthStatus(): Promise<void> {
		try {
			const isAuth = await this.isAuthenticated();

			if (isAuth) {
				const session = await this.getCurrentUser();

				vscode.window.showInformationMessage(
					`Authenticated as: ${session?.user?.email || session?.user?.displayName || session?.uid || 'Unknown'}`
				);
			} else {
				vscode.window.showInformationMessage('Not authenticated');
			}

		} catch (error) {
			this.logger.error('Failed to get auth status', error);
			vscode.window.showErrorMessage(`Failed to get authentication status: ${error}`);
		}
	}

	/**
	 * Refresh authentication session
	 */
	public async refreshSession(): Promise<void> {
		try {
			const session = await this.getCurrentUser();

			if (!session) {
				vscode.window.showWarningMessage('No active session to refresh');
				return;
			}

			// For now, just extend the current session
			// In a real implementation, you might validate with the server
			session.expiresAt = Date.now() + (60 * 60 * 1000); // 1 hour
			await this.storage.storeAuthSession(session);

			vscode.window.showInformationMessage('Session refreshed successfully');
			this.logger.info('Session refreshed for user: ' + session.uid);

		} catch (error) {
			this.logger.error('Failed to refresh session', error);
			vscode.window.showErrorMessage(`Failed to refresh session: ${error}`);
		}
	}

	/**
	 * Get Firebase manager for database operations
	 */
	public getFirebaseManager(): FirebaseManager {
		return this.firebaseManager;
	}

	/**
	 * Get current auth page URL (for configuration)
	 */
	public getAuthPageUrl(): string {
		return this.webAuthFlow.getAuthPageUrl();
	}
}

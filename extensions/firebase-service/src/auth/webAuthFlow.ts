import * as vscode from 'vscode';
import { ExternalAuthState } from './auth.types';
import { Logger } from '../utils/logger';
import { Security } from '../utils/security';
import { Storage } from '../utils/storage';
import { UriHandler } from './uriHandler';

export class WebAuthFlow {
	private readonly logger: Logger;
	private readonly storage: Storage;
	private readonly uriHandler: UriHandler;

	// This will be the user's external Firebase auth page URL
	// Can be configured via VS Code settings
	private get authPageUrl(): string {
		const config = vscode.workspace.getConfiguration('firebase-service');
		return config.get('authPageUrl', 'https://salesforce-ide-c1761.web.app/auth');
	}

	constructor(logger: Logger, storage: Storage, uriHandler: UriHandler) {
		this.logger = logger;
		this.storage = storage;
		this.uriHandler = uriHandler;
	}

	/**
	 * Initiate web-based authentication flow
	 */
	public async initiateAuthFlow(provider?: string): Promise<void> {
		this.logger.info(`Initiating web auth flow for provider: ${provider || 'default'}`);

		try {
			// Generate secure auth state for CSRF protection
			const authState = Security.createAuthState(provider);

			// Store pending auth state for later validation
			await this.storage.storePendingAuthState(authState);

			// Build auth URL with provider and state
			const authUrl = this.buildAuthUrl(provider, authState);

			this.logger.info(`Opening external auth page: ${authUrl}`);

			// Show user notification with option to open auth page
			const selection = await vscode.window.showInformationMessage(
				'Opening external authentication page. Please complete authentication and you will be redirected back to VS Code.',
				'Open Auth Page',
				'Cancel'
			);

			if (selection === 'Open Auth Page') {
				// Open external auth page in user's default browser
				await vscode.env.openExternal(vscode.Uri.parse(authUrl));
			} else if (selection === 'Cancel') {
				// Clear pending auth state if user cancels
				await this.storage.getPendingAuthState(); // This clears it
				this.logger.info('Authentication flow cancelled by user');
				return;
			}

			// Also open automatically for convenience
			await vscode.env.openExternal(vscode.Uri.parse(authUrl));

		} catch (error) {
			this.logger.error('Failed to initiate auth flow', error);
			throw error;
		}
	}

	/**
	 * Build the external authentication URL with provider and state parameters
	 */
	private buildAuthUrl(provider?: string, authState?: ExternalAuthState): string {
		const params = new URLSearchParams();

		// Add provider if specified
		if (provider) {
			params.set('provider', provider);
		}

		// Add auth state for CSRF protection
		if (authState) {
			// Use simple JSON encoding for easier handling on external page
			params.set('state', JSON.stringify(authState));
		}

		// Add callback URI for the external page to redirect back to VS Code
		const callbackUri = this.getCallbackUri();
		params.set('callback', encodeURIComponent(callbackUri));

		return `${this.authPageUrl}?${params.toString()}`;
	}

	/**
	 * Get the callback URI that the external auth page should redirect to
	 */
	private getCallbackUri(): string {
		// Use siid:// protocol URI to match external auth page
		return 'siid://ConscendoTechInc.firebase-service/auth-callback';
	}

	/**
	 * Get the current auth page URL (for configuration/debugging)
	 */
	public getAuthPageUrl(): string {
		return this.authPageUrl;
	}
}

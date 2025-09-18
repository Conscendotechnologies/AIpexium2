import * as vscode from 'vscode';
import { AuthState } from '../types/auth.types';
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
		const config = vscode.workspace.getConfiguration('firebase-authentication-v1');
		return config.get('authPageUrl', 'https://your-firebase-auth-page.com/auth');
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
			// Generate secure auth state
			const authState = Security.createAuthState(provider);

			// Store pending auth state for later validation
			await this.storage.storePendingAuthState(authState);

			// Generate callback URI
			const encodedState = Security.encodeAuthState(authState);
			const callbackUri = this.uriHandler.generateCallbackUri(encodedState);

			// Build external auth page URL with parameters
			const authUrl = this.buildAuthUrl(callbackUri, encodedState, provider);

			this.logger.info(`Opening external auth page: ${authUrl}`);

			// Show user notification
			vscode.window.showInformationMessage(
				'Opening external authentication page. Please complete authentication and you will be redirected back to VS Code.',
				'Open Auth Page'
			).then((selection: string | undefined) => {
				if (selection === 'Open Auth Page') {
					// Open external auth page in user's default browser
					vscode.env.openExternal(vscode.Uri.parse(authUrl));
				}
			});

			// Also open automatically
			await vscode.env.openExternal(vscode.Uri.parse(authUrl));

		} catch (error) {
			this.logger.error('Failed to initiate auth flow', error);
			throw error;
		}
	}

	/**
	 * Build the external authentication URL with required parameters
	 */
	private buildAuthUrl(callbackUri: string, state: string, provider?: string): string {
		const params = new URLSearchParams({
			callback: 'vscode',
			redirect_uri: callbackUri,
			state: state,
			session: Security.generateSessionId()
		});

		if (provider) {
			params.set('provider', provider);
		}

		return `${this.authPageUrl}?${params.toString()}`;
	}

	/**
	 * Get the current auth page URL
	 */
	public getAuthPageUrl(): string {
		return this.authPageUrl;
	}
}

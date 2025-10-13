import * as vscode from 'vscode';
import { AuthState } from '../types/auth.types';
import { Logger } from '../utils/logger';
import { Security } from '../utils/security';
import { Storage } from '../utils/storage';
import { UriHandler } from './uriHandler';
import { json } from 'stream/consumers';

export class WebAuthFlow {
	private readonly logger: Logger;
	private readonly storage: Storage;
	private readonly uriHandler: UriHandler;

	// This will be the user's external Firebase auth page URL
	// Can be configured via VS Code settings
	private get authPageUrl(): string {
		const config = vscode.workspace.getConfiguration('firebase-authentication-v1');
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

			// Build simple auth URL with only provider
			const authUrl = this.buildAuthUrl(provider, authState);

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
	 * Build the external authentication URL with only provider parameter
	 */
	private buildAuthUrl(provider?: string, authState?: AuthState): string {
		const params = new URLSearchParams();

		if (provider) {
			params.set('provider', provider);
		}

		if (authState) {
			// params.set('auth_state', Security.encodeAuthState(authState));
			params.set('state', JSON.stringify(authState));
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

import * as vscode from 'vscode';
import { AuthResult } from '../types/auth.types';
import { Logger } from '../utils/logger';
import { Security } from '../utils/security';
import { Storage } from '../utils/storage';

export class UriHandler {
	private readonly logger: Logger;
	private readonly storage: Storage;

	constructor(logger: Logger, storage: Storage) {
		this.logger = logger;
		this.storage = storage;
	}

	/**
	 * Handle incoming URI from external authentication page
	 */
	public async handleAuthCallback(uri: vscode.Uri): Promise<AuthResult> {
		this.logger.info(`Processing auth callback URI: ${uri.toString()}`);

		try {
			// Parse query parameters from URI
			const queryParams = this.parseQueryParams(uri.query);

			// Validate state parameter for CSRF protection
			await this.validateState(queryParams.state);

			// Extract auth result from query parameters
			const authResult: AuthResult = {
				token: queryParams.token,
				idToken: queryParams.idToken,
				refreshToken: queryParams.refreshToken,
				error: queryParams.error,
				state: queryParams.state,
				provider: queryParams.provider,
				user: queryParams.user ? JSON.parse(queryParams.user) : undefined
			};

			// Clear pending auth state
			await this.storage.clearPendingAuthState();

			if (authResult.error) {
				throw new Error(`Authentication failed: ${authResult.error}`);
			}

			if (!authResult.token && !authResult.idToken) {
				throw new Error('No authentication token received');
			}

			this.logger.info('Authentication callback processed successfully');
			return authResult;

		} catch (error) {
			this.logger.error('Failed to process auth callback', error);
			throw error;
		}
	}

	/**
	 * Parse query parameters from URI
	 */
	private parseQueryParams(query: string): Record<string, string> {
		const params: Record<string, string> = {};

		if (!query) {
			return params;
		}

		const pairs = query.split('&');
		for (const pair of pairs) {
			const [key, value] = pair.split('=');
			if (key && value) {
				params[decodeURIComponent(key)] = decodeURIComponent(value);
			}
		}

		return params;
	}

	/**
	 * Validate state parameter to prevent CSRF attacks
	 */
	private async validateState(receivedState?: string): Promise<void> {
		if (!receivedState) {
			throw new Error('Missing state parameter in auth callback');
		}

		const pendingState = this.storage.getPendingAuthState();
		if (!pendingState) {
			throw new Error('No pending authentication state found');
		}

		if (!Security.validateAuthState(receivedState, pendingState)) {
			throw new Error('Invalid state parameter - possible CSRF attack');
		}
	}

	/**
	 * Generate the callback URI that external auth page should redirect to
	 */
	public generateCallbackUri(state: string): string {
		// The URI scheme should match what's registered in package.json (vscode://)
		return `vscode://ConscendoTechInc.firebase-authentication-v1/auth-callback?state=${encodeURIComponent(state)}`;
	}
}

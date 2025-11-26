import * as vscode from 'vscode';
import { ExternalAuthResult, ExternalAuthState } from './auth.types';
import { Logger } from '../utils/logger';
import { Storage } from '../utils/storage';
import { Security } from '../utils/security';

export class UriHandler {
	private readonly logger: Logger;
	private readonly storage: Storage;

	constructor(logger: Logger, storage: Storage) {
		this.logger = logger;
		this.storage = storage;
	}

	/**
	 * Handle authentication callback from external page
	 */
	public async handleAuthCallback(uri: vscode.Uri): Promise<ExternalAuthResult> {
		this.logger.info(`Processing auth callback URI: ${uri.toString()}`);

		try {
			// Parse query parameters from URI
			const query = this.parseQueryParams(uri.query);

			// Extract auth result data
			const authResult: ExternalAuthResult = {
				uid: query.uid,
				idToken: query.idToken,
				state: query.state,
				error: query.error
			};

			// Validate state parameter for CSRF protection
			if (authResult.state) {
				await this.validateAuthState(authResult.state);
			}

			// Check for authentication errors
			if (authResult.error) {
				throw new Error(`Authentication failed: ${authResult.error}`);
			}

			// Validate required fields
			if (!authResult.uid || !authResult.idToken) {
				throw new Error('Authentication callback missing required uid or idToken');
			}

			this.logger.info(`Auth callback processed successfully for uid: ${authResult.uid}`);
			return authResult;

		} catch (error) {
			this.logger.error('Failed to process auth callback', error);
			throw error;
		}
	}

	/**
	 * Parse query parameters from URI query string
	 */
	private parseQueryParams(queryString: string): Record<string, string> {
		const params: Record<string, string> = {};

		if (!queryString) {
			return params;
		}

		// Split by & and parse key=value pairs
		queryString.split('&').forEach(param => {
			const [key, value] = param.split('=');
			if (key && value) {
				params[decodeURIComponent(key)] = decodeURIComponent(value);
			}
		});

		return params;
	}

	/**
	 * Validate auth state for CSRF protection
	 */
	private async validateAuthState(stateParam: string): Promise<void> {
		try {
			// Get pending auth state
			const pendingState = await this.storage.getPendingAuthState();

			if (!pendingState) {
				throw new Error('No pending auth state found');
			}

			// Parse state from callback
			let callbackState: ExternalAuthState;
			try {
				// Try parsing as JSON first (simple format)
				callbackState = JSON.parse(stateParam);
			} catch {
				// If that fails, try decoding as base64
				callbackState = Security.decodeAuthState(stateParam);
			}

			// Validate the auth state
			if (!Security.validateAuthState(callbackState)) {
				throw new Error('Invalid or expired auth state');
			}
			this.logger.info(`Auth state validated: ${JSON.stringify(callbackState)}`);
			// Verify state matches what we sent
			if (callbackState.nonce !== pendingState.nonce) {
				throw new Error('Auth state nonce mismatch - possible CSRF attack');
			}

			this.logger.info('Auth state validation successful');

		} catch (error) {
			this.logger.error('Auth state validation failed', error);
			throw new Error(`Authentication state validation failed: ${error}`);
		}
	}
}

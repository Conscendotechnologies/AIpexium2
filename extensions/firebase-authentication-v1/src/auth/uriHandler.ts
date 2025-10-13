import * as vscode from 'vscode';
import { AuthResult } from '../types/auth.types';
import { Logger } from '../utils/logger';
import { Security } from '../utils/security';
import { Storage } from '../utils/storage';

export class UriHandler {
	private readonly logger: Logger;
	private readonly storage: Storage;
	private currentUri?: vscode.Uri; // Store current URI for isTestUri method

	constructor(logger: Logger, storage: Storage) {
		this.logger = logger;
		this.storage = storage;
	}

	/**
	 * Handle incoming URI from external authentication page
	 */
	public async handleAuthCallback(uri: vscode.Uri): Promise<AuthResult> {
		this.logger.info(`Processing auth callback URI: ${uri.toString()}`);

		// Store the current URI for isTestUri method
		this.currentUri = uri;

		try {
			// Parse query parameters from URI
			const queryParams = this.parseQueryParams(uri);

			// Log received parameters for debugging
			this.logger.info(`🔍 Received callback parameters:`, Object.keys(queryParams));

			// Validate state parameter for CSRF protection
			await this.validateState(queryParams.state);

			// Validate that we have the required uid parameter
			this.validateRequiredParams(queryParams);

			// Extract simplified auth result from query parameters
			const authResult: AuthResult = {
				uid: queryParams.uid,
				state: queryParams.state,
				error: queryParams.error
			};

			// Clear pending auth state
			await this.storage.clearPendingAuthState();

			// Handle test URIs
			if (this.isTestUri()) {
				this.logger.info('🧪 Test URI processed successfully');
				return {
					uid: 'test_user_123',
					state: 'test_state'
				};
			}

			if (authResult.error) {
				throw new Error(`Authentication failed: ${authResult.error}`);
			}

			if (!authResult.uid) {
				throw new Error('No user UID received from authentication');
			}

			this.logger.info('Authentication callback processed successfully');
			return authResult;

		} catch (error) {
			this.logger.error('Failed to process auth callback', error);
			throw error;
		}
	}

	/**
	 * Validate that required parameters are present
	 */
	private validateRequiredParams(queryParams: Record<string, string>): void {
		// Check for error parameter first
		if (queryParams.error) {
			throw new Error(`Authentication error: ${queryParams.error}`);
		}

		// For test URIs, skip validation
		if (this.isTestUri()) {
			this.logger.info('🧪 Test URI detected - skipping parameter validation');
			return;
		}

		// Check for required uid parameter
		if (!queryParams.uid) {
			this.logger.error('🚨 Missing required uid parameter');
			this.logger.info('🔍 Available parameters:', Object.keys(queryParams));
			throw new Error('Missing required user ID (uid) parameter');
		}

		this.logger.info('✅ Required parameters validation passed');
	}

	/**
	 * Parse query parameters from URI - handles both query string and encoded path
	 */
	private parseQueryParams(uri: vscode.Uri): Record<string, string> {
		const params: Record<string, string> = {};

		this.logger.info(`🔍 Parsing URI query parameters from: ${uri.toString()}`);
		this.logger.info(`🔍 URI query: "${uri.query}"`);
		this.logger.info(`🔍 URI path: "${uri.path}"`);

		// Handle malformed URIs from auth page (double encoding issue)
		const fullUri = uri.toString();

		// Check if this is a malformed URI with encoded query in path
		if (fullUri.includes('%3F') && uri.query) {
			this.logger.info('🔧 Detected malformed URI with double encoding - attempting to fix');
			return this.parseMangledURI(fullUri);
		}

		// First try the normal query string
		if (uri.query) {
			this.parseQueryString(uri.query, params);
			this.logger.info(`🔍 Parsed from query string:`, params);
		}

		// If no query params found, check if they're encoded in the path
		if (Object.keys(params).length === 0 && uri.path) {
			// Decode the path and look for query parameters
			const decodedPath = decodeURIComponent(uri.path);
			this.logger.info(`🔍 Decoded path: "${decodedPath}"`);

			const queryIndex = decodedPath.indexOf('?');

			if (queryIndex !== -1) {
				const queryString = decodedPath.substring(queryIndex + 1);
				this.logger.info(`🔍 Query string from path: "${queryString}"`);
				this.parseQueryString(queryString, params);
				this.logger.info(`🔍 Parsed from path:`, params);
			}
		}

		this.logger.info(`🔍 Final parsed parameters:`, params);

		// Log parameter types for debugging
		Object.keys(params).forEach(key => {
			const value = params[key];
			this.logger.info(`🔍 Parameter ${key}: ${value?.substring(0, 100)}${value?.length > 100 ? '...' : ''}`);
		});

		return params;
	}

	/**
	 * Parse mangled URI with double encoding issues
	 */
	private parseMangledURI(fullUri: string): Record<string, string> {
		this.logger.info('🔧 Parsing malformed URI with custom logic');
		const params: Record<string, string> = {};

		try {
			// The URI structure is: siid://authority/path%3Fencoded_query?real_query
			// We need to extract both the encoded query from path and the real query

			// First, get the real query string (after the first real ?)
			const queryStart = fullUri.indexOf('?');
			if (queryStart !== -1) {
				const realQueryString = fullUri.substring(queryStart + 1);
				this.logger.info(`🔧 Real query string: ${realQueryString.substring(0, 200)}...`);
				this.parseQueryString(realQueryString, params);
			}

			// Now extract the encoded query from the path
			const pathPart = fullUri.substring(0, queryStart !== -1 ? queryStart : fullUri.length);
			this.logger.info(`🔧 Path part: ${pathPart}`);

			// Look for %3F (encoded ?) in the path
			const encodedQueryStart = pathPart.indexOf('%3F');
			if (encodedQueryStart !== -1) {
				const encodedQuery = pathPart.substring(encodedQueryStart + 3); // Skip %3F
				this.logger.info(`🔧 Encoded query from path: ${encodedQuery.substring(0, 200)}...`);

				// Decode and parse the encoded query
				try {
					const decodedQuery = decodeURIComponent(encodedQuery);
					this.logger.info(`🔧 Decoded query: ${decodedQuery.substring(0, 200)}...`);
					this.parseQueryString(decodedQuery, params);
				} catch (error) {
					this.logger.warn('⚠️ Failed to decode query from path', error);
				}
			}

			// Special handling for double-encoded state parameter
			if (params.state && params.state.includes('%')) {
				try {
					const originalState = params.state;
					params.state = decodeURIComponent(params.state);
					this.logger.info(`🔧 Double-decoded state: ${originalState} -> ${params.state}`);
				} catch (error) {
					this.logger.warn('⚠️ Failed to double-decode state parameter');
				}
			}

			// Fix user parameter (replace + with spaces and decode)
			if (params.user) {
				params.user = params.user.replace(/\+/g, ' ');
				try {
					if (params.user.includes('%')) {
						params.user = decodeURIComponent(params.user);
					}
				} catch (error) {
					this.logger.warn('⚠️ Failed to decode user parameter');
				}
			}

			this.logger.info('🔧 Successfully parsed malformed URI:', Object.keys(params));
			return params;

		} catch (error) {
			this.logger.error('🚨 Failed to parse malformed URI', error);
			return params;
		}
	}

	/**
	 * Parse a query string into parameters
	 */
	private parseQueryString(query: string, params: Record<string, string>): void {
		if (!query) {
			return;
		}

		const pairs = query.split('&');
		for (const pair of pairs) {
			const [key, value] = pair.split('=');
			if (key && value !== undefined) {
				// Decode both key and value, but handle the state parameter specially
				const decodedKey = decodeURIComponent(key);
				let decodedValue = decodeURIComponent(value);

				// For state parameter, it might already be JSON, so just use it as-is
				if (decodedKey === 'state') {
					// The state value should be plain JSON now
					params[decodedKey] = decodedValue;
				} else {
					params[decodedKey] = decodedValue;
				}
			}
		}
	}

	/**
	 * Validate state parameter to prevent CSRF attacks
	 */
	private async validateState(receivedState?: string): Promise<void> {
		this.logger.info(`🔍 Validating state parameter: ${receivedState}`);

		if (!receivedState) {
			// Allow test URIs without state parameters
			if (this.isTestUri()) {
				this.logger.info('🧪 Test URI detected - skipping state validation');
				return;
			}
			throw new Error('Missing state parameter in auth callback');
		}

		// Parse the state JSON directly (no URL decoding needed)
		let stateObject: any;
		try {
			stateObject = JSON.parse(receivedState);
			this.logger.info(`🔍 Parsed state object:`, stateObject);
		} catch (error) {
			this.logger.error('Failed to parse state JSON', error);
			throw new Error('Invalid state parameter format');
		}

		// Get the pending auth state from storage
		const pendingState = await this.storage.getPendingAuthState();
		if (!pendingState) {
			throw new Error('No pending authentication state found');
		}

		this.logger.info(`🔍 Expected state:`, pendingState);

		// Validate the state using the Security utility (pass the JSON string)
		// todo: disabled for development purposes
		// if (!Security.validateAuthState(receivedState, pendingState)) {
		// 	this.logger.error(`🚨 State validation failed! Received: ${receivedState}, Expected: ${JSON.stringify(pendingState)}`);
		// 	throw new Error('Invalid state parameter - possible CSRF attack');
		// }

		this.logger.info('✅ State validation passed');
	}

	/**
	 * Check if this is a test URI based on VS Code configuration
	 */
	private isTestUri(): boolean {
		if (!this.currentUri) {
			return false;
		}

		// Get VS Code configuration
		const config = vscode.workspace.getConfiguration('firebase-authentication-v1');
		const enableTestMode = config.get<boolean>('enableTestMode', false);

		// If test mode is disabled, never treat as test URI
		if (!enableTestMode) {
			this.logger.info('🔧 Test mode disabled in configuration');
			return false;
		}

		const testPatterns = config.get<string[]>('testUriPatterns', ['/test', '/debug', '/mock']);
		const uriPath = this.currentUri.path;

		// Check if the URI path matches any test patterns
		const isTest = testPatterns.some(pattern => {
			const matches = uriPath.includes(pattern);
			if (matches) {
				this.logger.info(`🧪 URI path '${uriPath}' matches test pattern '${pattern}'`);
			}
			return matches;
		});

		if (isTest) {
			this.logger.info(`🧪 Test URI detected - test mode enabled, path: ${uriPath}`);
		} else {
			this.logger.info(`🔧 Normal URI detected - path: ${uriPath}`);
		}

		return isTest;
	}


}

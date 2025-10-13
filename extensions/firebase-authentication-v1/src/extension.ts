import * as path from 'path';
import { config } from 'dotenv';
import * as vscode from 'vscode';
import { AuthManager } from './auth/authManager';
import { Logger } from './utils/logger';
import { Security } from './utils/security';
import { Storage } from './utils/storage';

let authManager: AuthManager;
let logger: Logger;

// Event emitter for authentication state changes
const authStateChangeEmitter = new vscode.EventEmitter<boolean>();

// Export the event for other parts of the extension to use
export const onDidChangeAuthState = authStateChangeEmitter.event;

// Firebase Authentication URI Handler class
class FirebaseAuthUriHandler implements vscode.UriHandler {
	constructor(private authManager: AuthManager, private logger: Logger) { }

	async handleUri(uri: vscode.Uri): Promise<void> {
		this.logger.info(`🔥 Received URI: ${uri.toString()}`);
		this.logger.info(`🔥 URI scheme: ${uri.scheme}`);
		this.logger.info(`🔥 URI authority: ${uri.authority}`);
		this.logger.info(`🔥 URI path: ${uri.path}`);
		this.logger.info(`🔥 URI query: ${uri.query}`);

		try {
			// Handle authentication callback
			this.logger.info('🔥 About to call authManager.handleAuthCallback...');
			const result = await this.authManager.handleAuthCallback(uri);

			// Fire auth state change event after successful callback
			authStateChangeEmitter.fire(true);

			return result;
		} catch (error) {
			this.logger.error('🔥 Failed to handle auth callback', error);
			vscode.window.showErrorMessage(`Authentication callback failed: ${error}`);
		}
	}
}

export function activate(context: vscode.ExtensionContext) {
	// Load environment variables from .env file
	const envPath = path.join(context.extensionPath, '.env');
	config({ path: envPath });

	logger = new Logger();
	logger.info('Firebase Authentication extension is activating...');

	try {
		// Initialize auth manager
		authManager = new AuthManager(context, logger);

		// Register commands
		registerCommands(context);

		// Register URI handler for deep links
		registerUriHandler(context);

		logger.info('Firebase Authentication extension activated successfully');
	} catch (error) {
		logger.error('Failed to activate Firebase Authentication extension', error);
		vscode.window.showErrorMessage(`Firebase Authentication: Activation failed - ${error}`);
	}
}

export function deactivate() {
	logger?.info('Firebase Authentication extension is deactivating...');
	authManager?.dispose();
}

function registerCommands(context: vscode.ExtensionContext) {
	const commands = [
		vscode.commands.registerCommand('firebase-authentication-v1.signIn', async () => {
			try {
				await authManager.signIn();
				authStateChangeEmitter.fire(true); // Notify auth state change
			} catch (error) {
				logger.error('Sign in failed', error);
				vscode.window.showErrorMessage(`Sign in failed: ${error}`);
			}
		}),

		vscode.commands.registerCommand('firebase-authentication-v1.signOut', async () => {
			try {
				await authManager.signOut();
				authStateChangeEmitter.fire(false); // Notify auth state change
				vscode.window.showInformationMessage('Successfully signed out');
			} catch (error) {
				logger.error('Sign out failed', error);
				vscode.window.showErrorMessage(`Sign out failed: ${error}`);
			}
		}),

		vscode.commands.registerCommand('firebase-authentication-v1.showProfile', async () => {
			try {
				await authManager.showProfile();
			} catch (error) {
				logger.error('Show profile failed', error);
				vscode.window.showErrorMessage(`Show profile failed: ${error}`);
			}
		}),

		vscode.commands.registerCommand('firebase-authentication-v1.refreshSession', async () => {
			try {
				await authManager.refreshSession();
				vscode.window.showInformationMessage('Session refreshed successfully');
			} catch (error) {
				logger.error('Refresh session failed', error);
				vscode.window.showErrorMessage(`Refresh session failed: ${error}`);
			}
		}),

		vscode.commands.registerCommand('firebase-authentication-v1.showAuthStatus', async () => {
			try {
				await authManager.showAuthStatus();
			} catch (error) {
				logger.error('Show auth status failed', error);
				vscode.window.showErrorMessage(`Show auth status failed: ${error}`);
			}
		}),

		vscode.commands.registerCommand('firebase-authentication-v1.isAuthenticated', async () => {
			try {
				const isAuthenticated = await authManager.isAuthenticated();
				logger.info(`Checked authentication status: ${isAuthenticated}`);
				return isAuthenticated;
			} catch (error) {
				logger.error('Check authentication failed', error);
				return false;
			}
		}),

		vscode.commands.registerCommand('firebase-authentication-v1.getUserInfo', async () => {
			try {
				return await authManager.getUserInfo();
			} catch (error) {
				logger.error('Get user info failed', error);
				return null;
			}
		}),

		vscode.commands.registerCommand('firebase-authentication-v1.onDidChangeAuthState', (callback: (isAuthenticated: boolean) => void) => {
			return onDidChangeAuthState(callback);
		}),


		// Debug command to show external URI for testing
		vscode.commands.registerCommand('firebase-authentication-v1.showExternalUri', async () => {
			try {
				// Create a mock state for testing
				const mockState = JSON.stringify({
					auth_status: 'pending',
					timestamp: Date.now(),
				});

				const encodedState = encodeURIComponent(mockState);

				const uri = await vscode.env.asExternalUri(
					vscode.Uri.parse(`${vscode.env.uriScheme}://ConscendoTechInc.firebase-authentication-v1/auth-callback?test=external&state=${encodedState}`)
				);

				// Store the state for validation
				// Note: In a real scenario, this would be stored when initiating auth flow
				logger.info(`🧪 Generated mock state: ${mockState}`);
				logger.info(`🌐 External URI: ${uri.toString()}`);

				vscode.window.showInformationMessage(
					`Firebase Auth URI: ${uri.toString()}`,
					'Copy URI', 'Open in Browser'
				).then((selection) => {
					if (selection === 'Copy URI') {
						vscode.env.clipboard.writeText(uri.toString());
						vscode.window.showInformationMessage('URI copied to clipboard!');
					} else if (selection === 'Open in Browser') {
						vscode.env.openExternal(uri);
					}
				});
			} catch (error) {
				logger.error('🌐 Failed to generate external URI', error);
				vscode.window.showErrorMessage(`Failed to generate external URI: ${error}`);
			}
		}),

		vscode.commands.registerCommand('firebase-authentication-v1.testUriHandler', async () => {
			logger.info('🧪 Testing URI handler manually...');

			try {
				// Step 1: Generate and store a valid auth state (simulating auth initiation)
				const authState = Security.createAuthState('google');
				const storage = new Storage(context);
				await storage.storePendingAuthState(authState);

				logger.info('🧪 Generated valid auth state:', JSON.stringify(authState));

				// Step 2: Create state string like the real auth flow would
				const stateString = JSON.stringify(authState);
				const encodedState = encodeURIComponent(stateString);

				// Step 3: Create a test URI with the valid state and mock tokens
				const testUri = vscode.Uri.parse(`siid://ConscendoTechInc.firebase-authentication-v1/callback?code=test123&token=mock_access_token_12345&idToken=mock_id_token_67890&state=${encodedState}`);

				logger.info(`🧪 Test URI: ${testUri.toString()}`);
				logger.info(`🧪 Test URI scheme: ${testUri.scheme}`);
				logger.info(`🧪 Test URI authority: ${testUri.authority}`);

				// Step 4: Manually trigger our URI handler
				const uriHandler = new FirebaseAuthUriHandler(authManager, logger);
				await uriHandler.handleUri(testUri);

				logger.info('🧪 Manual URI test completed successfully!');
			} catch (error) {
				logger.error('🧪 Manual URI test failed', error);
			}
		}),

		vscode.commands.registerCommand('firebase-authentication-v1.openTestPage', async () => {
			logger.info('🌐 Opening test page with proper auth state...');

			try {
				// Create a storage instance to store pending auth state
				const storage = new Storage(context);

				// Generate a proper auth state using the same method as real auth flows
				const authState = Security.createAuthState('google.com');
				logger.info(`🌐 Generated auth state: ${JSON.stringify(authState)}`);

				// Store this state as pending in Storage
				// This simulates what would happen when a real auth flow starts
				await storage.storePendingAuthState(authState);
				logger.info(`🌐 Stored pending auth state in Storage`);

				// Construct path to test page using extension's own path
				const testPagePath = vscode.Uri.file(path.join(context.extensionPath, 'test-deeplink.html'));

				// Create the redirect URL that the test page should use
				const redirectUrl = 'siid://ConscendoTechInc.firebase-authentication-v1/callback';

				// Add both redirect URL and the real auth state as query parameters
				// We pass the stringified auth state so the test page can use it
				const queryParams = new URLSearchParams({
					redirectUrl: redirectUrl,
					authState: JSON.stringify(authState)
				});

				// Create the URI with query parameters properly
				const testPageUri = testPagePath.with({
					query: queryParams.toString()
				});

				logger.info(`🌐 Opening test page: ${testPageUri.toString()}`);
				logger.info(`🌐 Redirect URL: ${redirectUrl}`);
				logger.info(`🌐 Auth State: ${JSON.stringify(authState)}`);

				// Open in external browser
				await vscode.env.openExternal(testPageUri);

				vscode.window.showInformationMessage(`Test page opened with auth state: ${authState.timestamp}...`);
			} catch (error) {
				logger.error('🌐 Failed to open test page', error);
				vscode.window.showErrorMessage(`Failed to open test page: ${error}`);
			}
		})
	];

	commands.forEach(command => context.subscriptions.push(command));
}

function registerUriHandler(context: vscode.ExtensionContext) {
	logger.info('🔧 Registering URI handler for deep links...');

	// Create our Firebase Auth URI Handler instance
	const uriHandler = new FirebaseAuthUriHandler(authManager, logger);

	// Register it with VS Code
	const disposable = vscode.window.registerUriHandler(uriHandler);
	context.subscriptions.push(disposable);

	logger.info('🔧 URI handler registered successfully');
	logger.info('🔧 URI handler instance:', uriHandler ? 'created' : 'failed');
}

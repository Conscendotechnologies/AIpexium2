import * as vscode from 'vscode';
import { FirebaseAuthProvider } from './firebaseAuthProvider';

export class UriHandler implements vscode.UriHandler {
	constructor(private authProvider: FirebaseAuthProvider) { }

	async handleUri(uri: vscode.Uri): Promise<void> {
		console.log('URI Handler called with:', uri.toString());
		vscode.window.showInformationMessage('URI Handler called with:', uri.toString());

		try {
			// Parse the URI path and query
			const path = uri.path;
			const query = this.parseQuery(uri.query);

			if (path === '/auth-complete') {
				const sessionId = query.session;
				const error = query.error;

				if (error) {
					// Handle authentication error
					const errorDescription = query.error_description || 'Unknown authentication error';
					vscode.window.showErrorMessage(`Authentication failed: ${errorDescription}`);
					await this.authProvider.handleAuthError(sessionId, error, errorDescription);
					return;
				}

				if (!sessionId) {
					vscode.window.showErrorMessage('Invalid authentication callback: missing session ID');
					return;
				}

				// Show progress while completing authentication
				await vscode.window.withProgress({
					location: vscode.ProgressLocation.Notification,
					title: 'Completing authentication...',
					cancellable: false
				}, async (progress) => {
					progress.report({ message: 'Retrieving user data...' });
					await this.authProvider.completeAuthWithSession(sessionId);
				});

			} else if (path === '/auth-cancel') {
				// Handle authentication cancellation
				const sessionId = query.session;
				vscode.window.showWarningMessage('Authentication was cancelled');
				await this.authProvider.handleAuthCancel(sessionId);

			} else {
				// Unknown URI path
				console.warn('Unknown URI path:', path);
				vscode.window.showWarningMessage(`Unknown authentication callback: ${path}`);
			}

		} catch (error: any) {
			console.error('Error handling URI:', error);
			vscode.window.showErrorMessage(`Authentication callback error: ${error.message}`);
		}
	}

	private parseQuery(query: string): Record<string, string> {
		const params: Record<string, string> = {};
		if (!query) return params;

		const pairs = query.split('&');
		for (const pair of pairs) {
			const [key, value] = pair.split('=');
			if (key && value) {
				params[decodeURIComponent(key)] = decodeURIComponent(value);
			}
		}
		return params;
	}
}

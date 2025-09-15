import * as vscode from 'vscode';
import { FirebaseAuthProvider } from './firebaseAuthProvider';
import { AuthWebviewProvider } from './authWebviewProvider';
import { UriHandler } from './uriHandler';

let authProvider: FirebaseAuthProvider;
let webviewProvider: AuthWebviewProvider;
let uriHandler: UriHandler;

export function activate(context: vscode.ExtensionContext) {
	console.log('Firebase Auth extension is now active!');

	// Initialize Firebase Auth Provider
	authProvider = new FirebaseAuthProvider(context);
	webviewProvider = new AuthWebviewProvider(context, authProvider);
	uriHandler = new UriHandler(authProvider);

	// Register URI handler for auth callbacks
	context.subscriptions.push(
		vscode.window.registerUriHandler(uriHandler)
	);

	// Register webview provider
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider('firebase-auth-view', webviewProvider)
	);

	// Register commands
	const loginCommand = vscode.commands.registerCommand('firebase-auth.login', async () => {
		try {
			await webviewProvider.showLoginWebview();
		} catch (error) {
			vscode.window.showErrorMessage(`Login failed: ${error}`);
		}
	});

	const logoutCommand = vscode.commands.registerCommand('firebase-auth.logout', async () => {
		try {
			await authProvider.signOut();
			vscode.window.showInformationMessage('Successfully logged out from Firebase');
			vscode.commands.executeCommand('setContext', 'firebase-auth.authenticated', false);
		} catch (error) {
			vscode.window.showErrorMessage(`Logout failed: ${error}`);
		}
	});

	const showStatusCommand = vscode.commands.registerCommand('firebase-auth.showStatus', () => {
		const user = authProvider.getCurrentUser();
		if (user) {
			vscode.window.showInformationMessage(
				`Logged in as: ${user.email || user.displayName || 'Anonymous'}`
			);
		} else {
			vscode.window.showInformationMessage('Not logged in to Firebase');
		}
	});

	// Listen to auth state changes
	authProvider.onAuthStateChanged((user) => {
		const isAuthenticated = !!user;
		vscode.commands.executeCommand('setContext', 'firebase-auth.authenticated', isAuthenticated);

		if (user) {
			vscode.window.showInformationMessage(
				`Welcome ${user.displayName || user.email || 'User'}!`
			);
		}
	});

	context.subscriptions.push(loginCommand, logoutCommand, showStatusCommand);
}

export function deactivate() {
	if (authProvider) {
		authProvider.dispose();
	}
}

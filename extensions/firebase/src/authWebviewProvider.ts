import * as vscode from 'vscode';
import { FirebaseAuthProvider } from './firebaseAuthProvider';

export class AuthWebviewProvider implements vscode.WebviewViewProvider {
	private _view?: vscode.WebviewView;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly authProvider: FirebaseAuthProvider
	) { }

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		token: vscode.CancellationToken
	): void | Thenable<void> {
		this._view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this.context.extensionUri]
		};

		webviewView.webview.html = this.getWebviewContent();

		// Handle messages from webview
		webviewView.webview.onDidReceiveMessage(
			async (message) => {
				switch (message.command) {
					case 'loginWithGoogle':
						try {
							webviewView.webview.postMessage({ command: 'showLoading', provider: 'Google' });
							await this.authProvider.signInWithGoogle();
							// Success message and UI update will be handled by auth state change
						} catch (error) {
							webviewView.webview.postMessage({ command: 'hideLoading' });
							vscode.window.showErrorMessage(`Google authentication failed: ${error}`);
						}
						break;
					case 'loginWithGithub':
						try {
							webviewView.webview.postMessage({ command: 'showLoading', provider: 'GitHub' });
							await this.authProvider.signInWithGitHub();
							// Success message and UI update will be handled by auth state change
						} catch (error) {
							webviewView.webview.postMessage({ command: 'hideLoading' });
							vscode.window.showErrorMessage(`GitHub authentication failed: ${error}`);
						}
						break;
					case 'logout':
						try {
							await this.authProvider.signOut();
							vscode.window.showInformationMessage('✅ Successfully logged out');
						} catch (error) {
							vscode.window.showErrorMessage(`Logout failed: ${error}`);
						}
						break;
				}
			},
			undefined,
			this.context.subscriptions
		);

		// Listen to auth state changes
		this.authProvider.onAuthStateChanged((user) => {
			if (this._view) {
				this._view.webview.html = user ? this.getAuthenticatedContent() : this.getWebviewContent();
			}
		});
	}

	public async showLoginWebview(): Promise<void> {
		if (this._view) {
			this._view.show(true);
			return;
		}

		// Create a new webview panel if view doesn't exist
		const panel = vscode.window.createWebviewPanel(
			'firebaseAuth',
			'Firebase Authentication',
			vscode.ViewColumn.One,
			{
				enableScripts: true,
				localResourceRoots: [this.context.extensionUri]
			}
		);

		panel.webview.html = this.getWebviewContent();

		panel.webview.onDidReceiveMessage(
			async (message) => {
				switch (message.command) {
					case 'loginWithGoogle':
						try {
							panel.webview.postMessage({ command: 'showLoading', provider: 'Google' });
							await this.authProvider.signInWithGoogle();
							// Success will be handled by auth state change and close panel
							panel.dispose();
						} catch (error) {
							panel.webview.postMessage({ command: 'hideLoading' });
							vscode.window.showErrorMessage(`Google authentication failed: ${error}`);
						}
						break;
					case 'loginWithGithub':
						try {
							panel.webview.postMessage({ command: 'showLoading', provider: 'GitHub' });
							await this.authProvider.signInWithGitHub();
							// Success will be handled by auth state change and close panel
							panel.dispose();
						} catch (error) {
							panel.webview.postMessage({ command: 'hideLoading' });
							vscode.window.showErrorMessage(`GitHub authentication failed: ${error}`);
						}
						break;
					case 'logout':
						try {
							await this.authProvider.signOut();
							vscode.window.showInformationMessage('✅ Successfully logged out');
							panel.webview.html = this.getWebviewContent();
						} catch (error) {
							vscode.window.showErrorMessage(`Logout failed: ${error}`);
						}
						break;
				}
			},
			undefined,
			this.context.subscriptions
		);
	}

	private getWebviewContent(): string {
		return `<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<title>Firebase Authentication</title>
			<style>
				body {
					font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
					padding: 20px;
					background-color: var(--vscode-editor-background);
					color: var(--vscode-foreground);
				}

				.container {
					max-width: 400px;
					margin: 0 auto;
					text-align: center;
				}

				.logo {
					font-size: 24px;
					font-weight: bold;
					margin-bottom: 30px;
					color: var(--vscode-textLink-foreground);
				}

				.auth-button {
					display: flex;
					align-items: center;
					justify-content: center;
					width: 100%;
					padding: 12px 16px;
					margin: 10px 0;
					border: 1px solid var(--vscode-button-border);
					border-radius: 4px;
					background-color: var(--vscode-button-background);
					color: var(--vscode-button-foreground);
					cursor: pointer;
					font-size: 14px;
					transition: all 0.2s;
					text-decoration: none;
				}

				.auth-button:hover:not(.loading) {
					background-color: var(--vscode-button-hoverBackground);
				}

				.auth-button:active:not(.loading) {
					transform: translateY(1px);
				}

				.google-btn:not(.loading) {
					background-color: #4285f4;
					color: white;
					border-color: #4285f4;
				}

				.google-btn:hover:not(.loading) {
					background-color: #357ae8;
				}

				.github-btn:not(.loading) {
					background-color: #24292e;
					color: white;
					border-color: #24292e;
				}

				.github-btn:hover:not(.loading) {
					background-color: #1a1e22;
				}

				.icon {
					width: 18px;
					height: 18px;
					margin-right: 8px;
				}

				.divider {
					margin: 20px 0;
					text-align: center;
					position: relative;
				}

				.divider:before {
					content: '';
					position: absolute;
					top: 50%;
					left: 0;
					right: 0;
					height: 1px;
					background: var(--vscode-widget-border);
				}

				.divider span {
					background: var(--vscode-editor-background);
					padding: 0 10px;
					color: var(--vscode-descriptionForeground);
					font-size: 12px;
				}

				.description {
					margin-top: 20px;
					font-size: 12px;
					color: var(--vscode-descriptionForeground);
					line-height: 1.4;
				}

				.loading {
					opacity: 0.6;
					pointer-events: none;
					background-color: var(--vscode-button-secondaryBackground) !important;
					color: var(--vscode-button-secondaryForeground) !important;
				}

				.loading-text {
					font-size: 12px;
					color: var(--vscode-descriptionForeground);
					margin-top: 16px;
					padding: 8px;
					background-color: var(--vscode-inputValidation-infoBackground);
					border-radius: 4px;
					border-left: 3px solid var(--vscode-inputValidation-infoBorder);
				}

				@keyframes pulse {
					0%, 100% { opacity: 0.6; }
					50% { opacity: 1; }
				}

				.pulse {
					animation: pulse 1.5s infinite;
				}
			</style>
		</head>
		<body>
			<div class="container">
				<div class="logo">🔥 Firebase Auth</div>

				<button class="auth-button google-btn" onclick="loginWithGoogle()">
					<svg class="icon" viewBox="0 0 24 24">
						<path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
						<path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
						<path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
						<path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
					</svg>
					<span class="button-text">Continue with Google</span>
				</button>

				<div class="divider">
					<span>OR</span>
				</div>

				<button class="auth-button github-btn" onclick="loginWithGithub()">
					<svg class="icon" viewBox="0 0 24 24">
						<path fill="currentColor" d="M12 2A10 10 0 0 0 2 12c0 4.42 2.87 8.17 6.84 9.5c.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34c-.46-1.16-1.11-1.47-1.11-1.47c-.91-.62.07-.6.07-.6c1 .07 1.53 1.03 1.53 1.03c.87 1.52 2.34 1.07 2.91.83c.09-.65.35-1.09.63-1.34c-2.22-.25-4.55-1.11-4.55-4.92c0-1.11.38-2 1.03-2.71c-.1-.25-.45-1.29.1-2.64c0 0 .84-.27 2.75 1.02c.79-.22 1.65-.33 2.5-.33c.85 0 1.71.11 2.5.33c1.91-1.29 2.75-1.02 2.75-1.02c.55 1.35.2 2.39.1 2.64c.65.71 1.03 1.6 1.03 2.71c0 3.82-2.34 4.66-4.57 4.91c.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0 0 12 2Z"/>
					</svg>
					<span class="button-text">Continue with GitHub</span>
				</button>

				<div class="description">
					Sign in to access Firebase features and sync your data across devices. You'll be redirected to a secure login page.
				</div>
			</div>

			<script>
				const vscode = acquireVsCodeApi();

				function loginWithGoogle() {
					vscode.postMessage({
						command: 'loginWithGoogle'
					});
				}

				function loginWithGithub() {
					vscode.postMessage({
						command: 'loginWithGithub'
					});
				}

				// Listen for messages from the extension
				window.addEventListener('message', event => {
					const message = event.data;

					if (message.command === 'showLoading') {
						showLoading(message.provider);
					} else if (message.command === 'hideLoading') {
						hideLoading();
					}
				});

				function showLoading(provider) {
					const buttons = document.querySelectorAll('.auth-button');
					buttons.forEach(btn => {
						btn.classList.add('loading');
						const buttonText = btn.querySelector('.button-text');
						const icon = btn.querySelector('.icon');

						if (buttonText && buttonText.textContent.includes(provider)) {
							icon.style.animation = 'pulse 1.5s infinite';
							buttonText.textContent = \`Opening \${provider} Authentication...\`;
						}
					});

					const container = document.querySelector('.container');
					if (container && !container.querySelector('.loading-text')) {
						const loadingText = document.createElement('div');
						loadingText.className = 'loading-text';
						loadingText.innerHTML = \`
							🌐 Complete authentication in your browser<br>
							<small>You'll be redirected back automatically</small>
						\`;
						container.appendChild(loadingText);
					}
				}

				function hideLoading() {
					// Remove loading states
					const buttons = document.querySelectorAll('.auth-button');
					buttons.forEach(btn => {
						btn.classList.remove('loading');
						const icon = btn.querySelector('.icon');
						if (icon) icon.style.animation = '';
					});

					// Remove loading text
					const loadingText = document.querySelector('.loading-text');
					if (loadingText) {
						loadingText.remove();
					}

					// Reset button text
					const googleBtn = document.querySelector('.google-btn .button-text');
					const githubBtn = document.querySelector('.github-btn .button-text');
					if (googleBtn) googleBtn.textContent = 'Continue with Google';
					if (githubBtn) githubBtn.textContent = 'Continue with GitHub';
				}
			</script>
		</body>
		</html>`;
	}

	private getAuthenticatedContent(): string {
		const user = this.authProvider.getCurrentUser();
		const displayName = user?.displayName || user?.email || 'User';
		const photoURL = user?.photoURL;

		return `<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<title>Firebase Authentication</title>
			<style>
				body {
					font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
					padding: 20px;
					background-color: var(--vscode-editor-background);
					color: var(--vscode-foreground);
				}

				.container {
					max-width: 400px;
					margin: 0 auto;
					text-align: center;
				}

				.user-info {
					padding: 20px;
					border: 1px solid var(--vscode-widget-border);
					border-radius: 8px;
					margin-bottom: 20px;
				}

				.avatar {
					width: 64px;
					height: 64px;
					border-radius: 50%;
					margin-bottom: 12px;
					border: 2px solid var(--vscode-textLink-foreground);
				}

				.user-name {
					font-size: 18px;
					font-weight: 600;
					margin-bottom: 8px;
					color: var(--vscode-textLink-foreground);
				}

				.user-email {
					font-size: 14px;
					color: var(--vscode-descriptionForeground);
					margin-bottom: 16px;
				}

				.status {
					display: inline-flex;
					align-items: center;
					padding: 4px 8px;
					background-color: #22c55e;
					color: white;
					border-radius: 12px;
					font-size: 12px;
					font-weight: 500;
				}

				.status-dot {
					width: 6px;
					height: 6px;
					background-color: white;
					border-radius: 50%;
					margin-right: 6px;
				}

				.logout-btn {
					padding: 10px 20px;
					background-color: var(--vscode-button-secondaryBackground);
					color: var(--vscode-button-secondaryForeground);
					border: 1px solid var(--vscode-button-border);
					border-radius: 4px;
					cursor: pointer;
					font-size: 14px;
					transition: all 0.2s;
				}

				.logout-btn:hover {
					background-color: var(--vscode-button-secondaryHoverBackground);
				}
			</style>
		</head>
		<body>
			<div class="container">
				<div class="user-info">
					${photoURL ? `<img src="${photoURL}" alt="Avatar" class="avatar">` : ''}
					<div class="user-name">${displayName}</div>
					${user?.email ? `<div class="user-email">${user.email}</div>` : ''}
					<div class="status">
						<span class="status-dot"></span>
						Authenticated
					</div>
				</div>

				<button class="logout-btn" onclick="logout()">
					Sign Out
				</button>
			</div>

			<script>
				const vscode = acquireVsCodeApi();

				function logout() {
					vscode.postMessage({
						command: 'logout'
					});
				}
			</script>
		</body>
		</html>`;
	}
}

import * as vscode from 'vscode';

export class InitialConsentPopup {
	private panel: vscode.WebviewPanel | undefined;
	private disposables: vscode.Disposable[] = [];
	private consentCallback: ((response: 'yes' | 'no') => void) | undefined;

	constructor(private readonly extensionPath: string) {}

	public async show(): Promise<'yes' | 'no'> {
		return new Promise<'yes' | 'no'>((resolve) => {
			this.consentCallback = resolve;

			// Create and show panel (non-closable)
			this.panel = vscode.window.createWebviewPanel(
				'firebaseInitialConsent',
				'Firebase Service',
				vscode.ViewColumn.One,
				{
					enableScripts: true,
					retainContextWhenHidden: true
				}
			);

			// Set the HTML content
			this.panel.webview.html = this.getWebviewContent();

			// Handle messages from the webview
			this.panel.webview.onDidReceiveMessage(
				(message) => {
					if (message.command === 'response') {
						this.handleResponse(message.value);
					}
				},
				null,
				this.disposables
			);

			// Prevent panel from being closed by user
			this.panel.onDidDispose(
				() => {
					this.dispose();
				},
				null,
				this.disposables
			);
		});
	}

	private handleResponse(response: 'yes' | 'no'): void {
		if (this.consentCallback) {
			const callback = this.consentCallback;
			this.consentCallback = undefined;
			callback(response);
		}
		this.panel?.dispose();
	}

	private getWebviewContent(): string {
		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Firebase Service - Privacy Consent</title>
	<style>
		body {
			font-family: var(--vscode-font-family);
			font-size: var(--vscode-font-size);
			color: var(--vscode-foreground);
			background-color: var(--vscode-editor-background);
			padding: 0;
			margin: 0;
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			min-height: 100vh;
		}

		.container {
			max-width: 600px;
			padding: 40px;
			text-align: center;
		}

		.icon {
			font-size: 64px;
			margin-bottom: 24px;
		}

		h1 {
			font-size: 24px;
			font-weight: 600;
			margin: 0 0 16px 0;
			color: var(--vscode-foreground);
		}

		.message {
			font-size: 14px;
			line-height: 1.6;
			margin: 0 0 32px 0;
			color: var(--vscode-descriptionForeground);
		}

		.buttons {
			display: flex;
			gap: 12px;
			justify-content: center;
		}

		.button {
			padding: 10px 24px;
			border: none;
			border-radius: 2px;
			font-size: 13px;
			cursor: pointer;
			font-family: var(--vscode-font-family);
			font-weight: 500;
			outline: 1px solid transparent;
			outline-offset: 2px !important;
			min-width: 100px;
		}

		.button:focus {
			outline-color: var(--vscode-focusBorder);
		}

		.button:hover {
			transform: translateY(-1px);
		}

		.button-primary {
			background-color: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
		}

		.button-primary:hover {
			background-color: var(--vscode-button-hoverBackground);
		}

		.button-secondary {
			background-color: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
		}

		.button-secondary:hover {
			background-color: var(--vscode-button-secondaryHoverBackground);
		}

		.info-text {
			font-size: 12px;
			color: var(--vscode-descriptionForeground);
			margin-top: 24px;
			font-style: italic;
		}

		.context-text {
			font-size: 13px;
			color: var(--vscode-descriptionForeground);
			margin: 20px 0 12px 0;
			line-height: 1.5;
		}

		.learn-more {
			margin-bottom: 8px;
		}

		.learn-more-link {
			color: var(--vscode-textLink-foreground);
			cursor: pointer;
			text-decoration: none;
			font-size: 13px;
			font-weight: 500;
		}

		.learn-more-link:hover {
			text-decoration: underline;
		}

		.accordion-content {
			max-height: 0;
			overflow: hidden;
			transition: max-height 0.3s ease-out;
			text-align: left;
			background-color: var(--vscode-input-background);
			border: 1px solid var(--vscode-input-border);
			border-radius: 4px;
			margin-bottom: 0;
		}

		.accordion-content.expanded {
			max-height: 400px;
			overflow-y: auto;
			padding: 16px;
			margin-bottom: 16px;
		}

		.accordion-content h3 {
			font-size: 14px;
			font-weight: 600;
			margin: 16px 0 8px 0;
		}

		.accordion-content h2 {
			font-size: 16px;
			font-weight: 600;
			margin: 20px 0 12px 0;
		}

		.accordion-content ul {
			margin: 8px 0;
			padding-left: 20px;
		}

		.accordion-content li {
			margin: 6px 0;
			line-height: 1.5;
		}

		.accordion-content .info-box {
			background-color: var(--vscode-textBlockQuote-background);
			border-left: 4px solid var(--vscode-textBlockQuote-border);
			padding: 12px;
			margin: 12px 0;
			font-size: 13px;
		}
	</style>
</head>
<body>
	<div class="container">
		<div class="icon">🔒</div>
		<h1>Firebase Service - Privacy Consent</h1>
		<p class="message">
			Firebase Service requires your consent to collect and process data for authentication and data storage.
			This helps us provide authentication and data storage capabilities.
		</p>
		<p class="message">
			<strong>Do you consent to data collection?</strong>
		</p>

		<div class="buttons">
			<button class="button button-secondary" onclick="respond('no')">No</button>
			<button class="button button-primary" onclick="respond('yes')" autofocus>Yes</button>
		</div>

		<p class="context-text">
			Want to know what data we collect and how we use it?
		</p>

		<div class="learn-more">
			<a class="learn-more-link" onclick="toggleAccordion()">📖 Learn More</a>
		</div>

		<div id="accordion" class="accordion-content">
			<h3>📋 What Data We Collect</h3>
			<ul>
				<li><strong>Authentication Data:</strong> User email, display name, authentication provider, and User ID</li>
				<li><strong>User Preferences:</strong> Data you explicitly store using Firestore commands and user properties</li>
			</ul>

			<h3>🎯 How We Use This Data</h3>
			<ul>
				<li>To provide authentication and personalized services</li>
				<li>To improve the extension based on usage patterns</li>
				<li>To track performance and identify issues</li>
				<li>To store your preferences and data across devices</li>
			</ul>

			<h3>🔐 Your Rights & Data Security</h3>
			<ul>
				<li><strong>Right to Access:</strong> You can access all data stored about you</li>
				<li><strong>Right to Deletion:</strong> You can request deletion of your data at any time</li>
				<li><strong>Right to Opt-Out:</strong> You can disable data collection in settings</li>
				<li><strong>Security:</strong> All data is stored securely in Firebase with encryption</li>
			</ul>
		</div>

		<p class="info-text">
			Clicking "No" will show you information about what features won't work without consent.
		</p>
	</div>

	<script>
		const vscode = acquireVsCodeApi();

		function respond(value) {
			vscode.postMessage({ command: 'response', value: value });
		}

		function toggleAccordion() {
			const accordion = document.getElementById('accordion');
			accordion.classList.toggle('expanded');
		}

		// Prevent window close
		window.addEventListener('beforeunload', (e) => {
			e.preventDefault();
			e.returnValue = '';
		});

		// Focus the Yes button on load
		window.addEventListener('load', () => {
			document.querySelector('.button-primary').focus();
		});
	</script>
</body>
</html>`;
	}

	public dispose(): void {
		this.panel?.dispose();
		while (this.disposables.length) {
			const disposable = this.disposables.pop();
			if (disposable) {
				disposable.dispose();
			}
		}
	}
}

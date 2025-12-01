import * as vscode from 'vscode';

export class PrivacyConsentView {
	private panel: vscode.WebviewPanel | undefined;
	private disposables: vscode.Disposable[] = [];
	private consentCallback: ((response: { consented: boolean; dontAskAgain?: boolean }) => void) | undefined;

	constructor(private readonly extensionPath: string) { }

	public async show(): Promise<{ consented: boolean; dontAskAgain?: boolean }> {
		return new Promise<{ consented: boolean; dontAskAgain?: boolean }>((resolve) => {
			this.consentCallback = resolve;

			// Create and show panel
			this.panel = vscode.window.createWebviewPanel(
				'firebasePrivacyConsent',
				'Firebase Service Privacy & Consent',
				vscode.ViewColumn.One,
				{
					enableScripts: true,
					retainContextWhenHidden: true,
					localResourceRoots: [vscode.Uri.file(this.extensionPath)]
				}
			);

			// Set the HTML content
			this.panel.webview.html = this.getWebviewContent();

			// Handle messages from the webview
			this.panel.webview.onDidReceiveMessage(
				(message) => {
					switch (message.command) {
						case 'consent':
							this.handleConsent({ consented: true });
							return;
						case 'dontAskAgain':
							this.handleConsent({ consented: false, dontAskAgain: true });
							return;
					}
				},
				null,
				this.disposables
			);

			// Handle panel disposal
			this.panel.onDidDispose(
				() => {
					this.dispose();
					// If callback wasn't called yet, treat as decline
					if (this.consentCallback) {
						const callback = this.consentCallback;
						this.consentCallback = undefined;
						callback({ consented: false });
					}
				},
				null,
				this.disposables
			);
		});
	}

	private handleConsent(response: { consented: boolean; dontAskAgain?: boolean }): void {
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
	<title>Firebase Service Privacy & Consent</title>
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
			height: 100vh;
		}

		.header {
			padding: 20px 30px;
			border-bottom: 1px solid var(--vscode-panel-border);
		}

		.header h1 {
			margin: 0 0 8px 0;
			font-size: 20px;
			font-weight: 600;
		}

		.header p {
			margin: 0;
			color: var(--vscode-descriptionForeground);
			font-size: 13px;
		}

		.content {
			flex: 1;
			overflow-y: auto;
			padding: 30px;
		}

		.section {
			margin-bottom: 30px;
		}

		.section h2 {
			font-size: 16px;
			font-weight: 600;
			margin: 0 0 12px 0;
			color: var(--vscode-foreground);
		}

		.section h3 {
			font-size: 14px;
			font-weight: 600;
			margin: 20px 0 8px 0;
			color: var(--vscode-foreground);
		}

		.section p, .section ul {
			margin: 8px 0;
			line-height: 1.6;
			color: var(--vscode-foreground);
		}

		.section ul {
			padding-left: 20px;
		}

		.section li {
			margin: 4px 0;
		}

		.warning-box {
			background-color: var(--vscode-inputValidation-warningBackground);
			border: 1px solid var(--vscode-inputValidation-warningBorder);
			border-radius: 3px;
			padding: 16px;
			margin: 20px 0;
		}

		.warning-box h3 {
			margin: 0 0 12px 0;
			color: var(--vscode-inputValidation-warningForeground);
			font-size: 14px;
			font-weight: 600;
		}

		.warning-box p {
			margin: 8px 0;
			color: var(--vscode-foreground);
		}

		.feature-list {
			list-style: none;
			padding: 0;
		}

		.feature-list li {
			padding: 4px 0;
			padding-left: 24px;
			position: relative;
		}

		.feature-list li.disabled::before {
			content: "⛔";
			position: absolute;
			left: 0;
		}

		.feature-list li.enabled::before {
			content: "✓";
			position: absolute;
			left: 0;
			color: var(--vscode-testing-iconPassed);
		}

		.info-box {
			background-color: var(--vscode-textBlockQuote-background);
			border-left: 4px solid var(--vscode-textBlockQuote-border);
			padding: 16px;
			margin: 20px 0;
		}

		.footer {
			border-top: 1px solid var(--vscode-panel-border);
			padding: 16px 30px;
			background-color: var(--vscode-editor-background);
			display: flex;
			justify-content: flex-end;
			gap: 12px;
		}

		.button {
			padding: 6px 14px;
			border: none;
			border-radius: 2px;
			font-size: 13px;
			cursor: pointer;
			font-family: var(--vscode-font-family);
			outline: 1px solid transparent;
			outline-offset: 2px !important;
		}

		.button:focus {
			outline-color: var(--vscode-focusBorder);
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

		.divider {
			height: 1px;
			background-color: var(--vscode-panel-border);
			margin: 20px 0;
		}
	</style>
</head>
<body>
	<div class="header">
		<h1>⚠️ What Happens If You Decline?</h1>
		<p>If you choose not to consent, the following features will be unavailable</p>
	</div>

	<div class="content">
		<div class="warning-box">
			<h3>Features That Will NOT Work:</h3>
			<ul class="feature-list">
				<li class="disabled"><strong>Authentication:</strong> Cannot sign in with Google, GitHub, or Email</li>
				<li class="disabled"><strong>Data Storage:</strong> Cannot store or retrieve data from Firestore</li>
				<li class="disabled"><strong>User Properties:</strong> Cannot set or retrieve user properties</li>
				<li class="disabled"><strong>Cross-Device Sync:</strong> Preferences won't sync across devices</li>
				<li class="disabled"><strong>Personalized Experience:</strong> No personalized features</li>
			</ul>

			<h3 style="margin-top: 24px;">What Will Still Work:</h3>
			<ul class="feature-list">
				<li class="enabled">Basic VS Code functionality</li>
				<li class="enabled">Local development without Firebase services & SIID-Code Agent</li>
				<li class="enabled">Other VS Code extensions</li>
			</ul>
		</div>

		<div class="section">
			<h2>📝 Your Decision</h2>
			<p>You can change your consent decision at any time by running the command <strong>"FBS: Review Privacy Consent"</strong> from the command palette or by changing the setting in <strong>Settings > Firebase Service > Privacy Consent</strong>.</p>
		</div>
	</div>

	<div class="footer">
		<button class="button button-secondary" onclick="dontAskAgain()">Don't Ask Again</button>
		<button class="button button-primary" onclick="consent()">I Consent</button>
	</div>

	<script>
		const vscode = acquireVsCodeApi();

		function consent() {
			vscode.postMessage({ command: 'consent', value: true });
		}

		function dontAskAgain() {
			vscode.postMessage({ command: 'dontAskAgain' });
		}

		// Don't prevent window close anymore since we have "Don't Ask Again"
		// User can close the window if they want

		// Focus the consent button on load
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

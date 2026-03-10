import * as vscode from 'vscode';

/**
 * Provides a webview-based session status view that displays when extension is locked
 */
export class SessionStatusView implements vscode.WebviewViewProvider {
	public static readonly viewType = 'firebase-service.sessionStatusView';
	private view?: vscode.WebviewView;
	private isLocked: boolean = false;
	private _onDidChangeLockState: vscode.EventEmitter<boolean> = new vscode.EventEmitter<boolean>();
	readonly onDidChangeLockState: vscode.Event<boolean> = this._onDidChangeLockState.event;

	constructor(private extensionUri: vscode.Uri) { }

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	) {
		this.view = webviewView;
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this.extensionUri]
		};

		this.updateWebviewContent();
	}

	/**
	 * Set the lock status and update the webview
	 */
	public setLocked(locked: boolean): void {
		if (this.isLocked !== locked) {
			this.isLocked = locked;
			this._onDidChangeLockState.fire(locked);
			this.updateWebviewContent();
		}
	}

	/**
	 * Update webview content based on lock status
	 */
	private updateWebviewContent(): void {
		if (!this.view) {
			return;
		}

		if (this.isLocked) {
			this.view.webview.html = this.getLockedContent();
		} else {
			this.view.webview.html = this.getActiveContent();
		}
	}

	/**
	 * Get HTML content when extension is locked
	 */
	private getLockedContent(): string {
		return `
			<!DOCTYPE html>
				<html lang="en">
				<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>Thank You — HackFest 2026</title>
				<style>
					@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500&display=swap');

					*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

					:root {
					--bg:      #1e1e1e;
					--panel:   #252526;
					--border:  #3c3c3c;
					--text:    #cccccc;
					--muted:   #6a6a6a;
					--accent:  #7c4dff;
					--green:   #4caf50;
					--white:   #ffffff;
					}

					body {
					font-family: 'JetBrains Mono', 'Consolas', monospace;
					color: var(--text);
					min-height: 100vh;
					display: flex;
					align-items: center;
					justify-content: center;
					padding: 24px;
					}

					.container {
					width: 100%;
					max-width: 320px;
					animation: fadeIn 0.5s ease forwards;
					opacity: 0;
					}

					@keyframes fadeIn {
					to { opacity: 1; }
					}

					/* Section label — mimics VSCode tree header */
					.section-label {
					font-size: 10px;
					font-weight: 500;
					letter-spacing: 0.1em;
					text-transform: uppercase;
					color: var(--text);
					margin-bottom: 16px;
					display: flex;
					align-items: center;
					gap: 6px;
					}

					.section-label::before {
					content: '›';
					color: var(--muted);
					font-size: 13px;
					}

					/* Card */
					.card {
					background: var(--panel);
					border: 1px solid var(--border);
					border-radius: 4px;
					padding: 28px 24px 24px;
					text-align: center;
					}

					/* Check icon */
					.icon-wrap {
					width: 44px;
					height: 44px;
					background: var(--green);
					border-radius: 8px;
					display: flex;
					align-items: center;
					justify-content: center;
					margin: 0 auto 18px;
					animation: popIn 0.4s cubic-bezier(0.16, 1, 0.3, 1) 0.3s both;
					}

					@keyframes popIn {
					from { transform: scale(0.6); opacity: 0; }
					to   { transform: scale(1);   opacity: 1; }
					}

					.icon-wrap svg {
					width: 22px;
					height: 22px;
					stroke: #fff;
					stroke-width: 2.5;
					fill: none;
					stroke-linecap: round;
					stroke-linejoin: round;
					}

					/* Heading */
					h1 {
					font-size: 14px;
					font-weight: 500;
					color: var(--white);
					margin-bottom: 8px;
					letter-spacing: 0.01em;
					}

					.sub {
					font-size: 11px;
					font-weight: 300;
					color: var(--muted);
					line-height: 1.6;
					margin-bottom: 20px;
					}

					/* Divider */
					.divider {
					border: none;
					border-top: 1px solid var(--border);
					margin-bottom: 16px;
					}

					/* Status row */
					.status-row {
					display: flex;
					justify-content: space-between;
					align-items: center;
					text-align: left;
					}

					.status-key {
					font-size: 10px;
					font-weight: 500;
					color: var(--text);
					}

					.status-val {
					font-size: 10px;
					font-weight: 300;
					color: var(--green);
					display: flex;
					align-items: center;
					gap: 5px;
					}

					.dot {
					width: 6px;
					height: 6px;
					border-radius: 50%;
					background: var(--green);
					animation: pulse 2s ease-in-out infinite;
					}

					@keyframes pulse {
					0%, 100% { opacity: 1; }
					50%       { opacity: 0.4; }
					}
				</style>
				</head>
				<body>

				<div class="container">


					<div class="card">

					<div class="icon-wrap">
						<svg viewBox="0 0 24 24">
						<polyline points="20 6 9 17 4 12"/>
						</svg>
					</div>

					<h1>Thank You for Participating</h1>
					<p class="sub">Your session has been completed.<br>HackFest 2026 · SIID</p>

					<hr class="divider">

					<div class="status-row">
						<span class="status-key">Status:</span>
						<span class="status-val">
						<span class="dot"></span>
						Participation Confirmed
						</span>
					</div>

					</div>

				</div>

				</body>
				</html>
		`;
	}

	/**
	 * Get HTML content when extension is active
	 */
	private getActiveContent(): string {
		return `
			<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>Session Status</title>
				<style>
					* {
						margin: 0;
						padding: 0;
						box-sizing: border-box;
					}

					body {
						font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
							'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',
							sans-serif;
						background-color: var(--vscode-sideBar-background);
						color: var(--vscode-sideBar-foreground);
						padding: 20px;
						display: flex;
						flex-direction: column;
						align-items: center;
						justify-content: center;
						min-height: 100vh;
					}

					.status-container {
						text-align: center;
						padding: 30px;
						border-radius: 8px;
						background-color: var(--vscode-editor-background);
						border: 2px solid var(--vscode-symbolIcon-greenForeground);
					}

					.status-icon {
						font-size: 48px;
						margin-bottom: 16px;
					}

					h1 {
						font-size: 20px;
						margin-bottom: 12px;
						color: var(--vscode-symbolIcon-greenForeground);
					}

					p {
						font-size: 13px;
						color: var(--vscode-sideBar-foreground);
						opacity: 0.8;
						line-height: 1.5;
					}

					.status {
						margin-top: 16px;
						padding: 12px;
						background-color: var(--vscode-inputValidation-successBackground);
						border-left: 3px solid var(--vscode-symbolIcon-greenForeground);
						border-radius: 4px;
						text-align: left;
					}

					.status-label {
						font-weight: 600;
						color: var(--vscode-symbolIcon-greenForeground);
						display: block;
						margin-bottom: 4px;
					}

					.status-message {
						font-size: 12px;
						color: var(--vscode-sideBar-foreground);
					}
				</style>
			</head>
			<body>
				<div class="status-container">
					<div class="status-icon">✅</div>
					<h1>Session Active</h1>
					<p>Your Firebase Service is running normally.</p>
					<div class="status">
						<span class="status-label">Status:</span>
						<span class="status-message">Extension Active</span>
					</div>
				</div>
			</body>
			</html>
		`;
	}
}

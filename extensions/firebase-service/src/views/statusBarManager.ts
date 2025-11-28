import * as vscode from 'vscode';
import { AuthManager } from '../auth/authManager';
import { Logger } from '../utils/logger';

export class FirebaseStatusBarManager {
	private statusBarItem: vscode.StatusBarItem;
	private authManager: AuthManager;
	private logger: Logger;

	constructor(authManager: AuthManager, logger: Logger) {
		this.authManager = authManager;
		this.logger = logger;

		// Create status bar item
		this.statusBarItem = vscode.window.createStatusBarItem(
			vscode.StatusBarAlignment.Right,
			100
		);

		// Listen to auth state changes
		this.authManager.onDidChangeAuthState(() => {
			this.updateStatusBar();
		});

		// Initial update
		this.updateStatusBar();
		this.statusBarItem.show();
	}

	private async updateStatusBar(): Promise<void> {
		try {
			const session = await this.authManager.getCurrentUser();

			if (session) {
				const displayName = session.user?.displayName || session.user?.email || 'Firebase User';
				this.statusBarItem.text = `$(flame) ${displayName}`;
				this.statusBarItem.tooltip = `Firebase: Signed in as ${session.user?.email || session.uid}\nClick to view options`;
				this.statusBarItem.command = 'firebase-service.showAuthStatus';
				this.statusBarItem.backgroundColor = undefined;
			} else {
				this.statusBarItem.text = '$(flame) Firebase: Not signed in';
				this.statusBarItem.tooltip = 'Click to sign in to Firebase';
				this.statusBarItem.command = 'firebase-service.signIn';
				this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
			}
		} catch (error) {
			this.logger.error('Failed to update status bar', error);
			this.statusBarItem.text = '$(flame) Firebase: Error';
			this.statusBarItem.tooltip = 'Firebase Service error - click for details';
			this.statusBarItem.command = 'firebase-service.showAuthStatus';
			this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
		}
	}

	public dispose(): void {
		this.statusBarItem.dispose();
	}

	public refresh(): void {
		this.updateStatusBar();
	}
}

import * as vscode from 'vscode';
import { AuthManager } from '../auth/authManager';

export class FirebaseTreeItem extends vscode.TreeItem {
	constructor(
		public readonly label: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly contextValue?: string,
		public readonly command?: vscode.Command,
		public readonly iconPath?: vscode.ThemeIcon
	) {
		super(label, collapsibleState);
		this.contextValue = contextValue;
		this.command = command;
		this.iconPath = iconPath;
	}
}

export class FirebaseTreeDataProvider implements vscode.TreeDataProvider<FirebaseTreeItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<FirebaseTreeItem | undefined | null | void> = new vscode.EventEmitter<FirebaseTreeItem | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<FirebaseTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

	constructor(private authManager: AuthManager) {
		// Listen to auth state changes to refresh tree
		authManager.onDidChangeAuthState(() => {
			this.refresh();
		});
	}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: FirebaseTreeItem): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: FirebaseTreeItem): Promise<FirebaseTreeItem[]> {
		if (!element) {
			// Root level items
			return this.getRootItems();
		}

		// Child items based on parent
		switch (element.contextValue) {
			case 'authentication':
				return this.getAuthenticationItems();
			case 'firestore':
				return this.getFirestoreItems();
			case 'analytics':
				return this.getAnalyticsItems();
			default:
				return [];
		}
	}

	private async getRootItems(): Promise<FirebaseTreeItem[]> {
		const items: FirebaseTreeItem[] = [];

		// Authentication section
		items.push(new FirebaseTreeItem(
			'Authentication',
			vscode.TreeItemCollapsibleState.Expanded,
			'authentication',
			undefined,
			new vscode.ThemeIcon('key')
		));

		// Firestore section
		items.push(new FirebaseTreeItem(
			'Firestore Database',
			vscode.TreeItemCollapsibleState.Collapsed,
			'firestore',
			undefined,
			new vscode.ThemeIcon('database')
		));

		// Analytics section
		items.push(new FirebaseTreeItem(
			'Analytics',
			vscode.TreeItemCollapsibleState.Collapsed,
			'analytics',
			undefined,
			new vscode.ThemeIcon('graph')
		));

		return items;
	}

	private async getAuthenticationItems(): Promise<FirebaseTreeItem[]> {
		const items: FirebaseTreeItem[] = [];
		const session = await this.authManager.getCurrentUser();

		if (session) {
			const user = session.user;
			items.push(new FirebaseTreeItem(
				`👤 ${user.displayName || user.email || 'User'}`,
				vscode.TreeItemCollapsibleState.None,
				'user',
				undefined,
				new vscode.ThemeIcon('account')
			));

			items.push(new FirebaseTreeItem(
				'Sign Out',
				vscode.TreeItemCollapsibleState.None,
				'signout',
				{
					command: 'firebase-service.signOut',
					title: 'Sign Out'
				},
				new vscode.ThemeIcon('sign-out')
			));
		} else {
			items.push(new FirebaseTreeItem(
				'Not Signed In',
				vscode.TreeItemCollapsibleState.None,
				'not-authenticated',
				undefined,
				new vscode.ThemeIcon('error')
			));

			items.push(new FirebaseTreeItem(
				'Sign In',
				vscode.TreeItemCollapsibleState.None,
				'signin',
				{
					command: 'firebase-service.signIn',
					title: 'Sign In'
				},
				new vscode.ThemeIcon('sign-in')
			));
		}

		return items;
	}

	private async getFirestoreItems(): Promise<FirebaseTreeItem[]> {
		return [
			new FirebaseTreeItem(
				'Store Data',
				vscode.TreeItemCollapsibleState.None,
				'firestore-store',
				{
					command: 'firebase-service.storeDataInteractive',
					title: 'Store Data'
				},
				new vscode.ThemeIcon('add')
			),
			new FirebaseTreeItem(
				'Retrieve Data',
				vscode.TreeItemCollapsibleState.None,
				'firestore-retrieve',
				{
					command: 'firebase-service.retrieveDataInteractive',
					title: 'Retrieve Data'
				},
				new vscode.ThemeIcon('search')
			)
		];
	}

	private async getAnalyticsItems(): Promise<FirebaseTreeItem[]> {
		return [
			new FirebaseTreeItem(
				'Log Event',
				vscode.TreeItemCollapsibleState.None,
				'analytics-event',
				{
					command: 'firebase-service.logEvent',
					title: 'Log Event'
				},
				new vscode.ThemeIcon('pulse')
			),
			new FirebaseTreeItem(
				'View Status',
				vscode.TreeItemCollapsibleState.None,
				'analytics-status',
				{
					command: 'firebase-service.getAnalyticsStatus',
					title: 'Get Analytics Status'
				},
				new vscode.ThemeIcon('info')
			)
		];
	}
}

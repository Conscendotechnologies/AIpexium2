import * as vscode from 'vscode';
import { AuthManager } from '../auth/authManager';
import { FirestoreService } from '../firestore/firestoreService';

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

	constructor(private authManager: AuthManager, private firestoreService: FirestoreService) {
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
				'Get Current User',
				vscode.TreeItemCollapsibleState.None,
				'get-user',
				{
					command: 'firebase-service.getUser',
					title: 'Get Current User'
				},
				new vscode.ThemeIcon('account')
			));

			items.push(new FirebaseTreeItem(
				'Show Auth Status',
				vscode.TreeItemCollapsibleState.None,
				'show-status',
				{
					command: 'firebase-service.showAuthStatus',
					title: 'Show Auth Status'
				},
				new vscode.ThemeIcon('info')
			));

			items.push(new FirebaseTreeItem(
				'Refresh Session',
				vscode.TreeItemCollapsibleState.None,
				'refresh-session',
				{
					command: 'firebase-service.refreshSession',
					title: 'Refresh Session'
				},
				new vscode.ThemeIcon('refresh')
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
		const items: FirebaseTreeItem[] = [];

		// Check if user is authenticated
		const session = await this.authManager.getCurrentUser();
		if (!session) {
			items.push(new FirebaseTreeItem(
				'Sign in to view data',
				vscode.TreeItemCollapsibleState.None,
				'firestore-not-authenticated',
				undefined,
				new vscode.ThemeIcon('info')
			));
			return items;
		}

		// Try to retrieve user data from Firestore
		try {
			if (!this.firestoreService.getInitializationStatus()) {
				items.push(new FirebaseTreeItem(
					'Firestore not initialized',
					vscode.TreeItemCollapsibleState.None,
					'firestore-not-initialized',
					undefined,
					new vscode.ThemeIcon('warning')
				));
				return items;
			}

			const userData = await this.firestoreService.getUserData(session.user.uid);

			if (userData) {
				// Display user data fields
				if (userData.email) {
					items.push(new FirebaseTreeItem(
						`📧 Email: ${userData.email}`,
						vscode.TreeItemCollapsibleState.None,
						'firestore-data',
						undefined,
						new vscode.ThemeIcon('mail')
					));
				}

				if (userData.displayName) {
					items.push(new FirebaseTreeItem(
						`👤 Name: ${userData.displayName}`,
						vscode.TreeItemCollapsibleState.None,
						'firestore-data',
						undefined,
						new vscode.ThemeIcon('person')
					));
				}

				if (userData.provider) {
					items.push(new FirebaseTreeItem(
						`🔑 Provider: ${userData.provider}`,
						vscode.TreeItemCollapsibleState.None,
						'firestore-data',
						undefined,
						new vscode.ThemeIcon('key')
					));
				}

				if (userData.createdAt) {
					const createdDate = userData.createdAt.toDate ? userData.createdAt.toDate() : new Date(userData.createdAt);
					items.push(new FirebaseTreeItem(
						`📅 Created: ${createdDate.toLocaleDateString()}`,
						vscode.TreeItemCollapsibleState.None,
						'firestore-data',
						undefined,
						new vscode.ThemeIcon('calendar')
					));
				}

				if (userData.lastLoginAt) {
					const lastLogin = userData.lastLoginAt.toDate ? userData.lastLoginAt.toDate() : new Date(userData.lastLoginAt);
					items.push(new FirebaseTreeItem(
						`🕒 Last Login: ${lastLogin.toLocaleString()}`,
						vscode.TreeItemCollapsibleState.None,
						'firestore-data',
						undefined,
						new vscode.ThemeIcon('history')
					));
				}

				if (userData.emailVerified !== undefined) {
					items.push(new FirebaseTreeItem(
						`✉️ Email Verified: ${userData.emailVerified ? 'Yes' : 'No'}`,
						vscode.TreeItemCollapsibleState.None,
						'firestore-data',
						undefined,
						new vscode.ThemeIcon(userData.emailVerified ? 'verified' : 'unverified')
					));
				}
			} else {
				items.push(new FirebaseTreeItem(
					'No user data found',
					vscode.TreeItemCollapsibleState.None,
					'firestore-no-data',
					undefined,
					new vscode.ThemeIcon('info')
				));
			}
		} catch (error) {
			items.push(new FirebaseTreeItem(
				`Error loading data: ${error}`,
				vscode.TreeItemCollapsibleState.None,
				'firestore-error',
				undefined,
				new vscode.ThemeIcon('error')
			));
		}

		return items;
	}
}

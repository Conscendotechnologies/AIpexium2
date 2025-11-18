import * as path from 'path';
import { config } from 'dotenv';
import * as vscode from 'vscode';
import { AnalyticsService } from './analytics/analyticsService';
import { FirestoreService } from './firestore/firestoreService';
import { AuthService } from './auth/authService';
import { AuthManager } from './auth/authManager';
import { Logger } from './utils/logger';
import { FirebaseAppManager } from './utils/firebaseAppManager';
import { FirebaseTreeDataProvider } from './views/firebaseTreeDataProvider';
import { FirebaseStatusBarManager } from './views/statusBarManager';

let analyticsService: AnalyticsService;
let firestoreService: FirestoreService;
let authService: AuthService;
let authManager: AuthManager;
let logger: Logger;
let firebaseAppManager: FirebaseAppManager;
let treeDataProvider: FirebaseTreeDataProvider;
let statusBarManager: FirebaseStatusBarManager;

// Firebase Authentication URI Handler class
class FirebaseServiceUriHandler implements vscode.UriHandler {
	constructor(private authManager: AuthManager, private logger: Logger) { }

	async handleUri(uri: vscode.Uri): Promise<void> {
		this.logger.info(`🔥 Firebase Service received URI: ${uri.toString()}`);
		this.logger.info(`🔥 URI scheme: ${uri.scheme}`);
		this.logger.info(`🔥 URI authority: ${uri.authority}`);
		this.logger.info(`🔥 URI path: ${uri.path}`);
		this.logger.info(`🔥 URI query: ${uri.query}`);

		try {
			// Handle authentication callback
			this.logger.info('🔥 About to call authManager.handleAuthCallback...');
			await this.authManager.handleAuthCallback(uri);
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
	logger.info('Firebase Service extension is activating...');

	try {
		// Initialize Firebase App Manager
		firebaseAppManager = new FirebaseAppManager(logger);

		// Initialize new AuthManager for external OAuth flow
		authManager = new AuthManager(context, logger);

		// Initialize legacy AuthService for backward compatibility
		authService = new AuthService(logger);

		// Initialize other services
		analyticsService = new AnalyticsService(firebaseAppManager, logger);
		firestoreService = new FirestoreService(firebaseAppManager, logger);

		// Register URI handler for authentication callbacks
		const uriHandler = new FirebaseServiceUriHandler(authManager, logger);
		context.subscriptions.push(vscode.window.registerUriHandler(uriHandler));

		// Initialize Tree View Provider
		treeDataProvider = new FirebaseTreeDataProvider(authManager);
		const treeView = vscode.window.createTreeView('firebaseServiceExplorer', {
			treeDataProvider: treeDataProvider,
			showCollapseAll: true
		});
		context.subscriptions.push(treeView);

		// Initialize Status Bar Manager
		statusBarManager = new FirebaseStatusBarManager(authManager, logger);
		context.subscriptions.push(statusBarManager);

		// Set context for menu visibility
		vscode.commands.executeCommand('setContext', 'firebase-service.authenticated', false);

		// Listen to auth state changes to update context
		authManager.onDidChangeAuthState(async (isAuthenticated) => {
			vscode.commands.executeCommand('setContext', 'firebase-service.authenticated', isAuthenticated);
			treeDataProvider.refresh();
			statusBarManager.refresh();
		});

		// Register commands
		registerCommands(context);

		logger.info('Firebase Service extension activated successfully');
	} catch (error) {
		logger.error('Failed to activate Firebase Service extension', error);
		vscode.window.showErrorMessage(`Firebase Service: Activation failed - ${error}`);
	}
}

export function deactivate() {
	logger?.info('Firebase Service extension is deactivating...');

	authService?.dispose();
	analyticsService?.dispose();
	firestoreService?.dispose();
	firebaseAppManager?.dispose();
	statusBarManager?.dispose();
	// authManager and treeDataProvider don't need explicit disposal
}

function registerCommands(context: vscode.ExtensionContext) {
	const commands = [
		vscode.commands.registerCommand('firebase-service.initialize', async () => {
			try {
				await initializeServices();
				vscode.window.showInformationMessage('Firebase Service initialized successfully');
			} catch (error) {
				logger.error('Failed to initialize Firebase Service', error);
				vscode.window.showErrorMessage(`Firebase Service initialization failed: ${error}`);
			}
		}),

		// Interactive database commands
		vscode.commands.registerCommand('firebase-service.storeDataInteractive', async () => {
			try {
				if (!firestoreService) {
					throw new Error('Firestore service not initialized');
				}

				// Check if user is authenticated
				const session = await authManager.getCurrentUser();
				if (!session) {
					const signIn = await vscode.window.showWarningMessage(
						'You need to sign in to store data',
						'Sign In'
					);
					if (signIn === 'Sign In') {
						await vscode.commands.executeCommand('firebase-service.signIn');
					}
					return;
				}

				// Prompt for collection name
				const collection = await vscode.window.showInputBox({
					prompt: 'Enter collection name',
					placeHolder: 'users',
					validateInput: (value) => {
						return value.trim() ? null : 'Collection name cannot be empty';
					}
				});

				if (!collection) {
					return;
				}

				// Prompt for document ID
				const documentId = await vscode.window.showInputBox({
					prompt: 'Enter document ID (leave empty for auto-generated)',
					placeHolder: 'user123 or leave empty'
				});

				// Prompt for data (JSON format)
				const dataInput = await vscode.window.showInputBox({
					prompt: 'Enter data as JSON',
					placeHolder: '{\"name\": \"John Doe\", \"email\": \"john@example.com\"}',
					validateInput: (value) => {
						try {
							JSON.parse(value);
							return null;
						} catch {
							return 'Invalid JSON format';
						}
					}
				});

				if (!dataInput) {
					return;
				}

				const data = JSON.parse(dataInput);

				// Add user info to the data
				data._storedBy = session.user.email || session.user.uid;
				data._storedAt = new Date().toISOString();

				// Store the data
				const docId = documentId || Date.now().toString();
				await firestoreService.storeData(collection, docId, data);

				vscode.window.showInformationMessage(
					`Data stored successfully in ${collection}/${docId}`
				);

				// Log analytics event
				if (analyticsService) {
					await analyticsService.logEvent({
						category: 'interaction',
						action: 'command_executed',
						label: 'data_stored',
						metadata: {
							collection,
							documentId: docId,
							user: session.user.email || session.user.uid
						}
					});
				}
			} catch (error) {
				logger.error('Failed to store data interactively', error);
				vscode.window.showErrorMessage(`Failed to store data: ${error}`);
			}
		}),

		vscode.commands.registerCommand('firebase-service.retrieveDataInteractive', async () => {
			try {
				if (!firestoreService) {
					throw new Error('Firestore service not initialized');
				}

				// Check if user is authenticated
				const session = await authManager.getCurrentUser();
				if (!session) {
					const signIn = await vscode.window.showWarningMessage(
						'You need to sign in to retrieve data',
						'Sign In'
					);
					if (signIn === 'Sign In') {
						await vscode.commands.executeCommand('firebase-service.signIn');
					}
					return;
				}

				// Prompt for collection name
				const collection = await vscode.window.showInputBox({
					prompt: 'Enter collection name',
					placeHolder: 'users',
					validateInput: (value) => {
						return value.trim() ? null : 'Collection name cannot be empty';
					}
				});

				if (!collection) {
					return;
				}

				// Prompt for document ID
				const documentId = await vscode.window.showInputBox({
					prompt: 'Enter document ID',
					placeHolder: 'user123',
					validateInput: (value) => {
						return value.trim() ? null : 'Document ID cannot be empty';
					}
				});

				if (!documentId) {
					return;
				}

				// Retrieve the data
				const data = await firestoreService.retrieveData(collection, documentId);

				if (data) {
					// Show the data in a new document
					const doc = await vscode.workspace.openTextDocument({
						content: JSON.stringify(data, null, 2),
						language: 'json'
					});
					await vscode.window.showTextDocument(doc);

					vscode.window.showInformationMessage(
						`Data retrieved from ${collection}/${documentId}`
					);

					// Log analytics event
					if (analyticsService) {
						await analyticsService.logEvent({
							category: 'interaction',
							action: 'command_executed',
							label: 'data_retrieved',
							metadata: {
								collection,
								documentId,
								user: session.user.email || session.user.uid
							}
						});
					}
				} else {
					vscode.window.showWarningMessage(
						`No data found at ${collection}/${documentId}`
					);
				}
			} catch (error) {
				logger.error('Failed to retrieve data interactively', error);
				vscode.window.showErrorMessage(`Failed to retrieve data: ${error}`);
			}
		}),

		vscode.commands.registerCommand('firebase-service.signIn', async () => {
			try {
				if (!authManager) {
					throw new Error('Auth manager not initialized');
				}

				const provider = await vscode.window.showQuickPick(
					['Google', 'GitHub', 'Email'],
					{ placeHolder: 'Select sign-in method' }
				);

				if (!provider) {
					return; // User cancelled
				}

				// Use AuthManager for external OAuth flow
				await authManager.signIn(provider.toLowerCase());

			} catch (error) {
				logger.error('Sign in command failed', error);
				vscode.window.showErrorMessage(`Sign in failed: ${error}`);
			}
		}),

		vscode.commands.registerCommand('firebase-service.signOut', async () => {
			try {
				if (!authManager) {
					throw new Error('Auth manager not initialized');
				}

				await authManager.signOut();
			} catch (error) {
				logger.error('Sign out command failed', error);
				vscode.window.showErrorMessage(`Sign out failed: ${error}`);
			}
		}),

		vscode.commands.registerCommand('firebase-service.getUser', async () => {
			try {
				if (!authManager) {
					throw new Error('Auth manager not initialized');
				}

				const session = await authManager.getCurrentUser();

				if (session) {
					const user = session.user;
					const userInfo = `User: ${user.displayName || user.email || user.uid}\nEmail: ${user.email}\nUID: ${user.uid}\nVerified: ${user.emailVerified}`;
					vscode.window.showInformationMessage(userInfo);
					return user;
				} else {
					vscode.window.showInformationMessage('No user signed in');
					return null;
				}
			} catch (error) {
				logger.error('Get user command failed', error as Error);
				vscode.window.showErrorMessage(`Failed to get user: ${(error as Error).message}`);
				return null;
			}
		}),

		vscode.commands.registerCommand('firebase-service.logEvent', async (eventData: any) => {
			try {
				if (!analyticsService) {
					throw new Error('Analytics service not initialized');
				}
				await analyticsService.logEvent(eventData);
			} catch (error) {
				logger.error('Failed to log event', error);
				throw error;
			}
		}),

		vscode.commands.registerCommand('firebase-service.setUserProperty', async (name: string, value: any) => {
			try {
				if (!analyticsService) {
					throw new Error('Analytics service not initialized');
				}
				await analyticsService.setUserProperty(name, value);
			} catch (error) {
				logger.error('Failed to set user property', error);
				throw error;
			}
		}),

		vscode.commands.registerCommand('firebase-service.logProcessEvent', async (action: string, metadata?: any) => {
			try {
				if (!analyticsService) {
					throw new Error('Analytics service not initialized');
				}
				await analyticsService.logProcessEvent(action, metadata);
			} catch (error) {
				logger.error('Failed to log process event', error);
				throw error;
			}
		}),

		vscode.commands.registerCommand('firebase-service.logInteractionEvent', async (action: string, metadata?: any) => {
			try {
				if (!analyticsService) {
					throw new Error('Analytics service not initialized');
				}
				await analyticsService.logInteractionEvent(action, metadata);
			} catch (error) {
				logger.error('Failed to log interaction event', error);
				throw error;
			}
		}),

		vscode.commands.registerCommand('firebase-service.logPerformanceEvent', async (metric: string, value: number, metadata?: any) => {
			try {
				if (!analyticsService) {
					throw new Error('Analytics service not initialized');
				}
				await analyticsService.logPerformanceEvent(metric, value, metadata);
			} catch (error) {
				logger.error('Failed to log performance event', error);
				throw error;
			}
		}),

		vscode.commands.registerCommand('firebase-service.storeData', async (collection: string, documentId: string, data: any) => {
			try {
				if (!firestoreService) {
					throw new Error('Firestore service not initialized');
				}
				await firestoreService.storeData(collection, documentId, data);
			} catch (error) {
				logger.error('Failed to store data', error);
				throw error;
			}
		}),

		vscode.commands.registerCommand('firebase-service.retrieveData', async (collection: string, documentId: string) => {
			try {
				if (!firestoreService) {
					throw new Error('Firestore service not initialized');
				}
				return await firestoreService.retrieveData(collection, documentId);
			} catch (error) {
				logger.error('Failed to retrieve data', error);
				throw error;
			}
		}),

		vscode.commands.registerCommand('firebase-service.getAnalyticsStatus', async () => {
			try {
				if (!analyticsService) {
					return { initialized: false };
				}
				return await analyticsService.getStatus();
			} catch (error) {
				logger.error('Failed to get analytics status', error as Error);
				return { initialized: false, error: (error as Error).message };
			}
		}),

		// New AuthManager commands
		vscode.commands.registerCommand('firebase-service.showAuthStatus', async () => {
			try {
				if (!authManager) {
					throw new Error('Auth manager not initialized');
				}
				await authManager.showAuthStatus();
			} catch (error) {
				logger.error('Show auth status command failed', error);
				vscode.window.showErrorMessage(`Failed to show auth status: ${error}`);
			}
		}),

		vscode.commands.registerCommand('firebase-service.refreshSession', async () => {
			try {
				if (!authManager) {
					throw new Error('Auth manager not initialized');
				}
				await authManager.refreshSession();
			} catch (error) {
				logger.error('Refresh session command failed', error);
				vscode.window.showErrorMessage(`Failed to refresh session: ${error}`);
			}
		}),

		vscode.commands.registerCommand('firebase-service.testAuthFlow', async () => {
			try {
				if (!authManager) {
					throw new Error('Auth manager not initialized');
				}
				await authManager.testAuthFlow();
			} catch (error) {
				logger.error('Test auth flow command failed', error);
				vscode.window.showErrorMessage(`Failed to test auth flow: ${error}`);
			}
		})
	];

	context.subscriptions.push(...commands);
}

async function initializeServices(): Promise<void> {
	const config = vscode.workspace.getConfiguration('firebase-service');

	// Check privacy consent
	const hasConsent = config.get<boolean>('privacyConsent', false);
	if (!hasConsent) {
		const consent = await vscode.window.showInformationMessage(
			'Firebase Service requires user consent for data collection. Do you consent to analytics and data storage?',
			'Yes',
			'No'
		);

		if (consent === 'Yes') {
			await config.update('privacyConsent', true, vscode.ConfigurationTarget.Global);
		} else {
			throw new Error('User consent required for Firebase services');
		}
	}

	// Initialize Firebase App
	await firebaseAppManager.initialize();

	// Set up Auth service with Firebase app
	const { getAuth } = await import('@firebase/auth');
	const auth = getAuth(firebaseAppManager.getApp());
	authService.setAuth(auth);

	// Initialize Auth service
	await authService.initialize();

	// Initialize Analytics if enabled
	const enableAnalytics = config.get<boolean>('enableAnalytics', true);
	if (enableAnalytics) {
		await analyticsService.initialize();
	}

	// Initialize Firestore if enabled
	const enableDataStorage = config.get<boolean>('enableDataStorage', true);
	if (enableDataStorage) {
		await firestoreService.initialize();
	}
}

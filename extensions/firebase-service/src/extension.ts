import * as path from 'path';
import { config } from 'dotenv';
import * as vscode from 'vscode';
import { FirestoreService } from './firestore/firestoreService';
import { AuthService } from './auth/authService';
import { AuthManager } from './auth/authManager';
import { Logger } from './utils/logger';
import { FirebaseAppManager } from './utils/firebaseAppManager';
import { FirebaseTreeDataProvider } from './views/firebaseTreeDataProvider';
import { FirebaseStatusBarManager } from './views/statusBarManager';
import { FirebaseServiceAPI } from './api';
import { SiidCodeHelper } from './utils/siidCodeHelper';

let firestoreService: FirestoreService;
let authService: AuthService;
let authManager: AuthManager;
let logger: Logger;
let firebaseAppManager: FirebaseAppManager;
let treeDataProvider: FirebaseTreeDataProvider;
let statusBarManager: FirebaseStatusBarManager;
let siidCodeHelper: SiidCodeHelper;
let api: FirebaseServiceAPI;

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

export async function activate(context: vscode.ExtensionContext): Promise<any> {
	// Load environment variables from .env file
	const envPath = path.join(context.extensionPath, '.env');
	config({ path: envPath });

	logger = new Logger();
	logger.info('Firebase Service extension is activating...');
	console.log('🔥 Firebase Service extension activate called');

	// Initialize Firebase App Manager
	firebaseAppManager = new FirebaseAppManager(logger);

	// Initialize new AuthManager for external OAuth flow
	authManager = new AuthManager(context, logger);

	// Create API instance
	api = new FirebaseServiceAPI(authManager);

	// Initialize siid-code helper
	logger.info('About to initialize SiidCodeHelper');
	siidCodeHelper = SiidCodeHelper.getInstance();
	await siidCodeHelper.initialize(authManager, logger);
	logger.info('SiidCodeHelper initialized successfully');

	// Initialize legacy AuthService for backward compatibility
	authService = new AuthService(logger);

	// Initialize Firestore service
	firestoreService = new FirestoreService(firebaseAppManager, logger);

	// Register URI handler for authentication callbacks
	const uriHandler = new FirebaseServiceUriHandler(authManager, logger);
	context.subscriptions.push(vscode.window.registerUriHandler(uriHandler));

	// Initialize Tree View Provider
	treeDataProvider = new FirebaseTreeDataProvider(authManager, firestoreService);
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

		// Store user data when authenticated
		if (isAuthenticated) {
			try {
				const session = await authManager.getCurrentUser();
				if (session && firestoreService) {
					// Ensure Firebase App is initialized first
					if (!firebaseAppManager.isInitialized()) {
						try {
							await firebaseAppManager.initialize();
							logger.info('Firebase App initialized for data storage');
						} catch (appInitError) {
							logger.error('Failed to initialize Firebase App', appInitError);
							return; // Skip if Firebase App can't be initialized
						}
					}

					// Ensure Firestore is initialized before storing user data
					if (!firestoreService.getInitializationStatus()) {
						const config = vscode.workspace.getConfiguration('firebase-service');
						const enableDataStorage = config.get<boolean>('enableDataStorage', true);
						if (enableDataStorage) {
							try {
								await firestoreService.initialize();
								logger.info('Firestore initialized for user data storage');
							} catch (initError) {
								logger.error('Failed to initialize Firestore', initError);
								return; // Skip user data storage if initialization fails
							}
						} else {
							logger.info('Firestore data storage is disabled in settings');
							return;
						}
					}

					// Store user data
					await firestoreService.storeUserData({
						uid: session.user.uid,
						email: session.user.email,
						displayName: session.user.displayName,
						photoURL: session.user.photoURL,
						emailVerified: session.user.emailVerified,
						provider: session.user.providerId
					});
					logger.info('User data stored in Firestore');
				}
			} catch (error) {
				logger.error('Failed to store user data on authentication', error);
			}
		}
	});

	// Register commands
	registerCommands(context);

	// Auto-initialize services on extension activation
	try {
		await initializeServices();
		logger.info('Firebase services auto-initialized successfully');
	} catch (error) {
		logger.warn('Auto-initialization failed, services can be initialized manually', error);
		// Don't throw error - allow extension to continue working
	}

	// Export API for other extensions
	const firebaseAPI = {
		login: async (email: string, password: string) => {
			try {
				const result = await authService.signIn({ provider: 'email', email, password });
				return result;
			} catch (error) {
				return { success: false, error: (error as Error).message };
			}
		},
		logout: async () => {
			try {
				await authService.signOut();
			} catch (error) {
				logger.error('Logout failed', error);
			}
		},
		getCurrentUser: async () => {
			try {
				return await authManager.getCurrentUser();
			} catch (error) {
				return null;
			}
		},
		isAuthenticated: async () => {
			try {
				return await authManager.isAuthenticated();
			} catch (error) {
				logger.error('Failed to check authentication', error);
				return false;
			}
		},
		onAuthStateChanged: authManager.onDidChangeAuthState,
		storeData: async (collection: string, docId: string, data: any) => {
			try {
				await firestoreService.storeData(collection, docId, data);
				return { success: true };
			} catch (error) {
				return { success: false, error: (error as Error).message };
			}
		},
		getData: async (collection: string, docId: string) => {
			try {
				return await firestoreService.retrieveData(collection, docId);
			} catch (error) {
				return { error: (error as Error).message };
			}
		}
	};

	// Note: Removed module.exports as VS Code uses the return value of activate for extension exports

	logger.info('Firebase Service extension activated successfully');

	console.log('🔥 Firebase Service extension activated, returning { firebaseAPI }:');
	return { firebaseAPI };
}

export function deactivate() {
	logger?.info('Firebase Service extension is deactivating...');

	authService?.dispose();
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
		}),

		// API Commands for other extensions
		vscode.commands.registerCommand('firebase-service.api.getUserDetails', async () => {
			try {
				const session = await authManager.getCurrentUser();
				if (!session) {
					return {
						authenticated: false,
						user: null
					};
				}

				// Try to get detailed user data from Firestore
				let userData = null;
				if (firestoreService) {
					try {
						userData = await firestoreService.getUserData(session.user.uid);
					} catch (error) {
						logger.warn('Could not retrieve user data from Firestore', error);
					}
				}

				return {
					authenticated: true,
					user: {
						uid: session.user.uid,
						email: session.user.email,
						displayName: session.user.displayName,
						photoURL: session.user.photoURL,
						emailVerified: session.user.emailVerified,
						provider: session.user.providerId,
						// Include Firestore data if available
						...(userData || {})
					}
				};
			} catch (error) {
				logger.error('Failed to get user details', error);
				return {
					authenticated: false,
					user: null,
					error: (error as Error).message
				};
			}
		}),

		vscode.commands.registerCommand('firebase-service.api.isAuthenticated', async () => {
			try {
				return await authManager.isAuthenticated();
			} catch (error) {
				logger.error('Failed to check authentication', error);
				return false;
			}
		}),

		vscode.commands.registerCommand('firebase-service.api.getUserId', async () => {
			try {
				const session = await authManager.getCurrentUser();
				return session?.user.uid || null;
			} catch (error) {
				logger.error('Failed to get user ID', error);
				return null;
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

	// Initialize Firestore if enabled
	const enableDataStorage = config.get<boolean>('enableDataStorage', true);
	if (enableDataStorage) {
		await firestoreService.initialize();
	}

	logger.info('Firebase Service extension activated successfully');

	return;
}

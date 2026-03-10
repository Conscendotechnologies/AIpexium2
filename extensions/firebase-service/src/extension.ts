import * as path from 'path';
import { config } from 'dotenv';
import * as vscode from 'vscode';
import { FirestoreService } from './firestore/firestoreService';
import { AuthManager } from './auth/authManager';
import { Logger } from './utils/logger';
import { FirebaseAppManager } from './utils/firebaseAppManager';
import { FirebaseTreeDataProvider } from './views/firebaseTreeDataProvider';
import { FirebaseStatusBarManager } from './views/statusBarManager';
import { FirebaseServiceAPI } from './api';
import { SiidCodeHelper } from './utils/siidCodeHelper';
import { runFirebaseAPITests } from './test/apiTest';
import { quickAPITest, testSpecificMethod } from './test/simpleTest';
import { PrivacyConsentView } from './views/privacyConsentView';
import { InitialConsentPopup } from './views/initialConsentPopup';
import { SessionStatusView } from './views/sessionStatusView';
import { ExtensionLockManager } from './utils/extensionLockManager';
import { HackathonUtils } from './utils/hackathonUtils';

let firestoreService: FirestoreService;
let authManager: AuthManager;
let logger: Logger;
let firebaseAppManager: FirebaseAppManager;
let treeDataProvider: FirebaseTreeDataProvider;
let statusBarManager: FirebaseStatusBarManager;
let siidCodeHelper: SiidCodeHelper;
let api: FirebaseServiceAPI;
let lockManager: ExtensionLockManager;
let sessionStatusView: SessionStatusView;
let isExtensionLocked: boolean = false;
let dailyCheckInterval: NodeJS.Timer | undefined;
let hasAutoLoggedOut: boolean = false; // Track if we've already auto-logged out

// Export function to allow external components to trigger lock status check
export let externalCheckAndUpdateLockStatus: (() => Promise<void>) | undefined;

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
	logger.info('🔥 Firebase Service extension activate called');


	// Initialize Firebase App Manager
	firebaseAppManager = new FirebaseAppManager(logger);

	// Initialize new AuthManager for external OAuth flow
	authManager = new AuthManager(context, logger);

	// Initialize Firestore service
	firestoreService = new FirestoreService(firebaseAppManager, authManager, logger);

	// Set FirestoreService in FirebaseManager (so it can fetch user data during auth)
	authManager.getFirebaseManager().setFirestoreService(firestoreService);

	// Create API instance
	api = new FirebaseServiceAPI(authManager, firestoreService);

	// Initialize Extension Lock Manager
	lockManager = new ExtensionLockManager(logger);

	// Set the lock check callback in API so getAdminApiKey() can trigger lock status updates
	// This is CRITICAL: ensures lock is checked and UI updated when hackDate is retrieved
	logger.info('🔍 [DEBUG] Setting lock check callback in API...');
	api.setLockCheckCallback(async () => {
		logger.info('🔍 [DEBUG] Lock check callback triggered from getAdminApiKey()');
		await checkAndUpdateLockStatus();
	});
	logger.info('🔍 [DEBUG] Lock check callback set successfully');

	// Register lock testing commands EARLY (before lock check)
	// This ensures users can always access test commands, even when locked

	// ============= Initialize SiidCodeHelper FIRST before any lock checks =============
	// This ensures siid-code extension is loaded before we try to lock it

	// Initialize siid-code helper EARLY before any lock checks
	// This prevents race conditions where auth state changes before siid-code is ready
	logger.info('About to initialize SiidCodeHelper');
	siidCodeHelper = SiidCodeHelper.getInstance();
	try {
		await siidCodeHelper.initialize(authManager, logger);
		logger.info('SiidCodeHelper initialized successfully');
	} catch (error) {
		logger.error('Failed to initialize SiidCodeHelper, but extension will continue', error);
	}

	// NOW check extension lock status AFTER siidCodeHelper is initialized
	logger.info('🔍 [DEBUG] Checking extension lock status now that SiidCodeHelper is initialized...');
	try {
		const storage = authManager.getFirebaseManager().getStorage();
		const storedHackDate = await storage.getHackDate();

		if (lockManager.shouldLockExtension(storedHackDate)) {
			isExtensionLocked = true;
			vscode.commands.executeCommand('setContext', 'firebase-service.extension-locked', true);
			logger.info('🔒 [DEBUG] Extension is LOCKED - locking siid-code screen');
			logger.info('🔒 [DEBUG] Lock status message: ' + lockManager.getLockStatusMessage(storedHackDate));
		} else {
			logger.info('✅ [DEBUG] Extension NOT locked');
			vscode.commands.executeCommand('setContext', 'firebase-service.extension-locked', false);
		}
	} catch (error) {
		logger.error('❌ [DEBUG] Error checking extension lock status', error);
	}
	logger.info('========== LOCK CHECK COMPLETE: EXTENSION ACTIVE ==========');

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

	// Initialize Session Status View (Webview)
	sessionStatusView = new SessionStatusView(context.extensionUri);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			SessionStatusView.viewType,
			sessionStatusView
		)
	);

	// Update session status based on lock state
	if (isExtensionLocked) {
		sessionStatusView.setLocked(true);
	}

	// Listen to lock state changes from session status view
	sessionStatusView.onDidChangeLockState((locked) => {
		logger.info(`🔒 [DEBUG] Lock state changed: ${locked}`);
		vscode.commands.executeCommand('setContext', 'firebase-service.extension-locked', locked);
		if (treeDataProvider) {
			treeDataProvider.refresh();
		}
	});

	// Start daily check for extension lock status
	startDailyLockCheck(context);

	// Initialize Status Bar Manager
	statusBarManager = new FirebaseStatusBarManager(authManager, logger);
	context.subscriptions.push(statusBarManager);

	// Restore authentication state from stored session (if exists)
	const hasExistingSession = await authManager.isAuthenticated();
	if (hasExistingSession) {
		logger.info('Restoring authentication state from stored session');
		vscode.commands.executeCommand('setContext', 'firebase-service.authenticated', true);
		treeDataProvider.refresh();
		statusBarManager.refresh();

		const currentUser = await authManager.getCurrentUser();
		if (currentUser) {
			logger.info(`Restored session for user: ${currentUser.user?.email || currentUser.uid}`);
		}
	} else {
		// No existing session - set to not authenticated
		vscode.commands.executeCommand('setContext', 'firebase-service.authenticated', false);
	}

	// Listen to auth state changes to update context
	authManager.onDidChangeAuthState(async (isAuthenticated) => {
		vscode.commands.executeCommand('setContext', 'firebase-service.authenticated', isAuthenticated);
		treeDataProvider.refresh();
		statusBarManager.refresh();
	});

	// Register commands
	registerCommands(context);

	// Auto-initialize services on extension activation
	try {
		initializeServices(context);
		logger.info('Firebase services auto-initialized successfully');
	} catch (error) {
		logger.warn('Auto-initialization failed, services can be initialized manually', error);
		// Don't throw error - allow extension to continue working
	}

	logger.info('Firebase Service extension activated successfully');

	// Export API for other extensions
	// Create a plain object with all API methods bound to maintain 'this' context
	const apiExport = {
		// Authentication methods
		onAuthStateChanged: api.onAuthStateChanged,
		signIn: api.signIn.bind(api),
		signOut: api.signOut.bind(api),
		autoLogout: api.autoLogout.bind(api),
		getCurrentUser: api.getCurrentUser.bind(api),
		isAuthenticated: api.isAuthenticated.bind(api),
		showAuthStatus: api.showAuthStatus.bind(api),
		refreshSession: api.refreshSession.bind(api),
		getFirebaseManager: api.getFirebaseManager.bind(api),
		getAuthPageUrl: api.getAuthPageUrl.bind(api),

		// Firestore methods
		storeData: api.storeData.bind(api),
		getData: api.getData.bind(api),
		getUserProperties: api.getUserProperties.bind(api),
		getAdminApiKey: api.getAdminApiKey.bind(api),
		getStoredHackDate: api.getStoredHackDate.bind(api),
		updateUserProperties: api.updateUserProperties.bind(api),
		getBugReportConfig: api.getBugReportConfig.bind(api),

		// Lock management
		checkAndUpdateLockStatus: async () => {
			if (externalCheckAndUpdateLockStatus) {
				await externalCheckAndUpdateLockStatus();
			}
		},
	};

	return apiExport;
}

export function deactivate() {
	logger?.info('Firebase Service extension is deactivating...');

	// Clear daily check interval
	if (dailyCheckInterval) {
		clearInterval(dailyCheckInterval);
	}

	firestoreService?.dispose();
	firebaseAppManager?.dispose();
	statusBarManager?.dispose();
	// authManager and treeDataProvider don't need explicit disposal
}

function registerCommands(context: vscode.ExtensionContext) {
	const commands = [
		vscode.commands.registerCommand('firebase-service.initialize', async () => {
			try {
				await initializeServices(context);
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
				data._storedBy = session.user?.email || session.uid;
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

				const storage = authManager.getFirebaseManager().getStorage();
				const storedHackDate = await storage.getHackDate();
				const shouldLockExtension = lockManager.shouldLockExtension(storedHackDate);
				if (shouldLockExtension) {
					vscode.window.showErrorMessage('Sign in is disabled because the hackathon has ended. Thank you for participating!');
					sessionStatusView.setLocked(shouldLockExtension);
					return;
				}


				// Check privacy consent before sign in
				const config = vscode.workspace.getConfiguration('firebase-service');
				const hasConsent = config.get<boolean>('privacyConsent', false);

				if (!hasConsent) {
					const action = await vscode.window.showErrorMessage(
						'Privacy consent is required to use Firebase authentication.',
						'Review Privacy Consent',
						'Cancel'
					);

					if (action === 'Review Privacy Consent') {
						await vscode.commands.executeCommand('firebase-service.reviewPrivacyConsent');
					}
					return;
				}

				// Hackathon: Direct Microsoft login, no provider selection
				// Use AuthManager for external OAuth flow with Microsoft as default
				await authManager.signIn('microsoft');

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
					const userInfo = session.user
						? `User: ${session.user.displayName || session.user.email || session.uid}\nEmail: ${session.user.email || 'N/A'}\nUID: ${session.uid}\nProvider: ${session.user.provider || 'N/A'}`
						: `UID: ${session.uid}`;
					vscode.window.showInformationMessage(userInfo);
					return session.user || { uid: session.uid };
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
						userData = await firestoreService.getUserData();
					} catch (error) {
						logger.warn('Could not retrieve user data from Firestore', error);
					}
				}

				return {
					authenticated: true,
					user: session.user ? {
						uid: session.uid,
						email: session.user.email,
						displayName: session.user.displayName,
						photoURL: session.user.photoURL,
						provider: session.user.provider,
						// Include Firestore data if available
						...(userData || {})
					} : {
						uid: session.uid,
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
				return session?.uid || null;
			} catch (error) {
				logger.error('Failed to get user ID', error);
				return null;
			}
		}),

		// Test Commands
		vscode.commands.registerCommand('firebase-service.runAPITests', async () => {
			try {
				if (!authManager || !firestoreService) {
					throw new Error('Firebase services not initialized');
				}
				await runFirebaseAPITests(authManager, firestoreService);
			} catch (error) {
				logger.error('Failed to run API tests', error);
				vscode.window.showErrorMessage(`Failed to run API tests: ${error}`);
			}
		}),

		vscode.commands.registerCommand('firebase-service.quickTest', async () => {
			try {
				await quickAPITest();
			} catch (error) {
				logger.error('Failed to run quick test', error);
				vscode.window.showErrorMessage(`Failed to run quick test: ${error}`);
			}
		}),

		vscode.commands.registerCommand('firebase-service.testMethod', async () => {
			try {
				const method = await vscode.window.showQuickPick([
					'isAuthenticated',
					'getCurrentUser',
					'getUserProperties',
					'getAdminApiKey',
					'getAuthPageUrl',
					'getFirebaseManager'
				], {
					placeHolder: 'Select method to test'
				});

				if (method) {
					await testSpecificMethod(method);
				}
			} catch (error) {
				logger.error('Failed to test specific method', error);
				vscode.window.showErrorMessage(`Failed to test method: ${error}`);
			}
		}),

		// Internal command to get API for other parts of the workbench
		vscode.commands.registerCommand('firebase-service.getAPI', () => {
			return api;
		}),

		// Privacy Consent Management
		vscode.commands.registerCommand('firebase-service.reviewPrivacyConsent', async () => {
			try {
				const config = vscode.workspace.getConfiguration('firebase-service');
				const currentConsent = config.get<boolean>('privacyConsent', false);
				const dontAskAgain = context.globalState.get<boolean>('firebase-service.privacyConsentDontAsk', false);

				if (currentConsent) {
					// User has already consented, ask if they want to revoke
					const action = await vscode.window.showWarningMessage(
						'You have currently consented to data collection. Would you like to revoke your consent?',
						{ modal: true },
						'Revoke Consent',
						'Keep Consent'
					);

					if (action === 'Revoke Consent') {
						await config.update('privacyConsent', false, vscode.ConfigurationTarget.Global);
						vscode.window.showWarningMessage('Consent revoked. Firebase Service features will be disabled. Please reload the window for changes to take effect.');
					}
				} else if (dontAskAgain) {
					// User previously chose "Don't Ask Again", give them option to reset
					const action = await vscode.window.showInformationMessage(
						'You previously chose "Don\'t Ask Again" for consent. Would you like to review consent options?',
						{ modal: true },
						'Review Consent',
						'Cancel'
					);

					if (action === 'Review Consent') {
						// Reset "Don't Ask Again" flag from globalState and show consent view
						await context.globalState.update('firebase-service.privacyConsentDontAsk', false);
						logger.info('Reset "Don\'t Ask Again" flag from globalState');
						const consentView = new PrivacyConsentView(context.extensionPath);
						const response = await consentView.show();

						if (response.consented) {
							await config.update('privacyConsent', true, vscode.ConfigurationTarget.Global);
							vscode.window.showInformationMessage('Thank you! Firebase Service has been enabled. Please reload the window for changes to take effect.');
						} else if (response.dontAskAgain) {
							await context.globalState.update('firebase-service.privacyConsentDontAsk', true);
							logger.info('User chose "Don\'t Ask Again" again - stored in globalState');
							vscode.window.showInformationMessage('You chose not to consent again.');
						}
					}
				} else {
					// User hasn't consented yet, show the consent view
					const consentView = new PrivacyConsentView(context.extensionPath);
					const response = await consentView.show();

					if (response.consented) {
						await config.update('privacyConsent', true, vscode.ConfigurationTarget.Global);
						vscode.window.showInformationMessage('Thank you! Firebase Service has been enabled. Please reload the window for changes to take effect.');
					} else if (response.dontAskAgain) {
						await context.globalState.update('firebase-service.privacyConsentDontAsk', true);
						logger.info('User chose "Don\'t Ask Again" - stored in globalState');
						vscode.window.showInformationMessage('You chose not to consent. The consent prompt will not appear again.');
					}
				}
			} catch (error) {
				logger.error('Failed to review privacy consent', error);
				vscode.window.showErrorMessage(`Failed to review privacy consent: ${error}`);
			}
		})
	];

	context.subscriptions.push(...commands);
}

async function initializeServices(context: vscode.ExtensionContext): Promise<void> {
	const config = vscode.workspace.getConfiguration('firebase-service');

	// Check privacy consent from settings
	const hasConsent = config.get<boolean>('privacyConsent', false);

	// Check "Don't Ask Again" from global state (IDE storage)
	const dontAskAgain = context.globalState.get<boolean>('firebase-service.privacyConsentDontAsk', false);

	// If user chose "Don't Ask Again", skip the consent flow completely
	if (dontAskAgain) {
		logger.info('User chose "Don\'t Ask Again" for privacy consent. Skipping consent flow.');
		throw new Error('User declined consent - Don\'t Ask Again');
	}

	if (!hasConsent) {
		// Step 1: Show custom initial consent popup (cannot be cancelled)
		const initialPopup = new InitialConsentPopup(context.extensionPath);
		const quickResponse = await initialPopup.show();

		if (quickResponse === 'yes') {
			// User consented immediately
			await config.update('privacyConsent', true, vscode.ConfigurationTarget.Global);
			vscode.window.showInformationMessage('Thank you! Firebase Service has been enabled.');
		} else {
			// Step 2: User said No, show detailed webview with full information
			const consentView = new PrivacyConsentView(context.extensionPath);
			const response = await consentView.show();

			if (response.consented) {
				await config.update('privacyConsent', true, vscode.ConfigurationTarget.Global);
				vscode.window.showInformationMessage('Thank you! Firebase Service has been enabled.');
			} else if (response.dontAskAgain) {
				// User chose "Don't Ask Again" - store in globalState (IDE storage)
				await context.globalState.update('firebase-service.privacyConsentDontAsk', true);
				logger.info('User clicked "Don\'t Ask Again" - stored in globalState');
				vscode.window.showInformationMessage(
					'You chose not to consent. The Firebase Service will not ask for consent again. You can enable it anytime from Settings > Extensions > Firebase Service > Privacy Consent.'
				);
				throw new Error('User consent declined - Don\'t Ask Again');
			} else {
				// User closed the panel without action
				vscode.window.showWarningMessage(
					'Firebase Service features are disabled. You can enable them later by running "FBS: Review Privacy Consent" or in Settings > Firebase Service > Privacy Consent.'
				);
				throw new Error('User consent required for Firebase services');
			}
		}
	}

	// Initialize Firebase App
	await firebaseAppManager.initialize();

	// Initialize Firestore if enabled
	const enableDataStorage = config.get<boolean>('enableDataStorage', true);
	if (enableDataStorage) {
		await firestoreService.initialize();
	}

	logger.info('Firebase Service extension activated successfully');

	return;
}

/**
 * Check extension lock status and update UI if changed
 * This function is called daily to ensure users cannot access expired extensions
 */
async function checkAndUpdateLockStatus(): Promise<void> {
	try {

		if (!authManager || !lockManager || !sessionStatusView) {
			return;
		}

		const storage = authManager.getFirebaseManager().getStorage();
		const storedHackDate = await storage.getHackDate();

		// 🎯 NEW: Check if hackathon has ended using HackathonUtils
		const hackathonHasEnded = HackathonUtils.isHackathonEnded(storedHackDate);

		// 🎯 NEW: Auto-logout if hackathon ended and user is still logged in
		if (hackathonHasEnded && !hasAutoLoggedOut) {
			const isAuth = await authManager.isAuthenticated();
			if (isAuth) {
				logger.info('🎯 [AUTO-LOGOUT] Hackathon ended - Auto-logging out user');

				try {
					await api.autoLogout();
					hasAutoLoggedOut = true;
					logger.info('🎯 [AUTO-LOGOUT] User successfully auto-logged out');
				} catch (error) {
					logger.error('🎯 [AUTO-LOGOUT] Error during auto-logout:', error);
				}
			}
		}

		const shouldLock = lockManager.shouldLockExtension(storedHackDate);

		// If lock status changed, update UI
		if (shouldLock !== isExtensionLocked) {
			isExtensionLocked = shouldLock;
			logger.info(`🔒 [AUTO-CHECK] Lock status changed to: ${shouldLock}`);

			sessionStatusView.setLocked(shouldLock);

			vscode.commands.executeCommand('setContext', 'firebase-service.extension-locked', shouldLock);

			if (shouldLock) {
				logger.warn('⏰ [AUTO-CHECK] Extension has expired and is now locked');
				vscode.window.showWarningMessage('Your Firebase Service session has expired.');
			} else {
				logger.info('✅ [AUTO-CHECK] Extension lock status updated');
			}
		} else {
			console.log('🔍 [checkAndUpdateLockStatus] No status change - current:', isExtensionLocked, 'new:', shouldLock);
		}
	} catch (error) {
		logger.error('❌ [AUTO-CHECK] Error checking lock status', error);
	}
}

/**
 * Start daily automatic check for extension lock status
 * Runs when IDE is opened/focused and every hour while active
 * Ensures users cannot access expired extensions without reload
 */
function startDailyLockCheck(context: vscode.ExtensionContext): void {
	try {
		// Make the check function available externally
		externalCheckAndUpdateLockStatus = checkAndUpdateLockStatus;

		// Check immediately when extension activates
		logger.info('🔍 [DEBUG] Running initial lock status check');
		checkAndUpdateLockStatus();

		// Check every hour while IDE is open
		dailyCheckInterval = setInterval(async () => {
			logger.info('⏰ [HOURLY-CHECK] Running hourly lock status check');
			await checkAndUpdateLockStatus();
		}, 60 * 60 * 1000); // Every hour in milliseconds

		// Also check when window gets focus (user comes back to VS Code)
		const focusDisposable = vscode.window.onDidChangeWindowState(async (state) => {
			if (state.focused) {
				logger.info('🔍 [FOCUS-CHECK] IDE focused - checking lock status');
				await checkAndUpdateLockStatus();
			}
		});

		// Register disposables for cleanup on deactivation
		context.subscriptions.push(focusDisposable);

		logger.info('✅ [DEBUG] Daily lock check enabled - checks every hour and on window focus');
	} catch (error) {
		logger.error('❌ Failed to start daily lock check', error);
	}
}

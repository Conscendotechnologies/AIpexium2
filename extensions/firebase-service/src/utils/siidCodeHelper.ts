import * as vscode from 'vscode';
import { Logger } from './logger';

/**
 * Helper class for communicating with siid-code extension
 * Uses direct API calls instead of VS Code commands for reliability
 */
export class SiidCodeHelper {
	private static instance: SiidCodeHelper;
	private siidCodeAPI: any = null;
	private isInitialized = false;
	private authManager: any = null;
	private logger!: Logger;

	private constructor() {
		// Logger will be set in initialize
	}

	public static getInstance(): SiidCodeHelper {
		if (!SiidCodeHelper.instance) {
			SiidCodeHelper.instance = new SiidCodeHelper();
		}
		return SiidCodeHelper.instance;
	}

	/**
	 * Initialize the helper by getting siid-code extension API and setting up auth listener
	 */
	public async initialize(authManager: any, logger: Logger): Promise<void> {
		if (this.isInitialized) return;
		this.logger = logger;
		this.logger.info('Initializing SiidCodeHelper');

		this.authManager = authManager;

		// Set up auth state change listener first
		this.setupAuthListener();

		// Ensure siid-code is activated before proceeding
		await this.ensureSiidCodeActivated();

		this.isInitialized = true;
	}

	/**
	 * Ensure siid-code extension is activated and API is available
	 */
	private async ensureSiidCodeActivated(): Promise<void> {
		try {
			// Debug: log all installed extensions
			const allExtensions = vscode.extensions.all.map(ext => ext.id);
			this.logger.info(`Installed extensions: ${allExtensions.join(', ')}`);

			const siidCodeExt = vscode.extensions.getExtension('ConscendoTechInc.siid-code');
			if (siidCodeExt) {
				try {
					this.logger.info('Checking siid-code extension...');
					// Check if already active, only activate if needed
					if (!siidCodeExt.isActive) {
						this.logger.info('Activating siid-code extension...');
						await siidCodeExt.activate();
						this.logger.info('siid-code extension activated successfully');
					} else {
						this.logger.info('siid-code extension is already active');
					}
					if (siidCodeExt.exports) {
						this.siidCodeAPI = siidCodeExt.exports;
						this.logger.info(`siidCodeAPI methods: ${Object.keys(this.siidCodeAPI).join(', ')}`);
						this.logger.info('Successfully connected to siid-code API');
						try {
							const methods = [];
							let obj = this.siidCodeAPI;
							while (obj && obj !== Object.prototype) {
								methods.push(...Object.getOwnPropertyNames(obj).filter(name => typeof obj[name] === 'function' && name !== 'constructor'));
								obj = Object.getPrototypeOf(obj);
							}
							this.logger.info(`siid-code API available methods: ${methods.join(', ')}`);
						} catch (error) {
							this.logger.error('Failed to inspect siid-code API methods', error);
						}
					} else {
						this.logger.warn('siid-code extension activated but exports not available');
					}
				} catch (activationError) {
					this.logger.error('Failed to activate siid-code extension', activationError);
				}
			} else {
				this.logger.warn('siid-code extension not found - make sure it is installed. Expected ID: ConscendoTechInc.siid-code');
			}
		} catch (error) {
			this.logger.error('Failed to initialize siid-code API', error);
		}
	}

	/**
	 * Set up listener for auth state changes
	 */
	private setupAuthListener(): void {
		if (!this.authManager) {
			this.logger.warn('AuthManager not available, cannot set up auth listener');
			return;
		}

		this.logger.info('Setting up auth state change listener in SiidCodeHelper');

		this.authManager.onDidChangeAuthState(async (isAuthenticated: boolean) => {
			this.logger.info(`Auth state changed: isAuthenticated=${isAuthenticated}`);

			if (isAuthenticated) {
				const session = await this.authManager.getCurrentUser();
				this.logger.info(`Current user session: ${JSON.stringify(session)}`);
				if (session) {
					this.logger.info('Notifying siid-code about user login');
					await this.notifyLogin({
						uid: session.uid,
						user: session.user,
						session: session
					});
				}
			} else {
				this.logger.info('Notifying siid-code about user logout');
				await this.notifyLogout();
			}
		});
	}

	/**
	 * Notify siid-code extension about user login
	 * Will wait for siid-code API to be available before notifying
	 */
	public async notifyLogin(loginData: any): Promise<void> {
		this.logger.info(`Checking siid-code API for login: siidCodeAPI exists=${!!this.siidCodeAPI}, has onFirebaseLogin=${!!(this.siidCodeAPI && this.siidCodeAPI.onFirebaseLogin)}`);

		// Wait for siid-code API to be available (with timeout)
		if (!this.siidCodeAPI) {
			this.logger.info('siid-code API not ready yet, waiting for activation...');
			const apiAvailable = await this.waitForSiidCodeAPI(5000); // 5 second timeout
			if (!apiAvailable) {
				this.logger.warn('Timeout waiting for siid-code API to become available');
				return;
			}
		}

		if (this.siidCodeAPI && this.siidCodeAPI.onFirebaseLogin) {
			try {
				await this.siidCodeAPI.onFirebaseLogin(loginData);
				this.logger.info('Notified siid-code about login');
			} catch (error) {
				this.logger.error('Failed to notify login', error);
			}
		} else {
			if (!this.siidCodeAPI) {
				this.logger.warn('siid-code API object not available for login notification');
			} else {
				this.logger.warn('siid-code API does not have onFirebaseLogin method');
			}
		}
	}

	/**
	 * Wait for siid-code API to become available
	 * @param timeoutMs Maximum time to wait in milliseconds
	 * @returns true if API became available, false if timeout
	 */
	private async waitForSiidCodeAPI(timeoutMs: number): Promise<boolean> {
		const startTime = Date.now();
		const checkInterval = 100; // Check every 100ms

		while (Date.now() - startTime < timeoutMs) {
			// Try to ensure siid-code is activated
			await this.ensureSiidCodeActivated();

			if (this.siidCodeAPI) {
				this.logger.info('siid-code API became available');
				return true;
			}

			// Wait before next check
			await new Promise(resolve => setTimeout(resolve, checkInterval));
		}

		return false;
	}

	/**
	 * Notify siid-code extension about user logout
	 */
	public async notifyLogout(): Promise<void> {
		this.logger.info(`Checking siid-code API for logout: siidCodeAPI exists=${!!this.siidCodeAPI}, has onFirebaseLogout=${!!(this.siidCodeAPI && this.siidCodeAPI.onFirebaseLogout)}`);
		if (this.siidCodeAPI && this.siidCodeAPI.onFirebaseLogout) {
			try {
				await this.siidCodeAPI.onFirebaseLogout();
				this.logger.info('Notified siid-code about logout');
			} catch (error) {
				this.logger.error('Failed to notify logout', error);
			}
		} else {
			if (!this.siidCodeAPI) {
				this.logger.warn('siid-code API object not available for logout notification');
			} else {
				this.logger.warn('siid-code API does not have onFirebaseLogout method');
			}
		}
	}

	/**
	 * Check if siid-code API is available
	 */
	public isAvailable(): boolean {
		return this.siidCodeAPI !== null;
	}

	/**
	 * Get the raw siid-code API for advanced usage
	 */
	public getAPI(): any {
		return this.siidCodeAPI;
	}
}

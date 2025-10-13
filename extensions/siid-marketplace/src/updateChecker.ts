import * as vscode from 'vscode';
import { ExtensionManager } from './extensionManager';
import { GitHubService } from './githubService';
import { ConfigService } from './configService';
import { LoggerService } from './loggerService';
import { BundledExtensionManager } from './bundledExtensionManager';
import { IExtensionInfo } from './types';

interface IUpdateCheckResult {
	extensionId: string;
	displayName: string;
	currentVersion: string;
	latestVersion: string;
	hasUpdate: boolean;
	updateSource: 'github' | 'bundle';
}

export class UpdateChecker {
	private static instance: UpdateChecker;
	private githubService: GitHubService;
	private configService: ConfigService;
	private logger: LoggerService;
	private bundledManager: BundledExtensionManager;
	private extensionManager: ExtensionManager;

	private updateCheckInterval: NodeJS.Timeout | undefined;
	private lastUpdateCheck: Date | undefined;
	private availableUpdates: Map<string, IUpdateCheckResult> = new Map();

	private constructor() {
		this.githubService = GitHubService.getInstance();
		this.configService = ConfigService.getInstance();
		this.logger = LoggerService.getInstance();
		this.bundledManager = BundledExtensionManager.getInstance();
		this.extensionManager = ExtensionManager.getInstance();
	}

	public static getInstance(): UpdateChecker {
		if (!UpdateChecker.instance) {
			UpdateChecker.instance = new UpdateChecker();
		}
		return UpdateChecker.instance;
	}

	/**
	 * Start background update checking
	 */
	public startBackgroundUpdates(): void {
		// Check for bundled extensions to install immediately on startup
		this.checkAndInstallBundledExtensions();
		// Check for updates after bundled installation (with longer delay)
		// setTimeout(() => {
		// 	this.checkForUpdatesInBackground();
		// }, 30000); // 30 second delay to let extension settle

		// // Schedule periodic checks (default 1 hour = 60 minutes)
		// const intervalMinutes = 60;
		// const intervalMs = intervalMinutes * 60 * 1000;

		// this.updateCheckInterval = setInterval(() => {
		// 	this.checkForUpdatesInBackground();
		// }, intervalMs);

		// this.logger.info(`[UpdateChecker.startPeriodicCheck] Update checker started - will check every ${intervalMinutes} minutes`);
	}

	/**
	 * Stop background update checking
	 */
	public stopBackgroundUpdates(): void {
		if (this.updateCheckInterval) {
			clearInterval(this.updateCheckInterval);
			this.updateCheckInterval = undefined;
			this.logger.info('[UpdateChecker.stopPeriodicCheck] Update checker stopped');
		}
	}

	/**
	 * Check and install bundled extensions on startup
	 */
	private async checkAndInstallBundledExtensions(progressCallback?: (message: string) => void): Promise<void> {
		try {
			this.logger.info('[UpdateChecker.checkAndInstallBundledExtensions] 📦 Checking for bundled extensions to install...');

			const config = await this.configService.getConfig();
			if (!config) {
				this.logger.warn('[UpdateChecker.checkAndInstallBundledExtensions] No configuration available');
				return;
			}

			const bundledExtensionsToInstall: IUpdateCheckResult[] = [];

			// Check each configured extension
			for (const extensionConfig of config.githubReleases) {
				try {
					// Check if extension is already installed
					this.logger.info(`[UpdateChecker.checkAndInstallBundledExtensions] Checking ${JSON.stringify(extensionConfig)}...`);
					const installedExtension = vscode.extensions.getExtension(extensionConfig.extensionId);
					this.logger.info(`[UpdateChecker.checkAndInstallBundledExtensions] Installed version: ${installedExtension?.packageJSON?.version || 'Not installed'}`);

					if (!installedExtension) {
						// Extension not installed, check if we have a bundled version
						const bundledVersion = await this.getBundledVersion(extensionConfig.extensionId);
						if (bundledVersion) {
							bundledExtensionsToInstall.push({
								extensionId: extensionConfig.extensionId,
								displayName: extensionConfig.displayName,
								currentVersion: '0.0.0',
								latestVersion: bundledVersion,
								hasUpdate: true,
								updateSource: 'bundle'
							});

							this.logger.info(`[UpdateChecker.checkAndInstallBundledExtensions] Found bundled extension to install: ${extensionConfig.displayName} v${bundledVersion}`);
						}
					} else {
						this.logger.info(`[UpdateChecker.checkAndInstallBundledExtensions] Extension ${extensionConfig.displayName} already installed (v${installedExtension.packageJSON?.version})`);
					}
				} catch (error) {
					this.logger.info(`[UpdateChecker.checkAndInstallBundledExtensions] Failed to check ${extensionConfig.extensionId}: ${error}`);
				}
			}

			// Install bundled extensions if any found
			if (bundledExtensionsToInstall.length > 0) {
				progressCallback?.(`Installing ${bundledExtensionsToInstall.length} bundled extension(s)...`);
				this.logger.info(`[UpdateChecker.checkAndInstallBundledExtensions] Installing ${bundledExtensionsToInstall.length} bundled extension(s)...`);
				await this.installBundledExtensions(bundledExtensionsToInstall, progressCallback);
			} else {
				progressCallback?.('All bundled extensions are already installed');
				this.logger.info('[UpdateChecker.checkAndInstallBundledExtensions] ✅ All bundled extensions are already installed');
			}

		} catch (error) {
			this.logger.warn(`[UpdateChecker.checkAndInstallBundledExtensions] Failed to check bundled extensions: ${error}`);
		}
	}

	/**
	 * Install bundled extensions automatically
	 */
	private async installBundledExtensions(extensions: IUpdateCheckResult[], progressCallback?: (message: string) => void): Promise<void> {
		let successCount = 0;
		const totalCount = extensions.length;

		for (const extension of extensions) {
			try {
				// Report progress for current installation
				progressCallback?.(`Installing ${extension.displayName}... (${successCount + 1}/${totalCount})`);

				// Get full extension config
				const config = await this.configService.getConfig();
				if (!config) continue;

				const extensionConfig = config.githubReleases
					.find((e: any) => e.extensionId === extension.extensionId);

				if (extensionConfig) {
					const extensionInfo: IExtensionInfo = {
						...extensionConfig,
						latestVersion: extension.latestVersion,
						isInstalled: false,
						hasUpdate: true
					};

					// Install from bundle
					await this.extensionManager.installExtension(extensionInfo);
					successCount++;

					progressCallback?.(`✅ Installed ${extension.displayName} (${successCount}/${totalCount})`);
					this.logger.info(`[UpdateChecker.installBundledExtensions] ✅ Installed ${extension.displayName} v${extension.latestVersion}`);

					// Cache this as installed
					this.availableUpdates.delete(extension.extensionId);
				}
			} catch (error) {
				progressCallback?.(`❌ Failed to install ${extension.displayName} (${successCount}/${totalCount})`);
				this.logger.error(`[UpdateChecker.installBundledExtensions] ❌ Failed to install ${extension.displayName}: ${error}`);
			}
		}

		// Show completion notification
		if (successCount > 0) {
			const message = successCount === totalCount
				? `✅ Successfully installed ${successCount} bundled extension(s)`
				: `⚠️ Installed ${successCount}/${totalCount} bundled extensions. Check logs for details.`;

			vscode.window.showInformationMessage(message);
			this.logger.info(`[UpdateChecker.installBundledExtensions] Installation complete: ${successCount}/${totalCount} successful`);
		}
	}

	/**
	 * Check for updates in background without blocking UI
	 */
	private async checkForUpdatesInBackground(): Promise<void> {
		try {
			this.logger.info('[UpdateChecker.checkForUpdatesInBackground] 🔄 Starting background update check...');
			this.lastUpdateCheck = new Date();

			const config = await this.configService.getConfig();
			if (!config) {
				this.logger.warn('[UpdateChecker.checkForUpdatesInBackground] No configuration available for update check');
				return;
			}

			const extensions = config.githubReleases;
			const updateResults: IUpdateCheckResult[] = [];

			// Check each extension for updates
			for (const extensionConfig of extensions) {
				try {
					const result = await this.checkSingleExtensionUpdate(extensionConfig);
					if (result) {
						updateResults.push(result);

						// Update our cache
						this.availableUpdates.set(result.extensionId, result);
					}
				} catch (error) {
					this.logger.debug(`[UpdateChecker.checkForUpdatesInBackground] Failed to check updates for ${extensionConfig.extensionId}: ${error}`);
					// Continue checking other extensions even if one fails
				}
			}

			// Filter only extensions that have updates
			const extensionsWithUpdates = updateResults.filter(r => r.hasUpdate);

			if (extensionsWithUpdates.length > 0) {
				this.logger.info(`[UpdateChecker.checkForUpdatesInBackground] 📦 Found ${extensionsWithUpdates.length} extension(s) with updates available`);
				this.showUpdateNotification(extensionsWithUpdates);
			} else {
				this.logger.info('[UpdateChecker.checkForUpdatesInBackground] ✅ All extensions are up to date');
			}

		} catch (error) {
			this.logger.warn(`[UpdateChecker.checkForUpdatesInBackground] Background update check failed: ${error}`);
		}
	}

	/**
	 * Check for updates for a single extension (only for installed extensions)
	 */
	private async checkSingleExtensionUpdate(extensionConfig: any): Promise<IUpdateCheckResult | null> {
		// Get current installed version
		const installedExtension = vscode.extensions.getExtension(extensionConfig.extensionId);
		const currentVersion = installedExtension?.packageJSON?.version || '0.0.0';
		const isInstalled = !!installedExtension;

		// Skip uninstalled extensions - they should be handled by startup installation
		if (!isInstalled) {
			this.logger.debug(`[UpdateChecker.checkSingleExtensionUpdate] Skipping ${extensionConfig.extensionId} - not installed (handled by startup installation)`);
			return null;
		}

		// Extension is installed - check for updates
		// Check bundled version first
		const bundledVersion = await this.getBundledVersion(extensionConfig.extensionId);
		if (bundledVersion && this.isNewerVersion(bundledVersion, currentVersion)) {
			return {
				extensionId: extensionConfig.extensionId,
				displayName: extensionConfig.displayName,
				currentVersion,
				latestVersion: bundledVersion,
				hasUpdate: true,
				updateSource: 'bundle'
			};
		}

		// Check GitHub version
		try {
			const release = await this.githubService.getLatestRelease(extensionConfig.owner, extensionConfig.repo);
			if (release) {
				const githubVersion = release.tag_name.replace(/^v/, ''); // Remove 'v' prefix if present

				// Compare with current version
				if (this.isNewerVersion(githubVersion, currentVersion)) {
					return {
						extensionId: extensionConfig.extensionId,
						displayName: extensionConfig.displayName,
						currentVersion,
						latestVersion: githubVersion,
						hasUpdate: true,
						updateSource: 'github'
					};
				}
			}
		} catch (error) {
			this.logger.debug(`[UpdateChecker.checkGitHubVersion] GitHub version check failed for ${extensionConfig.extensionId}: ${error}`);
		}

		// No update available
		return {
			extensionId: extensionConfig.extensionId,
			displayName: extensionConfig.displayName,
			currentVersion,
			latestVersion: currentVersion,
			hasUpdate: false,
			updateSource: 'github'
		};
	}

	/**
	 * Get bundled version for an extension
	 */
	private async getBundledVersion(extensionId: string): Promise<string | null> {
		const bundled = this.bundledManager.getBundledExtension(extensionId);
		return bundled ? bundled.version : null;
	}

	/**
	 * Compare versions using semantic versioning
	 */
	private isNewerVersion(version1: string, version2: string): boolean {
		const v1Parts = version1.split('.').map(Number);
		const v2Parts = version2.split('.').map(Number);

		// Pad arrays to same length
		const maxLength = Math.max(v1Parts.length, v2Parts.length);
		while (v1Parts.length < maxLength) v1Parts.push(0);
		while (v2Parts.length < maxLength) v2Parts.push(0);

		for (let i = 0; i < maxLength; i++) {
			if (v1Parts[i] > v2Parts[i]) return true;
			if (v1Parts[i] < v2Parts[i]) return false;
		}

		return false; // Versions are equal
	}

	/**
	 * Show update notification to user
	 */
	private showUpdateNotification(updates: IUpdateCheckResult[]): void {
		const updateCount = updates.length;
		const extensionNames = updates.map(u => u.displayName).join(', ');

		// Since bundled installations happen on startup, this should mostly be updates
		const toUpdate = updates.filter(u => u.currentVersion !== '0.0.0');
		const toInstall = updates.filter(u => u.currentVersion === '0.0.0');

		let message: string;
		if (toUpdate.length > 0 && toInstall.length > 0) {
			message = `${toUpdate.length} update(s) and ${toInstall.length} installation(s) available`;
		} else if (toUpdate.length > 0) {
			message = updateCount === 1
				? `Update available for ${updates[0].displayName} (v${updates[0].latestVersion})`
				: `${updateCount} extension updates available: ${extensionNames}`;
		} else {
			// This should be rare since bundled extensions install on startup
			message = updateCount === 1
				? `Install available for ${updates[0].displayName} (v${updates[0].latestVersion})`
				: `${updateCount} extensions available for installation: ${extensionNames}`;
		}

		const actionText = (toUpdate.length > 0 && toInstall.length > 0)
			? 'Install & Update All'
			: toInstall.length > 0
				? 'Install All'
				: 'Update All';

		vscode.window.showInformationMessage(
			message,
			actionText,
			'View Details',
			'Later'
		).then(selection => {
			switch (selection) {
				case 'Update All':
				case 'Install All':
				case 'Install & Update All':
					this.updateAllAvailable();
					break;
				case 'View Details':
					this.showUpdateDetails(updates);
					break;
				case 'Later':
					// User dismissed, do nothing
					break;
			}
		});
	}

	/**
	 * Update all available extensions (including installations)
	 */
	private async updateAllAvailable(): Promise<void> {
		try {
			const updates = Array.from(this.availableUpdates.values()).filter(u => u.hasUpdate);

			if (updates.length === 0) {
				vscode.window.showInformationMessage('No updates or installations available');
				return;
			}

			const toUpdate = updates.filter(u => u.currentVersion !== '0.0.0');
			const toInstall = updates.filter(u => u.currentVersion === '0.0.0');

			let message = '';
			if (toUpdate.length > 0 && toInstall.length > 0) {
				message = `Installing ${toInstall.length} and updating ${toUpdate.length} extension(s)...`;
			} else if (toInstall.length > 0) {
				message = `Installing ${toInstall.length} extension(s)...`;
			} else {
				message = `Updating ${toUpdate.length} extension(s)...`;
			}

			vscode.window.showInformationMessage(message);

			let successCount = 0;
			for (const update of updates) {
				try {
					// Get extension info for update/install
					const config = await this.configService.getConfig();
					if (!config) continue;

					const extensionConfig = config.githubReleases
						.find((e: any) => e.extensionId === update.extensionId);

					if (extensionConfig) {
						const isInstallation = update.currentVersion === '0.0.0';
						const extensionInfo: IExtensionInfo = {
							...extensionConfig,
							latestVersion: update.latestVersion,
							isInstalled: !isInstallation,
							hasUpdate: true
						};

						if (isInstallation) {
							// Install extension
							await this.extensionManager.installExtension(extensionInfo);
						} else {
							// Update extension
							await this.extensionManager.updateExtension(extensionInfo);
						}
						successCount++;

						// Remove from available updates
						this.availableUpdates.delete(update.extensionId);
					}
				} catch (error) {
					const action = update.currentVersion === '0.0.0' ? 'install' : 'update';
					this.logger.error(`[UpdateChecker.updateAll] Failed to ${action} ${update.displayName}: ${error}`);
				}
			}

			const toUpdateCount = toUpdate.length;
			const toInstallCount = toInstall.length;

			if (successCount === updates.length) {
				let successMessage = '';
				if (toUpdateCount > 0 && toInstallCount > 0) {
					successMessage = `✅ Successfully installed ${toInstallCount} and updated ${toUpdateCount} extension(s)`;
				} else if (toInstallCount > 0) {
					successMessage = `✅ Successfully installed ${successCount} extension(s)`;
				} else {
					successMessage = `✅ Successfully updated ${successCount} extension(s)`;
				}
				vscode.window.showInformationMessage(successMessage);
			} else {
				vscode.window.showWarningMessage(`Processed ${successCount}/${updates.length} extensions. Check logs for details.`);
			}

		} catch (error) {
			this.logger.error('[UpdateChecker.updateAll] Process all failed', error);
			vscode.window.showErrorMessage(`Failed to process extensions: ${error}`);
		}
	}

	/**
	 * Show detailed update information
	 */
	private showUpdateDetails(updates: IUpdateCheckResult[]): void {
		const panel = vscode.window.createWebviewPanel(
			'updateDetails',
			'Available Updates',
			vscode.ViewColumn.One,
			{ enableScripts: true, retainContextWhenHidden: true }
		);

		panel.webview.html = this.getUpdateDetailsHtml(updates);
	}

	/**
	 * Generate HTML for update details view
	 */
	private getUpdateDetailsHtml(updates: IUpdateCheckResult[]): string {
		const updateRows = updates.map(update => {
			const isInstallation = update.currentVersion === '0.0.0';
			const statusText = isInstallation
				? '📦 Available for Installation'
				: update.hasUpdate
					? '⬆️ Update Available'
					: '✅ Up to date';

			return `
				<tr>
					<td>${update.displayName}</td>
					<td>${isInstallation ? 'Not installed' : update.currentVersion}</td>
					<td>${update.latestVersion}</td>
					<td><span class="source-${update.updateSource}">${update.updateSource}</span></td>
					<td>${statusText}</td>
				</tr>
			`;
		}).join('');

		const toInstall = updates.filter(u => u.currentVersion === '0.0.0');
		const toUpdate = updates.filter(u => u.currentVersion !== '0.0.0' && u.hasUpdate);

		return `
			<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>Extension Updates & Installations</title>
				<style>
					body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; margin: 20px; background-color: var(--vscode-editor-background); color: var(--vscode-editor-foreground); }
					.header { border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 20px; margin-bottom: 20px; }
					.title { font-size: 24px; font-weight: bold; margin: 0; color: var(--vscode-titleBar-activeForeground); }
					table { width: 100%; border-collapse: collapse; margin-top: 20px; }
					th, td { padding: 12px; text-align: left; border-bottom: 1px solid var(--vscode-panel-border); }
					th { font-weight: bold; background-color: var(--vscode-panel-background); }
					.source-bundle { color: #4CAF50; font-weight: bold; }
					.source-github { color: #2196F3; font-weight: bold; }
					.stats { margin-top: 20px; padding: 15px; background-color: var(--vscode-panel-background); border-radius: 5px; }
				</style>
			</head>
			<body>
				<div class="header">
					<h1 class="title">Extension Updates & Installations</h1>
				</div>

				<div class="stats">
					<strong>Last Check:</strong> ${this.lastUpdateCheck?.toLocaleString() || 'Never'}<br>
					<strong>Available for Installation:</strong> ${toInstall.length}<br>
					<strong>Updates Available:</strong> ${toUpdate.length}<br>
					<strong>Total Extensions:</strong> ${updates.length}
				</div>

				<table>
					<thead>
						<tr>
							<th>Extension</th>
							<th>Current Version</th>
							<th>Latest Version</th>
							<th>Source</th>
							<th>Status</th>
						</tr>
					</thead>
					<tbody>
						${updateRows}
					</tbody>
				</table>
			</body>
			</html>
		`;
	}

	/**
	 * Get available updates (for marketplace view integration)
	 */
	public getAvailableUpdates(): Map<string, IUpdateCheckResult> {
		return this.availableUpdates;
	}

	/**
	 * Force update check (for manual trigger)
	 */
	public async forceUpdateCheck(): Promise<void> {
		await this.checkForUpdatesInBackground();
	}

	/**
	 * Check if an extension has an available update
	 */
	public hasAvailableUpdate(extensionId: string): boolean {
		const update = this.availableUpdates.get(extensionId);
		return update ? update.hasUpdate : false;
	}

	/**
	 * Get last update check time
	 */
	public getLastUpdateCheck(): Date | undefined {
		return this.lastUpdateCheck;
	}

	/**
	 * Force setup installation with progress callback
	 */
	public async forceSetupInstallation(progressCallback?: (message: string) => void): Promise<void> {
		await this.checkAndInstallBundledExtensions(progressCallback);
	}

	/**
	 * Get the count of bundled extensions that need to be installed
	 */
	public async getBundledExtensionsToInstallCount(): Promise<number> {
		try {
			const config = await this.configService.getConfig();
			if (!config) return 0;

			let count = 0;
			for (const extensionConfig of config.githubReleases) {
				const installedExtension = vscode.extensions.getExtension(extensionConfig.extensionId);
				if (!installedExtension) {
					const bundledVersion = await this.getBundledVersion(extensionConfig.extensionId);
					if (bundledVersion) {
						count++;
					}
				}
			}
			return count;
		} catch (error) {
			this.logger.warn(`[UpdateChecker.getBundledExtensionsToInstallCount] Failed to count: ${error}`);
			return 0;
		}
	}

	/**
	 * Dispose of resources
	 */
	public dispose(): void {
		this.stopBackgroundUpdates();
	}
}

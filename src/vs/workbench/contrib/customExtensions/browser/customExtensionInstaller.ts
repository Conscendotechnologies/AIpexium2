/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

console.log('Loading customExtensionInstaller.ts');

import { join } from '../../../../base/common/path.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkbenchExtensionManagementService } from '../../../services/extensionManagement/common/extensionManagement.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { URI } from '../../../../base/common/uri.js';
import { IExtensionDownloadResult, DOWNLOAD_INFO_PATH, ICustomExtensionsConfig, IGithubReleaseConfig } from '../common/customExtensions.js';
import { toErrorMessage } from '../../../../base/common/errorMessage.js';
import { IntervalTimer } from '../../../../base/common/async.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { MenuRegistry, MenuId } from '../../../../platform/actions/common/actions.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { Schemas } from '../../../../base/common/network.js';

const FIRST_LAUNCH_KEY = 'customExtensions.firstLaunchComplete';
const INSTALLED_VERSIONS_KEY = 'customExtensions.installedVersions';
const LAST_UPDATE_CHECK_KEY = 'customExtensions.lastUpdateCheck';
const UPDATE_HISTORY_KEY = 'customExtensions.updateHistory';

interface IDownloadSession {
	downloadedAt: number;
	results: IExtensionDownloadResult[];
}

interface IUpdateHistoryEntry {
	extensionId: string;
	version: string;
	timestamp: number;
	action: 'installed' | 'updated' | 'failed';
	error?: string;
}

export class CustomExtensionInstaller extends Disposable implements IWorkbenchContribution {

	private updateTimer: IntervalTimer | undefined;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IStorageService private readonly storageService: IStorageService,
		@IWorkbenchExtensionManagementService private readonly extensionManagementService: IWorkbenchExtensionManagementService,
		@IFileService private readonly fileService: IFileService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
		@IProductService private readonly productService: IProductService,
		@INotificationService private readonly notificationService: INotificationService
	) {
		super();
		console.log('CustomExtensionInstaller: Constructor called');
		this.logService.info('CustomExtensionInstaller: Service created');

		// Validate configuration first
		const configErrors = this.validateConfiguration();
		if (configErrors.length > 0) {
			const errorMessage = `Custom Extensions Configuration Errors:\n${configErrors.join('\n')}`;
			this.logService.error(errorMessage);
			this.showNotification('Custom Extensions configuration has errors - check console for details', Severity.Error);
			return; // Don't proceed with installation if configuration is invalid
		}

		// Check and install extensions after a short delay
		setTimeout(() => {
			this.checkAndInstallExtensions();
		}, 3000);

		// Setup scheduled update checking
		this.setupUpdateScheduling();

		// Register command palette commands
		this.registerCommands();
	}

	private async checkAndInstallExtensions(): Promise<void> {
		try {
			// // Check if this is the first launch
			// const firstLaunchComplete = this.storageService.getBoolean(FIRST_LAUNCH_KEY, StorageScope.APPLICATION, false);

			// if (firstLaunchComplete) {
			// 	this.logService.info('Custom extensions already installed, checking for updates...');
			// 	await this.checkForUpdates();
			// 	return;
			// }

			this.logService.info('First launch detected, installing custom extensions...');

			// Install downloaded extensions
			await this.installDownloadedExtensions();

			// Mark first launch as complete
			this.storageService.store(FIRST_LAUNCH_KEY, true, StorageScope.APPLICATION, StorageTarget.MACHINE);

			this.logService.info('Custom extensions installation completed');

		} catch (error) {
			this.logService.error('Error during custom extension installation:', toErrorMessage(error));
		}
	}

	private async installDownloadedExtensions(): Promise<void> {
		try {
			// Check for downloaded files
			const downloadInfoPath = URI.joinPath(this.environmentService.userRoamingDataHome, DOWNLOAD_INFO_PATH);
			this.logService.info(`Checking for download info at ${downloadInfoPath}`);

			// Debug: Show what's in the downloads directory
			const downloadsDir = URI.joinPath(this.environmentService.userRoamingDataHome, 'downloads');
			this.logService.info(`Debug: Checking downloads directory at ${downloadsDir}`);

			try {
				if (await this.fileService.exists(downloadsDir)) {
					const dirStat = await this.fileService.resolve(downloadsDir);
					if (dirStat.children) {
						const contents = dirStat.children.map(child => ({
							name: child.name,
							type: child.isDirectory ? 'directory' : 'file'
						}));
						this.logService.info(`Debug: Downloads directory contents: ${JSON.stringify(contents)}`);
					} else {
						this.logService.info('Debug: Downloads directory is empty or has no children resolved');
					}
				} else {
					this.logService.info('Debug: Downloads directory does not exist');
				}
			} catch (debugError) {
				this.logService.info(`Debug: Error reading downloads directory: ${toErrorMessage(debugError)}`);
			}

			// Debug: Show what's in the User directory
			const userDir = this.environmentService.userRoamingDataHome;
			this.logService.info(`Debug: Checking user directory at ${userDir}`);

			try {
				if (await this.fileService.exists(userDir)) {
					const userDirStat = await this.fileService.resolve(userDir);
					if (userDirStat.children) {
						const userContents = userDirStat.children.map(child => ({
							name: child.name,
							type: child.isDirectory ? 'directory' : 'file'
						}));
						this.logService.info(`Debug: User directory contents: ${JSON.stringify(userContents)}`);
					} else {
						this.logService.info('Debug: User directory is empty or has no children resolved');
					}
				} else {
					this.logService.info('Debug: User directory does not exist');
				}
			} catch (debugError) {
				this.logService.info(`Debug: Error reading user directory: ${toErrorMessage(debugError)}`);
			}

			if (!(await this.fileService.exists(downloadInfoPath))) {
				this.logService.info('No download info found, checking for orphaned VSIX files...');

				// Check if there are VSIX files without download info
				try {
					if (await this.fileService.exists(downloadsDir)) {
						const dirStat = await this.fileService.resolve(downloadsDir);
						if (dirStat.children) {
							const vsixFiles = dirStat.children.filter(child =>
								!child.isDirectory && child.name.endsWith('.vsix')
							);

							if (vsixFiles.length > 0) {
								this.logService.info(`Found ${vsixFiles.length} orphaned VSIX file(s), creating download session...`);

								// Create download session and save it
								const downloadSession: IDownloadSession = {
									downloadedAt: Date.now(),
									results: vsixFiles.map(vsixFile => {
										const nameWithoutExt = vsixFile.name.replace('.vsix', '');
										const lastDashIndex = nameWithoutExt.lastIndexOf('-');
										const extensionId = lastDashIndex > 0 ? nameWithoutExt.substring(0, lastDashIndex) : nameWithoutExt;
										const version = lastDashIndex > 0 ? nameWithoutExt.substring(lastDashIndex + 1) : '1.0.0';

										return {
											extensionId,
											version,
											fileName: vsixFile.name,
											filePath: URI.file(join(this.environmentService.userRoamingDataHome.fsPath, 'downloads', vsixFile.name)).toString(),
											success: true
										} as IExtensionDownloadResult;
									})
								};

								// Save the download session
								await this.fileService.writeFile(
									downloadInfoPath,
									VSBuffer.fromString(JSON.stringify(downloadSession, null, 2))
								);

								this.logService.info('Created download info for orphaned VSIX files');
							}
						}
					}
				} catch (orphanError) {
					this.logService.error('Error checking for orphaned VSIX files:', toErrorMessage(orphanError));
				}

				// Check again if we created download info
				if (!(await this.fileService.exists(downloadInfoPath))) {
					this.logService.info('No download info or VSIX files found, skipping extension installation');
					return;
				}
			}

			// Read download session info
			const downloadInfoContent = await this.fileService.readFile(downloadInfoPath);
			const downloadSession: IDownloadSession = JSON.parse(downloadInfoContent.value.toString());

			this.logService.info(`Found download session with ${downloadSession.results.length} extensions`);

			let installedCount = 0;
			let failedCount = 0;

			// Install each downloaded extension
			for (const result of downloadSession.results) {
				if (!result.success) {
					this.logService.warn(`Skipping failed download: ${result.extensionId} - ${result.error}`);
					failedCount++;
					continue;
				}

				try {
					this.logService.info(`Installing extension: ${result.extensionId} from ${result.fileName}`);

					// Handle both URI strings and file paths
					let extensionPath: URI;
					if (result.filePath.startsWith('file://') || result.filePath.startsWith('vscode-userdata://')) {
						// It's a URI string, parse it
						extensionPath = URI.parse(result.filePath);
					} else {
						// It's a file path, create URI from it
						extensionPath = URI.file(result.filePath);
					}

					// Convert vscode-userdata URI to file URI for extension installation
					const fileExtensionPath = extensionPath.scheme === Schemas.vscodeUserData ?
						extensionPath.with({ scheme: Schemas.file }) : extensionPath;

					// Create a clean file URI with proper decoding
					const cleanFileUri = URI.file(fileExtensionPath.fsPath);

					if (await this.fileService.exists(cleanFileUri)) {
						// Use the extension management service to install from VSIX
						this.logService.info(`Using file path: ${cleanFileUri.toString()} for installation`);
						const extension = await this.extensionManagementService.installFromLocation(cleanFileUri);

						this.logService.info(`Successfully installed extension: ${extension.identifier.id}`);

						// Show individual notification for new extension
						this.showNotification(`Installed custom extension: ${extension.identifier.id}`, Severity.Info);

						// Store installed version info
						this.storeInstalledVersion(extension.identifier.id, result.version);

						// Store installation history
						this.storeUpdateHistory({
							extensionId: extension.identifier.id,
							version: result.version,
							timestamp: Date.now(),
							action: 'installed'
						});

						// Clean up downloaded file after successful installation
						await this.fileService.del(extensionPath);
						installedCount++;

						this.logService.info(`Cleaned up downloaded file: ${result.fileName}`);
					} else {
						this.logService.warn(`Downloaded extension file not found: ${result.filePath}`);
						failedCount++;
					}

				} catch (error) {
					this.logService.error(`Error installing extension ${result.extensionId}:`, toErrorMessage(error));

					// Show error notification
					this.showNotification(`Failed to install custom extension: ${result.extensionId}`, Severity.Error);

					// Store failed installation history
					this.storeUpdateHistory({
						extensionId: result.extensionId,
						version: result.version,
						timestamp: Date.now(),
						action: 'failed',
						error: toErrorMessage(error)
					});

					failedCount++;
				}
			}

			// Clean up download info file after processing
			await this.fileService.del(downloadInfoPath);

			this.logService.info(`Extension installation summary: ${installedCount} installed, ${failedCount} failed`);

			// Show notification to user
			this.showInstallationSummary(installedCount, failedCount);

		} catch (error) {
			this.logService.error('Error installing downloaded extensions:', toErrorMessage(error));
		}
	}

	private async checkForUpdates(): Promise<void> {
		try {
			// Check for downloaded files that might be updates
			const downloadInfoPath = URI.joinPath(this.environmentService.userRoamingDataHome, DOWNLOAD_INFO_PATH);

			if (!(await this.fileService.exists(downloadInfoPath))) {
				this.logService.info('No new downloads found for update checking');
				return;
			}

			// Read download session info
			const downloadInfoContent = await this.fileService.readFile(downloadInfoPath);
			const downloadSession: IDownloadSession = JSON.parse(downloadInfoContent.value.toString());

			const installedVersions = this.getInstalledVersions();
			let updatesFound = 0;

			// Check each download for potential updates
			for (const result of downloadSession.results) {
				if (!result.success) {
					continue;
				}

				const installedVersion = installedVersions[result.extensionId];
				if (installedVersion && installedVersion !== result.version) {
					this.logService.info(`Update available for ${result.extensionId}: ${installedVersion} → ${result.version}`);
					updatesFound++;

					// Install the update (same process as initial installation)
					try {
						const extensionPath = URI.parse(result.filePath);
						// Convert vscode-userdata URI to file URI for extension installation
						const fileExtensionPath = extensionPath.scheme === Schemas.vscodeUserData ?
							extensionPath.with({ scheme: Schemas.file }) : extensionPath;

						if (await this.fileService.exists(extensionPath)) {
							const extension = await this.extensionManagementService.installFromLocation(fileExtensionPath);
							this.logService.info(`Successfully updated extension: ${extension.identifier.id}`);
							this.storeInstalledVersion(extension.identifier.id, result.version);
							await this.fileService.del(extensionPath);
						}
					} catch (error) {
						this.logService.error(`Failed to update extension ${result.extensionId}:`, toErrorMessage(error));

						// Show error notification
						this.showNotification(`Failed to update custom extension: ${result.extensionId}`, Severity.Error);

						// Store failed update history
						this.storeUpdateHistory({
							extensionId: result.extensionId,
							version: result.version,
							timestamp: Date.now(),
							action: 'failed',
							error: toErrorMessage(error)
						});
					}
				}
			}

			if (updatesFound === 0) {
				this.logService.info('No updates found for installed custom extensions');
			} else {
				// Show notification for updates
				this.showUpdateSummary(updatesFound);
			}

			// Clean up download info file after processing
			await this.fileService.del(downloadInfoPath);

		} catch (error) {
			this.logService.error('Error checking for updates:', toErrorMessage(error));
		}
	}

	private storeInstalledVersion(extensionId: string, version: string): void {
		try {
			const installedVersions = this.getInstalledVersions();
			installedVersions[extensionId] = version;
			this.storageService.store(
				INSTALLED_VERSIONS_KEY,
				JSON.stringify(installedVersions),
				StorageScope.APPLICATION,
				StorageTarget.MACHINE
			);
		} catch (error) {
			this.logService.error('Error storing installed version:', toErrorMessage(error));
		}
	}

	private getInstalledVersions(): Record<string, string> {
		try {
			const stored = this.storageService.get(INSTALLED_VERSIONS_KEY, StorageScope.APPLICATION, '{}');
			return JSON.parse(stored);
		} catch (error) {
			this.logService.error('Error getting installed versions:', toErrorMessage(error));
			return {};
		}
	}

	/**
	 * Registers command palette commands for manual operations
	 */
	private registerCommands(): void {
		// Define command IDs and labels
		const commands = [
			{
				id: 'customExtensions.checkForUpdates',
				title: 'Custom Extensions: Check for Updates',
				handler: async () => {
					try {
						this.showNotification('Checking for custom extension updates...', Severity.Info);
						await this.performScheduledUpdateCheck();
					} catch (error) {
						this.logService.error('Error during manual update check:', toErrorMessage(error));
						this.showNotification('Failed to check for updates', Severity.Error);
					}
				}
			},
			{
				id: 'customExtensions.viewHistory',
				title: 'Custom Extensions: View Update History',
				handler: () => {
					this.showUpdateHistory();
				}
			},
			{
				id: 'customExtensions.reinstallAll',
				title: 'Custom Extensions: Reinstall All',
				handler: async () => {
					try {
						this.showNotification('Reinstalling all custom extensions...', Severity.Info);
						// Clear first launch flag to force reinstallation
						this.storageService.store(FIRST_LAUNCH_KEY, false, StorageScope.APPLICATION, StorageTarget.MACHINE);
						await this.checkAndInstallExtensions();
					} catch (error) {
						this.logService.error('Error during reinstall:', toErrorMessage(error));
						this.showNotification('Failed to reinstall extensions', Severity.Error);
					}
				}
			},
			{
				id: 'customExtensions.validateConfiguration',
				title: 'Custom Extensions: Validate Configuration',
				handler: () => {
					const errors = this.validateConfiguration();
					if (errors.length === 0) {
						this.showNotification('Custom Extensions configuration is valid', Severity.Info);
					} else {
						const errorMessage = `Configuration Errors:\n${errors.join('\n')}`;
						this.logService.error(errorMessage);
						this.showNotification('Configuration has errors - check console for details', Severity.Error);
					}
				}
			}
		];

		// Register commands and add them to command palette
		for (const command of commands) {
			// Register the command
			this._register(CommandsRegistry.registerCommand(command.id, command.handler));

			// Add to command palette
			MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
				command: {
					id: command.id,
					title: command.title
				}
			});
		}

		this.logService.info('Custom extension commands registered');
	}

	/**
	 * Shows update history in a notification
	 */
	private showUpdateHistory(): void {
		const history = this.getUpdateHistory();

		if (history.length === 0) {
			this.showNotification('No custom extension history available', Severity.Info);
			return;
		}

		// Show the last 5 entries
		const recentHistory = history.slice(-5).reverse();
		const historyText = recentHistory.map(entry => {
			const date = new Date(entry.timestamp).toLocaleString();
			return `${entry.extensionId} ${entry.action} (v${entry.version}) - ${date}${entry.error ? ` - Error: ${entry.error}` : ''}`;
		}).join('\n');

		this.showNotification(`Recent Custom Extension History:\n${historyText}`, Severity.Info);
	}

	/**
	 * Validates the custom extensions configuration
	 */
	private validateConfiguration(): string[] {
		const errors: string[] = [];

		try {
			const customExtensions = (this.productService as any).customExtensions as ICustomExtensionsConfig;

			if (!customExtensions) {
				errors.push('No customExtensions configuration found in product.json');
				return errors;
			}

			// Validate githubReleases array
			if (!customExtensions.githubReleases || !Array.isArray(customExtensions.githubReleases)) {
				errors.push('customExtensions.githubReleases must be an array');
				return errors;
			}

			if (customExtensions.githubReleases.length === 0) {
				errors.push('customExtensions.githubReleases array is empty');
				return errors;
			}

			// Validate each extension configuration
			customExtensions.githubReleases.forEach((ext: IGithubReleaseConfig, index: number) => {
				const prefix = `Extension ${index + 1}:`;

				if (!ext.owner) {
					errors.push(`${prefix} owner is required`);
				}

				if (!ext.repo) {
					errors.push(`${prefix} repo is required`);
				}

				if (!ext.extensionId) {
					errors.push(`${prefix} extensionId is required`);
				}

				if (!ext.vsixAssetName) {
					errors.push(`${prefix} vsixAssetName is required`);
				}
			});

			// Validate optional checkInterval
			if (customExtensions.checkInterval !== undefined) {
				if (typeof customExtensions.checkInterval !== 'number' || customExtensions.checkInterval <= 0) {
					errors.push('checkInterval must be a positive number (hours)');
				}
			}

			// Validate optional autoUpdate
			if (customExtensions.autoUpdate !== undefined && typeof customExtensions.autoUpdate !== 'boolean') {
				errors.push('autoUpdate must be a boolean value');
			}

		} catch (error) {
			errors.push(`Error reading configuration: ${toErrorMessage(error)}`);
		}

		return errors;
	}

	/**
	 * Sets up scheduled update checking based on configuration
	 */
	private setupUpdateScheduling(): void {
		try {
			// Get custom extensions configuration from product.json
			const customExtensions = (this.productService as any).customExtensions as ICustomExtensionsConfig;
			if (!customExtensions || !customExtensions.autoUpdate) {
				this.logService.info('Auto-update disabled, skipping update scheduling');
				return;
			}

			const checkInterval = customExtensions.checkInterval || 24; // Default to 24 hours
			const intervalMs = checkInterval * 60 * 60 * 1000; // Convert hours to milliseconds

			this.logService.info(`Setting up update checking every ${checkInterval} hours`);

			// Create interval timer for periodic updates
			this.updateTimer = this._register(new IntervalTimer());
			this.updateTimer.cancelAndSet(() => {
				this.performScheduledUpdateCheck();
			}, intervalMs);

			// Also check if we need to do an immediate update check
			this.checkIfUpdateCheckNeeded();

		} catch (error) {
			this.logService.error('Error setting up update scheduling:', toErrorMessage(error));
		}
	}

	/**
	 * Checks if an update check is needed based on last check time
	 */
	private checkIfUpdateCheckNeeded(): void {
		try {
			const customExtensions = (this.productService as any).customExtensions as ICustomExtensionsConfig;
			if (!customExtensions) {
				return;
			}

			const checkInterval = customExtensions.checkInterval || 24;
			const intervalMs = checkInterval * 60 * 60 * 1000;
			const lastUpdateCheck = this.storageService.getNumber(LAST_UPDATE_CHECK_KEY, StorageScope.APPLICATION, 0);
			const now = Date.now();

			if (now - lastUpdateCheck >= intervalMs) {
				this.logService.info('Scheduled update check needed, performing now');
				this.performScheduledUpdateCheck();
			} else {
				const nextCheck = new Date(lastUpdateCheck + intervalMs);
				this.logService.info(`Next update check scheduled for: ${nextCheck.toISOString()}`);
			}
		} catch (error) {
			this.logService.error('Error checking if update check needed:', toErrorMessage(error));
		}
	}

	/**
	 * Performs a scheduled update check
	 */
	private async performScheduledUpdateCheck(): Promise<void> {
		try {
			this.logService.info('Performing scheduled update check for custom extensions');

			// Update the last check timestamp
			this.storageService.store(LAST_UPDATE_CHECK_KEY, Date.now(), StorageScope.APPLICATION, StorageTarget.MACHINE);

			// Trigger main process to download latest versions
			// Note: This would ideally trigger the main process download logic
			// For now, we'll check for existing downloads
			await this.checkForUpdates();

		} catch (error) {
			this.logService.error('Error during scheduled update check:', toErrorMessage(error));
		}
	}

	/**
	 * Stores an update history entry
	 */
	private storeUpdateHistory(entry: IUpdateHistoryEntry): void {
		try {
			const history = this.getUpdateHistory();
			history.push(entry);

			// Keep only the last 50 entries to prevent storage bloat
			if (history.length > 50) {
				history.splice(0, history.length - 50);
			}

			this.storageService.store(
				UPDATE_HISTORY_KEY,
				JSON.stringify(history),
				StorageScope.APPLICATION,
				StorageTarget.MACHINE
			);
		} catch (error) {
			this.logService.error('Error storing update history:', toErrorMessage(error));
		}
	}

	/**
	 * Gets the update history
	 */
	private getUpdateHistory(): IUpdateHistoryEntry[] {
		try {
			const stored = this.storageService.get(UPDATE_HISTORY_KEY, StorageScope.APPLICATION, '[]');
			return JSON.parse(stored);
		} catch (error) {
			this.logService.error('Error getting update history:', toErrorMessage(error));
			return [];
		}
	}

	/**
	 * Cleanup method called when the service is disposed
	 */
	override dispose(): void {
		if (this.updateTimer) {
			this.updateTimer.dispose();
			this.updateTimer = undefined;
		}
		super.dispose();
	}

	/**
	 * Shows notification to user about extension operations
	 */
	private showNotification(message: string, severity: Severity = Severity.Info): void {
		this.notificationService.notify({
			severity,
			message,
			source: 'Custom Extensions'
		});
	}

	/**
	 * Shows notification for successful installations
	 */
	private showInstallationSummary(installedCount: number, failedCount: number): void {
		if (installedCount > 0 && failedCount === 0) {
			this.showNotification(`Successfully installed ${installedCount} custom extension${installedCount > 1 ? 's' : ''}`, Severity.Info);
		} else if (installedCount > 0 && failedCount > 0) {
			this.showNotification(`Installed ${installedCount} custom extension${installedCount > 1 ? 's' : ''}, ${failedCount} failed`, Severity.Warning);
		} else if (failedCount > 0) {
			this.showNotification(`Failed to install ${failedCount} custom extension${failedCount > 1 ? 's' : ''}`, Severity.Error);
		}
	}

	/**
	 * Shows notification for updates
	 */
	private showUpdateSummary(updatesFound: number): void {
		if (updatesFound > 0) {
			this.showNotification(`Found and installed ${updatesFound} extension update${updatesFound > 1 ? 's' : ''}`, Severity.Info);
		}
	}
}

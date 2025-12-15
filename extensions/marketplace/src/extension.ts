import * as vscode from 'vscode';
import { PackagedExtensionManager, InstalledExtensionMeta } from './PackagedExtensionManager';
import { MarketplaceLogger } from './MarketplaceLogger';

async function installExtensionsWithBlockingModal(
	packagedManager: PackagedExtensionManager,
	extensions: InstalledExtensionMeta[],
	logger: MarketplaceLogger,
	action: 'Installing' | 'Updating'
): Promise<void> {
	// Create status bar item
	const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	statusBarItem.text = `$(sync~spin) ${action} extensions...`;
	statusBarItem.show();

	// Show blocking modal overlay (blocks UI but not background processes)
	const title = `${action} Extensions`;
	const message = `${action} ${extensions.length} extension${extensions.length > 1 ? 's' : ''}. Please wait...`;
	logger.info(`[BLOCKING_MODAL] Showing blocking modal overlay`);
	try {
		const result = await vscode.commands.executeCommand('_showBlockingProgress', title, message);
		logger.info(`[BLOCKING_MODAL] Command returned: ${JSON.stringify(result)}`);
	} catch (err) {
		logger.error(`[BLOCKING_MODAL] Failed to show modal: ${err}`);
	}

	try {
		const folder = packagedManager.getPackagedExtensionsFolder();
		const fs = await import('fs');
		const path = await import('path');

		for (let i = 0; i < extensions.length; i++) {
			const ext = extensions[i];

			// Update status bar
			statusBarItem.text = `$(sync~spin) ${action} ${i + 1}/${extensions.length}: ${ext.displayName || ext.fileName}`;
			logger.info(`${action} ${ext.displayName || ext.fileName} (${i + 1}/${extensions.length})`);

			// Update blocking modal message with current progress
			const progressMessage = `${action} ${i + 1}/${extensions.length}: ${ext.displayName || ext.fileName}`;
			try {
				await vscode.commands.executeCommand('_updateBlockingProgressMessage', progressMessage);
				await vscode.commands.executeCommand('_updateBlockingProgress', i + 1, extensions.length);
			} catch (err) {
				logger.error(`[BLOCKING_MODAL] Failed to update modal: ${err}`);
			}

			// Install this extension
			try {
				const vsixPath = path.join(folder, ext.fileName);
				if (!fs.existsSync(vsixPath)) {
					logger.error(`VSIX not found: ${vsixPath}`);
					continue;
				}
				const vsixUri = vscode.Uri.file(vsixPath);
				logger.info(`Installing ${ext.displayName} from ${vsixPath}`);
				await vscode.commands.executeCommand('workbench.extensions.installExtension', vsixUri);
				logger.info(`Successfully installed ${ext.displayName}`);
			} catch (err) {
				logger.error(`Failed to install ${ext.displayName}: ${err}`);
			}
		}

		statusBarItem.text = `$(check) ${action} complete: ${extensions.length} extension${extensions.length > 1 ? 's' : ''}`;
		logger.info(`${action} complete: ${extensions.length} extension${extensions.length > 1 ? 's' : ''}`);
	} catch (err) {
		statusBarItem.text = `$(error) ${action} failed`;
		logger.error(`${action} failed: ${err}`);
		throw err;
	} finally {
		// Clean up status bar after a delay
		setTimeout(() => statusBarItem.dispose(), 5000);

		// Handle completion based on action type
		if (action === 'Updating') {
			// For updates, show restart buttons on the blocking modal
			logger.info('[BLOCKING_MODAL] Showing restart buttons on modal');
			setTimeout(async () => {
				try {
					// Show restart buttons on custom blocking dialog
					await vscode.commands.executeCommand('_showBlockingProgressRestartButtons');
				} catch (err) {
					logger.error(`[BLOCKING_MODAL] Failed to show restart buttons: ${err}`);
				}
			}, 500);
		} else {
			// For fresh installs, auto-close the modal
			logger.info('[BLOCKING_MODAL] Closing modal overlay');
			setTimeout(async () => {
				try {
					const result = await vscode.commands.executeCommand('_closeBlockingProgress');
					logger.info(`[BLOCKING_MODAL] Close command returned: ${JSON.stringify(result)}`);
				} catch (err) {
					logger.error(`[BLOCKING_MODAL] Failed to close modal: ${err}`);
				}
			}, 500);
		}
	}
}

async function installExtensionsWithStatusBar(
	packagedManager: PackagedExtensionManager,
	extensions: InstalledExtensionMeta[],
	logger: MarketplaceLogger,
	action: 'Installing' | 'Updating'
): Promise<void> {
	const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	statusBarItem.text = `$(sync~spin) ${action} extensions...`;
	statusBarItem.show();

	try {
		for (let i = 0; i < extensions.length; i++) {
			const ext = extensions[i];
			statusBarItem.text = `$(sync~spin) ${action} extenions...`;
			logger.info(`${action} ${ext.displayName || ext.fileName}`);
		}

		await packagedManager.installExtensions(extensions);

		statusBarItem.text = `$(check) ${action} complete: ${extensions.length} extension${extensions.length > 1 ? 's' : ''}`;
		setTimeout(() => statusBarItem.dispose(), 5000);

		// Only show reload prompt for updates, not for new installations
		if (action === 'Updating' && extensions.length > 0) {
			vscode.window.showInformationMessage(
				`Successfully updated ${extensions.length} extension${extensions.length > 1 ? 's' : ''}. Please reload window to apply changes.`,
				'Reload Window'
			).then(selection => {
				if (selection === 'Reload Window') {
					vscode.commands.executeCommand('workbench.action.reloadWindow');
				}
			});
		}
	} catch (err) {
		statusBarItem.text = `$(error) ${action} failed`;
		setTimeout(() => statusBarItem.dispose(), 5000);
		logger.error(`${action} failed: ${err}`);
		throw err;
	}
}

export async function activate(context: vscode.ExtensionContext) {
	const logger = new MarketplaceLogger();
	logger.info('Marketplace extension activated v1');

	const packagedManager = new PackagedExtensionManager(context);
	try {
		await packagedManager.loadPackagedExtensions();
		logger.info('Loaded packaged extensions metadata');
		packagedManager.checkInstalledExtensions();
		logger.info('Checked installed extensions');
		const installedMeta = packagedManager.getInstalledExtensionsMeta();
		logger.info(`Installed extensions metadata: ${JSON.stringify(installedMeta, null, 2)}`);

		// Separate new installations from updates
		const newExtensions = installedMeta.filter(ext => !ext.installed);
		const updates = installedMeta.filter(ext => ext.needsUpdate);

		// Automatically install new extensions with blocking modal
		if (newExtensions.length > 0) {
			logger.info(`Found ${newExtensions.length} new extensions to install automatically`);
			await installExtensionsWithBlockingModal(packagedManager, newExtensions, logger, 'Installing');
		}

		// Show notification only for updates
		if (updates.length > 0) {
			const message = `Found ${updates.length} extension${updates.length > 1 ? 's' : ''} that need${updates.length === 1 ? 's' : ''} to be updated.`;
			const action = 'Update All';
			vscode.window.showInformationMessage(message, action).then(selection => {
				if (selection === action) {
					vscode.commands.executeCommand('marketplace.updateAllExtensions');
				}
			});
		}
	} catch (err) {
		logger.error(`Error initializing PackagedExtensionManager: ${err}`);
	}

	const updateAllCommand = vscode.commands.registerCommand('marketplace.updateAllExtensions', async () => {
		try {
			const meta = packagedManager.getInstalledExtensionsMeta();
			const toUpdate = meta.filter(ext => ext.needsUpdate);
			if (toUpdate.length === 0) {
				vscode.window.showInformationMessage('All extensions are up to date.');
				return;
			}

			await installExtensionsWithBlockingModal(packagedManager, toUpdate, logger, 'Updating');
		} catch (err) {
			vscode.window.showErrorMessage(`Failed to update extensions: ${err}`, { modal: true });
			logger.error(`Update failed: ${err}`);
		}
	});

	context.subscriptions.push(updateAllCommand, logger);
}

export function deactivate() {
	// Add any necessary cleanup logic here
}

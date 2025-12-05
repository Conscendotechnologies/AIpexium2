import * as vscode from 'vscode';
import { PackagedExtensionManager, InstalledExtensionMeta } from './PackagedExtensionManager';
import { MarketplaceLogger } from './MarketplaceLogger';

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

		// Automatically install new extensions
		if (newExtensions.length > 0) {
			logger.info(`Found ${newExtensions.length} new extensions to install automatically`);
			await installExtensionsWithStatusBar(packagedManager, newExtensions, logger, 'Installing');
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

			await installExtensionsWithStatusBar(packagedManager, toUpdate, logger, 'Updating');
		} catch (err) {
			vscode.window.showErrorMessage(`Failed to update extensions: ${err}`);
			logger.error(`Update failed: ${err}`);
		}
	});

	context.subscriptions.push(updateAllCommand, logger);
}

export function deactivate() {
	// Add any necessary cleanup logic here
}

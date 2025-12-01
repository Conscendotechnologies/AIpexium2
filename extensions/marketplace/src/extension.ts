import * as vscode from 'vscode';
import { PackagedExtensionManager } from './PackagedExtensionManager';
import { MarketplaceLogger } from './MarketplaceLogger';

export async function activate(context: vscode.ExtensionContext) {
	const logger = new MarketplaceLogger();
	logger.info('Marketplace extension activated');

	const packagedManager = new PackagedExtensionManager(context);
	try {
		await packagedManager.loadPackagedExtensions();
		logger.info('Loaded packaged extensions metadata');
		packagedManager.checkInstalledExtensions();
		logger.info('Checked installed extensions');
		const installedMeta = packagedManager.getInstalledExtensionsMeta();
		logger.info(`Installed extensions metadata: ${JSON.stringify(installedMeta, null, 2)}`);

		// Check for updates
		const updates = installedMeta.filter(ext => ext.needsUpdate || !ext.installed);
		if (updates.length > 0) {
			const message = `Found ${updates.length} extensions that need to be installed or updated.`;
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

	const helloWorldCommand = vscode.commands.registerCommand('marketplace.helloWorld', () => {
		vscode.window.showInformationMessage('Hello from Marketplace Extension!');
		logger.info('Hello World command executed');
	});

	const updateAllCommand = vscode.commands.registerCommand('marketplace.updateAllExtensions', async () => {
		try {
			const meta = packagedManager.getInstalledExtensionsMeta();
			const toUpdate = meta.filter(ext => ext.needsUpdate || !ext.installed);
			if (toUpdate.length === 0) {
				vscode.window.showInformationMessage('All extensions are up to date.');
				return;
			}

			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: "Updating Extensions",
				cancellable: false
			}, async (progress) => {
				progress.report({ message: "Starting updates..." });
				await packagedManager.installExtensions(toUpdate);
			});

			vscode.window.showInformationMessage(`Successfully updated ${toUpdate.length} extensions. Please reload window to apply changes.`, 'Reload Window').then(selection => {
				if (selection === 'Reload Window') {
					vscode.commands.executeCommand('workbench.action.reloadWindow');
				}
			});
		} catch (err) {
			vscode.window.showErrorMessage(`Failed to update extensions: ${err}`);
			logger.error(`Update failed: ${err}`);
		}
	});

	context.subscriptions.push(helloWorldCommand, updateAllCommand, logger);
}

export function deactivate() {
	// Add any necessary cleanup logic here
}

import * as vscode from 'vscode';
import { MarketplaceViewProvider } from './marketplaceView';
import { ExtensionManager } from './extensionManager';
import { LoggerService } from './loggerService';
import { IExtensionInfo } from './types';
import { UpdateChecker } from './updateChecker';

let marketplaceProvider: MarketplaceViewProvider;
let extensionManager: ExtensionManager;
let logger: LoggerService;
let updateChecker: UpdateChecker;

export function activate(context: vscode.ExtensionContext) {
	// Initialize logger first
	logger = LoggerService.getInstance();
	logger.info('[Extension.activate] Siid Marketplace extension is now active!');

	// Initialize services
	marketplaceProvider = new MarketplaceViewProvider();
	extensionManager = ExtensionManager.getInstance();
	updateChecker = UpdateChecker.getInstance();

	// Start background update checking with continuous progress
	startBackgroundSetupWithProgress();

	// Register the tree view
	const treeView = vscode.window.createTreeView('siidMarketplace', {
		treeDataProvider: marketplaceProvider,
		showCollapseAll: true
	});

	// Set tree view description
	treeView.description = 'Extensions built and maintained by Conscendo Technologies';

	// Try to make the tree view visible by refreshing the provider
	marketplaceProvider.refresh();

	// Register commands - All now use ExtensionManager directly (no old wrapper functions)
	const testCommand = vscode.commands.registerCommand('siidMarketplace.test', () => {
		vscode.window.showInformationMessage('Siid Marketplace is working!');
		logger.info('[Extension.testCommand] Test command executed');
	});

	const refreshCommand = vscode.commands.registerCommand('siidMarketplace.refresh', () => {
		marketplaceProvider.refresh();
		vscode.window.showInformationMessage('Siid Marketplace refreshed');
	});

	const installCommand = vscode.commands.registerCommand('siidMarketplace.install', async (item: any) => {
		try {
			logger.info(`[Extension.installCommand] Install command received item: ${JSON.stringify({
				type: typeof item,
				constructor: item?.constructor?.name,
				extensionInfo: item?.extensionInfo ? 'exists' : 'missing',
				keys: Object.keys(item || {})
			})}`);

			// Handle both ExtensionItem and IExtensionInfo
			const extensionInfo: IExtensionInfo = item?.extensionInfo || item;

			if (!extensionInfo || !extensionInfo.extensionId) {
				throw new Error(`Invalid extension info: extensionId is ${extensionInfo?.extensionId}`);
			}

			logger.info(`[Extension.installCommand] Resolved extensionInfo: ${JSON.stringify({
				extensionId: extensionInfo.extensionId,
				displayName: extensionInfo.displayName,
				version: extensionInfo.version
			})}`);

			vscode.window.showInformationMessage(`Installing ${extensionInfo.displayName}...`);
			await extensionManager.installExtension(extensionInfo);
			setTimeout(() => marketplaceProvider.refresh(), 2000);
			vscode.window.showInformationMessage(`✅ ${extensionInfo.displayName} installed successfully!`);
		} catch (error) {
			logger.error(`[Extension.installCommand] Install command failed: ${error}`);
			vscode.window.showErrorMessage(`Failed to install extension: ${error}`);
		}
	});

	const uninstallCommand = vscode.commands.registerCommand('siidMarketplace.uninstall', async (item: any) => {
		const extensionInfo: IExtensionInfo = item?.extensionInfo || item;
		if (!extensionInfo || !extensionInfo.extensionId) {
			vscode.window.showErrorMessage('Invalid extension information');
			return;
		}

		const result = await vscode.window.showWarningMessage(
			`Are you sure you want to uninstall ${extensionInfo.displayName}?`,
			'Uninstall', 'Cancel'
		);
		if (result === 'Uninstall') {
			try {
				vscode.window.showInformationMessage(`Uninstalling ${extensionInfo.displayName}...`);
				await extensionManager.uninstallExtension(extensionInfo);
				setTimeout(() => marketplaceProvider.refresh(), 2000);
				vscode.window.showInformationMessage(`✅ ${extensionInfo.displayName} uninstalled successfully!`);
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to uninstall ${extensionInfo.displayName}: ${error}`);
			}
		}
	});

	const updateCommand = vscode.commands.registerCommand('siidMarketplace.update', async (item: any) => {
		const extensionInfo: IExtensionInfo = item?.extensionInfo || item;
		if (!extensionInfo || !extensionInfo.extensionId) {
			vscode.window.showErrorMessage('Invalid extension information');
			return;
		}

		try {
			vscode.window.showInformationMessage(`Updating ${extensionInfo.displayName}...`);
			await extensionManager.updateExtension(extensionInfo);
			setTimeout(() => marketplaceProvider.refresh(), 2000);
			vscode.window.showInformationMessage(`✅ ${extensionInfo.displayName} updated successfully!`);
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to update ${extensionInfo.displayName}: ${error}`);
		}
	});

	const viewOnGitHubCommand = vscode.commands.registerCommand('siidMarketplace.viewOnGitHub', (item: any) => {
		const extensionInfo: IExtensionInfo = item?.extensionInfo || item;
		if (!extensionInfo || !extensionInfo.owner || !extensionInfo.repo) {
			vscode.window.showErrorMessage('Invalid extension information for GitHub view');
			return;
		}
		const url = `https://github.com/${extensionInfo.owner}/${extensionInfo.repo}`;
		vscode.env.openExternal(vscode.Uri.parse(url));
	});

	const viewDetailsCommand = vscode.commands.registerCommand('siidMarketplace.viewDetails', (item: any) => {
		const extensionInfo: IExtensionInfo = item?.extensionInfo || item;
		if (!extensionInfo || !extensionInfo.extensionId) {
			vscode.window.showErrorMessage('Invalid extension information');
			return;
		}
		const panel = vscode.window.createWebviewPanel(
			'extensionDetails',
			`${extensionInfo.displayName} - Details`,
			vscode.ViewColumn.One,
			{ enableScripts: true, retainContextWhenHidden: true }
		);

		panel.webview.html = `
			<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>${extensionInfo.displayName} - Details</title>
				<style>
					body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; margin: 20px; background-color: var(--vscode-editor-background); color: var(--vscode-editor-foreground); }
					.header { border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 20px; margin-bottom: 20px; }
					.title { font-size: 24px; font-weight: bold; margin: 0; color: var(--vscode-titleBar-activeForeground); }
					.section-title { font-size: 18px; font-weight: bold; margin: 20px 0 10px 0; color: var(--vscode-titleBar-activeForeground); }
					.info-item { margin: 8px 0; }
					.label { font-weight: bold; color: var(--vscode-foreground); }
					.value { color: var(--vscode-descriptionForeground); }
					.link { color: var(--vscode-textLink-foreground); text-decoration: none; }
					.link:hover { text-decoration: underline; }
					ul { padding-left: 20px; }
					li { margin: 4px 0; }
				</style>
			</head>
			<body>
				<div class="header">
					<h1 class="title">${extensionInfo.displayName}</h1>
				</div>
				<div class="content">
					<h2 class="section-title">Extension Information</h2>
					<div class="info-item"><span class="label">Extension ID:</span> <span class="value">${extensionInfo.extensionId}</span></div>
					<div class="info-item"><span class="label">Version:</span> <span class="value">${extensionInfo.latestVersion || 'Unknown'}</span></div>
					<div class="info-item"><span class="label">Repository:</span> <span class="value">${extensionInfo.owner}/${extensionInfo.repo}</span></div>
					${extensionInfo.description ? `<div class="info-item"><span class="label">Description:</span> <span class="value">${extensionInfo.description}</span></div>` : ''}
					${extensionInfo.category ? `<div class="info-item"><span class="label">Category:</span> <span class="value">${extensionInfo.category}</span></div>` : ''}
					<h2 class="section-title">Links</h2>
					<ul>
						<li><a href="https://github.com/${extensionInfo.owner}/${extensionInfo.repo}" class="link">GitHub Repository</a></li>
						<li><a href="https://github.com/${extensionInfo.owner}/${extensionInfo.repo}/releases" class="link">Releases</a></li>
						<li><a href="https://github.com/${extensionInfo.owner}/${extensionInfo.repo}/issues" class="link">Issues</a></li>
						${extensionInfo.homepage ? `<li><a href="${extensionInfo.homepage}" class="link">Homepage</a></li>` : ''}
					</ul>
				</div>
			</body>
			</html>
		`;
	});

	const checkUpdatesCommand = vscode.commands.registerCommand('siidMarketplace.checkUpdates', async () => {
		try {
			vscode.window.showInformationMessage('Checking for extension updates...');
			await updateChecker.forceUpdateCheck();
			setTimeout(() => marketplaceProvider.refresh(), 2000);
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to check for updates: ${error}`);
		}
	}); const installAllRequiredCommand = vscode.commands.registerCommand('siidMarketplace.installAllRequired', async () => {
		try {
			vscode.window.showInformationMessage('Installing all required extensions...');
			await extensionManager.installAllRequired();
			setTimeout(() => marketplaceProvider.refresh(), 2000);
			vscode.window.showInformationMessage('✅ All required extensions installed!');
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to install required extensions: ${error}`);
		}
	});

	const updateAllCommand = vscode.commands.registerCommand('siidMarketplace.updateAll', async () => {
		try {
			vscode.window.showInformationMessage('Updating all extensions...');
			await extensionManager.updateAllExtensions();
			setTimeout(() => marketplaceProvider.refresh(), 2000);
			vscode.window.showInformationMessage('✅ All extensions updated!');
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to update extensions: ${error}`);
		}
	});

	const showLogsCommand = vscode.commands.registerCommand('siidMarketplace.showLogs', () => {
		logger.show();
	});

	const clearLogsCommand = vscode.commands.registerCommand('siidMarketplace.clearLogs', () => {
		logger.clear();
		logger.info('[Extension.clearLogsCommand] Logs cleared');
	});

	const viewUpdatesCommand = vscode.commands.registerCommand('siidMarketplace.viewUpdates', () => {
		const lastCheck = updateChecker.getLastUpdateCheck();
		if (!lastCheck) {
			vscode.window.showInformationMessage('No update check has been performed yet. Checking now...', 'Check Now')
				.then(selection => {
					if (selection === 'Check Now') {
						vscode.commands.executeCommand('siidMarketplace.checkUpdates');
					}
				});
			return;
		}

		const updates = Array.from(updateChecker.getAvailableUpdates().values());
		if (updates.length === 0) {
			vscode.window.showInformationMessage(`All extensions are up to date! (Last checked: ${lastCheck.toLocaleString()})`);
		} else {
			// Show update details in a new panel - this will be handled by UpdateChecker
			vscode.window.showInformationMessage('Opening update details...', 'View Details')
				.then(selection => {
					if (selection === 'View Details') {
						const availableUpdates = updates.filter(u => u.hasUpdate);
						if (availableUpdates.length > 0) {
							// The UpdateChecker will show the details panel
							// For now, show a simple message with update count
							const names = availableUpdates.map(u => u.displayName).join(', ');
							vscode.window.showInformationMessage(`${availableUpdates.length} updates available: ${names}`);
						}
					}
				});
		}
	});


	// Add commands to subscriptions
	context.subscriptions.push(
		treeView,
		testCommand,
		refreshCommand,
		installCommand,
		uninstallCommand,
		updateCommand,
		viewOnGitHubCommand,
		viewDetailsCommand,
		checkUpdatesCommand,
		installAllRequiredCommand,
		updateAllCommand,
		showLogsCommand,
		clearLogsCommand,
		viewUpdatesCommand,
		extensionManager,
		logger,
		updateChecker
	);

	// Show welcome message on first activation
	showWelcomeMessage(context);

	// Note: Removed old auto-install logic that caused rate limit issues.
	// Extensions are now installed on-demand via the hybrid approach.
}

async function startBackgroundSetupWithProgress() {
	// Start the progress indicator that will persist until setup is complete
	vscode.window.withProgress({
		location: vscode.ProgressLocation.Window,
		title: 'Siid Marketplace: Setting up...',
		cancellable: false
	}, async (progress) => {
		try {
			// Phase 1: Initial check
			progress.report({ message: 'Checking for extension updates...', increment: 10 });
			logger.info('[Extension.startBackgroundSetupWithProgress] Starting setup...');

			// Get count of extensions to install for better progress tracking
			const extensionsToInstallCount = await updateChecker.getBundledExtensionsToInstallCount();

			// Phase 2: Setup process
			if (extensionsToInstallCount > 0) {
				progress.report({
					message: `Installing ${extensionsToInstallCount} bundled extension(s)...`,
					increment: 20
				});
			} else {
				progress.report({ message: 'Verifying extensions...', increment: 30 });
			}

			// Start the actual setup process with callback for progress updates
			await updateChecker.forceSetupInstallation((message: string) => {
				progress.report({ message });
			});

			// Phase 3: Verification
			progress.report({ message: 'Finalizing setup...', increment: 30 });

			// Add a small delay to ensure installations are processed
			await new Promise(resolve => setTimeout(resolve, 1500));

			// Phase 4: Completion
			progress.report({ message: 'Setup completed successfully', increment: 40 });

			// Keep the progress visible for a moment to show completion
			await new Promise(resolve => setTimeout(resolve, 1000));

			logger.info('[Extension.startBackgroundSetupWithProgress] Setup completed successfully');

		} catch (error) {
			logger.error(`[Extension.startBackgroundSetupWithProgress] Setup failed: ${error}`);
			progress.report({ message: 'Setup failed - check logs for details' });

			// Show error for a moment before completing
			await new Promise(resolve => setTimeout(resolve, 2000));
		}
	});
}

export function deactivate() {
	logger.info('[Extension.deactivate] Siid Marketplace extension is deactivated');

	// Clean up update checker
	if (updateChecker) {
		updateChecker.dispose();
	}
}

function showWelcomeMessage(context: vscode.ExtensionContext) {
	const hasShownWelcome = context.globalState.get('siidMarketplace.hasShownWelcome', false);

	if (!hasShownWelcome) {
		vscode.window.showInformationMessage(
			'Welcome to Siid Marketplace! Discover extensions built specifically for your IDE.',
			'Explore Extensions'
		).then(selection => {
			if (selection === 'Explore Extensions') {
				vscode.commands.executeCommand('siidMarketplace.refresh');
			}
		});

		context.globalState.update('siidMarketplace.hasShownWelcome', true);
	}
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { ITerminalService } from '../../../../workbench/contrib/terminal/browser/terminal.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { URI } from '../../../../base/common/uri.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../base/common/event.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { localize2 } from '../../../../nls.js';

export const AUTHORIZE_ORG_COMMAND_ID = 'salesforce.authorizeOrg';
export const SHOW_ORGS_COMMAND_ID = 'salesforce.showAuthorizedOrgs';
export const GET_AUTHORIZED_ORGS_COMMAND_ID = 'salesforce.getAuthorizedOrgs';

// Additional SFDX command IDs
export const SFDX_AUTHORIZE_ORG_COMMAND_ID = 'sfdx.authorizeOrg';
export const SFDX_AUTHORIZE_DEV_HUB_COMMAND_ID = 'sfdx.authorizeDevHub';
export const SFDX_CREATE_DEFAULT_SCRATCH_ORG_COMMAND_ID = 'sfdx.createDefaultScratchOrg';
export const SFDX_AUTHORIZE_ORG_SESSION_ID_COMMAND_ID = 'sfdx.authorizeOrgSessionId';
export const SFDX_REMOVE_DELETED_EXPIRED_ORGS_COMMAND_ID = 'sfdx.removeDeletedExpiredOrgs';

interface AipexiumConfig {
	authorizedOrgs?: AuthorizedOrg[];
	[key: string]: any;
}

interface AuthorizedOrg {
	username: string;
	alias: string;
	authorised: boolean;
}

// Event emitter for org authorization changes
export const onOrgAuthorizationChanged = new Emitter<void>();

// Helper function to read config file
async function readConfig(fileService: IFileService, workspaceService: IWorkspaceContextService): Promise<AipexiumConfig> {
	const workspaceRoot = workspaceService.getWorkspace().folders[0]?.uri;
	if (!workspaceRoot) {
		throw new Error('No workspace found');
	}

	const configPath = URI.joinPath(workspaceRoot, '.aipexium', 'config.json');

	try {
		const configContent = await fileService.readFile(configPath);
		return JSON.parse(configContent.value.toString());
	} catch (error) {
		// If file doesn't exist, return empty config
		return {};
	}
}

// Helper function to write config file
async function writeConfig(fileService: IFileService, workspaceService: IWorkspaceContextService, config: AipexiumConfig): Promise<void> {
	const workspaceRoot = workspaceService.getWorkspace().folders[0]?.uri;
	if (!workspaceRoot) {
		throw new Error('No workspace found');
	}

	const configPath = URI.joinPath(workspaceRoot, '.aipexium', 'config.json');
	const aipexiumDir = URI.joinPath(workspaceRoot, '.aipexium');

	// Create .aipexium directory if it doesn't exist
	try {
		await fileService.createFolder(aipexiumDir);
	} catch (error) {
		// Directory might already exist, ignore error
	}

	// Write config file
	const configContent = JSON.stringify(config, null, 2);
	await fileService.writeFile(configPath, VSBuffer.fromString(configContent));
}

// Helper function to extract email from success message
function extractUsernameFromOutput(output: string): string | null {
	// Updated regex patterns for sf CLI output
	const successMatch = output.match(/Successfully authorized\s+([^\s]+)/) ||
		output.match(/Authorized to\s+([^\s]+)/) ||
		output.match(/Successfully logged into\s+([^\s]+)/);
	return successMatch ? successMatch[1] : null;
}

// Helper function to monitor terminal output for authorization success
function monitorTerminalForAuth(
	terminalService: ITerminalService,
	fileService: IFileService,
	workspaceService: IWorkspaceContextService,
	aliasName: string,
	commandService?: ICommandService
): void {
	const activeTerminal = terminalService.activeInstance;
	if (!activeTerminal) {
		console.error('No active terminal found');
		return;
	}

	let outputBuffer = '';
	const disposables = new DisposableStore();

	// Listen for terminal output
	const onDataDisposable = activeTerminal.onData((data: string) => {
		outputBuffer += data;

		// Check if authorization was successful - updated patterns for sf CLI
		if (outputBuffer.includes('Successfully authorized') ||
			outputBuffer.includes('Authorized to') ||
			outputBuffer.includes('Successfully logged into')) {
			const username = extractUsernameFromOutput(outputBuffer);
			if (username) {
				// Store the authorized org information
				storeAuthorizedOrg(fileService, workspaceService, username, aliasName)
					.then(async () => {
						console.log(`Stored authorized org: ${username} with alias: ${aliasName}`);

						// Set the target org using sf CLI
						if (commandService) {
							try {
								console.log(`Setting target org to: ${aliasName}`);
								const setTargetCommand = `sf config set target-org ${aliasName}\n`;
								await commandService.executeCommand('workbench.action.terminal.sendSequence', {
									text: setTargetCommand
								});

								// Wait a bit for the command to complete, then emit the event
								setTimeout(() => {
									onOrgAuthorizationChanged.fire();
								}, 1000);
							} catch (error) {
								console.error('Failed to set target org:', error);
								// Still emit the event even if setting target fails
								onOrgAuthorizationChanged.fire();
							}
						} else {
							// Emit event to notify UI of org authorization change
							onOrgAuthorizationChanged.fire();
						}
					})
					.catch((error) => {
						console.error('Failed to store authorized org:', error);
					});
			}

			// Clean up the listener
			disposables.dispose();
		}
	});

	// Set up cleanup after 5 minutes (in case user doesn't complete auth)
	const timeoutId = setTimeout(() => {
		disposables.dispose();
	}, 5 * 60 * 1000);

	disposables.add(onDataDisposable);
	disposables.add({
		dispose: () => {
			clearTimeout(timeoutId);
		}
	});
}

// Helper function to store authorized org information
async function storeAuthorizedOrg(
	fileService: IFileService,
	workspaceService: IWorkspaceContextService,
	username: string,
	aliasName: string
): Promise<void> {
	try {
		// Read existing config
		const config = await readConfig(fileService, workspaceService);

		// Initialize authorizedOrgs array if it doesn't exist
		if (!config.authorizedOrgs) {
			config.authorizedOrgs = [];
		}

		// Set all existing orgs to authorised: false
		config.authorizedOrgs.forEach((org: AuthorizedOrg) => {
			org.authorised = false;
		});

		// Check if this org (by username) already exists
		const existingOrgIndex = config.authorizedOrgs.findIndex((org: AuthorizedOrg) => org.username === username);

		if (existingOrgIndex !== -1) {
			// Update existing org's alias and set as currently authorised
			config.authorizedOrgs[existingOrgIndex].alias = aliasName;
			config.authorizedOrgs[existingOrgIndex].authorised = true;
		} else {
			// Add new org as currently authorised
			config.authorizedOrgs.push({
				username: username,
				alias: aliasName,
				authorised: true
			});
		}

		// Write updated config
		await writeConfig(fileService, workspaceService, config);

		console.log(`Org information saved to .aipexium/config.json:`, {
			username: username,
			alias: aliasName,
			authorised: true
		});
	} catch (error) {
		console.error('Error storing authorized org:', error);
		throw error;
	}
}

// Helper function to get authorized orgs from config
async function getAuthorizedOrgs(fileService: IFileService, workspaceService: IWorkspaceContextService): Promise<AuthorizedOrg[]> {
	try {
		const config = await readConfig(fileService, workspaceService);

		if (config.authorizedOrgs && Array.isArray(config.authorizedOrgs)) {
			return config.authorizedOrgs;
		}

		return [];
	} catch (error) {
		console.error('Error reading authorized orgs:', error);
		return [];
	}
}

// Helper function to set org as current authorized org
export async function setCurrentAuthorizedOrg(
	fileService: IFileService,
	workspaceService: IWorkspaceContextService,
	selectedOrg: AuthorizedOrg,
	commandService?: ICommandService,
	terminalService?: ITerminalService
): Promise<void> {
	try {
		// Read existing config
		const config = await readConfig(fileService, workspaceService);

		// Initialize authorizedOrgs array if it doesn't exist
		if (!config.authorizedOrgs) {
			config.authorizedOrgs = [];
		}

		// Set all existing orgs to authorised: false
		config.authorizedOrgs.forEach((org: AuthorizedOrg) => {
			org.authorised = false;
		});

		// Find and update the selected org
		const orgIndex = config.authorizedOrgs.findIndex((org: AuthorizedOrg) => org.username === selectedOrg.username);
		if (orgIndex !== -1) {
			config.authorizedOrgs[orgIndex].authorised = true;
		}

		// Write updated config
		await writeConfig(fileService, workspaceService, config);

		console.log(`Set ${selectedOrg.alias} as current authorized org`);

		// Set target org using SF CLI if command service and terminal service are available
		if (commandService && terminalService) {
			try {
				// Get current terminal or create new one if needed
				let activeTerminal = terminalService.activeInstance;
				if (!activeTerminal) {
					await commandService.executeCommand('workbench.action.terminal.new');
					// Wait a bit for terminal to be ready
					await new Promise(resolve => setTimeout(resolve, 1000));
					activeTerminal = terminalService.activeInstance;
				}

				if (activeTerminal) {
					console.log(`Setting target org to: ${selectedOrg.alias}`);
					const setTargetCommand = `sf config set target-org ${selectedOrg.alias}\n`;
					await commandService.executeCommand('workbench.action.terminal.sendSequence', {
						text: setTargetCommand
					});
				}
			} catch (error) {
				console.error('Failed to set target org via SF CLI:', error);
			}
		}

		// Emit event to notify UI of org authorization change
		onOrgAuthorizationChanged.fire();
	} catch (error) {
		console.error('Error setting current authorized org:', error);
		throw error;
	}
}

// Command to authorize an org
CommandsRegistry.registerCommand({
	id: AUTHORIZE_ORG_COMMAND_ID,
	handler: async (accessor) => {
		const commandService = accessor.get(ICommandService) as ICommandService;
		const quickInputService = accessor.get(IQuickInputService) as IQuickInputService;
		const fileService = accessor.get(IFileService) as IFileService;
		const workspaceService = accessor.get(IWorkspaceContextService) as IWorkspaceContextService;
		const terminalService = accessor.get(ITerminalService) as ITerminalService;

		try {
			// Step 1: Get alias name for the org
			const alias = await quickInputService.input({
				placeHolder: 'Enter alias for the org (e.g., MyDevOrg)',
				value: 'MyDevOrg'
			});

			if (!alias || alias.trim() === '') {
				console.error('Invalid alias name');
				return;
			}

			const trimmedAlias = alias.trim();

			// Step 2: Open terminal
			await commandService.executeCommand('workbench.action.terminal.new');

			// Step 3: Set up terminal monitoring for successful authorization
			// Wait a bit for terminal to be ready
			setTimeout(() => {
				monitorTerminalForAuth(terminalService, fileService, workspaceService, trimmedAlias, commandService);
			}, 1000);

			// Step 4: Run SF auth command (modern Salesforce CLI)
			const authCommand = `sf org login web --alias ${trimmedAlias}\n`;
			await commandService.executeCommand('workbench.action.terminal.sendSequence', {
				text: authCommand
			});

		} catch (error) {
			console.error('Error during org authorization:', error);
		}
	}
});

// Command to show all authorized orgs (QuickPick) - Modified to directly set selected org as current
CommandsRegistry.registerCommand({
	id: SHOW_ORGS_COMMAND_ID,
	handler: async (accessor) => {
		const quickInputService = accessor.get(IQuickInputService) as IQuickInputService;
		const fileService = accessor.get(IFileService) as IFileService;
		const workspaceService = accessor.get(IWorkspaceContextService) as IWorkspaceContextService;
		const notificationService = accessor.get(INotificationService) as INotificationService;
		const commandService = accessor.get(ICommandService) as ICommandService;
		const terminalService = accessor.get(ITerminalService) as ITerminalService;

		try {
			// Get authorized orgs from config
			const authorizedOrgs = await getAuthorizedOrgs(fileService, workspaceService);

			if (!authorizedOrgs || authorizedOrgs.length === 0) {
				notificationService.info('No authorized orgs found. Please authorize an org first.');
				return;
			}

			// Sort orgs to show currently authorised ones first
			const sortedOrgs = authorizedOrgs.sort((a: AuthorizedOrg, b: AuthorizedOrg) => {
				if (a.authorised && !b.authorised) return -1;
				if (!a.authorised && b.authorised) return 1;
				return 0;
			});

			// Create QuickPick items
			const quickPickItems = sortedOrgs.map((org: AuthorizedOrg) => ({
				label: `${org.authorised ? '$(check) ' : '$(circle-outline) '}${org.alias}`,
				description: org.username,
				detail: `Username: ${org.username} | Alias: ${org.alias} | Status: ${org.authorised ? 'Currently Authorised' : 'Previously Authorised'}`,
				org: org
			}));

			// Show the QuickPick to select an org
			const selectedItem = await quickInputService.pick(quickPickItems, {
				placeHolder: 'Select an org to set as current authorized org',
				matchOnDescription: true,
				matchOnDetail: true
			});

			if (selectedItem && selectedItem.org) {
				const selectedOrg = selectedItem.org;

				// Directly set the selected org as current authorized org with SF CLI target setting
				await setCurrentAuthorizedOrg(fileService, workspaceService, selectedOrg, commandService, terminalService);

				// Show success notification
				notificationService.info(`Set ${selectedOrg.alias} as current authorized org and target`);
			}
		} catch (error) {
			console.error('Error showing authorized orgs:', error);
			notificationService.error('Failed to retrieve authorized orgs.');
		}
	}
});

// Command to get authorized orgs (for dropdown)
CommandsRegistry.registerCommand({
	id: GET_AUTHORIZED_ORGS_COMMAND_ID,
	handler: async (accessor) => {
		const fileService = accessor.get(IFileService) as IFileService;
		const workspaceService = accessor.get(IWorkspaceContextService) as IWorkspaceContextService;

		try {
			const authorizedOrgs = await getAuthorizedOrgs(fileService, workspaceService);
			return authorizedOrgs;
		} catch (error) {
			console.error('Error getting authorized orgs:', error);
			return [];
		}
	}
});

// SFDX: Authorize an Org - Action2 for command palette
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: SFDX_AUTHORIZE_ORG_COMMAND_ID,
			title: localize2('sfdx.authorizeOrg', 'SFDX: Authorize an Org'),
			category: Categories.Developer,
			f1: true
		});
	}

	async run(accessor: any): Promise<void> {
		const commandService = accessor.get(ICommandService);
		const quickInputService = accessor.get(IQuickInputService);
		const fileService = accessor.get(IFileService);
		const workspaceService = accessor.get(IWorkspaceContextService);
		const terminalService = accessor.get(ITerminalService);

		try {
			// Step 1: Get alias name for the org
			const alias = await quickInputService.input({
				placeHolder: 'Enter alias for the org (e.g., MyDevOrg)',
				value: 'MyDevOrg'
			});

			if (!alias || alias.trim() === '') {
				console.error('Invalid alias name');
				return;
			}

			const trimmedAlias = alias.trim();

			// Step 2: Open terminal
			await commandService.executeCommand('workbench.action.terminal.new');

			// Step 3: Set up terminal monitoring for successful authorization
			setTimeout(() => {
				monitorTerminalForAuth(terminalService, fileService, workspaceService, trimmedAlias, commandService);
			}, 1000);

			// Step 4: Run SF auth command for production org
			const authCommand = `sf org login web --alias ${trimmedAlias}\n`;
			await commandService.executeCommand('workbench.action.terminal.sendSequence', {
				text: authCommand
			});

		} catch (error) {
			console.error('Error during org authorization:', error);
		}
	}
});

// SFDX: Authorize a Dev Hub - Action2 for command palette
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: SFDX_AUTHORIZE_DEV_HUB_COMMAND_ID,
			title: localize2('sfdx.authorizeDevHub', 'SFDX: Authorize a Dev Hub'),
			category: Categories.Developer,
			f1: true
		});
	}

	async run(accessor: any): Promise<void> {
		const commandService = accessor.get(ICommandService);
		const quickInputService = accessor.get(IQuickInputService);
		const fileService = accessor.get(IFileService);
		const workspaceService = accessor.get(IWorkspaceContextService);
		const terminalService = accessor.get(ITerminalService);

		try {
			// Step 1: Get alias name for the dev hub
			const alias = await quickInputService.input({
				placeHolder: 'Enter alias for the Dev Hub (e.g., MyDevHub)',
				value: 'MyDevHub'
			});

			if (!alias || alias.trim() === '') {
				console.error('Invalid alias name');
				return;
			}

			const trimmedAlias = alias.trim();

			// Step 2: Open terminal
			await commandService.executeCommand('workbench.action.terminal.new');

			// Step 3: Set up terminal monitoring for successful authorization
			setTimeout(() => {
				monitorTerminalForAuth(terminalService, fileService, workspaceService, trimmedAlias, commandService);
			}, 1000);

			// Step 4: Run SF auth command for dev hub
			const authCommand = `sf org login web --alias ${trimmedAlias} --set-default-dev-hub\n`;
			await commandService.executeCommand('workbench.action.terminal.sendSequence', {
				text: authCommand
			});

		} catch (error) {
			console.error('Error during dev hub authorization:', error);
		}
	}
});

// SFDX: Create a Default Scratch Org - Action2 for command palette
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: SFDX_CREATE_DEFAULT_SCRATCH_ORG_COMMAND_ID,
			title: localize2('sfdx.createDefaultScratchOrg', 'SFDX: Create a Default Scratch Org...'),
			category: Categories.Developer,
			f1: true
		});
	}

	async run(accessor: any): Promise<void> {
		const commandService = accessor.get(ICommandService);
		const quickInputService = accessor.get(IQuickInputService);

		try {
			// Step 1: Get alias name for the scratch org
			const alias = await quickInputService.input({
				placeHolder: 'Enter alias for the scratch org (e.g., MyScratchOrg)',
				value: 'MyScratchOrg'
			});

			if (!alias || alias.trim() === '') {
				console.error('Invalid alias name');
				return;
			}

			const trimmedAlias = alias.trim();

			// Step 2: Open terminal
			await commandService.executeCommand('workbench.action.terminal.new');

			// Step 3: Run SF create scratch org command
			const createScratchCommand = `sf org create scratch --alias ${trimmedAlias} --set-default\n`;
			await commandService.executeCommand('workbench.action.terminal.sendSequence', {
				text: createScratchCommand
			});

		} catch (error) {
			console.error('Error during scratch org creation:', error);
		}
	}
});

// SFDX: Authorize an Org using Session ID - Action2 for command palette
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: SFDX_AUTHORIZE_ORG_SESSION_ID_COMMAND_ID,
			title: localize2('sfdx.authorizeOrgSessionId', 'SFDX: Authorize an Org using Session ID'),
			category: Categories.Developer,
			f1: true
		});
	}

	async run(accessor: any): Promise<void> {
		const commandService = accessor.get(ICommandService);
		const quickInputService = accessor.get(IQuickInputService);

		try {
			// Step 1: Get session ID
			const sessionId = await quickInputService.input({
				placeHolder: 'Enter the Session ID',
				password: true
			});

			if (!sessionId || sessionId.trim() === '') {
				console.error('Invalid session ID');
				return;
			}

			// Step 2: Get instance URL
			const instanceUrl = await quickInputService.input({
				placeHolder: 'Enter the instance URL (e.g., https://yourinstance.salesforce.com)',
				value: 'https://'
			});

			if (!instanceUrl || instanceUrl.trim() === '') {
				console.error('Invalid instance URL');
				return;
			}

			// Step 3: Get alias name
			const alias = await quickInputService.input({
				placeHolder: 'Enter alias for the org (e.g., MySessionOrg)',
				value: 'MySessionOrg'
			});

			if (!alias || alias.trim() === '') {
				console.error('Invalid alias name');
				return;
			}

			// Step 4: Open terminal
			await commandService.executeCommand('workbench.action.terminal.new');

			// Step 5: Run SF auth command with session ID
			const authCommand = `sf org login access-token --alias ${alias.trim()} --instance-url ${instanceUrl.trim()} --no-prompt\n`;
			await commandService.executeCommand('workbench.action.terminal.sendSequence', {
				text: authCommand
			});

			// Note: User will need to paste the session ID when prompted

		} catch (error) {
			console.error('Error during session ID authorization:', error);
		}
	}
});

// SFDX: Remove Deleted and Expired Orgs - Action2 for command palette
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: SFDX_REMOVE_DELETED_EXPIRED_ORGS_COMMAND_ID,
			title: localize2('sfdx.removeDeletedExpiredOrgs', 'SFDX: Remove Deleted and Expired Orgs'),
			category: Categories.Developer,
			f1: true
		});
	}

	async run(accessor: any): Promise<void> {
		const commandService = accessor.get(ICommandService);
		const quickInputService = accessor.get(IQuickInputService);

		try {
			// Confirm action with user
			const confirm = await quickInputService.pick([
				{ label: 'Yes', description: 'Remove all deleted and expired orgs' },
				{ label: 'No', description: 'Cancel operation' }
			], {
				placeHolder: 'Are you sure you want to remove all deleted and expired orgs?'
			});

			if (!confirm || confirm.label !== 'Yes') {
				return;
			}

			// Step 1: Open terminal
			await commandService.executeCommand('workbench.action.terminal.new');

			// Step 2: Run SF command to clean up orgs
			const cleanupCommand = `sf org list --clean\n`;
			await commandService.executeCommand('workbench.action.terminal.sendSequence', {
				text: cleanupCommand
			});

		} catch (error) {
			console.error('Error during org cleanup:', error);
		}
	}
});

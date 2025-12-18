/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { app } from 'electron';
import { ILogService } from '../../platform/log/common/log.js';
import { IStateService } from '../../platform/state/node/state.js';
import { isWindows } from '../../base/common/platform.js';

const execAsync = promisify(exec);

/**
 * Sets up the Salesforce CLI path in the Windows user PATH environment variable.
 * This function:
 * 1. Only runs on Windows
 * 2. Only runs once per installation (tracked via state service)
 * 3. Checks if the path is already in the user PATH to avoid duplicates
 * 4. Updates both the permanent user PATH and the current process PATH
 *
 * @param logService - The log service for logging messages
 * @param stateService - The state service for tracking whether setup has been completed
 */
export async function setupSalesforceCliPath(logService: ILogService, stateService: IStateService): Promise<void> {
	// Only run on Windows
	if (!isWindows) {
		return;
	}

	// Check if we've already set up the Salesforce CLI path
	const isSetup = stateService.getItem<boolean>('salesforce.cliPathSetup');
	if (isSetup) {
		logService.trace('Salesforce CLI path already configured, skipping setup');
		return;
	}

	const appResourcesPath = process.resourcesPath;
	const sfCliBinPath = path.join(appResourcesPath, 'app', 'node_modules', '.bin');

	logService.info('Setting up Salesforce CLI path:', sfCliBinPath);

	try {
		// Get current user PATH first to avoid shell expansion issues
		const getCurrentPathCmd = `powershell -Command "[Environment]::GetEnvironmentVariable('Path', 'User')"`;
		const { stdout: currentPath } = await execAsync(getCurrentPathCmd);

		// Check if already added to avoid duplicates
		if (currentPath && currentPath.includes(sfCliBinPath)) {
			logService.info('Salesforce CLI path already in User PATH');
			await stateService.setItem('salesforce.cliPathSetup', true);
			return;
		}

		// Append our path to the current user PATH
		const trimmedPath = currentPath ? currentPath.trim() : '';
		const newPath = trimmedPath ? `${trimmedPath};${sfCliBinPath}` : sfCliBinPath;

		// Set the new PATH value
		const setPathCmd = `powershell -Command "[Environment]::SetEnvironmentVariable('Path', '${newPath}', 'User')"`;
		await execAsync(setPathCmd);

		// Also update current process PATH for immediate availability
		process.env.PATH = `${sfCliBinPath}${path.delimiter}${process.env.PATH}`;

		// Mark as setup complete
		await stateService.setItem('salesforce.cliPathSetup', true);

		logService.info('Salesforce CLI path configured successfully');
	} catch (error) {
		logService.error('Failed to setup Salesforce CLI path:', error);
	}
}

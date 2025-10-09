/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IRoocodeService } from '../common/roocode.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';

/**
 * Register Roo Code commands with VSCode's command system
 */
export function registerRoocodeCommands(): void {
	// Start Roo Code Session
	CommandsRegistry.registerCommand({
		id: 'roocode.startSession',
		handler: async (accessor: ServicesAccessor) => {
			const roocodeService = accessor.get(IRoocodeService);
			const logService = accessor.get(ILogService);

			try {
				await roocodeService.startSession();
				logService.info('Roo Code session started successfully');
			} catch (error) {
				logService.error('Failed to start Roo Code session', error);
			}
		}
	});

	// Stop Roo Code Session
	CommandsRegistry.registerCommand({
		id: 'roocode.stopSession',
		handler: async (accessor: ServicesAccessor) => {
			const roocodeService = accessor.get(IRoocodeService);
			const logService = accessor.get(ILogService);

			try {
				await roocodeService.stopSession();
				logService.info('Roo Code session stopped successfully');
			} catch (error) {
				logService.error('Failed to stop Roo Code session', error);
			}
		}
	});

	// Get Session Status
	CommandsRegistry.registerCommand({
		id: 'roocode.getStatus',
		handler: (accessor: ServicesAccessor) => {
			const roocodeService = accessor.get(IRoocodeService);
			return roocodeService.getSessionStatus();
		}
	});

	// Execute Command
	CommandsRegistry.registerCommand({
		id: 'roocode.executeCommand',
		handler: async (accessor: ServicesAccessor, command: string, ...args: any[]) => {
			const roocodeService = accessor.get(IRoocodeService);
			const logService = accessor.get(ILogService);

			try {
				const result = await roocodeService.executeCommand(command, args);
				logService.info('Roo Code command executed successfully', command);
				return result;
			} catch (error) {
				logService.error('Failed to execute Roo Code command', error);
				throw error;
			}
		}
	});
}

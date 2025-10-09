/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ITerminalService, ITerminalInstance } from '../../terminal/browser/terminal.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { Emitter, Event } from '../../../../base/common/event.js';

/**
 * Terminal execution result
 */
export interface ITerminalExecutionResult {
	terminalId: number;
	command: string;
	exitCode?: number;
	output?: string;
}

/**
 * Service for handling terminal operations in Roo Code
 * Provides managed terminal creation and command execution
 */
export class RoocodeTerminalService extends Disposable {
	private readonly _onDidExecuteCommand = this._register(new Emitter<ITerminalExecutionResult>());
	readonly onDidExecuteCommand: Event<ITerminalExecutionResult> = this._onDidExecuteCommand.event;

	private roocodeTerminals = new Map<number, ITerminalInstance>();

	constructor(
		@ITerminalService private readonly terminalService: ITerminalService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		this.logService.info('RoocodeTerminalService: Initializing');
	}

	/**
	 * Create a new Roo Code terminal
	 */
	async createTerminal(name?: string): Promise<ITerminalInstance> {
		this.logService.info('RoocodeTerminalService: Creating terminal', name);

		const terminal = await this.terminalService.createTerminal({
			config: {
				name: name || 'Roo Code'
			}
		});

		if (terminal) {
			this.roocodeTerminals.set(terminal.instanceId, terminal);

			// Register disposal handler
			terminal.onDisposed(() => {
				this.roocodeTerminals.delete(terminal.instanceId);
			});
		}

		return terminal;
	}

	/**
	 * Execute command in terminal
	 */
	async executeCommand(command: string, options?: {
		terminalId?: number;
		createIfNotExists?: boolean;
		waitForExit?: boolean;
	}): Promise<ITerminalExecutionResult> {
		this.logService.info('RoocodeTerminalService: Executing command', command);

		let terminal: ITerminalInstance | undefined;

		// Get or create terminal
		if (options?.terminalId) {
			terminal = this.roocodeTerminals.get(options.terminalId);
		}

		if (!terminal && options?.createIfNotExists !== false) {
			terminal = await this.createTerminal();
		}

		if (!terminal) {
			throw new Error('No terminal available for command execution');
		}

		// Execute command
		terminal.sendText(command, true);

		const result: ITerminalExecutionResult = {
			terminalId: terminal.instanceId,
			command
		};

		this._onDidExecuteCommand.fire(result);

		return result;
	}

	/**
	 * Execute multiple commands sequentially
	 */
	async executeCommandSequence(commands: string[], terminalId?: number): Promise<ITerminalExecutionResult[]> {
		this.logService.info('RoocodeTerminalService: Executing command sequence', commands.length);

		const results: ITerminalExecutionResult[] = [];

		for (const command of commands) {
			const result = await this.executeCommand(command, {
				terminalId,
				createIfNotExists: terminalId === undefined
			});
			results.push(result);

			// Use the same terminal for all commands
			terminalId = result.terminalId;
		}

		return results;
	}

	/**
	 * Get active Roo Code terminal
	 */
	getActiveTerminal(): ITerminalInstance | undefined {
		if (this.roocodeTerminals.size === 0) {
			return undefined;
		}
		// Return the most recently created terminal
		const terminals = Array.from(this.roocodeTerminals.values());
		return terminals[terminals.length - 1];
	}

	/**
	 * Get all Roo Code terminals
	 */
	getAllTerminals(): ITerminalInstance[] {
		return Array.from(this.roocodeTerminals.values());
	}

	/**
	 * Close terminal
	 */
	async closeTerminal(terminalId: number): Promise<void> {
		this.logService.info('RoocodeTerminalService: Closing terminal', terminalId);

		const terminal = this.roocodeTerminals.get(terminalId);
		if (terminal) {
			terminal.dispose();
			this.roocodeTerminals.delete(terminalId);
		}
	}

	/**
	 * Close all Roo Code terminals
	 */
	async closeAllTerminals(): Promise<void> {
		this.logService.info('RoocodeTerminalService: Closing all terminals');

		for (const terminal of this.roocodeTerminals.values()) {
			terminal.dispose();
		}
		this.roocodeTerminals.clear();
	}

	override dispose(): void {
		this.logService.info('RoocodeTerminalService: Disposing');
		this.closeAllTerminals();
		super.dispose();
	}
}

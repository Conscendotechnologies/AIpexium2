/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { Emitter, Event } from '../../../../base/common/event.js';

/**
 * MCP Server configuration
 */
export interface IMCPServerConfig {
	id: string;
	name: string;
	command: string;
	args?: string[];
	env?: Record<string, string>;
	autoStart?: boolean;
}

/**
 * MCP Server instance
 */
export interface IMCPServer {
	id: string;
	config: IMCPServerConfig;
	status: 'disconnected' | 'connecting' | 'connected' | 'error';
	lastError?: string;
}

/**
 * Service for managing MCP (Model Context Protocol) servers
 * This enables Pro-Code's advanced integration capabilities
 */
export class RoocodeMCPService extends Disposable {
	private readonly _onDidServerChange = this._register(new Emitter<IMCPServer>());
	readonly onDidServerChange: Event<IMCPServer> = this._onDidServerChange.event;

	private mcpServers = new Map<string, IMCPServer>();

	constructor(
		@ILogService private readonly logService: ILogService
	) {
		super();
		this.logService.info('RoocodeMCPService: Initializing MCP service');
	}

	/**
	 * Connect to an MCP server
	 */
	async connectToMCPServer(config: IMCPServerConfig): Promise<void> {
		this.logService.info(`RoocodeMCPService: Connecting to MCP server ${config.id}`);

		const server: IMCPServer = {
			id: config.id,
			config,
			status: 'connecting'
		};

		this.mcpServers.set(config.id, server);
		this._onDidServerChange.fire(server);

		try {
			// MCP connection logic will be implemented here
			// For now, we'll simulate a successful connection
			server.status = 'connected';
			this.logService.info(`RoocodeMCPService: Successfully connected to ${config.id}`);
			this._onDidServerChange.fire(server);
		} catch (error) {
			server.status = 'error';
			server.lastError = error instanceof Error ? error.message : String(error);
			this.logService.error(`RoocodeMCPService: Failed to connect to ${config.id}`, error);
			this._onDidServerChange.fire(server);
			throw error;
		}
	}

	/**
	 * Disconnect from an MCP server
	 */
	async disconnectFromMCPServer(serverId: string): Promise<void> {
		const server = this.mcpServers.get(serverId);
		if (!server) {
			this.logService.warn(`RoocodeMCPService: Server ${serverId} not found`);
			return;
		}

		this.logService.info(`RoocodeMCPService: Disconnecting from MCP server ${serverId}`);
		server.status = 'disconnected';
		this._onDidServerChange.fire(server);
		this.mcpServers.delete(serverId);
	}

	/**
	 * Get all connected MCP servers
	 */
	getConnectedServers(): IMCPServer[] {
		return Array.from(this.mcpServers.values()).filter(s => s.status === 'connected');
	}

	/**
	 * Get a specific MCP server
	 */
	getServer(serverId: string): IMCPServer | undefined {
		return this.mcpServers.get(serverId);
	}

	override dispose(): void {
		// Disconnect all servers
		for (const serverId of this.mcpServers.keys()) {
			this.disconnectFromMCPServer(serverId);
		}
		super.dispose();
	}
}

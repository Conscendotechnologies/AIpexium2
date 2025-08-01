/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// mcpClient.ts - Filesystem MCP Server Only

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

interface Tool {
	name: string;
	[key: string]: any;
}

interface ServerConfig {
	command?: string;
	args?: string[];
	env?: Record<string, string>;
}

interface Settings {
	servers: {
		filesystem?: ServerConfig;
	};
}

export async function setupMcpClients() {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders || workspaceFolders.length === 0) {
		return {};
	}

	const workspaceRoot = workspaceFolders[0].uri.fsPath;
	const configPath = path.join(workspaceRoot, ".aipexium", "mcp-settings.json");

	if (!fs.existsSync(configPath)) {
		return {};
	}

	let settings: Settings;
	try {
		const raw = fs.readFileSync(configPath, "utf-8");
		settings = JSON.parse(raw);
	} catch {
		return {};
	}

	const clients: Record<string, Client> = {};

	if (settings.servers.filesystem) {
		const filesystemClient = await setupFilesystemClient(settings.servers.filesystem);
		if (filesystemClient) {
			clients.filesystem = filesystemClient;
		}
	}

	return clients;
}

async function setupFilesystemClient(config: ServerConfig): Promise<Client | null> {
	if (!config.command) {
		return null;
	}

	const cleanEnv: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (value !== undefined) {
			cleanEnv[key] = value;
		}
	}

	const transport = new StdioClientTransport({
		command: config.command,
		args: config.args || [],
		env: {
			...cleanEnv,
			...config.env
		}
	});

	const client = new Client({ name: "vscode-filesystem-mcp-client", version: "1.0.0" });

	try {
		await client.connect(transport);
		await listTools(client);
		return client;
	} catch {
		return null;
	}
}

async function listTools(client: Client) {
	try {
		await client.listTools();
	} catch {
		// Silent fail if tool listing fails
	}
}

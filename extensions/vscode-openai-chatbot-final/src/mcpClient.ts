/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// mcpClient.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import * as fs from "fs";
import * as path from "path";

interface Tool {
	name: string;
	[key: string]: any;
}

export async function setupMcpClient() {
	console.log("[MCP] Initializing GitHub MCP client...");

	const configPath = path.resolve(__dirname, "..", "mcp-settings.json");
	if (!fs.existsSync(configPath)) {
		console.error("[MCP] mcp-settings.json not found");
		return null;
	}

	const raw = fs.readFileSync(configPath, "utf-8");
	const settings = JSON.parse(raw);
	const github = settings.servers.github;
	if (!github?.url || !github?.authorization_token) {
		console.error("[MCP] GitHub server URL or token missing in settings");
		return null;
	}

	console.log(`[MCP] [%s] endpoint: %s`, "github", github.url);
	const transport = new StreamableHTTPClientTransport(new URL(github.url), {
		requestInit: {
			headers: {
				Authorization: github.authorization_token,
				Accept: "application/json, text/event-stream",
			},
		},
	});

	const client = new Client({ name: "vscode-github-mcp-client", version: "1.0.0" });
	console.log("[MCP] Client created");

	try {
		await client.connect(transport);
		console.log("[MCP] Connected successfully to GitHub MCP server");
	} catch (err: any) {
		console.error("[MCP] Connection failed:", err.message);
		return null;
	}

	try {
		const resp = (await client.listTools()) as { tools?: Tool[] };
		const tools = resp.tools || [];
		console.log(`[MCP] ${tools.length} tools available:`);
		tools.forEach((t, i) => console.log(`  [${i + 1}] ${t.name}`));
	} catch (err: any) {
		console.error("[MCP] listTools failed:", err.message);
	}

	return client;
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { callOpenAI, ChatMessage } from './openaiClient';
import { setupMcpClients } from './mcpClient';
import { contextManager } from './contextManager';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from "vscode";


const TOOL_TAG_REGEX = /<use_mcp_tool name="(.+?)" client="(.+?)">(.*?)<\/use_mcp_tool>/gs;

let mcpClients: Record<string, Client> = {};
let cachedTools: any[] = [];
let systemPromptInitialized = false;

async function ensureMcpSetup() {
	console.log('[Task] 🔍 Ensuring MCP setup...');
	if (Object.keys(mcpClients).length === 0) {
		console.log('[Task] 🔧 Setting up MCP clients...');
		mcpClients = await setupMcpClients();
		console.log('[Task] 📊 Available clients after setup:', Object.keys(mcpClients));

		if (Object.keys(mcpClients).length === 0) {
			console.error('[Task] ❌ No MCP clients were successfully setup!');
		} else {
			console.log('[Task] ✅ MCP clients setup completed');
		}
	} else {
		console.log('[Task] ✅ MCP clients already setup:', Object.keys(mcpClients));
	}
}
function getFilesystemBasePath(): string {
	try {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
		const settingsPath = path.join(workspaceFolder, '.aipexium', 'mcp-settings.json');

		const raw = fs.readFileSync(settingsPath, 'utf-8');
		const config = JSON.parse(raw);
		const args = config?.servers?.filesystem?.args;

		// Assume last argument is the base path
		if (Array.isArray(args) && args.length > 0) {
			return args[args.length - 1];
		}
	} catch (err) {
		console.error('[Task] ❌ Failed to read mcp-settings.json:', err);
	}

	// Fallback to default path
	return 'force-app/main/default';
}

async function initializeSystemPrompt() {
	console.log('[Task] 🔍 Checking if system prompt needs initialization...');
	if (systemPromptInitialized) return;

	await ensureMcpSetup();

	if (cachedTools.length === 0 && mcpClients.filesystem) {
		try {
			const toolsResponse = await mcpClients.filesystem.listTools();
			const tools = (toolsResponse as any).tools || [];
			cachedTools.push(...tools.map((t: any) => ({ ...t, client: 'filesystem' })));
		} catch (error: any) {
			console.error('[Task] ❌ Error loading tools from filesystem:', error.message);
		}
	}

	const toolsDescription = cachedTools.length > 0
		? cachedTools.map((t: any) => `Tool: ${t.name}, Client: ${t.client}, Desc: ${t.description || 'n/a'}`).join('\n')
		: 'No tools available.';

	const basePath = getFilesystemBasePath();

	const systemPrompt = `You are a proactive VS Code assistant with access to filesystem tools. Use the tools automatically to help users without asking questions.

You can use the following tools:
${toolsDescription}

RULES:
1. Use the tools without asking the user anything.
2. When the user asks to create an Apex class:
   - Use write_file tool to create it in "${basePath}/classes/"
   - Also create the corresponding .cls-meta.xml file
3. When the user asks to create an LWC component:
   - Create folder under "${basePath}/lwc/{componentName}/"
   - Create {componentName}.html, {componentName}.js, and {componentName}.js-meta.xml
   - If an Apex class is needed, create that first
4. Use directory_tree, search_files, or list_directory to find paths and verify folder existence
5. Always use full path (e.g. ${basePath}/classes/MyClass.cls)
6. Format tool calls using:
   <use_mcp_tool name="write_file" client="filesystem">{"path": "path/to/file", "content": "..."}</use_mcp_tool>
7. DO NOT show <use_mcp_tool> commands in the chat response.
   - Instead, after successful execution, respond with a simple message like:
      File "MyClass.cls" created successfully.
      Files "example.html", "example.js", and "example.js-meta.xml" created successfully.
8. Don't ask the user where to create the file. Just assume standard Salesforce DX paths and do it.
9. When the user asks to create a trigger:
   - Use write_file tool to create it in "${basePath}/triggers/"
   - Also create the corresponding .trigger-meta.xml file
Examples (for internal processing only):
<use_mcp_tool name="write_file" client="filesystem">{"path": "${basePath}/classes/AccountFetcher.cls", "content": "public with sharing class AccountFetcher {...}"}</use_mcp_tool>
<use_mcp_tool name="write_file" client="filesystem">{"path": "${basePath}/lwc/helloWorld/helloWorld.html", "content": "<template>Hello World</template>"}</use_mcp_tool>`;

	contextManager.initializeWithSystemPrompt(systemPrompt);
	systemPromptInitialized = true;
	console.log('[Task] ✅ System prompt initialized with basePath:', basePath);
}


async function executeToolCall(toolName: string, clientName: string, rawArgs: string): Promise<any> {
	console.log('[Task] 🔧 Executing tool call:', { toolName, clientName, rawArgs });

	const client = mcpClients[clientName];
	if (!client) {
		const errorMsg = `Client ${clientName} not found. Available clients: ${Object.keys(mcpClients).join(', ')}`;
		console.error('[Task] ❌', errorMsg);
		throw new Error(errorMsg);
	}

	console.log('[Task] ✅ Client found for:', clientName);

	let parsedArgs;
	try {
		parsedArgs = JSON.parse(rawArgs.trim());
		console.log('[Task] ✅ Successfully parsed tool arguments:', parsedArgs);
	} catch (parseError) {
		console.error('[Task] ❌ Failed to parse tool arguments:', rawArgs);
		console.error('[Task] 🔍 Parse error:', parseError);
		throw new Error(`Invalid JSON in tool arguments: ${rawArgs}`);
	}

	console.log('[Task] 🚀 Calling tool:', toolName, 'with parsed args:', parsedArgs);

	try {
		const result = await client.callTool({
			name: toolName,
			arguments: parsedArgs
		});

		console.log('[Task] ✅ Tool execution successful!');
		console.log('[Task] 📊 Tool result:', result);
		return result;
	} catch (toolError: any) {
		console.error('[Task] ❌ Tool execution failed:', toolError.message);
		console.error('[Task] 🔍 Full tool error:', toolError);
		throw toolError;
	}
}

export async function handleTask(userPrompt: string, model: string): Promise<string> {
	console.log('[Task] 🚀 Processing task with prompt:', userPrompt);
	console.log('[Task] 📊 Using model:', model);

	console.log('[Task] 🔧 Initializing system prompt...');
	await initializeSystemPrompt();

	console.log('[Task] 💬 Adding user message to context...');
	contextManager.addMessage('user', userPrompt);
	const conversationMessages = contextManager.getMessages();
	console.log(`[Task] 📊 Using ${conversationMessages.length} messages from context`);

	console.log('[Task] 🤖 Calling OpenAI for initial response...');
	let currentResponse = await callOpenAI(conversationMessages, model);
	console.log('[Task] ✅ Initial AI response received (first 200 chars):', currentResponse.substring(0, 200));

	contextManager.addMessage('assistant', currentResponse);

	let toolExecutionCount = 0;
	const maxToolExecutions = 5;

	console.log('[Task] 🔍 Starting tool execution loop...');
	while (toolExecutionCount < maxToolExecutions) {
		const toolMatches = Array.from(currentResponse.matchAll(TOOL_TAG_REGEX));
		console.log(`[Task] 🔍 Detected ${toolMatches.length} <use_mcp_tool> tags in AI response`);

		if (toolMatches.length === 0) {
			console.log('[Task] ❌ No tool tags found. AI did not attempt tool execution.');
			console.log('[Task] 📋 Final response (first 200 chars):', currentResponse.substring(0, 200));
			break;
		}

		console.log(`[Task] 🔁 Executing ${toolMatches.length} tool(s) (iteration ${toolExecutionCount + 1})`);

		for (const [index, match] of toolMatches.entries()) {
			const [fullMatch, toolName, clientName, rawArgs] = match;
			console.log(`[Task] 🔧 Tool ${index + 1}/${toolMatches.length} - Usage detected:`, {
				toolName,
				clientName,
				rawArgs: rawArgs.substring(0, 100) + (rawArgs.length > 100 ? '...' : '')
			});

			try {
				console.log(`[Task] 🚀 Executing tool ${toolName}...`);
				const result = await executeToolCall(toolName, clientName, rawArgs);
				console.log(`[Task] ✅ Tool ${toolName} execution successful!`);
				console.log('[Task] 📊 Tool result preview:', JSON.stringify(result, null, 2).substring(0, 200));

				contextManager.addMessage('assistant', `✅ Tool '${toolName}' executed successfully.\nResult:\n${JSON.stringify(result, null, 2)}`);
				console.log('[Task] ✅ Tool result added to context');

			} catch (err: any) {
				console.error(`[Task] ❌ Tool ${toolName} execution failed:`, err.message);
				console.error('[Task] 🔍 Full error:', err);
				const errorMessage = `Tool execution failed: ${err.message}`;
				contextManager.addMessage('assistant', errorMessage);
				console.log('[Task] ❌ Returning error message to user');
				return errorMessage;
			}
		}

		console.log('[Task] 🔁 All tools executed, calling OpenAI with tool results...');

		const updatedMessages = contextManager.getMessages();
		console.log(`[Task] 📊 Updated context has ${updatedMessages.length} messages`);

		currentResponse = await callOpenAI(updatedMessages, model);
		console.log('[Task] ✅ Follow-up AI response received (first 200 chars):', currentResponse.substring(0, 200));

		contextManager.addMessage('assistant', currentResponse);
		toolExecutionCount++;
		console.log(`[Task] 📊 Tool execution count: ${toolExecutionCount}/${maxToolExecutions}`);
	}

	if (toolExecutionCount >= maxToolExecutions) {
		console.warn('[Task] ⚠️ Reached max tool execution limit. Stopping further tool calls.');
		currentResponse += '\n\n(Note: Reached maximum tool execution limit)';
	}

	console.log('[Task] ✅ Task processing completed!');
	console.log('[Task] 📊 Final response length:', currentResponse.length);
	return currentResponse;
}

// Function to clear conversation context if needed
export function clearConversationContext() {
	console.log('[Task] 🧹 Clearing conversation context...');
	contextManager.clearContext();
	systemPromptInitialized = false;
	console.log('[Task] ✅ Conversation context cleared, system prompt reset');
}

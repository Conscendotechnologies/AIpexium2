/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import { handleTask } from './task';

export async function handleUserMessage(prompt: string, model: string): Promise<string> {
	console.log('[Controller] 🚀 Handling user message...');
	console.log('[Controller] 💬 User prompt:', prompt);
	console.log('[Controller] 🤖 Selected model:', model);

	try {
		console.log('[Controller] 🔧 Calling handleTask...');
		const result = await handleTask(prompt, model);
		console.log('[Controller] ✅ Task completed successfully');
		console.log('[Controller] 📊 Result length:', result.length);
		console.log('[Controller] 📋 Result preview (first 200 chars):', result.substring(0, 200));

		// Automatically open created files if any path is found in the result
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (workspaceFolder) {
			console.log('[Controller] 🔍 Workspace folder found:', workspaceFolder.uri.fsPath);
			const workspaceRoot = workspaceFolder.uri.fsPath;

			// Look for file paths in the result
			const fileMatches = [...result.matchAll(/"path"\s*:\s*"([^"]+)"/g)];
			console.log('[Controller] 📄 Found file matches:', fileMatches.length);

			for (const [index, match] of fileMatches.entries()) {
				const relativePath = match[1];
				const fullPath = path.join(workspaceRoot, relativePath);
				console.log(`[Controller] 📂 Attempting to open file ${index + 1}:`, fullPath);

				try {
					const document = await vscode.workspace.openTextDocument(fullPath);
					await vscode.window.showTextDocument(document, { preview: false });
					console.log('[Controller] ✅ Successfully opened file:', fullPath);
				} catch (err: any) {
					console.warn('[Controller] ⚠️ Could not open file:', fullPath);
					console.warn('[Controller] 🔍 File open error:', err.message);
				}
			}

			if (fileMatches.length === 0) {
				console.log('[Controller] 📄 No file paths found in result for auto-opening');
			}
		} else {
			console.log('[Controller] ⚠️ No workspace folder available for file operations');
		}

		console.log('[Controller] ✅ Returning result to user');
		return result;
	} catch (error: any) {
		console.error('[Controller] ❌ Error handling message:', error.message);
		console.error('[Controller] 🔍 Full error:', error);
		console.error('[Controller] 📊 Error stack:', error.stack);

		const errorMessage = 'An error occurred while processing your request: ' + error.message;
		console.log('[Controller] ❌ Returning error message:', errorMessage);
		return errorMessage;
	}
}

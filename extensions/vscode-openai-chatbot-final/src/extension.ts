/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as path from 'path';
import { handleUserMessage } from './controller';
import { clearConversationContext } from './task';
import { setupMcpClients } from './mcpClient';
import * as fs from 'fs';

let toolsList: string[] = [];

export async function activate(context: vscode.ExtensionContext) {
  console.log('[EXT] 🚀 Activating extension...');

  // Setup only filesystem MCP client
  console.log('[EXT] 🔧 Setting up MCP clients...');
  const mcpClients = await setupMcpClients();
  console.log('[EXT] 📊 MCP clients setup result:', Object.keys(mcpClients));

  // Collect tools only from filesystem client
  if (mcpClients.filesystem) {
    console.log('[EXT] 🔍 Fetching tools from filesystem client...');
    try {
      const toolsResponse = await mcpClients.filesystem.listTools();
      const tools = (toolsResponse as any).tools;
      console.log('[EXT] 📋 Raw tools response:', tools);

      if (Array.isArray(tools)) {
        const clientTools = tools.map((tool: any) => `${tool.name} (filesystem)`);
        toolsList.push(...clientTools);
        console.log('[EXT] ✅ Filesystem Tools loaded:', clientTools);
      } else {
        console.log('[EXT] ⚠️ Tools response is not an array:', typeof tools);
      }
    } catch (err: any) {
      console.error('[EXT] ❌ Error fetching tools from filesystem:', err.message);
      console.error('[EXT] 🔍 Full error:', err);
    }
  } else {
    console.error('[EXT] ❌ Filesystem client not available in mcpClients');
  }

  console.log('[EXT] 📊 Final available tools:', toolsList);

  const chatProvider = new ChatViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('openaiChatView', chatProvider)
  );

  // Register clear context command
  const clearContextCommand = vscode.commands.registerCommand('extension.clearContext', () => {
    console.log('[EXT] 🧹 Clear context command triggered');
    clearConversationContext();
    vscode.window.showInformationMessage('Conversation context cleared');
  });
  context.subscriptions.push(clearContextCommand);

  console.log('[EXT] ✅ Extension activation completed');
}

class ChatViewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;

  constructor(private context: vscode.ExtensionContext) {
    console.log('[EXT] 🏗️ ChatViewProvider constructor called');
  }

  async resolveWebviewView(webviewView: vscode.WebviewView) {
    console.log('[EXT] 🌐 Resolving webview view...');
    this._view = webviewView;
    const webview = webviewView.webview;

    webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri]
    };

    const indexPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'index.html');
    console.log('[EXT] 📄 Loading HTML from:', indexPath.fsPath);

    const indexHtml = await fs.promises.readFile(indexPath.fsPath, 'utf-8');

    const htmlWithUris = indexHtml
      .replace('style.css', webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'style.css')).toString())
      .replace('main.js', webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'main.js')).toString());

    webview.html = htmlWithUris;
    console.log('[EXT] ✅ Webview HTML set successfully');

    // Unified message handler
    webview.onDidReceiveMessage(async (message: { command: string; text?: string; model?: string }) => {
      console.log('[EXT] 📨 Received message from webview:', message);

      switch (message.command) {
        case 'send':
          if (message.text && message.model) {
            console.log('[EXT] 💬 Processing user message:', message.text, 'with model:', message.model);
            try {
              const response = await handleUserMessage(message.text, message.model);
              console.log('[EXT] ✅ Got response from handleUserMessage:', response.substring(0, 100) + '...');
              webview.postMessage({ command: 'response', text: response });
            } catch (error: any) {
              console.error('[EXT] ❌ Error processing message:', error);
              console.error('[EXT] 🔍 Error stack:', error.stack);
              webview.postMessage({ command: 'response', text: 'Error processing your request: ' + error.message });
            }
          } else {
            console.warn('[EXT] ⚠️ Send command missing text or model:', message);
          }
          break;

        case 'clearContext':
          console.log('[EXT] 🧹 Clear context requested from webview');
          clearConversationContext();
          webview.postMessage({ command: 'contextCleared', text: 'Conversation context has been cleared.' });
          break;

        case 'showToolsInCommandPalette':
          console.log('[EXT] 🔧 Show tools in command palette requested');
          if (toolsList.length === 0) {
            console.warn('[EXT] ⚠️ No MCP tools available for command palette');
            vscode.window.showWarningMessage('No MCP tools available.');
            return;
          }

          console.log('[EXT] 📋 Showing tools in quick pick:', toolsList);
          const selected = await vscode.window.showQuickPick(toolsList, {
            title: 'Available MCP Tools',
            placeHolder: 'Select a tool...'
          });

          if (selected) {
            console.log('[EXT] ✅ User selected tool:', selected);
            vscode.window.showInformationMessage(`You selected: ${selected}`);
          } else {
            console.log('[EXT] ❌ User cancelled tool selection');
          }
          break;

        default:
          console.warn('[EXT] ⚠️ Unknown command received from webview:', message.command);
          break;
      }
    });

    // Send tools after slight delay to ensure webview is ready
    setTimeout(() => {
      console.log('[EXT] 📤 Sending tools to webview after delay:', toolsList);
      webview.postMessage({ command: 'loadTools', tools: toolsList });
    }, 1000);
  }
}

export function deactivate() {
  console.log('[EXT] 🛑 Extension deactivated');
}

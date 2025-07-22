/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as path from 'path';
import { callOpenAI } from './openaiClient';
import { setupMcpClient } from './mcpClient';
import * as fs from 'fs';

let toolsList: string[] = [];

export async function activate(context: vscode.ExtensionContext) {
  console.log('[EXT] Activating extension...');

  const mcpClient = await setupMcpClient();
  if (mcpClient) {
    try {
      const toolsResponse = await mcpClient.listTools();
      const tools = (toolsResponse as any).tools;

      if (Array.isArray(tools)) {
        toolsList = tools.map((tool: any) => tool.name);
        console.log(`[EXT] MCP Tools:`, toolsList);
      } else {
        console.warn('[EXT] MCP tools list is not an array.');
      }
    } catch (err: any) {
      console.error('[EXT] Error fetching tools:", err.message');
    }
  }

  const chatProvider = new ChatViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('openaiChatView', chatProvider)
  );
}

class ChatViewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;

  constructor(private context: vscode.ExtensionContext) { }

  async resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;
    const webview = webviewView.webview;

    webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri]
    };

    const indexPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'index.html');
    const indexHtml = await fs.promises.readFile(indexPath.fsPath, 'utf-8');

    const htmlWithUris = indexHtml
      .replace('style.css', webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'style.css')).toString())
      .replace('main.js', webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'main.js')).toString());

    webview.html = htmlWithUris;

    // Unified message handler
    webview.onDidReceiveMessage(async (message: { command: string; text?: string; model?: string }) => {
      switch (message.command) {
        case 'send':
          if (message.text && message.model) {
            const response = await callOpenAI(message.text, message.model);
            webview.postMessage({ command: 'response', text: response });
          }
          break;

        case 'showToolsInCommandPalette':
          if (toolsList.length === 0) {
            vscode.window.showWarningMessage('No MCP tools available.');
            return;
          }

          const selected = await vscode.window.showQuickPick(toolsList, {
            title: 'Available MCP Tools',
            placeHolder: 'Select a tool...'
          });

          if (selected) {
            vscode.window.showInformationMessage(`You selected: ${selected}`);
            // Optionally: trigger tool or perform action
          }
          break;

        default:
          console.warn('[EXT] Unknown command received from webview:', message.command);
          break;
      }
    });

    // Send tools after slight delay
    setTimeout(() => {
      webview.postMessage({ command: 'loadTools', tools: toolsList });
    }, 500);
  }
}

export function deactivate() { }

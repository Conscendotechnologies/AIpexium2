/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import axios from 'axios';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string; // only used for 'tool' messages
}

function getApiKey(): string {
  try {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      throw new Error('No workspace folder found. Please open a workspace and configure your API key using the key icon in the secondary sidebar.');
    }

    const apiKeyPath = path.join(workspaceFolder.uri.fsPath, '.vscode', 'openai-api-key.txt');

    if (!fs.existsSync(apiKeyPath)) {
      throw new Error('OpenAI API key not configured. Please configure it using the key icon in the secondary sidebar.');
    }

    const apiKey = fs.readFileSync(apiKeyPath, 'utf-8').trim();

    if (!apiKey || apiKey === '') {
      throw new Error('OpenAI API key file is empty. Please configure it using the key icon in the secondary sidebar.');
    }

    return apiKey;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      throw new Error('OpenAI API key not configured. Please configure it using the key icon in the secondary sidebar.');
    }
    throw error;
  }
}

export async function callOpenAI(messages: ChatMessage[], model: string): Promise<string> {
  console.log('[OpenAI] 🚀 Starting OpenAI API call...');
  console.log('[OpenAI] 🤖 Using model:', model);
  console.log('[OpenAI] 📊 Number of messages:', messages.length);

  // Log message types and lengths
  messages.forEach((msg, index) => {
    console.log(`[OpenAI] 📋 Message ${index + 1}: ${msg.role} (${msg.content.length} chars)${msg.name ? ` [${msg.name}]` : ''}`);
  });

  try {
    const OPENAI_API_KEY = getApiKey();
    console.log('[OpenAI] 🔐 Using configured API key (first 10 chars):', OPENAI_API_KEY.substring(0, 10) + '...');

    const requestPayload = {
      model,
      messages,
      temperature: 0.7,
      max_tokens: 2000
    };

    console.log('[OpenAI] 📤 Request payload prepared');
    console.log('[OpenAI] 🌡️ Temperature:', requestPayload.temperature);
    console.log('[OpenAI] 🎯 Max tokens:', requestPayload.max_tokens);

    console.log('[OpenAI] 🌐 Sending POST request to OpenAI API...');
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      requestPayload,
      {
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('[OpenAI] ✅ Response received from OpenAI API');
    console.log('[OpenAI] 📊 Response status:', response.status);
    console.log('[OpenAI] 📋 Response headers:', Object.keys(response.headers));

    if (!response.data) {
      console.error('[OpenAI] ❌ No data in response');
      throw new Error('No data received from OpenAI API');
    }

    if (!response.data.choices || response.data.choices.length === 0) {
      console.error('[OpenAI] ❌ No choices in response');
      console.error('[OpenAI] 🔍 Response data:', response.data);
      throw new Error('No choices returned from OpenAI API');
    }

    const result = response.data.choices[0].message.content;
    console.log('[OpenAI] ✅ Successfully extracted response content');
    console.log('[OpenAI] 📊 Response length:', result ? result.length : 0);
    console.log('[OpenAI] 📋 Response preview (first 200 chars):', result ? result.substring(0, 200) : 'null');

    // Log usage information if available
    if (response.data.usage) {
      console.log('[OpenAI] 📊 Token usage:', response.data.usage);
    }

    return result || 'Empty response from OpenAI';

  } catch (error: any) {
    console.error('[OpenAI] ❌ Error occurred during API call');
    console.error('[OpenAI] 🔍 Error message:', error.message);

    if (error.response) {
      console.error('[OpenAI] 📊 Response status:', error.response.status);
      console.error('[OpenAI] 📋 Response status text:', error.response.statusText);
      console.error('[OpenAI] 🔍 Response data:', error.response.data);

      // Log specific error details
      if (error.response.data && error.response.data.error) {
        console.error('[OpenAI] ❌ API Error details:', error.response.data.error);
      }

      // Handle authentication errors specifically
      if (error.response.status === 401) {
        return 'Authentication failed. Please check your API key configuration using the key icon in the secondary sidebar.';
      }
    } else if (error.request) {
      console.error('[OpenAI] 🌐 Network error - no response received');
      console.error('[OpenAI] 🔍 Request details:', error.request);
    } else {
      console.error('[OpenAI] ⚙️ Request setup error:', error.message);
    }

    console.error('[OpenAI] 📊 Error stack:', error.stack);

    // Return a more informative error message
    const errorMessage = error.response?.data?.error?.message || error.message || 'Unknown error';
    return `Error calling OpenAI API: ${errorMessage}`;
  }
}

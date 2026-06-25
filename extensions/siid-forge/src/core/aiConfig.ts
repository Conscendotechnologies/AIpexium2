/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';

/**
 * Manages SIID Forge's OWN OpenRouter API key + model, so Forge can call the
 * LLM directly (independent of the SIID-Code agent). The key lives in Forge's
 * encrypted SecretStorage; we cannot read SIID-Code's key (VS Code SecretStorage
 * is encrypted and scoped per-extension), so Forge keeps its own. Resolution
 * order: env var → setting → SecretStorage.
 */

const SECRET_KEY = 'siid-forge.openRouterApiKey';
const DEFAULT_MODEL = 'anthropic/claude-sonnet-4.5';

export class AiConfig {
  constructor(private readonly context: vscode.ExtensionContext) { }

  /** Resolves the API key: env var, then setting, then SecretStorage. */
  async getApiKey(): Promise<string | undefined> {
    const env = process.env.OPENROUTER_API_KEY?.trim();
    if (env) {
      return env;
    }
    const setting = vscode.workspace.getConfiguration('siid-forge').get<string>('openRouterApiKey')?.trim();
    if (setting) {
      return setting;
    }
    return (await this.context.secrets.get(SECRET_KEY))?.trim() || undefined;
  }

  async hasApiKey(): Promise<boolean> {
    return !!(await this.getApiKey());
  }

  /** Prompts for and stores the key in SecretStorage. Returns true if saved. */
  async promptAndStoreApiKey(): Promise<boolean> {
    const key = await vscode.window.showInputBox({
      title: 'SIID Forge: OpenRouter API Key',
      prompt: 'Paste your OpenRouter API key (stored securely in SecretStorage).',
      password: true,
      placeHolder: 'sk-or-…',
      ignoreFocusOut: true,
      validateInput: (v) => (v.trim().length > 10 ? undefined : 'That doesn’t look like a valid key.')
    });
    if (!key) {
      return false;
    }
    await this.context.secrets.store(SECRET_KEY, key.trim());
    return true;
  }

  async clearApiKey(): Promise<void> {
    await this.context.secrets.delete(SECRET_KEY);
  }

  /** The model to use (setting override, else a sensible default). */
  getModel(): string {
    return vscode.workspace.getConfiguration('siid-forge').get<string>('aiModel')?.trim() || DEFAULT_MODEL;
  }

  /** Persists the chosen model to the (global) setting. */
  async setModel(model: string): Promise<void> {
    await vscode.workspace.getConfiguration('siid-forge').update('aiModel', model.trim(), vscode.ConfigurationTarget.Global);
  }
}

/** A few common OpenRouter models offered as quick picks (free text allowed). */
export const SUGGESTED_MODELS = [
  'anthropic/claude-sonnet-4.5',
  'anthropic/claude-opus-4.1',
  'openai/gpt-5.1',
  'openai/gpt-5.1-mini',
  'google/gemini-2.5-pro',
  'deepseek/deepseek-chat'
];

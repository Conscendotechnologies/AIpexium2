/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';

/**
 * Hands a prompt off to the SIID-Code AI agent (a separate Roo-Cline-based
 * extension). SIID Forge embeds no LLM — it prepares deterministic context and
 * delegates the generative work to the installed agent, per "one engine, many
 * consumers". Falls back to the clipboard when the agent isn't available so the
 * user can paste the prompt manually.
 */

const SIID_CODE_ID = 'ConscendoTechInc.siid-code';

interface SiidCodeApi {
  startNewTask?(opts: { text: string; images?: string[]; newTab?: boolean }): Promise<unknown> | unknown;
}

export type HandoffResult = 'started' | 'clipboard';

/**
 * Starts a new SIID-Code task with `text`. If the agent extension is missing or
 * doesn't expose the API, copies the prompt to the clipboard and returns
 * 'clipboard' so the caller can tell the user to paste it.
 */
export async function handToAgent(text: string): Promise<HandoffResult> {
  const ext = vscode.extensions.getExtension(SIID_CODE_ID);
  if (ext) {
    try {
      const api = (ext.isActive ? ext.exports : await ext.activate()) as SiidCodeApi | undefined;
      if (api && typeof api.startNewTask === 'function') {
        await api.startNewTask({ text, newTab: false });
        // Bring the chat into view if the command exists.
        await vscode.commands.executeCommand('siid-code.focusInput').then(undefined, () => undefined);
        return 'started';
      }
    } catch {
      // Fall through to clipboard.
    }
    // The extension exists but no usable API — try its newTask command, else clipboard.
    try {
      await vscode.commands.executeCommand('siid-code.newTask', { prompt: text });
      return 'started';
    } catch {
      // Fall through.
    }
  }
  await vscode.env.clipboard.writeText(text);
  return 'clipboard';
}

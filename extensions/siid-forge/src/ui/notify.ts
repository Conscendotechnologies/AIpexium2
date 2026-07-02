/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';

/**
 * One place for user-facing toasts so every command speaks the same way:
 * success is prefixed ✅, failure ❌, and "cancelled" is worded identically
 * everywhere. Features should prefer these over calling `vscode.window.show*`
 * directly for the ok/err/cancelled/info cases.
 */
export const notify = {
  /** Success toast (✅ prefix). */
  ok(message: string): void {
    void vscode.window.showInformationMessage(`✅ ${message}`);
  },
  /** Error toast (❌ prefix). */
  err(message: string): void {
    void vscode.window.showErrorMessage(`❌ ${message}`);
  },
  /**
   * Warning toast (⚠️ prefix) — for a real caution the user should notice but
   * that isn't a failure (e.g. "log wasn't captured at FINEST", "no logs yet").
   * Distinct from `err`: don't downgrade a genuine warning to an error.
   */
  warn(message: string): void {
    void vscode.window.showWarningMessage(`⚠️ ${message}`);
  },
  /** Neutral info toast (no prefix). */
  info(message: string): void {
    void vscode.window.showInformationMessage(message);
  },
  /** The single, consistent "cancelled" wording. */
  cancelled(what: string): void {
    void vscode.window.showInformationMessage(`${what} cancelled.`);
  }
};

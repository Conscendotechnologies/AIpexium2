/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { Commands } from '../commands';
import { Feature } from './types';

/**
 * "Retrieve Metadata" now opens the sf-project-retriever panel — the single
 * diff-based retrieve UI (compare org↔local, grouped by type, per-file apply).
 * Forge just delegates to its command. The two extensions always ship together
 * (both internal), so the command is guaranteed present.
 */
export const registerRetrieveMetadata: Feature = ({ context }) => {
  context.subscriptions.push(
    vscode.commands.registerCommand(Commands.retrieveMetadata, async () => {
      await vscode.commands.executeCommand('sf-project-retriever.openRetriever');
    })
  );
};

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../base/common/lifecycle.js';
import { CommandsRegistry } from '../../../platform/commands/common/commands.js';
import { IBlockingProgressDialogService } from '../../services/progress/common/blockingProgressDialog.js';
import { Codicon } from '../../../base/common/codicons.js';
import { ThemeIcon } from '../../../base/common/themables.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../common/contributions.js';
import { IHostService } from '../../services/host/browser/host.js';

export class MainThreadBlockingProgress extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.mainThreadBlockingProgress';

	private currentDialog: { close: () => void; updateMessage: (message: string) => void; updateTitle: (title: string) => void; updateProgress: (current: number, total: number) => void; showRestartButton: (onRestart: () => void, onLater: () => void) => void } | undefined;

	constructor(
		@IBlockingProgressDialogService private readonly blockingProgressService: IBlockingProgressDialogService,
		@IHostService private readonly hostService: IHostService
	) {
		super();
		console.log('[MainThreadBlockingProgress] Constructor called, service:', blockingProgressService);

		this.registerCommands();
	}

	private registerCommands(): void {
		// Register internal command to show blocking progress
		this._register(CommandsRegistry.registerCommand('_internal.showBlockingProgress', async (_accessor, title: string, message: string, details?: string[]) => {
			console.log('[MainThreadBlockingProgress] _internal.showBlockingProgress called', { title, message, details });

			// Close any existing dialog first
			if (this.currentDialog) {
				console.log('[MainThreadBlockingProgress] Closing existing dialog');
				this.currentDialog.close();
			}

			// Show new dialog
			console.log('[MainThreadBlockingProgress] Calling blockingProgressService.show');
			this.currentDialog = this.blockingProgressService.show({
				title,
				message,
				details,
				icon: ThemeIcon.fromId(Codicon.sync.id)
			});
			console.log('[MainThreadBlockingProgress] Dialog shown successfully');

			return true;
		}));

		// Register internal command to update blocking progress message
		this._register(CommandsRegistry.registerCommand('_internal.updateBlockingProgressMessage', async (_accessor, message: string) => {
			console.log('[MainThreadBlockingProgress] _internal.updateBlockingProgressMessage called', { message });
			if (this.currentDialog) {
				this.currentDialog.updateMessage(message);
				return true;
			} else {
				console.log('[MainThreadBlockingProgress] No dialog to update');
				return false;
			}
		}));

		// Register internal command to update blocking progress title
		this._register(CommandsRegistry.registerCommand('_internal.updateBlockingProgressTitle', async (_accessor, title: string) => {
			console.log('[MainThreadBlockingProgress] _internal.updateBlockingProgressTitle called', { title });
			if (this.currentDialog) {
				this.currentDialog.updateTitle(title);
				return true;
			} else {
				console.log('[MainThreadBlockingProgress] No dialog to update');
				return false;
			}
		}));

		// Register internal command to update blocking progress
		this._register(CommandsRegistry.registerCommand('_internal.updateBlockingProgress', async (_accessor, current: number, total: number) => {
			console.log('[MainThreadBlockingProgress] _internal.updateBlockingProgress called', { current, total });
			if (this.currentDialog) {
				this.currentDialog.updateProgress(current, total);
				return true;
			} else {
				console.log('[MainThreadBlockingProgress] No dialog to update');
				return false;
			}
		}));

		// Register internal command to show restart buttons
		this._register(CommandsRegistry.registerCommand('_internal.showBlockingProgressRestartButtons', async (_accessor) => {
			console.log('[MainThreadBlockingProgress] _internal.showBlockingProgressRestartButtons called');
			if (this.currentDialog) {
				this.currentDialog.showRestartButton(
					// onRestart callback
					async () => {
						console.log('[MainThreadBlockingProgress] Reload Window clicked - executing reload');
						// Use IHostService to reload the window
						await this.hostService.reload();
					},
					// onLater callback
					() => {
						console.log('[MainThreadBlockingProgress] Later clicked');
						// Dialog will close itself via the Later button's click handler
					}
				);
				return true;
			} else {
				console.log('[MainThreadBlockingProgress] No dialog to show restart buttons');
				return false;
			}
		}));

		// Register internal command to close blocking progress
		this._register(CommandsRegistry.registerCommand('_internal.closeBlockingProgress', async () => {
			console.log('[MainThreadBlockingProgress] _internal.closeBlockingProgress called');
			if (this.currentDialog) {
				console.log('[MainThreadBlockingProgress] Closing current dialog');
				this.currentDialog.close();
				this.currentDialog = undefined;
			} else {
				console.log('[MainThreadBlockingProgress] No dialog to close');
			}
			return true;
		}));
	}

	override dispose(): void {
		if (this.currentDialog) {
			this.currentDialog.close();
		}
		super.dispose();
	}
}

registerWorkbenchContribution2(MainThreadBlockingProgress.ID, MainThreadBlockingProgress, WorkbenchPhase.BlockRestore);

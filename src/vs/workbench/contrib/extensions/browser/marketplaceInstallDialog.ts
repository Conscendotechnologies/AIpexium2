/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import Severity from '../../../../base/common/severity.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { MarkdownString } from '../../../../base/common/htmlContent.js';

export const IBlockingProgressDialogService = createDecorator<IBlockingProgressDialogService>('blockingProgressDialogService');

export interface IBlockingProgressOptions {
	/**
	 * The title of the dialog
	 */
	title: string;

	/**
	 * The main message to display
	 */
	message: string;

	/**
	 * Optional icon to display
	 */
	icon?: ThemeIcon;

	/**
	 * Optional additional details in markdown format
	 */
	details?: string[];

	/**
	 * Severity level of the dialog (Info, Warning, Error)
	 */
	severity?: Severity;
}

export interface IBlockingProgressDialogService {
	readonly _serviceBrand: undefined;

	/**
	 * Show a blocking modal dialog that prevents user interaction
	 * @param options Configuration for the blocking dialog
	 * @returns A promise that can be used to control dialog lifetime
	 */
	show(options: IBlockingProgressOptions): { close: () => void };
}

export class BlockingProgressDialogService implements IBlockingProgressDialogService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IDialogService private readonly dialogService: IDialogService
	) { }

	show(options: IBlockingProgressOptions): { close: () => void } {
		// Create markdown details
		const markdownDetails = (options.details || [options.message]).map(detail => ({
			markdown: new MarkdownString(detail)
		}));

		// Show blocking modal without buttons (user cannot close it)
		this.dialogService.prompt({
			type: options.severity ?? Severity.Info,
			message: options.title,
			custom: {
				icon: options.icon,
				disableCloseAction: true, // Prevents ESC/X from closing
				markdownDetails
			},
			buttons: [] // No buttons = user cannot dismiss
		});

		// Return close function
		return {
			close: () => {
				// Dialog will auto-close when this service is disposed or when user completes the action
			}
		};
	}
}

registerSingleton(IBlockingProgressDialogService, BlockingProgressDialogService, InstantiationType.Delayed);

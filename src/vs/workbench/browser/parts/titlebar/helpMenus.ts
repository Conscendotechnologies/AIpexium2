/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { MenuId, registerAction2, Action2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { URI } from '../../../../base/common/uri.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';

export function setupHelpMenus(): void {
	// Help menus are registered through the ReportBugAction registerAction2 call below
}

registerAction2(class ReportBugAction extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.reportBug',
			title: localize({ key: 'miReportBug', comment: ['&& denotes a mnemonic'] }, "Report a &&Bug"),
			menu: {
				id: MenuId.MenubarHelpMenu,
				group: '1_help',
				order: 1
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const openerService = accessor.get(IOpenerService);
		const productService = accessor.get(IProductService);
		const commandService = accessor.get(ICommandService);

		// Get IDE information
		const ideInfo = this.getIdeInformation(productService);

		// Default fallback values
		let email = 'aman.dhakar@conscendo.io';
		let subject = 'Bug Report';
		let body = 'Please describe the issue here...';

		try {
			// Try to get bug report config from firebase-service extension
			// Using vscode.extensions API through a command
			const firebaseApi = await commandService.executeCommand('_firebase-service.getAPI');
			if (firebaseApi && typeof (firebaseApi as any).getBugReportConfig === 'function') {
				const config = await (firebaseApi as any).getBugReportConfig();
				if (config) {
					email = config.email || email;
					subject = config.subject || subject;
					body = config.body || body;
				}
			}
		} catch (error) {
			// If firebase-service is not available or any error occurs, use fallback values
			// Silent fail - this is expected if firebase-service is not installed or not activated
		}

		// Append IDE information to the body
		const fullBody = `${body}\n\n---\n\n${ideInfo}`;

		// Open Gmail compose with pre-filled recipient and subject
		const gmailUrl = `https://mail.google.com/mail/u/0/?view=cm&fs=1&to=${encodeURIComponent(email)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(fullBody)}`;
		openerService.open(URI.parse(gmailUrl), { openExternal: true });
	}

	private getIdeInformation(productService: IProductService): string {
		const lines: string[] = [];

		lines.push(`Version: ${productService.version || 'Unknown'}`);
		lines.push(`Commit: ${productService.commit || 'Unknown'}`);
		lines.push(`Date: ${productService.date || 'Unknown'}`);

		// Browser/Electron information
		if (typeof navigator !== 'undefined') {
			lines.push(`Browser: ${navigator.userAgent || 'Unknown'}`);
		}

		// Try to get additional environment info if available
		if (typeof process !== 'undefined') {
			try {
				if (process.versions) {
					if (process.versions.electron) {
						lines.push(`Electron: ${process.versions.electron}`);
					}
					if (process.versions.chrome) {
						lines.push(`Chromium: ${process.versions.chrome}`);
					}
					if (process.versions.node) {
						lines.push(`Node.js: ${process.versions.node}`);
					}
					if (process.versions.v8) {
						lines.push(`V8: ${process.versions.v8}`);
					}
				}
				if (process.platform && process.arch) {
					lines.push(`OS: ${process.platform} ${process.arch}`);
				}
			} catch (error) {
				// Process info not available in browser context
			}
		}

		return lines.join('\n');
	}
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { MenuId, registerAction2, Action2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { URI } from '../../../../base/common/uri.js';

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

	run(accessor: ServicesAccessor): void {
		const openerService = accessor.get(IOpenerService);
		// Open Gmail compose with pre-filled recipient and subject
		const gmailUrl = 'https://mail.google.com/mail/u/0/?view=cm&fs=1&to=aman.dhakar.191@gmail.com&subject=Bug%20Report&body=Please%20describe%20the%20issue%20here...';
		openerService.open(URI.parse(gmailUrl), { openExternal: true });
	}
});

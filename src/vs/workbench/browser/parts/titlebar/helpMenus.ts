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

	async run(accessor: ServicesAccessor): Promise<void> {
		const openerService = accessor.get(IOpenerService);

		// Default fallback values
		let email = '099637c0.conscendo.io@in.teams.ms';

		const outlookUrl = `https://outlook.office.com/mail/deeplink/compose?to=${encodeURIComponent(email)}`;
		openerService.open(URI.parse(outlookUrl), { openExternal: true });
	}

});

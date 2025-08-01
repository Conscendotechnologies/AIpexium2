/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, MenuId, MenuRegistry, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { AuxiliaryBarVisibleContext, IsAuxiliaryWindowContext } from '../../../common/contextkeys.js';
import { ViewContainerLocation, ViewContainerLocationToString } from '../../../common/views.js';
import { ActivityBarPosition, IWorkbenchLayoutService, LayoutSettings, Parts } from '../../../services/layout/browser/layoutService.js';
import { IPaneCompositePartService } from '../../../services/panecomposite/browser/panecomposite.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { SwitchCompositeViewAction } from '../compositeBarActions.js';
import { closeIcon } from '../panel/panelActions.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { URI } from '../../../../base/common/uri.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';

const auxiliaryBarRightIcon = registerIcon('auxiliarybar-right-layout-icon', Codicon.layoutSidebarRight, localize('toggleAuxiliaryIconRight', 'Icon to toggle the auxiliary bar off in its right position.'));
const auxiliaryBarRightOffIcon = registerIcon('auxiliarybar-right-off-layout-icon', Codicon.layoutSidebarRightOff, localize('toggleAuxiliaryIconRightOn', 'Icon to toggle the auxiliary bar on in its right position.'));
const auxiliaryBarLeftIcon = registerIcon('auxiliarybar-left-layout-icon', Codicon.layoutSidebarLeft, localize('toggleAuxiliaryIconLeft', 'Icon to toggle the auxiliary bar in its left position.'));
const auxiliaryBarLeftOffIcon = registerIcon('auxiliarybar-left-off-layout-icon', Codicon.layoutSidebarLeftOff, localize('toggleAuxiliaryIconLeftOn', 'Icon to toggle the auxiliary bar on in its left position.'));
const keyIcon = registerIcon('auxiliary-key-icon', Codicon.key, localize('auxiliaryKeyIcon', 'Key icon for auxiliary bar'));
const newChatIcon = registerIcon('auxiliarybar-new-chat-icon', Codicon.add, localize('newChatIcon', 'Icon to create a new chat in auxiliary bar.'));
export class ToggleAuxiliaryBarAction extends Action2 {

	static readonly ID = 'workbench.action.toggleAuxiliaryBar';
	static readonly LABEL = localize2('toggleAuxiliaryBar', "Toggle Secondary Side Bar Visibility");

	constructor() {
		super({
			id: ToggleAuxiliaryBarAction.ID,
			title: ToggleAuxiliaryBarAction.LABEL,
			toggled: {
				condition: AuxiliaryBarVisibleContext,
				title: localize('closeSecondarySideBar', 'Hide Secondary Side Bar'),
				icon: closeIcon,
				mnemonicTitle: localize({ key: 'secondary sidebar mnemonic', comment: ['&& denotes a mnemonic'] }, "Secondary Si&&de Bar"),
			},
			icon: closeIcon, // Ensures no flickering when using toggled.icon
			category: Categories.View,
			metadata: {
				description: localize('openAndCloseAuxiliaryBar', 'Open/Show and Close/Hide Secondary Side Bar'),
			},
			f1: true,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyB
			},
			menu: [
				{
					id: MenuId.LayoutControlMenuSubmenu,
					group: '0_workbench_layout',
					order: 1
				},
				{
					id: MenuId.MenubarAppearanceMenu,
					group: '2_workbench_layout',
					order: 2
				}, {
					id: MenuId.AuxiliaryBarTitle,
					group: 'navigation',
					order: 2,
					when: ContextKeyExpr.equals(`config.${LayoutSettings.ACTIVITY_BAR_LOCATION}`, ActivityBarPosition.DEFAULT)
				}
			]
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const layoutService = accessor.get(IWorkbenchLayoutService);
		layoutService.setPartHidden(layoutService.isVisible(Parts.AUXILIARYBAR_PART), Parts.AUXILIARYBAR_PART);
	}
}

export class NewChatAction extends Action2 {

	static readonly ID = 'workbench.action.auxiliaryBar.newChat';
	static readonly LABEL = localize2('newChat', "New Chat");

	constructor() {
		super({
			id: NewChatAction.ID,
			title: NewChatAction.LABEL,
			icon: newChatIcon,
			category: Categories.View,
			metadata: {
				description: localize('newChatDescription', 'Create a new chat or refresh the secondary side bar'),
			},
			f1: true,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyN
			},
			menu: [
				{
					id: MenuId.AuxiliaryBarTitle,
					group: 'navigation',
					order: 1,
					when: AuxiliaryBarVisibleContext
				}
			]
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const commandService = accessor.get(ICommandService);
		const layoutService = accessor.get(IWorkbenchLayoutService);

		try {
			// First try to execute the extension's clear context command
			await commandService.executeCommand('extension.clearContext');
		} catch (error) {
			console.log('Extension clear context command not available, proceeding with refresh');
		}

		// Refresh the auxiliary bar by hiding and showing it
		if (layoutService.isVisible(Parts.AUXILIARYBAR_PART)) {
			layoutService.setPartHidden(true, Parts.AUXILIARYBAR_PART);
			// Small delay to ensure the hide operation completes
			setTimeout(() => {
				layoutService.setPartHidden(false, Parts.AUXILIARYBAR_PART);
			}, 100);
		}
	}
}

registerAction2(NewChatAction);

export class ConfigureKeyAction extends Action2 {

	static readonly ID = 'workbench.action.configureAuxiliaryKey';
	static readonly LABEL = localize2('configureAuxiliaryKey', "Configure API Key");

	constructor() {
		super({
			id: ConfigureKeyAction.ID,
			title: ConfigureKeyAction.LABEL,
			icon: keyIcon,
			category: Categories.View,
			f1: true,
			menu: [
				{
					id: MenuId.AuxiliaryBarTitle,
					group: 'navigation',
					order: 1,
					when: ContextKeyExpr.and(
						AuxiliaryBarVisibleContext,
						ContextKeyExpr.equals(`config.${LayoutSettings.ACTIVITY_BAR_LOCATION}`, ActivityBarPosition.DEFAULT)
					)
				}
			]
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const quickInputService = accessor.get(IQuickInputService);
		const fileService = accessor.get(IFileService);
		const workspaceService = accessor.get(IWorkspaceContextService);

		// Get workspace folder
		const workspaceFolder = workspaceService.getWorkspace().folders[0];
		if (!workspaceFolder) {
			quickInputService.pick([], {
				title: localize('noWorkspaceTitle', 'No Workspace'),
				placeHolder: localize('noWorkspaceMessage', 'Please open a workspace to configure API key')
			});
			return;
		}

		// Define the path for the API key file
		const configDir = URI.joinPath(workspaceFolder.uri, '.vscode');
		const apiKeyFile = URI.joinPath(configDir, 'openai-api-key.txt');

		// Get current key from file (if exists)
		let currentKey = '';
		try {
			const fileContent = await fileService.readFile(apiKeyFile);
			currentKey = fileContent.value.toString().trim();
		} catch (error) {
			// File doesn't exist or can't be read - that's okay
			console.log('[ConfigureKey] API key file does not exist yet');
		}

		const maskedCurrentKey = currentKey ? '••••••••••••••••••••' + currentKey.slice(-8) : '';

		const input = quickInputService.createInputBox();
		input.title = localize('configureKeyTitle', 'Configure API Key');
		input.placeholder = localize('configureKeyPlaceholder', 'Enter your API key...');
		input.prompt = currentKey
			? localize('configureKeyPromptExisting', 'Current key: {0}. Enter new key or leave empty to keep current:', maskedCurrentKey)
			: localize('configureKeyPromptNew', 'Enter your API key');
		input.password = true;
		input.ignoreFocusOut = true;

		input.onDidAccept(async () => {
			const newKey = input.value.trim();

			if (newKey) {
				try {
					// Ensure .vscode directory exists
					try {
						await fileService.createFolder(configDir);
					} catch (error) {
						// Directory might already exist - that's okay
					}

					// Write the API key to file
					await fileService.writeFile(apiKeyFile, VSBuffer.fromString(newKey));

					// Always close the input box immediately after pressing enter
					input.hide();

				} catch (error: any) {
					// Still close the input box on error
					input.hide();
					setTimeout(() => {
						quickInputService.pick([], {
							title: localize('keySaveErrorTitle', 'API Key Save Error'),
							placeHolder: localize('keySaveError', 'Failed to save API key: {0}', error.message)
						});
					}, 100);
					return;
				}
			} else if (!currentKey) {
				// No current key and no new key provided
				input.validationMessage = localize('keyRequiredValidation', 'API key is required');
				return;
			} else {
				// Empty input but current key exists - keep current key
				input.hide();
			}
		});

		input.onDidHide(() => {
			input.dispose();
		});

		input.show();
	}
}

registerAction2(ToggleAuxiliaryBarAction);
registerAction2(ConfigureKeyAction);

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.closeAuxiliaryBar',
			title: localize2('closeSecondarySideBar', 'Hide Secondary Side Bar'),
			category: Categories.View,
			precondition: AuxiliaryBarVisibleContext,
			f1: true,
		});
	}
	run(accessor: ServicesAccessor) {
		accessor.get(IWorkbenchLayoutService).setPartHidden(true, Parts.AUXILIARYBAR_PART);
	}
});

registerAction2(class FocusAuxiliaryBarAction extends Action2 {

	static readonly ID = 'workbench.action.focusAuxiliaryBar';
	static readonly LABEL = localize2('focusAuxiliaryBar', "Focus into Secondary Side Bar");

	constructor() {
		super({
			id: FocusAuxiliaryBarAction.ID,
			title: FocusAuxiliaryBarAction.LABEL,
			category: Categories.View,
			f1: true,
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const paneCompositeService = accessor.get(IPaneCompositePartService);
		const layoutService = accessor.get(IWorkbenchLayoutService);

		// Show auxiliary bar
		if (!layoutService.isVisible(Parts.AUXILIARYBAR_PART)) {
			layoutService.setPartHidden(false, Parts.AUXILIARYBAR_PART);
		}

		// Focus into active composite
		const composite = paneCompositeService.getActivePaneComposite(ViewContainerLocation.AuxiliaryBar);
		composite?.focus();
	}
});

MenuRegistry.appendMenuItems([
	{
		id: MenuId.LayoutControlMenu,
		item: {
			group: '2_pane_toggles',
			command: {
				id: ToggleAuxiliaryBarAction.ID,
				title: localize('toggleSecondarySideBar', "Toggle Secondary Side Bar"),
				toggled: { condition: AuxiliaryBarVisibleContext, icon: auxiliaryBarLeftIcon },
				icon: auxiliaryBarLeftOffIcon,
			},
			when: ContextKeyExpr.and(
				IsAuxiliaryWindowContext.negate(),
				ContextKeyExpr.or(
					ContextKeyExpr.equals('config.workbench.layoutControl.type', 'toggles'),
					ContextKeyExpr.equals('config.workbench.layoutControl.type', 'both')),
				ContextKeyExpr.equals('config.workbench.sideBar.location', 'right')
			),
			order: 0
		}
	}, {
		id: MenuId.LayoutControlMenu,
		item: {
			group: '2_pane_toggles',
			command: {
				id: ToggleAuxiliaryBarAction.ID,
				title: localize('toggleSecondarySideBar', "Toggle Secondary Side Bar"),
				toggled: { condition: AuxiliaryBarVisibleContext, icon: auxiliaryBarRightIcon },
				icon: auxiliaryBarRightOffIcon,
			},
			when: ContextKeyExpr.and(
				IsAuxiliaryWindowContext.negate(),
				ContextKeyExpr.or(
					ContextKeyExpr.equals('config.workbench.layoutControl.type', 'toggles'),
					ContextKeyExpr.equals('config.workbench.layoutControl.type', 'both')),
				ContextKeyExpr.equals('config.workbench.sideBar.location', 'left')
			),
			order: 2
		}
	}, {
		id: MenuId.ViewContainerTitleContext,
		item: {
			group: '3_workbench_layout_move',
			command: {
				id: ToggleAuxiliaryBarAction.ID,
				title: localize2('hideAuxiliaryBar', 'Hide Secondary Side Bar'),
			},
			when: ContextKeyExpr.and(AuxiliaryBarVisibleContext, ContextKeyExpr.equals('viewContainerLocation', ViewContainerLocationToString(ViewContainerLocation.AuxiliaryBar))),
			order: 2
		}
	}
]);

registerAction2(class extends SwitchCompositeViewAction {
	constructor() {
		super({
			id: 'workbench.action.previousAuxiliaryBarView',
			title: localize2('previousAuxiliaryBarView', 'Previous Secondary Side Bar View'),
			category: Categories.View,
			f1: true
		}, ViewContainerLocation.AuxiliaryBar, -1);
	}
});

registerAction2(class extends SwitchCompositeViewAction {
	constructor() {
		super({
			id: 'workbench.action.nextAuxiliaryBarView',
			title: localize2('nextAuxiliaryBarView', 'Next Secondary Side Bar View'),
			category: Categories.View,
			f1: true
		}, ViewContainerLocation.AuxiliaryBar, 1);
	}
});

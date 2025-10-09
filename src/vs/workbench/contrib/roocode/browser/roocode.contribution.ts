/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IRoocodeService } from '../common/roocode.js';
import { RoocodeService } from './roocodeService.js';
import { registerRoocodeCommands } from './roocodeCommands.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { MenuRegistry, MenuId } from '../../../../platform/actions/common/actions.js';
import { localize } from '../../../../nls.js';

/**
 * Roo Code contribution that initializes the Roo Code integration
 */
class RoocodeContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.roocode';

	constructor(
		@ILogService logService: ILogService
	) {
		super();
		logService.info('RoocodeContribution: Initializing Roo Code integration');
	}
}

// Register the Roo Code service
registerSingleton(IRoocodeService, RoocodeService, InstantiationType.Delayed);

// Register the contribution
registerWorkbenchContribution2(RoocodeContribution.ID, RoocodeContribution, WorkbenchPhase.AfterRestored);

// Register commands
registerRoocodeCommands();

// Register configuration settings
const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
configurationRegistry.registerConfiguration({
	id: 'roocode',
	title: localize('roocode', "Roo Code"),
	type: 'object',
	properties: {
		'roocode.apiKey': {
			type: 'string',
			default: '',
			description: localize('roocode.apiKey', "API key for AI provider"),
			scope: 5 /* ConfigurationScope.MACHINE_OVERRIDABLE */
		},
		'roocode.model': {
			type: 'string',
			default: 'gpt-4',
			description: localize('roocode.model', "AI model to use"),
			enum: ['gpt-4', 'gpt-3.5-turbo', 'claude-3-opus', 'claude-3-sonnet'],
			enumDescriptions: [
				localize('roocode.model.gpt4', "OpenAI GPT-4"),
				localize('roocode.model.gpt35', "OpenAI GPT-3.5 Turbo"),
				localize('roocode.model.claude3opus', "Anthropic Claude 3 Opus"),
				localize('roocode.model.claude3sonnet', "Anthropic Claude 3 Sonnet")
			]
		},
		'roocode.mode': {
			type: 'string',
			default: 'code',
			description: localize('roocode.mode', "Default Roo Code operation mode"),
			enum: ['code', 'architect', 'ask', 'debug', 'custom'],
			enumDescriptions: [
				localize('roocode.mode.code', "Code generation and editing mode"),
				localize('roocode.mode.architect', "Architecture and design mode"),
				localize('roocode.mode.ask', "Q&A and documentation mode"),
				localize('roocode.mode.debug', "Debugging assistance mode"),
				localize('roocode.mode.custom', "Custom workflow mode")
			]
		},
		'roocode.autoSave': {
			type: 'boolean',
			default: true,
			description: localize('roocode.autoSave', "Automatically save changes made by Roo Code")
		},
		'roocode.maxTokens': {
			type: 'number',
			default: 4096,
			description: localize('roocode.maxTokens', "Maximum tokens per request"),
			minimum: 100,
			maximum: 32000
		},
		'roocode.enabled': {
			type: 'boolean',
			default: true,
			description: localize('roocode.enabled', "Enable Roo Code integration")
		}
	}
});

// Register menu items
MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
	command: {
		id: 'roocode.startSession',
		title: localize('roocode.startSession', "Roo Code: Start Session")
	}
});

MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
	command: {
		id: 'roocode.stopSession',
		title: localize('roocode.stopSession', "Roo Code: Stop Session")
	}
});

MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
	command: {
		id: 'roocode.getStatus',
		title: localize('roocode.getStatus', "Roo Code: Get Session Status")
	}
});

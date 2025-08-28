/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
console.log('Loading custom.contribution.ts');
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from '../../../common/contributions.js';
import { LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { CustomExtensionInstaller } from './customExtensionInstaller.js';
try {
	Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench)
		.registerWorkbenchContribution(CustomExtensionInstaller, LifecyclePhase.Eventually);
} catch (error) {
	console.error('Failed to register CustomExtensionInstaller:', error);
}



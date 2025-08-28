/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

console.log('Loading customExtensionInstaller.ts');

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkbenchExtensionManagementService } from '../../../services/extensionManagement/common/extensionManagement.js';

const FIRST_LAUNCH_KEY = 'customExtensions.firstLaunchComplete';

export class CustomExtensionInstaller extends Disposable implements IWorkbenchContribution {

	constructor(
		@ILogService private readonly logService: ILogService,
		@IStorageService private readonly storageService: IStorageService,
		@IWorkbenchExtensionManagementService private readonly extensionManagementService: IWorkbenchExtensionManagementService
	) {
		super();
		console.log('CustomExtensionInstaller: Constructor called');
		this.logService.info('CustomExtensionInstaller: Service created');

		// Check and install extensions after a short delay
		setTimeout(() => {
			this.checkAndInstallExtensions();
		}, 3000);
	}

	private async checkAndInstallExtensions(): Promise<void> {
		try {
			// Check if this is the first launch
			const firstLaunchComplete = this.storageService.getBoolean(FIRST_LAUNCH_KEY, StorageScope.APPLICATION, false);

			if (firstLaunchComplete) {
				this.logService.info('Custom extensions already installed, skipping');
				return;
			}

			this.logService.info('First launch detected, installing custom extensions...');

			// Call the extension management service
			await this.extensionManagementService.installDefaultCustomExtensions();

			// Mark first launch as complete
			this.storageService.store(FIRST_LAUNCH_KEY, true, StorageScope.APPLICATION, StorageTarget.MACHINE);

			this.logService.info('Custom extensions installation completed');

		} catch (error) {
			this.logService.error('Error during custom extension installation:', error);
		}
	}
}

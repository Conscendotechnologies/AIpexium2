/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { joinPath } from '../../../../base/common/resources.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';

export interface IImportSettings {
	importSettings: boolean;
	importKeybindings: boolean;
}

export class ImportSettingsService extends Disposable {

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService
	) {
		super();
	}

	async importFromVSCode(options: IImportSettings): Promise<void> {
		try {
			// Get the home directory from environment service
			const homeDir = this.getHomeDirectory();

			console.log('Home directory:', homeDir);

			// VS Code settings location
			const vsCodeUserPath = joinPath(URI.file(homeDir), 'AppData', 'Roaming', 'Code', 'User');
			console.log('VS Code path:', vsCodeUserPath.fsPath);

			// SIID settings path - try dev first
			const siidDevPath = joinPath(URI.file(homeDir), 'AppData', 'Roaming', 'siid-dev', 'User');
			const siidProdPath = joinPath(URI.file(homeDir), 'AppData', 'Roaming', 'siid', 'User');

			// Determine which SIID path to use
			const siidUserPath = await this.resolveSIIDPath(siidDevPath, siidProdPath);
			console.log('SIID path:', siidUserPath.fsPath);

			if (options.importSettings) {
				await this.copyFile(
					joinPath(vsCodeUserPath, 'settings.json'),
					joinPath(siidUserPath, 'settings.json')
				);
			}

			if (options.importKeybindings) {
				console.log('Importing keybindings...');
				await this.copyFile(
					joinPath(vsCodeUserPath, 'keybindings.json'),
					joinPath(siidUserPath, 'keybindings.json')
				);
			}

			console.log('Import complete!');
		} catch (error) {
			console.error('Error importing settings from VS Code:', error);
			throw error;
		}
	}

	/**
	 * Get home directory from environment service
	 */
	private getHomeDirectory(): string {
		// The environment service has the userHome property
		return (this.environmentService as any).userHome?.fsPath || (this.environmentService as any).homePath?.fsPath || '';
	}

	/**
	 * Resolve which SIID path to use
	 */
	private async resolveSIIDPath(devPath: URI, prodPath: URI): Promise<URI> {
		try {
			// Try dev path first
			await this.fileService.stat(devPath);
			console.log('Using SIID dev path');
			return devPath;
		} catch {
			try {
				// Try prod path
				await this.fileService.stat(prodPath);
				console.log('Using SIID production path');
				return prodPath;
			} catch {
				// Default to dev path
				console.log('Using default SIID dev path');
				return devPath;
			}
		}
	}

	private async copyFile(source: URI, destination: URI): Promise<void> {
		try {

			// Check if the source exists
			try {
				await this.fileService.stat(source);
			} catch {
				console.warn(`Source file not found: ${source.fsPath}`);
				return;
			}

			// Ensure destination folder exists
			try {
				await this.fileService.stat(destination);
			} catch {
				const parent = destination.with({
					path: destination.path.substring(0, destination.path.lastIndexOf('/'))
				});
				await this.fileService.createFolder(parent);
			}

			// Read & write
			const srcContent = await this.fileService.readFile(source);
			await this.fileService.writeFile(destination, srcContent.value);

			console.log(`Successfully imported: ${destination.fsPath}`);

		} catch (error) {
			console.error(`Failed to copy file: ${source.fsPath} → ${destination.fsPath}`, error);
			throw error;
		}
	}
}

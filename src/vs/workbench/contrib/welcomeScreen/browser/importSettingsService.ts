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
			// Get home directory
			const homeDir = this.getHomeDirectory();
			console.log('Home directory:', homeDir);

			// VS Code settings folder
			const vsCodeUserPath = joinPath(URI.file(homeDir), 'AppData', 'Roaming', 'Code', 'User');

			// SIID folders
			const siidProdPath = joinPath(URI.file(homeDir), 'AppData', 'Roaming', 'siid', 'User');
			const siidDevPath = joinPath(URI.file(homeDir), 'AppData', 'Roaming', 'siid-dev', 'User');

			console.log('VS Code Path:', vsCodeUserPath.fsPath);
			console.log('SIID Prod Path:', siidProdPath.fsPath);

			// Check if siid-dev exists
			const devExists = await this.pathExists(siidDevPath);
			console.log('SIID-dev exists:', devExists);

			// ALWAYS import to SIID production
			await this.importToTarget(vsCodeUserPath, siidProdPath, options);

			// If SIID-dev exists, import there as well
			if (devExists) {
				console.log('Importing to SIID-dev...');
				await this.importToTarget(vsCodeUserPath, siidDevPath, options);
			}

			console.log('Import complete!');
		} catch (error) {
			console.error('Error importing settings:', error);
			throw error;
		}
	}

	/**
	 * Get home directory from environment service
	 */
	private getHomeDirectory(): string {
		return (
			(this.environmentService as any).userHome?.fsPath ||
			(this.environmentService as any).homePath?.fsPath ||
			''
		);
	}

	/**
	 * Check if a path exists
	 */
	private async pathExists(path: URI): Promise<boolean> {
		try {
			await this.fileService.stat(path);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Import settings to a specific target (prod or dev)
	 */
	private async importToTarget(sourceBase: URI, targetBase: URI, options: IImportSettings): Promise<void> {
		// Import settings.json
		if (options.importSettings) {
			await this.copyFile(
				joinPath(sourceBase, 'settings.json'),
				joinPath(targetBase, 'settings.json')
			);
		}

		// Import keybindings.json
		if (options.importKeybindings) {
			await this.copyFile(
				joinPath(sourceBase, 'keybindings.json'),
				joinPath(targetBase, 'keybindings.json')
			);
		}
	}

	/**
	 * Copy a file safely using file service
	 */
	private async copyFile(source: URI, destination: URI): Promise<void> {
		try {
			// Skip if VS Code file does not exist
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

			// Copy content
			const srcContent = await this.fileService.readFile(source);
			await this.fileService.writeFile(destination, srcContent.value);

			console.log(`Successfully imported: ${destination.fsPath}`);

		} catch (error) {
			console.error(`Failed to copy file: ${source.fsPath} → ${destination.fsPath}`, error);
			throw error;
		}
	}
}

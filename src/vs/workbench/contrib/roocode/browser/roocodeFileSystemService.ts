/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { URI } from '../../../../base/common/uri.js';
import { VSBuffer } from '../../../../base/common/buffer.js';

/**
 * Service for handling file system operations in Roo Code
 * Provides safe and managed access to workspace files
 */
export class RoocodeFileSystemService extends Disposable {
	constructor(
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceService: IWorkspaceContextService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		this.logService.info('RoocodeFileSystemService: Initializing');
	}

	/**
	 * Read file content
	 */
	async readFile(uri: URI): Promise<string> {
		this.logService.info('RoocodeFileSystemService: Reading file', uri.toString());

		try {
			const content = await this.fileService.readFile(uri);
			return content.value.toString();
		} catch (error) {
			this.logService.error('RoocodeFileSystemService: Failed to read file', error);
			throw error;
		}
	}

	/**
	 * Write file content
	 */
	async writeFile(uri: URI, content: string): Promise<void> {
		this.logService.info('RoocodeFileSystemService: Writing file', uri.toString());

		try {
			const buffer = VSBuffer.fromString(content);
			await this.fileService.writeFile(uri, buffer);
		} catch (error) {
			this.logService.error('RoocodeFileSystemService: Failed to write file', error);
			throw error;
		}
	}

	/**
	 * Create new file
	 */
	async createFile(uri: URI, content?: string): Promise<void> {
		this.logService.info('RoocodeFileSystemService: Creating file', uri.toString());

		try {
			const buffer = content ? VSBuffer.fromString(content) : VSBuffer.fromString('');
			await this.fileService.createFile(uri, buffer);
		} catch (error) {
			this.logService.error('RoocodeFileSystemService: Failed to create file', error);
			throw error;
		}
	}

	/**
	 * Delete file
	 */
	async deleteFile(uri: URI): Promise<void> {
		this.logService.info('RoocodeFileSystemService: Deleting file', uri.toString());

		try {
			await this.fileService.del(uri);
		} catch (error) {
			this.logService.error('RoocodeFileSystemService: Failed to delete file', error);
			throw error;
		}
	}

	/**
	 * Check if file exists
	 */
	async exists(uri: URI): Promise<boolean> {
		try {
			const stat = await this.fileService.exists(uri);
			return stat;
		} catch (error) {
			this.logService.error('RoocodeFileSystemService: Failed to check file existence', error);
			return false;
		}
	}

	/**
	 * List files in directory
	 */
	async listFiles(uri: URI): Promise<string[]> {
		this.logService.info('RoocodeFileSystemService: Listing files', uri.toString());

		try {
			const stat = await this.fileService.resolve(uri);
			if (!stat.children) {
				return [];
			}

			return stat.children
				.filter(child => !child.isDirectory)
				.map(child => child.name);
		} catch (error) {
			this.logService.error('RoocodeFileSystemService: Failed to list files', error);
			throw error;
		}
	}

	/**
	 * Get workspace root URI
	 */
	getWorkspaceRoot(): URI | undefined {
		const workspace = this.workspaceService.getWorkspace();
		if (workspace.folders.length === 0) {
			return undefined;
		}
		return workspace.folders[0].uri;
	}

	/**
	 * Resolve relative path to absolute URI
	 */
	resolveWorkspacePath(relativePath: string): URI | undefined {
		const root = this.getWorkspaceRoot();
		if (!root) {
			return undefined;
		}
		return URI.joinPath(root, relativePath);
	}

	override dispose(): void {
		this.logService.info('RoocodeFileSystemService: Disposing');
		super.dispose();
	}
}

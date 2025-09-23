/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IGithubReleaseConfig {
	owner: string;
	repo: string;
	extensionId: string;
	vsixAssetName: string;
}

export interface ICustomExtensionsConfig {
	githubReleases: IGithubReleaseConfig[];
	autoUpdate: boolean;
	checkInterval: number;
}

export interface IDownloadInfo {
	fileName: string;
	filePath: string;
	version: string;
	extensionId: string;
	downloadedAt: number;
}

export interface IExtensionDownloadResult {
	extensionId: string;
	fileName: string;
	filePath: string;
	version: string;
	success: boolean;
	error?: string;
}

export const DOWNLOAD_INFO_PATH = 'downloads/extensions-download-info.json';

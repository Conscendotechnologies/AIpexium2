/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';

export interface SfProjectConfig {
	targetOrg?: string;
	lastRetrieveTime?: number;
}

export class ConfigManager {
	private static readonly CONFIG_SECTION = 'sfProjectRetriever';
	private static readonly SF_CONFIG_PATH = '.sf/config.json';
	private static readonly MANIFEST_PATH = 'manifest/package.xml';

	/**
	 * Gets the target org from workspace-level .sf/config.json
	 */
	async getWorkspaceTargetOrg(workspaceFolder: vscode.WorkspaceFolder): Promise<string | undefined> {
		try {
			const configPath = path.join(workspaceFolder.uri.fsPath, ConfigManager.SF_CONFIG_PATH);
			const content = await vscode.workspace.fs.readFile(vscode.Uri.file(configPath));
			const config = JSON.parse(content.toString());
			return config['target-org'];
		} catch (error) {
			return undefined;
		}
	}

	/**
	 * Checks if the workspace has a manifest file
	 */
	async hasManifest(workspaceFolder: vscode.WorkspaceFolder): Promise<boolean> {
		try {
			const manifestUri = vscode.Uri.joinPath(workspaceFolder.uri, ConfigManager.MANIFEST_PATH);
			await vscode.workspace.fs.stat(manifestUri);
			return true;
		} catch (error) {
			return false;
		}
	}

	/**
	 * Gets the manifest path for the workspace
	 */
	getManifestPath(workspaceFolder: vscode.WorkspaceFolder): string {
		return path.join(workspaceFolder.uri.fsPath, ConfigManager.MANIFEST_PATH);
	}

	/**
	 * Gets extension configuration
	 */
	getConfiguration(): vscode.WorkspaceConfiguration {
		return vscode.workspace.getConfiguration(ConfigManager.CONFIG_SECTION);
	}

	/**
	 * Checks if auto-retrieve on startup is enabled
	 */
	isAutoRetrieveEnabled(): boolean {
		return this.getConfiguration().get<boolean>('autoRetrieveOnStartup', false);
	}

	/**
	 * Gets whether to show notifications
	 */
	shouldShowNotifications(): boolean {
		return this.getConfiguration().get<boolean>('showNotifications', true);
	}

	/**
	 * Saves last retrieve time to workspace state
	 */
	async saveLastRetrieveTime(context: vscode.ExtensionContext): Promise<void> {
		await context.workspaceState.update('lastRetrieveTime', Date.now());
	}

	/**
	 * Gets last retrieve time from workspace state
	 */
	getLastRetrieveTime(context: vscode.ExtensionContext): number | undefined {
		return context.workspaceState.get<number>('lastRetrieveTime');
	}

	/**
	 * Formats last retrieve time as human-readable string
	 */
	formatLastRetrieveTime(context: vscode.ExtensionContext): string {
		const lastTime = this.getLastRetrieveTime(context);
		if (!lastTime) {
			return vscode.l10n.t('Never');
		}

		const now = Date.now();
		const diff = now - lastTime;
		const minutes = Math.floor(diff / 60000);
		const hours = Math.floor(diff / 3600000);
		const days = Math.floor(diff / 86400000);

		if (minutes < 1) {
			return vscode.l10n.t('Just now');
		} else if (minutes < 60) {
			return vscode.l10n.t('{0} minutes ago', minutes);
		} else if (hours < 24) {
			return vscode.l10n.t('{0} hours ago', hours);
		} else {
			return vscode.l10n.t('{0} days ago', days);
		}
	}
}

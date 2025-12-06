/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { exec } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';

const execAsync = promisify(exec);

export interface SfCliResult {
	success: boolean;
	stdout: string;
	stderr: string;
}

export class SfCliService {
	private outputChannel: vscode.OutputChannel;

	constructor(outputChannel: vscode.OutputChannel) {
		this.outputChannel = outputChannel;
	}

	/**
	 * Executes SF CLI command using shell (works like the original version)
	 */
	private async execSfCommand(command: string, options: any = {}): Promise<{ stdout: string; stderr: string }> {
		const execOptions = {
			...options,
			maxBuffer: 50 * 1024 * 1024, // 50MB buffer
			shell: true
		};

		this.outputChannel.appendLine(vscode.l10n.t('Executing: {0}', command));

		try {
			const result = await execAsync(command, execOptions);
			return {
				stdout: result.stdout.toString(),
				stderr: result.stderr.toString()
			};
		} catch (error: any) {
			throw error;
		}
	}	/**
	 * Validates that SF CLI is installed and available
	 */
	async validateCliInstalled(): Promise<boolean> {
		try {
			await this.execSfCommand('sf --version');
			return true;
		} catch (error: any) {
			this.outputChannel.appendLine(vscode.l10n.t('SF CLI not found. Please install Salesforce CLI.'));
			this.outputChannel.appendLine(vscode.l10n.t('Error: {0}', error.message));
			return false;
		}
	}

	/**
	 * Retrieves source from the target org using the manifest
	 */
	async retrieveSource(
		targetOrg: string,
		manifestPath: string,
		workspaceFolder: string,
		cancellationToken: vscode.CancellationToken
	): Promise<SfCliResult> {
		this.outputChannel.appendLine(vscode.l10n.t('Starting retrieve from org: {0}', targetOrg));
		this.outputChannel.appendLine(vscode.l10n.t('Using manifest: {0}', manifestPath));

		try {
			const command = `sf project retrieve start --manifest "${manifestPath}" --target-org ${targetOrg}`;

			// Create a promise that rejects when cancellation is requested
			const cancellationPromise = new Promise<never>((_, reject) => {
				cancellationToken.onCancellationRequested(() => {
					reject(new Error(vscode.l10n.t('Retrieve operation was cancelled')));
				});
			});

			// Race between the command execution and cancellation
			const result = await Promise.race([
				this.execSfCommand(command, {
					cwd: workspaceFolder,
					timeout: 5 * 60 * 1000 // 5 minute timeout
				}),
				cancellationPromise
			]);

			this.outputChannel.appendLine(result.stdout);
			if (result.stderr) {
				this.outputChannel.appendLine(vscode.l10n.t('Warning: {0}', result.stderr));
			}

			return {
				success: true,
				stdout: result.stdout,
				stderr: result.stderr
			};
		} catch (error: any) {
			const errorMessage = error.message || vscode.l10n.t('Unknown error occurred');
			this.outputChannel.appendLine(vscode.l10n.t('Error: {0}', errorMessage));

			if (error.stderr) {
				this.outputChannel.appendLine(error.stderr);
			}

			return {
				success: false,
				stdout: error.stdout || '',
				stderr: error.stderr || errorMessage
			};
		}
	}

	/**
	 * Gets the list of authorized orgs
	 */
	async getAuthorizedOrgs(): Promise<string[]> {
		try {
			const result = await this.execSfCommand('sf org list --json');
			const parsed = JSON.parse(result.stdout);

			if (parsed.status === 0 && parsed.result) {
				const nonScratchOrgs = parsed.result.nonScratchOrgs || [];
				const scratchOrgs = parsed.result.scratchOrgs || [];
				return [...nonScratchOrgs, ...scratchOrgs].map((org: any) => org.username || org.alias);
			}
			return [];
		} catch (error) {
			this.outputChannel.appendLine(vscode.l10n.t('Failed to retrieve org list'));
			return [];
		}
	}

	/**
	 * Checks if the specified org is still authenticated
	 */
	async isOrgAuthenticated(username: string): Promise<boolean> {
		try {
			const result = await this.execSfCommand(`sf org display --target-org ${username} --json`);
			const parsed = JSON.parse(result.stdout);
			this.outputChannel.appendLine(vscode.l10n.t('Org authentication check: {0}', JSON.stringify(parsed, null, 2)));
			return parsed.status === 0;
		} catch (error: any) {
			this.outputChannel.appendLine(vscode.l10n.t('Org authentication check failed: {0}', error.message));
			return false;
		}
	}
}

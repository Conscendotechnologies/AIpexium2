/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export enum RetrieveStatus {
	Idle = 'idle',
	Retrieving = 'retrieving',
	Success = 'success',
	Error = 'error',
	NoOrg = 'noOrg'
}

export class StatusBarManager {
	private statusBarItem: vscode.StatusBarItem;
	private currentStatus: RetrieveStatus = RetrieveStatus.Idle;
	private currentOrg: string | undefined;

	constructor() {
		this.statusBarItem = vscode.window.createStatusBarItem(
			vscode.StatusBarAlignment.Left,
			100
		);
		this.statusBarItem.command = 'sf-project-retriever.retrieveNow';
		this.updateStatusBar();
	}

	/**
	 * Updates the status bar with current state
	 */
	private updateStatusBar(): void {
		switch (this.currentStatus) {
			case RetrieveStatus.Idle:
				if (this.currentOrg) {
					this.statusBarItem.text = `$(cloud-download) SF: ${this.currentOrg}`;
					this.statusBarItem.color = undefined;
					this.statusBarItem.backgroundColor = undefined;
				} else {
					this.statusBarItem.text = `$(cloud-download) SF: ${vscode.l10n.t('No Org')}`;
					this.statusBarItem.color = new vscode.ThemeColor('statusBarItem.warningForeground');
					this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
				}
				break;

			case RetrieveStatus.Retrieving:
				this.statusBarItem.text = `$(sync~spin) ${vscode.l10n.t('Retrieving...')}`;
				this.statusBarItem.color = new vscode.ThemeColor('statusBarItem.prominentForeground');
				this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
				break;

			case RetrieveStatus.Success:
				this.statusBarItem.text = `$(check) ${vscode.l10n.t('Retrieved')}`;
				this.statusBarItem.color = new vscode.ThemeColor('statusBarItem.prominentForeground');
				this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
				break;

			case RetrieveStatus.Error:
				this.statusBarItem.text = `$(error) ${vscode.l10n.t('Retrieve Failed')}`;
				this.statusBarItem.color = new vscode.ThemeColor('statusBarItem.errorForeground');
				this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
				break;

			case RetrieveStatus.NoOrg:
				this.statusBarItem.text = `$(warning) ${vscode.l10n.t('No Org Set')}`;
				this.statusBarItem.color = new vscode.ThemeColor('statusBarItem.warningForeground');
				this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
				break;
		}
	}

	/**
	 * Sets the current org and updates display
	 */
	setOrg(org: string | undefined): void {
		this.currentOrg = org;
		if (org) {
			this.currentStatus = RetrieveStatus.Idle;
		} else {
			this.currentStatus = RetrieveStatus.NoOrg;
		}
		this.updateStatusBar();
	}

	/**
	 * Sets tooltip text
	 */
	setTooltip(tooltip: string): void {
		this.statusBarItem.tooltip = tooltip;
	}

	/**
	 * Updates status to retrieving
	 */
	setRetrieving(): void {
		this.currentStatus = RetrieveStatus.Retrieving;
		this.updateStatusBar();
	}

	/**
	 * Updates status to success (temporarily, then back to idle)
	 */
	setSuccess(): void {
		this.currentStatus = RetrieveStatus.Success;
		this.updateStatusBar();

		// Revert to idle after 3 seconds
		setTimeout(() => {
			if (this.currentStatus === RetrieveStatus.Success) {
				this.currentStatus = RetrieveStatus.Idle;
				this.updateStatusBar();
			}
		}, 3000);
	}

	/**
	 * Updates status to error
	 */
	setError(): void {
		this.currentStatus = RetrieveStatus.Error;
		this.updateStatusBar();
	}

	/**
	 * Resets to idle state
	 */
	resetToIdle(): void {
		this.currentStatus = RetrieveStatus.Idle;
		this.updateStatusBar();
	}

	/**
	 * Shows the status bar item
	 */
	show(): void {
		this.statusBarItem.show();
	}

	/**
	 * Hides the status bar item
	 */
	hide(): void {
		this.statusBarItem.hide();
	}

	/**
	 * Disposes the status bar item
	 */
	dispose(): void {
		this.statusBarItem.dispose();
	}
}

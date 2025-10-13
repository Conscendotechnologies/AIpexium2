import * as vscode from 'vscode';
import { IExtensionInfo } from './types';
import { BundledExtensionManager } from './bundledExtensionManager';
import { UpdateChecker } from './updateChecker';

export class ExtensionItem extends vscode.TreeItem {
	private bundledManager: BundledExtensionManager;
	private updateChecker: UpdateChecker;

	constructor(
		public readonly extensionInfo: IExtensionInfo,
		collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None
	) {
		super(extensionInfo.displayName, collapsibleState);

		this.bundledManager = BundledExtensionManager.getInstance();
		this.updateChecker = UpdateChecker.getInstance();

		this.description = this.getDescription();
		this.tooltip = this.getTooltip();
		this.contextValue = this.getContextValue();
		this.iconPath = this.getIconPath();
		this.command = this.getCommand();
	}

	private getDescription(): string {
		let description = '';

		// Check if bundled version exists
		const hasBundled = this.bundledManager.hasBundledExtension(this.extensionInfo.extensionId);
		const bundledInfo = this.bundledManager.getBundledExtension(this.extensionInfo.extensionId);

		// Check for updates from UpdateChecker
		const hasUpdate = this.updateChecker.hasAvailableUpdate(this.extensionInfo.extensionId);

		if (this.extensionInfo.isInstalled) {
			// Installed extension
			if (hasUpdate) {
				description = `v${this.extensionInfo.version} → v${this.extensionInfo.latestVersion}`;
			} else {
				description = `v${this.extensionInfo.version}`;
			}

			// Add bundle indicator for installed extensions
			if (hasBundled) {
				description += ` 📦`;
			}

			// Add update indicator
			if (hasUpdate) {
				description += ` ⬆️`;
			}
		} else {
			// Not installed extension
			description = this.extensionInfo.latestVersion ? `v${this.extensionInfo.latestVersion}` : 'Latest';

			// Show bundle availability for uninstalled extensions
			if (hasBundled && bundledInfo) {
				description += ` (📦 v${bundledInfo.version})`;
			}
		}

		return description;
	}

	private getTooltip(): vscode.MarkdownString {
		const tooltip = new vscode.MarkdownString();
		tooltip.isTrusted = true;

		tooltip.appendMarkdown(`**${this.extensionInfo.displayName}**\n\n`);

		if (this.extensionInfo.description) {
			tooltip.appendMarkdown(`${this.extensionInfo.description}\n\n`);
		}

		tooltip.appendMarkdown(`**Publisher:** ${this.extensionInfo.owner}\n`);

		if (this.extensionInfo.category) {
			tooltip.appendMarkdown(`**Category:** ${this.extensionInfo.category}\n`);
		}

		if (this.extensionInfo.tags && this.extensionInfo.tags.length > 0) {
			tooltip.appendMarkdown(`**Tags:** ${this.extensionInfo.tags.join(', ')}\n`);
		}

		if (this.extensionInfo.latestVersion) {
			tooltip.appendMarkdown(`**Latest Version:** ${this.extensionInfo.latestVersion}\n`);
		}

		if (this.extensionInfo.lastUpdated) {
			tooltip.appendMarkdown(`**Last Updated:** ${this.extensionInfo.lastUpdated.toLocaleDateString()}\n`);
		}

		if (this.extensionInfo.downloadCount !== undefined) {
			tooltip.appendMarkdown(`**Downloads:** ${this.extensionInfo.downloadCount}\n`);
		}

		if (this.extensionInfo.license) {
			tooltip.appendMarkdown(`**License:** ${this.extensionInfo.license}\n`);
		}

		// Bundle status information
		const hasBundled = this.bundledManager.hasBundledExtension(this.extensionInfo.extensionId);
		const bundledInfo = this.bundledManager.getBundledExtension(this.extensionInfo.extensionId);

		if (hasBundled && bundledInfo) {
			tooltip.appendMarkdown(`\n📦 **Bundled Version:** v${bundledInfo.version}\n`);
			tooltip.appendMarkdown(`📂 **Bundle Source:** Local VSIX file\n`);
		}

		// Update status from UpdateChecker
		const hasUpdate = this.updateChecker.hasAvailableUpdate(this.extensionInfo.extensionId);
		const lastCheck = this.updateChecker.getLastUpdateCheck();

		if (lastCheck) {
			tooltip.appendMarkdown(`\n🔄 **Last Update Check:** ${lastCheck.toLocaleString()}\n`);
		}

		// Status information
		if (this.extensionInfo.isInstalled) {
			if (hasUpdate) {
				tooltip.appendMarkdown(`\n⬆️ **Update Available** - New version ready for installation\n`);
			} else {
				tooltip.appendMarkdown(`\n✅ **Installed and Up to Date**\n`);
			}
		} else {
			if (hasBundled) {
				tooltip.appendMarkdown(`\n⚡ **Quick Install Available** - Bundled version for instant installation\n`);
			} else {
				tooltip.appendMarkdown(`\n📦 **Available for Installation** - Will download from GitHub\n`);
			}
		}

		if (this.extensionInfo.required) {
			tooltip.appendMarkdown(`\n⚠️ **Required Extension**\n`);
		}

		return tooltip;
	}

	private getContextValue(): string {
		const hasBundled = this.bundledManager.hasBundledExtension(this.extensionInfo.extensionId);
		const hasUpdate = this.updateChecker.hasAvailableUpdate(this.extensionInfo.extensionId);

		if (this.extensionInfo.isInstalled) {
			if (hasUpdate) {
				return 'extension-updatable';
			}
			return 'extension-installed';
		} else {
			if (hasBundled) {
				return 'extension-bundled';
			}
			return 'extension-installable';
		}
	}

	private getIconPath(): vscode.ThemeIcon | vscode.Uri | { light: vscode.Uri; dark: vscode.Uri } | undefined {
		const hasBundled = this.bundledManager.hasBundledExtension(this.extensionInfo.extensionId);
		const hasUpdate = this.updateChecker.hasAvailableUpdate(this.extensionInfo.extensionId);

		// Use different icons based on status
		if (this.extensionInfo.isInstalled) {
			if (hasUpdate) {
				return new vscode.ThemeIcon('sync', new vscode.ThemeColor('charts.yellow'));
			}
			return new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
		}

		// Show bundle indicator for uninstalled extensions
		if (hasBundled) {
			return new vscode.ThemeIcon('package', new vscode.ThemeColor('charts.blue'));
		}

		// Use category-specific icons for uninstalled extensions
		switch (this.extensionInfo.category?.toLowerCase()) {
			case 'ai tools':
				return new vscode.ThemeIcon('robot');
			case 'salesforce':
				return new vscode.ThemeIcon('cloud');
			case 'development tools':
				return new vscode.ThemeIcon('tools');
			case 'themes':
				return new vscode.ThemeIcon('color-mode');
			default:
				return new vscode.ThemeIcon('extensions');
		}
	}

	private getCommand(): vscode.Command | undefined {
		return {
			command: 'siidMarketplace.viewDetails',
			title: 'View Extension Details',
			arguments: [this.extensionInfo]
		};
	}
}

export class CategoryItem extends vscode.TreeItem {
	constructor(
		public readonly category: string,
		public readonly extensionCount: number
	) {
		super(category, vscode.TreeItemCollapsibleState.Expanded);

		this.description = `${extensionCount} extension${extensionCount !== 1 ? 's' : ''}`;
		this.contextValue = 'category';
		this.iconPath = this.getCategoryIcon();
		this.tooltip = `${category} - ${extensionCount} extension${extensionCount !== 1 ? 's' : ''}`;
	}

	private getCategoryIcon(): vscode.ThemeIcon {
		switch (this.category.toLowerCase()) {
			case 'ai tools':
				return new vscode.ThemeIcon('robot');
			case 'salesforce':
				return new vscode.ThemeIcon('cloud');
			case 'development tools':
				return new vscode.ThemeIcon('tools');
			case 'themes':
				return new vscode.ThemeIcon('color-mode');
			default:
				return new vscode.ThemeIcon('folder');
		}
	}
}

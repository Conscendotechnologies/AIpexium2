import * as vscode from 'vscode';
import { ConfigService } from './configService';
import { LoggerService } from './loggerService';
import { BundledExtensionManager } from './bundledExtensionManager';
import { ExtensionItem, CategoryItem } from './extensionItem';
import { IExtensionInfo, IGithubReleaseConfig } from './types';

export class MarketplaceViewProvider implements vscode.TreeDataProvider<ExtensionItem | CategoryItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<ExtensionItem | CategoryItem | undefined | null | void> = new vscode.EventEmitter<ExtensionItem | CategoryItem | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<ExtensionItem | CategoryItem | undefined | null | void> = this._onDidChangeTreeData.event;

	private configService: ConfigService;
	private logger: LoggerService;
	private bundledManager: BundledExtensionManager;
	private extensions: IExtensionInfo[] = [];
	private installedExtensions: vscode.Extension<any>[] = [];

	constructor() {
		this.configService = ConfigService.getInstance();
		this.bundledManager = BundledExtensionManager.getInstance();
		this.logger = LoggerService.getInstance();
		this.loadExtensions();
	}

	refresh(): void {
		this.loadExtensions();
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: ExtensionItem | CategoryItem): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: ExtensionItem | CategoryItem): Promise<(ExtensionItem | CategoryItem)[]> {
		if (!element) {
			// Return categories at root level
			const categories = await this.getCategories();

			// If no categories, show loading or placeholder
			if (categories.length === 0) {
				// Return a loading item
				return [new CategoryItem('Loading...', 0)];
			}

			return categories;
		}

		if (element instanceof CategoryItem) {
			// Return extensions for this category
			if (element.category === 'Loading...') {
				return [];
			}
			return this.getExtensionsForCategory(element.category);
		}

		return [];
	}

	private async loadExtensions(): Promise<void> {
		try {
			// Get currently installed extensions
			this.installedExtensions = vscode.extensions.all.filter(ext =>
				!ext.id.startsWith('vscode.') && !ext.id.startsWith('ms-vscode.')
			);

			// Load extensions from bundled extensions
			const bundledExtensions = this.bundledManager.getAllBundledExtensions();

			// Convert bundled extensions to extension info
			const extensionInfos = bundledExtensions.map((bundledExt) => {
				try {
					// Check if extension is installed
					const installedExt = this.installedExtensions.find(ext =>
						ext.id.toLowerCase() === bundledExt.extensionId.toLowerCase()
					);

					// Extract extension name from fileName (remove .vsix extension)
					const extensionName = bundledExt.fileName.replace(/\.vsix$/, '');
					const parts = extensionName.split('-');
					const name = parts.slice(0, -1).join('-'); // Remove version part

					// Create proper extension ID format
					const properExtensionId = bundledExt.extensionId.includes('.')
						? bundledExt.extensionId
						: `ConscendoTech.${bundledExt.extensionId}`;

					// Create a proper display name
					const displayName = name.replace(/-/g, ' ')
						.split(' ')
						.map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
						.join(' ') || 'Bundled Extension';

					// Create extension info from bundled extension
					const extensionInfo: IExtensionInfo = {
						extensionId: properExtensionId,
						displayName: displayName,
						description: `A bundled extension that provides additional functionality for Siid IDE. Version: ${bundledExt.version}`,
						owner: 'ConscendoTech',
						repo: bundledExt.extensionId || name,
						vsixAssetName: bundledExt.fileName,
						category: 'Development Tools',
						tags: ['bundled', 'local', 'siid'],
						icon: '',
						required: false,
						isInstalled: !!installedExt,
						version: installedExt?.packageJSON.version || bundledExt.version,
						latestVersion: bundledExt.version,
						hasUpdate: false,
						downloadCount: 0,
						lastUpdated: new Date(),
						homepage: 'https://github.com/ConscendoTech',
						license: 'MIT'
					};

					return extensionInfo;
				} catch (error) {
					this.logger.error(`[MarketplaceView.loadExtensions] Error processing bundled extension ${bundledExt.fileName}`, error);
					return null;
				}
			}).filter(ext => ext !== null) as IExtensionInfo[];

			// If no bundled extensions found, fall back to config
			if (extensionInfos.length === 0) {
				this.logger.warn('[MarketplaceView.loadExtensions] No bundled extensions found, falling back to configuration');
				await this.loadFromConfig();
				return;
			}

			this.extensions = extensionInfos;

		} catch (error) {
			this.logger.error('[MarketplaceView.loadExtensions] Error loading bundled extensions, falling back to config', error);
			await this.loadFromConfig();
		}
	}

	private async loadFromConfig(): Promise<void> {
		try {
			const config = await this.configService.getConfig();
			if (!config) {
				this.logger.error('[MarketplaceView.loadFromConfig] No configuration found');
				this.extensions = [];
				return;
			}			// Process extensions from config without making GitHub API calls
			const extensionInfos = config.githubReleases.map((extension: IGithubReleaseConfig) => {
				try {
					// Check if extension is installed
					const installedExt = this.installedExtensions.find(ext =>
						ext.id.toLowerCase() === extension.extensionId.toLowerCase()
					);

					// Create basic extension info without GitHub API calls
					const extensionInfo: IExtensionInfo = {
						...extension,
						isInstalled: !!installedExt,
						version: installedExt?.packageJSON.version || '',
						hasUpdate: false, // Will be determined by UpdateChecker
						latestVersion: '', // Will be updated by UpdateChecker in background
						downloadCount: 0,
						lastUpdated: new Date()
					};

					return extensionInfo;
				} catch (error) {
					this.logger.error(`[MarketplaceView.loadFromConfig] Error processing extension ${extension.extensionId}`, error);
					// Return basic info even if processing fails
					return {
						...extension,
						isInstalled: false,
						hasUpdate: false,
						version: '',
						latestVersion: '',
						downloadCount: 0,
						lastUpdated: new Date()
					} as IExtensionInfo;
				}
			});

			this.extensions = extensionInfos;

		} catch (error) {
			this.logger.error('[MarketplaceView.loadFromConfig] Error loading extensions from config', error);
			this.extensions = [];
		}
	}

	private async getCategories(): Promise<CategoryItem[]> {
		const categoryMap = new Map<string, number>();

		// Count extensions per category
		this.extensions.forEach(ext => {
			const category = ext.category || 'Other';
			categoryMap.set(category, (categoryMap.get(category) || 0) + 1);
		});

		// Create category items
		const categories: CategoryItem[] = [];
		for (const [category, count] of categoryMap.entries()) {
			categories.push(new CategoryItem(category, count));
		}

		// Sort categories alphabetically, but put required extensions first
		return categories.sort((a, b) => {
			if (a.category === 'AI Tools') return -1;
			if (b.category === 'AI Tools') return 1;
			if (a.category === 'Salesforce') return -1;
			if (b.category === 'Salesforce') return 1;
			return a.category.localeCompare(b.category);
		});
	}

	private async getExtensionsForCategory(category: string): Promise<ExtensionItem[]> {
		const categoryExtensions = this.extensions.filter(ext =>
			(ext.category || 'Other') === category
		);

		return categoryExtensions
			.sort((a, b) => {
				// Sort by: required first, then installed, then alphabetical
				if (a.required && !b.required) return -1;
				if (!a.required && b.required) return 1;
				if (a.isInstalled && !b.isInstalled) return -1;
				if (!a.isInstalled && b.isInstalled) return 1;
				return a.displayName.localeCompare(b.displayName);
			})
			.map(ext => new ExtensionItem(ext));
	}

	public getExtensionById(extensionId: string): IExtensionInfo | undefined {
		return this.extensions.find(ext => ext.extensionId === extensionId);
	}

	public getAllExtensions(): IExtensionInfo[] {
		return [...this.extensions];
	}

	public getInstalledExtensions(): IExtensionInfo[] {
		return this.extensions.filter(ext => ext.isInstalled);
	}

	public getUpdatableExtensions(): IExtensionInfo[] {
		return this.extensions.filter(ext => ext.isInstalled && ext.hasUpdate);
	}
}

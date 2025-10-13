export interface IGithubReleaseConfig {
	owner: string;
	repo: string;
	extensionId: string;
	vsixAssetName: string;
	displayName: string;
	description?: string;
	category?: string;
	icon?: string;
	required?: boolean;
	tags?: string[];
}

export interface IMarketplaceConfig {
	enabled: boolean;
	showInExplorer: boolean;
	categories: string[];
}

export interface ICustomExtensionsConfig {
	githubReleases: IGithubReleaseConfig[];
	autoUpdate: boolean;
	checkInterval: number;
	marketplace?: IMarketplaceConfig;
}

export interface IExtensionInfo extends IGithubReleaseConfig {
	version?: string;
	latestVersion?: string;
	isInstalled: boolean;
	hasUpdate: boolean;
	downloadUrl?: string;
	homepage?: string;
	license?: string;
	lastUpdated?: Date;
	downloadCount?: number;
}

export interface IGithubRelease {
	tag_name: string;
	name: string;
	body: string;
	published_at: string;
	assets: Array<{
		name: string;
		browser_download_url: string;
		download_count: number;
	}>;
}

export interface IGithubRepo {
	name: string;
	description: string;
	html_url: string;
	homepage: string;
	license?: {
		name: string;
	};
	updated_at: string;
}
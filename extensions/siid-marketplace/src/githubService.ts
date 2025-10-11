import * as vscode from 'vscode';
import { IGithubRelease, IGithubRepo, IGithubReleaseConfig, IExtensionInfo } from './types';
import { LoggerService } from './loggerService';

export class GitHubService {
	private static instance: GitHubService;
	private cache: Map<string, any> = new Map();
	private cacheTimeout = 30 * 60 * 1000; // 30 minutes - increased cache time
	private logger: LoggerService;

	private constructor() {
		this.logger = LoggerService.getInstance();
	}

	public static getInstance(): GitHubService {
		if (!GitHubService.instance) {
			GitHubService.instance = new GitHubService();
		}
		return GitHubService.instance;
	}

	private getAuthHeaders(): Record<string, string> {
		const config = vscode.workspace.getConfiguration('siid.marketplace');
		const githubToken = config.get<string>('githubToken');

		if (githubToken) {
			return {
				'Authorization': `token ${githubToken}`,
				'Accept': 'application/vnd.github.v3+json',
				'User-Agent': 'Siid-Marketplace-Extension'
			};
		}

		return {
			'Accept': 'application/vnd.github.v3+json',
			'User-Agent': 'Siid-Marketplace-Extension'
		};
	}

	private async fetchWithRetry(url: string, retries = 3): Promise<Response | null> {
		for (let i = 0; i < retries; i++) {
			try {
				const response = await fetch(url, {
					headers: this.getAuthHeaders()
				});

				if (response.status === 403) {
					const rateLimitReset = response.headers.get('x-ratelimit-reset');
					const remaining = response.headers.get('x-ratelimit-remaining');

					if (remaining === '0') {
						this.logger.warn(`[GitHubService.fetchWithRetry] GitHub API rate limit exceeded. Reset at: ${rateLimitReset ? new Date(parseInt(rateLimitReset) * 1000).toLocaleString() : 'unknown'}`);

						// If this is the last retry, return null
						if (i === retries - 1) {
							return null;
						}

						// Wait a bit before retrying
						await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1)));
						continue;
					}
				}

				return response;
			} catch (error) {
				this.logger.error(`[GitHubService.fetchWithRetry] Network error on attempt ${i + 1}`, error);
				if (i === retries - 1) {
					throw error;
				}
				// Wait before retrying
				await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
			}
		}
		return null;
	}

	public async getLatestRelease(owner: string, repo: string): Promise<IGithubRelease | null> {
		const cacheKey = `release-${owner}-${repo}`;
		const cached = this.getFromCache(cacheKey);
		if (cached) {
			return cached;
		}

		try {
			const url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
			const response = await this.fetchWithRetry(url);

			if (!response || !response.ok) {
				if (response) {
					const responseData = await response.json();
					if (response.status === 404) {
						// Repository or releases don't exist - this is normal for bundled-only extensions
						this.logger.debug(`[GitHubService.getLatestRelease] No GitHub releases found for ${owner}/${repo} (repository may not exist or have releases)`);
					} else {
						this.logger.warn(`[GitHubService.getLatestRelease] Failed to fetch release for ${owner}/${repo}: ${JSON.stringify(responseData)}`);
					}
				}
				return null;
			}

			const release = await response.json() as IGithubRelease;
			this.setCache(cacheKey, release);
			return release;
		} catch (error) {
			this.logger.error(`[GitHubService.getLatestRelease] Error fetching release for ${owner}/${repo}`, error);
			return null;
		}
	}

	public async getRepositoryInfo(owner: string, repo: string): Promise<IGithubRepo | null> {
		const cacheKey = `repo-${owner}-${repo}`;
		const cached = this.getFromCache(cacheKey);
		if (cached) {
			return cached;
		}

		try {
			const url = `https://api.github.com/repos/${owner}/${repo}`;
			const response = await this.fetchWithRetry(url);

			if (!response || !response.ok) {
				if (response) {
					this.logger.warn(`[GitHubService.getRepositoryInfo] Failed to fetch repo info for ${owner}/${repo}: ${JSON.stringify(await response.json())}`);
				}
				return null;
			}

			const repoInfo = await response.json() as IGithubRepo;
			this.setCache(cacheKey, repoInfo);
			return repoInfo;
		} catch (error) {
			this.logger.error(`[GitHubService.getRepositoryInfo] Error fetching repo info for ${owner}/${repo}`, error);
			return null;
		}
	}

	public async enrichExtensionInfo(extension: IGithubReleaseConfig): Promise<IExtensionInfo> {
		const [release, repoInfo] = await Promise.all([
			this.getLatestRelease(extension.owner, extension.repo),
			this.getRepositoryInfo(extension.owner, extension.repo)
		]);

		const extensionInfo: IExtensionInfo = {
			...extension,
			isInstalled: false, // Will be determined by extension management
			hasUpdate: false, // Will be determined by comparing versions
			description: extension.description || repoInfo?.description || 'No description available'
		};

		if (release) {
			extensionInfo.latestVersion = release.tag_name.replace(/^v/, '');
			extensionInfo.lastUpdated = new Date(release.published_at);

			// Find the matching VSIX asset
			const asset = release.assets.find(asset =>
				this.matchesVsixPattern(asset.name, extension.vsixAssetName)
			);

			if (asset) {
				extensionInfo.downloadUrl = asset.browser_download_url;
				extensionInfo.downloadCount = asset.download_count;
			}
		}

		if (repoInfo) {
			extensionInfo.homepage = repoInfo.homepage || repoInfo.html_url;
			extensionInfo.license = repoInfo.license?.name;
			if (!extensionInfo.lastUpdated) {
				extensionInfo.lastUpdated = new Date(repoInfo.updated_at);
			}
		}

		return extensionInfo;
	}

	public async getDownloadUrl(extension: IGithubReleaseConfig): Promise<string | null> {
		const release = await this.getLatestRelease(extension.owner, extension.repo);
		if (!release) {
			return null;
		}

		const asset = release.assets.find(asset =>
			this.matchesVsixPattern(asset.name, extension.vsixAssetName)
		);

		return asset ? asset.browser_download_url : null;
	}

	private matchesVsixPattern(fileName: string, pattern: string): boolean {
		// Convert glob pattern to regex
		const regexPattern = pattern
			.replace(/\*/g, '.*')
			.replace(/\?/g, '.');

		const regex = new RegExp(`^${regexPattern}$`, 'i');
		return regex.test(fileName);
	}

	private getFromCache(key: string): any {
		const cached = this.cache.get(key);
		if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
			return cached.data;
		}
		return null;
	}

	private setCache(key: string, data: any): void {
		this.cache.set(key, {
			data,
			timestamp: Date.now()
		});
	}

	public clearCache(): void {
		this.cache.clear();
	}
}

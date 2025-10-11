import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { IExtensionInfo } from './types';

export interface IBundledExtension {
	filePath: string;
	extensionId: string;
	version: string;
	fileName: string;
}

export class BundledExtensionManager {
	private static instance: BundledExtensionManager;
	private bundledExtensionsPath: string;
	private outputChannel: vscode.OutputChannel;
	private bundledExtensions: Map<string, IBundledExtension> = new Map();

	private constructor() {
		this.outputChannel = vscode.window.createOutputChannel('Siid Marketplace - Bundled');

		// Get the extension path
		const extensionPath = vscode.extensions.getExtension('ConscendoTechInc.siid-marketplace')?.extensionPath || __dirname;
		this.bundledExtensionsPath = path.join(extensionPath, 'bundled-extensions');

		// Initialize bundle scanning
		this.scanBundledExtensions();
	}

	public static getInstance(): BundledExtensionManager {
		if (!BundledExtensionManager.instance) {
			BundledExtensionManager.instance = new BundledExtensionManager();
		}
		return BundledExtensionManager.instance;
	}

	/**
	 * Scan the bundled-extensions folder for VSIX files
	 */
	private scanBundledExtensions(): void {
		try {
			this.outputChannel.appendLine(`[BundledExtensionManager.scanBundledExtensions] Scanning bundled extensions in: ${this.bundledExtensionsPath}`);

			if (!fs.existsSync(this.bundledExtensionsPath)) {
				this.outputChannel.appendLine('[BundledExtensionManager.scanBundledExtensions] Bundled extensions folder does not exist');
				return;
			}

			const files = fs.readdirSync(this.bundledExtensionsPath);
			const vsixFiles = files.filter(file => file.endsWith('.vsix'));

			this.outputChannel.appendLine(`[BundledExtensionManager.scanBundledExtensions] Found ${vsixFiles.length} VSIX files`);

			for (const fileName of vsixFiles) {
				try {
					const bundledExt = this.parseVsixFileName(fileName);
					if (bundledExt) {
						this.bundledExtensions.set(bundledExt.extensionId, bundledExt);
						this.outputChannel.appendLine(`[BundledExtensionManager.scanBundledExtensions] Registered: ${bundledExt.extensionId} v${bundledExt.version}`);
					}
				} catch (error) {
					this.outputChannel.appendLine(`[BundledExtensionManager.scanBundledExtensions] Failed to parse ${fileName}: ${error}`);
				}
			}

		} catch (error) {
			this.outputChannel.appendLine(`[BundledExtensionManager.scanBundledExtensions] Error scanning bundled extensions: ${error}`);
		}
	}

	/**
	 * Parse VSIX filename to extract extension ID and version
	 * Expected formats:
	 * - extensionId-version.vsix
	 * - publisher.name-version.vsix
	 */
	private parseVsixFileName(fileName: string): IBundledExtension | null {
		const filePath = path.join(this.bundledExtensionsPath, fileName);

		// Remove .vsix extension
		const nameWithoutExt = fileName.replace(/\.vsix$/i, '');

		// Try to find the last dash that separates name from version
		const lastDashIndex = nameWithoutExt.lastIndexOf('-');

		if (lastDashIndex === -1) {
			this.outputChannel.appendLine(`[BundledExtensionManager.parseVsixFileName] Cannot parse filename: ${fileName} - no version separator found`);
			return null;
		}

		const extensionId = nameWithoutExt.substring(0, lastDashIndex);
		const version = nameWithoutExt.substring(lastDashIndex + 1);

		// Basic validation
		if (!extensionId || !version) {
			this.outputChannel.appendLine(`[BundledExtensionManager.parseVsixFileName] Cannot parse filename: ${fileName} - invalid format`);
			return null;
		}

		// Validate version format (basic semver check)
		if (!/^\d+\.\d+\.\d+/.test(version)) {
			this.outputChannel.appendLine(`[BundledExtensionManager.parseVsixFileName] Cannot parse filename: ${fileName} - invalid version format: ${version}`);
			return null;
		}

		// Create proper extension ID format (add publisher prefix if not present)
		const properExtensionId = extensionId.includes('.')
			? extensionId
			: `ConscendoTech.${extensionId}`;

		return {
			filePath,
			extensionId: properExtensionId,
			version,
			fileName
		};
	}

	/**
	 * Check if an extension is available in the bundle
	 */
	public hasBundledExtension(extensionId: string): boolean {
		// Check exact match first
		if (this.bundledExtensions.has(extensionId)) {
			return true;
		}

		// Check if we have the short form and they're looking for the long form
		if (extensionId.includes('.')) {
			const shortId = extensionId.split('.')[1];
			const longForm = `ConscendoTech.${shortId}`;
			if (this.bundledExtensions.has(longForm)) {
				return true;
			}
		}

		// Check if we have the long form and they're looking for the short form
		const longForm = extensionId.includes('.') ? extensionId : `ConscendoTech.${extensionId}`;
		return this.bundledExtensions.has(longForm);
	}

	/**
	 * Get bundled extension info
	 */
	public getBundledExtension(extensionId: string): IBundledExtension | null {
		// Check exact match first
		if (this.bundledExtensions.has(extensionId)) {
			return this.bundledExtensions.get(extensionId) || null;
		}

		// Check if we have the short form and they're looking for the long form
		if (extensionId.includes('.')) {
			const shortId = extensionId.split('.')[1];
			const longForm = `ConscendoTech.${shortId}`;
			if (this.bundledExtensions.has(longForm)) {
				return this.bundledExtensions.get(longForm) || null;
			}
		}

		// Check if we have the long form and they're looking for the short form
		const longForm = extensionId.includes('.') ? extensionId : `ConscendoTech.${extensionId}`;
		return this.bundledExtensions.get(longForm) || null;
	}

	/**
	 * Get all bundled extensions
	 */
	public getAllBundledExtensions(): IBundledExtension[] {
		return Array.from(this.bundledExtensions.values());
	}

	/**
	 * Install extension from bundle
	 */
	public async installFromBundle(extensionInfo: IExtensionInfo): Promise<boolean> {
		const bundledExt = this.getBundledExtension(extensionInfo.extensionId);

		if (!bundledExt) {
			this.outputChannel.appendLine(`[BundledExtensionManager.installFromBundle] No bundled version found for: ${extensionInfo.extensionId}`);
			return false;
		}

		try {
			this.outputChannel.appendLine(`[BundledExtensionManager.installFromBundle] Installing ${extensionInfo.displayName} from bundle v${bundledExt.version}...`);

			// Verify file exists
			if (!fs.existsSync(bundledExt.filePath)) {
				throw new Error(`Bundled VSIX file not found: ${bundledExt.filePath}`);
			}

			// Install using VS Code API
			const vsixUri = vscode.Uri.file(bundledExt.filePath);
			await vscode.commands.executeCommand('workbench.extensions.installExtension', vsixUri);

			this.outputChannel.appendLine(`[BundledExtensionManager.installFromBundle] ✅ Successfully installed ${extensionInfo.displayName} v${bundledExt.version} from bundle`);
			return true;

		} catch (error) {
			this.outputChannel.appendLine(`[BundledExtensionManager.installFromBundle] ❌ Failed to install ${extensionInfo.displayName} from bundle: ${error}`);
			throw error;
		}
	}

	/**
	 * Compare bundled version with target version
	 */
	public compareBundledVersion(extensionId: string, targetVersion: string): number {
		const bundledExt = this.getBundledExtension(extensionId);
		if (!bundledExt) {
			return -1; // No bundled version
		}

		return this.compareVersions(bundledExt.version, targetVersion);
	}

	/**
	 * Compare two semantic versions
	 * Returns: 1 if v1 > v2, -1 if v1 < v2, 0 if equal
	 */
	private compareVersions(version1: string, version2: string): number {
		const v1parts = version1.split('.').map(n => parseInt(n, 10));
		const v2parts = version2.split('.').map(n => parseInt(n, 10));

		const maxLength = Math.max(v1parts.length, v2parts.length);

		for (let i = 0; i < maxLength; i++) {
			const v1part = v1parts[i] || 0;
			const v2part = v2parts[i] || 0;

			if (v1part > v2part) return 1;
			if (v1part < v2part) return -1;
		}

		return 0;
	}

	/**
	 * Refresh bundle scan
	 */
	public refresh(): void {
		this.bundledExtensions.clear();
		this.scanBundledExtensions();
	}

	/**
	 * Get bundle statistics
	 */
	public getBundleStats(): { total: number; totalSizeMB: number; extensions: IBundledExtension[] } {
		const extensions = this.getAllBundledExtensions();
		let totalSize = 0;

		for (const ext of extensions) {
			try {
				const stats = fs.statSync(ext.filePath);
				totalSize += stats.size;
			} catch (error) {
				// File might not exist, skip
			}
		}

		return {
			total: extensions.length,
			totalSizeMB: Math.round((totalSize / (1024 * 1024)) * 100) / 100,
			extensions
		};
	}

	public dispose(): void {
		this.outputChannel.dispose();
	}
}

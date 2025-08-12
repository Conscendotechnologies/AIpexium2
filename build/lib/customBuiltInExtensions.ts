// build/lib/customBuiltInExtensions.ts
const fs = require('fs');
const https = require('https');
const path = require('path');

async function downloadCustomExtensions(): Promise<void> {
	const __cwd = process.cwd();
	const TEMP_DIR = path.resolve(__cwd, 'temp');
	const DOWNLOADS_DIR = path.resolve(__cwd, 'downloads');
	const EXTENSIONS_DIR = path.resolve(__cwd, 'extensions'); // Final destination for extracted extensions

	const ZIP_FILES = [
		{
			url: 'https://raw.githubusercontent.com/aman-dhakar-191/in-build-extensions/main/roo-cline-3.25.10.zip',
			name: 'roo-cline-3.25.10.zip',
			id: 'roo-cline'
		},
		{
			url: 'https://raw.githubusercontent.com/aman-dhakar-191/in-build-extensions/main/salesforce.salesforcedx-vscode-core-64.8.0.zip',
			name: 'salesforce.salesforcedx-vscode-core-64.8.0.zip',
			id: 'salesforce-dx-core'
		},
		{
			url: 'https://raw.githubusercontent.com/aman-dhakar-191/in-build-extensions/main/salesforce.salesforcedx-vscode-apex-64.8.0.zip',
			name: 'salesforce.salesforcedx-vscode-apex-64.8.0.zip',
			id: 'salesforce-dx-apex'
		},
		{
			url: 'https://raw.githubusercontent.com/aman-dhakar-191/in-build-extensions/main/salesforce.salesforcedx-vscode-lightning-64.8.0.zip',
			name: 'salesforce.salesforcedx-vscode-lightning-64.8.0.zip',
			id: 'salesforce-dx-lightning'
		},
		{
			url: 'https://raw.githubusercontent.com/aman-dhakar-191/in-build-extensions/main/salesforce.salesforcedx-vscode-lwc-64.8.0.zip',
			name: 'salesforce.salesforcedx-vscode-lwc-64.8.0.zip',
			id: 'salesforce-dx-lwc'
		},
		{
			url: 'https://raw.githubusercontent.com/aman-dhakar-191/in-build-extensions/main/salesforce.salesforcedx-vscode-soql-64.8.0.zip',
			name: 'salesforce.salesforcedx-vscode-soql-64.8.0.zip',
			id: 'salesforce-dx-soql'
		},
		{
			url: 'https://raw.githubusercontent.com/aman-dhakar-191/in-build-extensions/main/salesforce.salesforcedx-vscode-visualforce-64.8.0.zip',
			name: 'salesforce.salesforcedx-vscode-visualforce-64.8.0.zip',
			id: 'salesforce-dx-visualforce'
		},
		{
			url: 'https://raw.githubusercontent.com/aman-dhakar-191/in-build-extensions/main/salesforce.salesforce-vscode-slds-2.0.12.zip',
			name: 'salesforce.salesforce-vscode-slds-2.0.12.zip',
			id: 'salesforce-dx-slds'
		}
	];

	console.log('📦 Downloading custom extensions...');

	// Create required directories
	fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
	fs.mkdirSync(TEMP_DIR, { recursive: true });
	fs.mkdirSync(EXTENSIONS_DIR, { recursive: true });

	try {
		for (const file of ZIP_FILES) {
			const zipPath = path.join(DOWNLOADS_DIR, file.name);
			const tempExtractPath = path.join(TEMP_DIR, file.id);
			const finalExtensionPath = path.join(EXTENSIONS_DIR, file.id);

			// Create individual temp directory for this extension
			fs.mkdirSync(tempExtractPath, { recursive: true });

			console.log(`⬇️  Downloading ${file.url} → ${zipPath}`);
			await downloadFile(file.url, zipPath);
			console.log(`✅ Download complete: ${zipPath}`);

			console.log(`📦 Extracting ${zipPath} → ${tempExtractPath}`);
			await extractZip(zipPath, tempExtractPath);
			console.log(`✅ Extracted to ${tempExtractPath}`);

			console.log(`📂 Moving extracted content → ${finalExtensionPath}`);
			await moveExtractedContent(tempExtractPath, finalExtensionPath);
			console.log(`✅ Moved to final location: ${finalExtensionPath}`);

			// Clean up individual temp directory
			// await cleanupDirectory(tempExtractPath);
			// console.log(`🧹 Cleaned up temp directory: ${tempExtractPath}`);
		}

		// Clean up main temp directory
		// await cleanupDirectory(TEMP_DIR);
		// console.log('🧹 Cleaned up main temp directory');

		console.log('🎉 All custom extensions downloaded, extracted, and organized successfully!');

	} catch (err) {
		console.error('❌ Error:', err);
		process.exitCode = 1;
		throw err;
	}
}

function followRedirect(url: string, cb: (err: any, res?: any) => void): void {
	https.get(url, (res: any) => {
		const statusCode = res.statusCode || 0;
		if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
			console.log(`Following redirect: ${url} → ${res.headers.location}`);
			followRedirect(res.headers.location, cb);
		} else {
			cb(null, res);
		}
	}).on('error', cb);
}

async function downloadFile(url: string, outputPath: string): Promise<void> {
	return new Promise((resolve, reject) => {
		followRedirect(url, (err: any, res?: any) => {
			if (err) return reject(err);
			if (!res) return reject(new Error('No response received'));

			const status = res.statusCode || 0;
			if (status !== 200) {
				return reject(new Error(`Failed to download ${url}. Status: ${status}`));
			}

			const contentType = (res.headers['content-type'] || '').toLowerCase();
			console.log(`Content-Type: ${contentType}`);

			if (!contentType.includes('zip') && !contentType.includes('octet-stream') && !contentType.includes('application/zip')) {
				console.warn(`⚠️  Warning: content-type for ${url} is ${contentType}`);
			}

			const fileStream = fs.createWriteStream(outputPath);
			res.pipe(fileStream);

			fileStream.on('finish', () => {
				fileStream.close();
				resolve();
			});

			fileStream.on('error', (err: any) => {
				try {
					fs.unlinkSync(outputPath);
				} catch (e) {
					// Ignore cleanup errors
				}
				reject(err);
			});
		});
	});
}

async function extractZip(zipPath: string, destPath: string): Promise<void> {
	try {
		const AdmZip = require('adm-zip');
		const zip = new AdmZip(zipPath);

		// Ensure destination directory exists
		fs.mkdirSync(destPath, { recursive: true });

		console.log(`Extracting ${zipPath} to ${destPath}...`);
		zip.extractAllTo(destPath, true);

		// List extracted files for verification
		const entries = zip.getEntries();
		console.log(`Extracted ${entries.length} files/folders:`);
		entries.slice(0, 5).forEach((entry: any) => {
			console.log(`  - ${entry.entryName}`);
		});
		if (entries.length > 5) {
			console.log(`  ... and ${entries.length - 5} more`);
		}

	} catch (error) {
		console.error(`Failed to extract ${zipPath}:`, error);
		throw error;
	}
}

async function moveExtractedContent(sourcePath: string, destPath: string): Promise<void> {
	try {
		sourcePath = sourcePath + '/extension'
		// Remove destination if it exists
		if (fs.existsSync(destPath)) {
			await cleanupDirectory(destPath);
		}

		// Create destination directory
		fs.mkdirSync(destPath, { recursive: true });

		// Read source directory contents
		const items = fs.readdirSync(sourcePath);

		if (items.length === 0) {
			console.warn(`⚠️  Warning: No content found in ${sourcePath}`);
			return;
		}

		// Move each item from source to destination
		for (const item of items) {
			const sourceItem = path.join(sourcePath, item);
			const destItem = path.join(destPath, item);

			console.log(`  Moving: ${item}`);
			await moveItem(sourceItem, destItem);
		}

		console.log(`Moved ${items.length} items from ${sourcePath} to ${destPath}`);

	} catch (error) {
		console.error(`Failed to move content from ${sourcePath} to ${destPath}:`, error);
		throw error;
	}
}

async function moveItem(source: string, dest: string): Promise<void> {
	return new Promise((resolve, reject) => {
		fs.rename(source, dest, (err: any) => {
			if (err) {
				// If rename fails, try copy and delete
				copyRecursive(source, dest)
					.then(() => cleanupDirectory(source))
					.then(() => resolve())
					.catch(reject);
			} else {
				resolve();
			}
		});
	});
}

async function copyRecursive(source: string, dest: string): Promise<void> {
	const stats = fs.statSync(source);

	if (stats.isDirectory()) {
		fs.mkdirSync(dest, { recursive: true });
		const items = fs.readdirSync(source);

		for (const item of items) {
			const sourceItem = path.join(source, item);
			const destItem = path.join(dest, item);
			await copyRecursive(sourceItem, destItem);
		}
	} else {
		// Ensure parent directory exists
		fs.mkdirSync(path.dirname(dest), { recursive: true });
		fs.copyFileSync(source, dest);
	}
}

async function cleanupDirectory(dirPath: string): Promise<void> {
	if (!fs.existsSync(dirPath)) {
		return;
	}

	try {
		const items = fs.readdirSync(dirPath);

		for (const item of items) {
			const itemPath = path.join(dirPath, item);
			const stats = fs.statSync(itemPath);

			if (stats.isDirectory()) {
				await cleanupDirectory(itemPath);
				fs.rmdirSync(itemPath);
			} else {
				fs.unlinkSync(itemPath);
			}
		}

		fs.rmdirSync(dirPath);
	} catch (error) {
		console.warn(`Warning: Failed to cleanup ${dirPath}:`, error);
		// Don't throw, as cleanup failures shouldn't stop the main process
	}
}

export { downloadCustomExtensions };

// Allow direct execution
if (require.main === module) {
	downloadCustomExtensions().catch(err => {
		console.error('Script failed:', err);
		process.exit(1);
	});
}

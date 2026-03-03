// extension.ts — Salesforce Setup SIID Extension
// Handles the siid://ConscendoTechInc.salesforce-setup/authorize URI that is
// triggered by the companion Chrome extension.

import * as vscode from 'vscode';
import { exec, ChildProcess, ExecException } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// ─── Output channel (singleton) ───────────────────────────────────────────────

let outputChannel: vscode.OutputChannel | undefined;

function getOutputChannel(): vscode.OutputChannel {
	if (!outputChannel) {
		outputChannel = vscode.window.createOutputChannel('Salesforce Setup');
	}
	return outputChannel;
}

// ─── Activation ───────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
	const channel = getOutputChannel();
	channel.appendLine('🔌 Salesforce Setup extension activated');

	// ── URI handler ──────────────────────────────────────────────────────────
	// Receives: siid://ConscendoTechInc.salesforce-setup/authorize?...
	const uriHandler = vscode.window.registerUriHandler({
		handleUri: async (uri: vscode.Uri) => {
			channel.appendLine(`\n📩 URI received: ${uri.toString()}`);
			console.log(`\n📩 URI received: ${uri.toString()}`)
			if (uri.path === '/authorize') {
				await handleAuthorization(uri);
			} else {
				channel.appendLine(`⚠️ Unknown URI path: ${uri.path}`);
			}
		}
	});

	// ── Commands ─────────────────────────────────────────────────────────────

	const authorizeCmd = vscode.commands.registerCommand('salesforce-setup.authorize', async () => {
		channel.show();
		channel.appendLine('\n💡 Waiting for authorization request from browser...');
		channel.appendLine('Click the SIID icon on any Salesforce page to start.');
		vscode.window.showInformationMessage(
			'Salesforce Setup: Click the SIID icon on any Salesforce page to authorize an org.'
		);
	});

	const statusCmd = vscode.commands.registerCommand('salesforce-setup.showStatus', () => {
		showStatus(channel);
	});

	const openProjectCmd = vscode.commands.registerCommand('salesforce-setup.openProject', async () => {
		await openProjectFolder();
	});

	const retrieveCmd = vscode.commands.registerCommand('salesforce-setup.retrieveMetadata', async () => {
		await retrieveMetadataInteractive(channel);
	});

	const setDirCmd = vscode.commands.registerCommand('salesforce-setup.setProjectsDirectory', async () => {
		await setProjectsDirectory();
	});

	const refreshCmd = vscode.commands.registerCommand('salesforce-setup.refreshView', () => {
		channel.appendLine('View refreshed.');
	});

	context.subscriptions.push(
		uriHandler,
		authorizeCmd, statusCmd, openProjectCmd,
		retrieveCmd, setDirCmd, refreshCmd
	);

	// ── Status bar ───────────────────────────────────────────────────────────

	const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	statusBar.text = '$(cloud) SF Setup';
	statusBar.tooltip = 'Salesforce Setup — click to show status';
	statusBar.command = 'salesforce-setup.showStatus';
	statusBar.show();
	context.subscriptions.push(statusBar);

	vscode.window.showInformationMessage(
		'☁️ Salesforce Setup is ready. Click the SIID connector icon on any Salesforce page.'
	);
}

// ─── URI authorization handler ────────────────────────────────────────────────

async function handleAuthorization(uri: vscode.Uri): Promise<void> {
	const channel = getOutputChannel();
	channel.show();

	try {
		channel.appendLine('\n' + '='.repeat(60));
		channel.appendLine('🚀 SALESFORCE SETUP — STARTING');
		channel.appendLine('='.repeat(60));
		channel.appendLine(`📋 Full URI: ${uri.toString()}`);
		channel.appendLine(`📋 URI Path: ${uri.path}`);
		channel.appendLine(`📋 URI Query: ${uri.query}`);

		// Parse query parameters sent by the Chrome extension
		const params = new URLSearchParams(uri.query);
		const instanceUrl = params.get('instanceUrl');
		const accessToken = params.get('accessToken');
		const alias = params.get('alias') || 'myorg';
		const projectName = params.get('projectName') || `${alias}-project`;
		const autoRetrieve = params.get('retrieve') !== 'false';

		channel.appendLine('\n📊 Parsed Parameters:');
		channel.appendLine(`   ✓ Instance URL:  ${instanceUrl || '❌ MISSING'}`);
		channel.appendLine(`   ✓ Access Token:  ${accessToken ? `✅ Present (${accessToken.length} chars)` : '❌ MISSING'}`);
		channel.appendLine(`   ✓ Alias:         ${alias}`);
		channel.appendLine(`   ✓ Project Name:  ${projectName}`);
		channel.appendLine(`   ✓ Auto Retrieve: ${autoRetrieve}`);

		// Validate required fields
		if (!instanceUrl || !accessToken) {
			const missing = [!instanceUrl && 'instanceUrl', !accessToken && 'accessToken']
				.filter(Boolean).join(', ');
			const msg = `Missing required parameters: ${missing}`;
			channel.appendLine(`\n❌ ERROR: ${msg}`);
			channel.appendLine('\n🔍 Troubleshooting:');
			channel.appendLine('   1. Make sure you are logged into Salesforce');
			channel.appendLine('   2. Refresh the Salesforce page and try again');
			channel.appendLine('   3. Check the browser console (F12) for errors');
			channel.appendLine('   4. Ensure the Chrome extension has cookie permissions');

			vscode.window.showErrorMessage(
				`Salesforce Setup: ${msg}`, 'View Output'
			).then(sel => sel === 'View Output' && channel.show());
			return;
		}

		// Run all setup steps with a progress indicator
		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: `Salesforce Setup: ${alias}`,
			cancellable: false
		}, async (progress) => {

			// Step 1 — Project path
			channel.appendLine('\n📁 Step 1/5: Determining project location...');
			progress.report({ message: 'Determining project location...', increment: 10 });
			const projectPath = await getOrCreateProjectPath(alias, projectName, channel);
			channel.appendLine(`   ✓ Project path: ${projectPath}`);

			// Step 2 — Authorize org
			channel.appendLine('\n🔐 Step 2/5: Authorizing org...');
			progress.report({ message: 'Authorizing org...', increment: 20 });
			await authorizeOrg(instanceUrl, accessToken, alias, projectPath, channel);

			// Step 3 — Set default org
			channel.appendLine('\n⚙️ Step 3/5: Configuring project...');
			progress.report({ message: 'Configuring project...', increment: 20 });
			await setDefaultOrg(alias, projectPath, channel);

			// Step 4 — Retrieve metadata (optional)
			if (autoRetrieve) {
				channel.appendLine('\n📥 Step 4/5: Retrieving metadata...');
				progress.report({ message: 'Retrieving metadata (this may take a while)...', increment: 20 });
				await retrieveMetadata(alias, projectPath, channel);
			} else {
				channel.appendLine('\n⏭️ Step 4/5: Skipping metadata retrieval (disabled)');
				progress.report({ increment: 20 });
			}

			// Step 5 — Open project
			channel.appendLine('\n📂 Step 5/5: Opening project...');
			progress.report({ message: 'Opening project...', increment: 20 });
			await openProject(projectPath, channel);

			progress.report({ message: 'Complete!', increment: 10 });
		});

		channel.appendLine('\n' + '='.repeat(60));
		channel.appendLine('✅ SUCCESS! Org is ready to use!');
		channel.appendLine('='.repeat(60));
		channel.appendLine(`   Org Alias:    ${alias}`);
		channel.appendLine(`   Instance:     ${instanceUrl}`);
		channel.appendLine(`   Project:      ${projectName}`);
		channel.appendLine('\n💡 You can now start developing in SIID!');

		vscode.window.showInformationMessage(
			`✅ Org "${alias}" is ready!`, 'Open Terminal'
		).then(sel => {
			if (sel === 'Open Terminal') {
				vscode.commands.executeCommand('workbench.action.terminal.new');
			}
		});

	} catch (error) {
		const err = error as Error;
		channel.appendLine('\n' + '='.repeat(60));
		channel.appendLine('❌ ERROR OCCURRED');
		channel.appendLine('='.repeat(60));
		channel.appendLine(`Error: ${err.message}`);
		channel.appendLine(`Stack: ${err.stack}`);
		console.error('[salesforce-setup] Authorization error:', err);

		vscode.window.showErrorMessage(
			`Salesforce Setup: ${err.message}`, 'View Output'
		).then(sel => sel === 'View Output' && channel.show());
	}
}

// ─── Project path ─────────────────────────────────────────────────────────────

async function getOrCreateProjectPath(alias: string, projectName: string, channel: vscode.OutputChannel): Promise<string> {
	const config = vscode.workspace.getConfiguration('salesforce-setup');
	let baseDir: string = config.get('projectsDirectory') || '';

	if (!baseDir) {
		baseDir = path.join(os.homedir(), 'salesforce-projects');
		channel.appendLine(`   Using default directory: ${baseDir}`);
	} else {
		channel.appendLine(`   Using configured directory: ${baseDir}`);
	}

	// Expand leading ~
	if (baseDir.startsWith('~')) {
		baseDir = baseDir.replace('~', os.homedir());
	}

	channel.appendLine(`   📝 Project name from browser: ${projectName}`);
	const projectPath = path.join(baseDir, projectName);

	if (fs.existsSync(projectPath)) {
		channel.appendLine(`   ℹ️ Project already exists: ${projectPath}`);
		channel.appendLine(`   ⚠️ Using existing project — files may be updated`);
		return projectPath;
	}

	// Create base directory if needed
	if (!fs.existsSync(baseDir)) {
		fs.mkdirSync(baseDir, { recursive: true });
		channel.appendLine(`   ✓ Created base directory: ${baseDir}`);
	}

	channel.appendLine(`   Creating new SFDX project...`);
	await runCommand(
		`sf project generate --name "${projectName}" --output-dir "${baseDir}"`,
		baseDir
	);
	channel.appendLine(`   ✓ Project created successfully`);
	return projectPath;
}

// ─── Org authorization ────────────────────────────────────────────────────────

async function authorizeOrg(instanceUrl: string, accessToken: string, alias: string, projectPath: string, channel: vscode.OutputChannel): Promise<void> {
	try {
		channel.appendLine(`   Writing auth files directly...`);
		await createAuthFileDirect(instanceUrl, accessToken, alias, channel);
		channel.appendLine(`   ✓ Authorized org: ${alias}`);
		channel.appendLine(`   ✓ Instance: ${instanceUrl}`);
	} catch (error) {
		const err = error as Error;
		channel.appendLine(`   ❌ Authorization failed: ${err.message}`);
		throw new Error(`Authorization failed: ${err.message}`);
	}
}

interface AuthData {
	accessToken: string;
	instanceUrl: string;
	loginUrl: string;
	orgId: string;
	username: string;
	clientId: string;
	isDevHub: boolean;
	devHubUsername: undefined;
}

interface AliasFileData {
	orgs: Record<string, string>;
}

async function createAuthFileDirect(instanceUrl: string, accessToken: string, alias: string, channel: vscode.OutputChannel): Promise<void> {
	try {
		const sfDir = path.join(os.homedir(), '.sf');
		const sfdxDir = path.join(os.homedir(), '.sfdx');

		for (const dir of [sfDir, sfdxDir]) {
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true });
				channel.appendLine(`   ✓ Created ${path.basename(dir)} directory`);
			}
		}

		const hostname = new URL(instanceUrl).hostname;
		const username = `user@${hostname}`;

		const authData: AuthData = {
			accessToken,
			instanceUrl,
			loginUrl: instanceUrl,
			orgId: 'unknown',
			username,
			clientId: 'PlatformCLI',
			isDevHub: false,
			devHubUsername: undefined
		};

		for (const dir of [sfDir, sfdxDir]) {
			await createAliasFile(dir, alias, username, channel);
			await createAuthFile(dir, username, authData, channel);
		}

		// Verify connectivity (non-fatal if it fails)
		try {
			const result = await runCommand(
				`sf org display --target-org ${alias} --json`, os.homedir()
			);
			const data = JSON.parse(result);
			if (data.status === 0) {
				channel.appendLine(`   ✓ Verified org connection`);
				if (data.result?.username) channel.appendLine(`   ✓ Username: ${data.result.username}`);
				if (data.result?.id) channel.appendLine(`   ✓ Org ID: ${data.result.id}`);
			}
		} catch (verifyErr) {
			const err = verifyErr as Error;
			channel.appendLine(`   ⚠️ Could not verify org (this is OK): ${err.message}`);
			channel.appendLine(`   ℹ️ Auth files created — org should still be usable`);
		}

	} catch (error) {
		const err = error as Error;
		throw new Error(`Failed to write auth files: ${err.message}`);
	}
}

async function createAliasFile(dir: string, alias: string, username: string, channel: vscode.OutputChannel): Promise<void> {
	const filePath = path.join(dir, 'alias.json');
	let data: AliasFileData = { orgs: {} };

	if (fs.existsSync(filePath)) {
		try {
			const raw = fs.readFileSync(filePath, 'utf8');
			data = JSON.parse(raw);
			if (!data.orgs) data.orgs = {};
		} catch (e) {
			const err = e as Error;
			channel.appendLine(`   ⚠️ Could not read existing alias file: ${err.message}`);
		}
	}

	data.orgs[alias] = username;
	fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
	channel.appendLine(`   ✓ Alias written in ${path.basename(dir)}: ${alias} → ${username}`);
}

async function createAuthFile(dir: string, username: string, authData: AuthData, channel: vscode.OutputChannel): Promise<void> {
	const filePath = path.join(dir, `${username}.json`);
	fs.writeFileSync(filePath, JSON.stringify(authData, null, 2), 'utf8');
	channel.appendLine(`   ✓ Auth file written in ${path.basename(dir)}: ${username}.json`);
}

// ─── Post-auth steps ──────────────────────────────────────────────────────────

async function setDefaultOrg(alias: string, projectPath: string, channel: vscode.OutputChannel): Promise<void> {
	const cmd = `sf config set target-org=${alias}`;
	channel.appendLine(`   Running: ${cmd}`);
	try {
		await runCommand(cmd, projectPath);
		channel.appendLine(`   ✓ Default org set to: ${alias}`);
	} catch (error) {
		const err = error as Error;
		channel.appendLine(`   ⚠️ Could not set default org: ${err.message}`);
		// Non-fatal — continue
	}
}

async function retrieveMetadata(alias: string, projectPath: string, channel: vscode.OutputChannel): Promise<void> {
	channel.appendLine(`   Retrieving metadata types from ${alias}...`);
	channel.appendLine(`   This may take several minutes depending on org size.`);

	try {
		// First try a targeted retrieve of common metadata types
		const retrieveCmd =
			`sf project retrieve start ` +
			`--metadata ApexClass ApexTrigger AuraDefinitionBundle LightningComponentBundle ` +
			`ApexPage CustomObject CustomTab CustomApplication PermissionSet Layout ` +
			`StaticResource Flow ` +
			`--target-org ${alias}`;

		channel.appendLine(`   Running: sf project retrieve start (common types)`);
		await runCommand(retrieveCmd, projectPath, true);
		channel.appendLine(`   ✓ Metadata retrieved successfully`);

	} catch (error) {
		const err = error as Error;
		channel.appendLine(`   ⚠️ Metadata retrieval completed with warnings: ${err.message}`);
		// Partial retrieval is acceptable — don't throw
	}
}

async function openProject(projectPath: string, channel: vscode.OutputChannel): Promise<void> {
	try {
		const uri = vscode.Uri.file(projectPath);
		channel.appendLine(`   Opening folder: ${projectPath}`);
		await vscode.commands.executeCommand('vscode.openFolder', uri, false);
		channel.appendLine(`   ✓ Project opened in SIID`);
	} catch (error) {
		const err = error as Error;
		channel.appendLine(`   ⚠️ Could not open folder automatically: ${err.message}`);
		channel.appendLine(`   You can open it manually: ${projectPath}`);
	}
}

// ─── Interactive commands ─────────────────────────────────────────────────────

function showStatus(channel: vscode.OutputChannel): void {
	const config = vscode.workspace.getConfiguration('salesforce-setup');
	channel.show();
	channel.appendLine('\n── Salesforce Setup Status ──────────────────────────');
	channel.appendLine(`Projects directory:   ${config.get('projectsDirectory') || path.join(os.homedir(), 'salesforce-projects')}`);
	channel.appendLine(`Auto-retrieve:        ${config.get('autoRetrieveMetadata')}`);
	channel.appendLine(`Debug logging:        ${config.get('enableDebugLogging')}`);
	channel.appendLine('─────────────────────────────────────────────────────\n');
	vscode.window.showInformationMessage('Salesforce Setup status written to the output channel.');
}

async function openProjectFolder(): Promise<void> {
	const config = vscode.workspace.getConfiguration('salesforce-setup');
	let baseDir: string = config.get('projectsDirectory') || path.join(os.homedir(), 'salesforce-projects');
	if (baseDir.startsWith('~')) baseDir = baseDir.replace('~', os.homedir());
	await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(baseDir));
}

async function retrieveMetadataInteractive(channel: vscode.OutputChannel): Promise<void> {
	const alias = await vscode.window.showInputBox({
		prompt: 'Enter the org alias to retrieve metadata from',
		placeHolder: 'e.g. myorg'
	});
	if (!alias) return;

	const config = vscode.workspace.getConfiguration('salesforce-setup');
	let baseDir: string = config.get('projectsDirectory') || path.join(os.homedir(), 'salesforce-projects');
	if (baseDir.startsWith('~')) baseDir = baseDir.replace('~', os.homedir());

	await retrieveMetadata(alias, baseDir, channel);
}

async function setProjectsDirectory(): Promise<void> {
	const uri = await vscode.window.showOpenDialog({
		canSelectFiles: false,
		canSelectFolders: true,
		canSelectMany: false,
		openLabel: 'Select Projects Directory'
	});
	if (uri?.[0]) {
		await vscode.workspace
			.getConfiguration('salesforce-setup')
			.update('projectsDirectory', uri[0].fsPath, vscode.ConfigurationTarget.Global);
		vscode.window.showInformationMessage(
			`Salesforce Setup: Projects directory set to "${uri[0].fsPath}"`
		);
	}
}

// ─── Command runner ───────────────────────────────────────────────────────────

function runCommand(command: string, cwd: string, streamOutput: boolean = false): Promise<string> {
	const channel = getOutputChannel();

	return new Promise<string>((resolve, reject) => {
		const child: ChildProcess = exec(
			command,
			{
				cwd,
				shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
				maxBuffer: 10 * 1024 * 1024 // 10 MB
			},
			(error: ExecException | null, stdout: string, stderr: string) => {
				if (error) {
					if (stderr && !stdout) reject(new Error(stderr));
					else if (stdout) resolve(stdout);   // warnings only — treat as success
					else reject(new Error(error.message));
					return;
				}
				resolve(stdout);
			}
		);

		if (streamOutput) {
			child.stdout?.on('data', (d: Buffer) => channel.append(d.toString()));
			child.stderr?.on('data', (d: Buffer) => channel.append(d.toString()));
		}
	});
}

// ─── Deactivation ─────────────────────────────────────────────────────────────

export function deactivate(): void {
	if (outputChannel) outputChannel.dispose();
}

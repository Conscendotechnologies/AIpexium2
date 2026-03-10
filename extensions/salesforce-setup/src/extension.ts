/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
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

// ─── NEW: SF Context Panel (singleton) ───────────────────────────────────────
let contextPanel: vscode.WebviewPanel | undefined;

// ─── Activation ───────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
	const channel = getOutputChannel();
	channel.appendLine('🔌 Salesforce Setup extension activated');

	// ── URI handler ──────────────────────────────────────────────────────────
	// Receives: siid://ConscendoTechInc.salesforce-setup/authorize?...
	const uriHandler = vscode.window.registerUriHandler({
		handleUri: async (uri: vscode.Uri) => {
			channel.appendLine(`\n📩 URI received: ${uri.toString()}`);
			console.log(`\n📩 URI received: ${uri.toString()}`);
			if (uri.path === '/authorize') {
				await handleAuthorization(uri);
			} else if (uri.path === '/context') {
				await handleContextCapture(uri, context);
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

	// ── NEW: Show Context command ─────────────────────────────────────────────
	const showContextCmd = vscode.commands.registerCommand('salesforce-setup.showContext', () => {
		if (contextPanel) {
			contextPanel.reveal(vscode.ViewColumn.Two);
		} else {
			vscode.window.showInformationMessage('No SF context captured yet. Use the Chrome extension to capture a Salesforce page.');
		}
	});

	context.subscriptions.push(
		uriHandler,
		authorizeCmd, statusCmd, openProjectCmd,
		retrieveCmd, setDirCmd, refreshCmd, showContextCmd
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
				if (data.result?.username) { channel.appendLine(`   ✓ Username: ${data.result.username}`); }
				if (data.result?.id) { channel.appendLine(`   ✓ Org ID: ${data.result.id}`); }
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
			if (!data.orgs) { data.orgs = {}; }
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
	if (baseDir.startsWith('~')) { baseDir = baseDir.replace('~', os.homedir()); }
	await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(baseDir));
}

async function retrieveMetadataInteractive(channel: vscode.OutputChannel): Promise<void> {
	const alias = await vscode.window.showInputBox({
		prompt: 'Enter the org alias to retrieve metadata from',
		placeHolder: 'e.g. myorg'
	});
	if (!alias) { return; }

	const config = vscode.workspace.getConfiguration('salesforce-setup');
	let baseDir: string = config.get('projectsDirectory') || path.join(os.homedir(), 'salesforce-projects');
	if (baseDir.startsWith('~')) { baseDir = baseDir.replace('~', os.homedir()); }

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
					if (stderr && !stdout) { reject(new Error(stderr)); }
					else if (stdout) { resolve(stdout); }   // warnings only — treat as success
					else { reject(new Error(error.message)); }
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

// ─── NEW: SF Context Types ────────────────────────────────────────────────────

interface SFPageContext {
	url?: string; recordId?: string; objectType?: string;
	appName?: string; pageTitle?: string; setupArea?: string;
}
interface SFRecordData {
	apiName?: string;
	fields?: Record<string, { value: unknown; displayValue?: string }>;
	error?: string;
}
interface SFLWCComponent {
	tagName: string;
	attributes: Record<string, string>;
	inputValues: Record<string, string>;
}
interface SFContext {
	prompt?: string; timestamp?: string; contextSummary?: string;
	pageContext?: SFPageContext;
	fieldValues?: Record<string, { value: string | string[]; type: string; mode: string; displayValue?: string }>;
	recordData?: SFRecordData;
	lwcComponents?: SFLWCComponent[];
	relatedLists?: Array<{ title: string; count: string; rowCount: number }>;
	validationMessages?: string[];
}

// ─── NEW: Context URI Handler ─────────────────────────────────────────────────

async function handleContextCapture(uri: vscode.Uri, extContext: vscode.ExtensionContext): Promise<void> {
	const channel = getOutputChannel();
	channel.appendLine('\n📸 SF Context capture received');
	const params = new URLSearchParams(uri.query);
	const sfContextRaw = params.get('sfContext');
	const screenshotB64 = params.get('screenshot') || undefined;
	const prompt = params.get('prompt') || '';
	const pageUrl = params.get('pageUrl') || '';
	let sfContext: SFContext | null = null;
	if (sfContextRaw) {
		try { sfContext = JSON.parse(decodeURIComponent(sfContextRaw)); }
		catch (e) { channel.appendLine('WARNING: Could not parse sfContext JSON'); }
	}
	if (screenshotB64) {
		const p = await saveScreenshot(screenshotB64, sfContext?.pageContext?.objectType || 'sf-page');
		channel.appendLine('Screenshot saved: ' + p);
	}
	showContextPanel(extContext, { prompt, pageUrl, sfContext, screenshotB64 });
	if (sfContext?.contextSummary) { channel.appendLine('\n' + sfContext.contextSummary); }
}

// ─── NEW: Save Screenshot ─────────────────────────────────────────────────────

async function saveScreenshot(base64DataUrl: string, label: string): Promise<string> {
	const tmpDir = path.join(os.tmpdir(), 'salesforce-setup-screenshots');
	if (!fs.existsSync(tmpDir)) { fs.mkdirSync(tmpDir, { recursive: true }); }
	const base64 = base64DataUrl.replace(/^data:image\/\w+;base64,/, '');
	const stamp = new Date().toISOString().replace(/[:.]/g, '-');
	const filePath = path.join(tmpDir, label + '-' + stamp + '.png');
	fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
	return filePath;
}

// ─── NEW: Show Context Webview Panel ─────────────────────────────────────────

function showContextPanel(
	extContext: vscode.ExtensionContext,
	data: { prompt: string; pageUrl: string; sfContext: SFContext | null; screenshotB64?: string }
): void {
	const { prompt, sfContext, screenshotB64 } = data;
	const pc = sfContext?.pageContext;
	const title = pc?.objectType ? 'SF Context — ' + pc.objectType
		: pc?.setupArea ? 'SF Context — Setup: ' + pc.setupArea
			: 'SF Context';
	if (contextPanel) {
		contextPanel.title = title;
		contextPanel.reveal(vscode.ViewColumn.Two, true);
	} else {
		contextPanel = vscode.window.createWebviewPanel(
			'sfContext', title,
			{ viewColumn: vscode.ViewColumn.Two, preserveFocus: true },
			{ enableScripts: true, retainContextWhenHidden: true }
		);
		contextPanel.onDidDispose(() => { contextPanel = undefined; });
	}
	contextPanel.webview.html = buildContextPanelHTML({ prompt, sfContext, screenshotB64 });
}

// ─── NEW: HTML helpers ────────────────────────────────────────────────────────

function escHtml(s: string): string {
	return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function buildContextPanelHTML(data: { prompt: string; sfContext: SFContext | null; screenshotB64?: string }): string {
	const { prompt, sfContext, screenshotB64 } = data;
	const ctx = sfContext?.pageContext;

	let fieldRows = '';
	Object.entries(sfContext?.fieldValues || {}).forEach(([label, info]) => {
		const val = info.displayValue || (Array.isArray(info.value) ? info.value.join(', ') : info.value);
		if (!val) { return; }
		const badge = info.mode === 'edit' ? '<span class="be">edit</span>' : '<span class="br">read</span>';
		fieldRows += '<tr><td class="fl">' + escHtml(label) + '</td><td>' + escHtml(String(val)) + ' ' + badge + '</td></tr>';
	});

	const rec = sfContext?.recordData;
	let recRows = '';
	if (rec && !rec.error && rec.fields) {
		Object.entries(rec.fields).forEach(([key, d]) => {
			const val = d.displayValue || String(d.value ?? '');
			if (val) { recRows += '<tr><td class="fl">' + escHtml(key) + '</td><td>' + escHtml(val) + '</td></tr>'; }
		});
	}

	const lwcComps = (sfContext?.lwcComponents || []).filter((c: SFLWCComponent) => c.tagName.startsWith('c-'));
	let lwcHTML = '';
	lwcComps.slice(0, 15).forEach((c: SFLWCComponent) => {
		let inputs = '';
		Object.entries(c.inputValues || {}).forEach(([k, v]) => {
			if (v) { inputs += '<div class="lp"><span class="pk">' + escHtml(k) + ':</span> ' + escHtml(v) + '</div>'; }
		});
		lwcHTML += '<div class="li"><code>&lt;' + escHtml(c.tagName) + '&gt;</code>' + (inputs || '<span class="mu">no inputs</span>') + '</div>';
	});

	let relHTML = '';
	(sfContext?.relatedLists || []).forEach((r: { title: string; count: string; rowCount: number }) => {
		relHTML += '<div class="ri"><strong>' + escHtml(r.title) + '</strong> <span class="mu">' + escHtml(r.count) + '</span></div>';
	});

	let valHTML = '';
	(sfContext?.validationMessages || []).forEach((m: string) => {
		valHTML += '<div class="ei">&#9888; ' + escHtml(m) + '</div>';
	});

	const ssHTML = screenshotB64 ? '<section><h2>&#128248; Screenshot</h2><img src="' + screenshotB64 + '" class="ss" alt=""/></section>' : '';
	const capturedAt = sfContext?.timestamp ? new Date(sfContext.timestamp).toLocaleString() : new Date().toLocaleString();
	const pageInfoHTML = ctx ? [
		ctx.pageTitle ? '<span class="pk2">Title</span><span class="pv">' + escHtml(ctx.pageTitle) + '</span>' : '',
		ctx.objectType ? '<span class="pk2">Object</span><span class="pv">' + escHtml(ctx.objectType) + '</span>' : '',
		ctx.recordId ? '<span class="pk2">Record ID</span><span class="pv"><code>' + escHtml(ctx.recordId) + '</code></span>' : '',
		ctx.appName ? '<span class="pk2">App</span><span class="pv">' + escHtml(ctx.appName) + '</span>' : '',
		ctx.setupArea ? '<span class="pk2">Setup</span><span class="pv">' + escHtml(ctx.setupArea) + '</span>' : '',
		ctx.url ? '<span class="pk2">URL</span><span class="pv sm">' + escHtml(ctx.url) + '</span>' : '',
	].filter(Boolean).join('') : '<span class="empty">No page info captured</span>';

	const css = '*{box-sizing:border-box;margin:0;padding:0}'
		+ 'body{font-family:var(--vscode-font-family,-apple-system,sans-serif);font-size:13px;color:var(--vscode-foreground);background:var(--vscode-editor-background);padding:16px;line-height:1.5}'
		+ 'h1{font-size:16px;margin-bottom:4px}h2{font-size:12px;font-weight:600;margin-bottom:10px;opacity:.8;text-transform:uppercase;letter-spacing:.05em}'
		+ 'section{background:var(--vscode-editorWidget-background,rgba(255,255,255,.04));border:1px solid var(--vscode-editorWidget-border,rgba(255,255,255,.1));border-radius:6px;padding:14px;margin-bottom:14px}'
		+ '.meta{font-size:11px;opacity:.6;margin-bottom:16px}'
		+ '.pb{background:var(--vscode-textBlockQuote-background,rgba(0,122,204,.1));border-left:3px solid var(--vscode-focusBorder,#007acc);padding:10px 14px;border-radius:0 6px 6px 0;font-style:italic;margin-bottom:16px;word-break:break-word}'
		+ '.pg{display:grid;grid-template-columns:1fr 1fr;gap:6px 14px}.pk2{opacity:.6;font-size:11px}.pv{font-size:12px;word-break:break-all}.sm{font-size:10px}'
		+ 'table{width:100%;border-collapse:collapse}td{padding:5px 8px;border-bottom:1px solid var(--vscode-editorWidget-border,rgba(255,255,255,.07));vertical-align:top}td:first-child{width:40%}'
		+ '.fl{opacity:.75;font-size:11px;padding-top:7px}'
		+ '.be{display:inline-block;font-size:9px;padding:1px 5px;border-radius:3px;margin-left:4px;font-weight:600;background:rgba(0,122,204,.2);color:#4fc3f7}'
		+ '.br{display:inline-block;font-size:9px;padding:1px 5px;border-radius:3px;margin-left:4px;font-weight:600;background:rgba(4,132,75,.2);color:#66bb6a}'
		+ '.li{padding:8px 10px;margin-bottom:8px;background:var(--vscode-textBlockQuote-background,rgba(255,255,255,.03));border-radius:4px;border:1px solid var(--vscode-editorWidget-border,rgba(255,255,255,.08))}'
		+ '.li code{font-size:12px;color:#4ec9b0}.lp{font-size:11px;margin-top:4px}.pk{opacity:.65}'
		+ '.ri{padding:4px 0;font-size:12px;border-bottom:1px solid var(--vscode-editorWidget-border,rgba(255,255,255,.07))}'
		+ '.ei{padding:6px 8px;color:#f48771;background:rgba(244,135,113,.1);border-radius:4px;margin-bottom:6px;font-size:12px}'
		+ '.mu{opacity:.5;font-size:11px}.ss{width:100%;border-radius:4px;border:1px solid var(--vscode-editorWidget-border,rgba(255,255,255,.1))}'
		+ '.empty{opacity:.4;font-style:italic;font-size:12px}';

	return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><style>' + css + '</style></head><body>'
		+ '<h1>&#128421; Salesforce Context</h1>'
		+ '<div class="meta">Captured: ' + capturedAt + '</div>'
		+ (prompt ? '<div class="pb">&#128172; &quot;' + escHtml(prompt) + '&quot;</div>' : '')
		+ '<section><h2>&#128196; Page Info</h2><div class="pg">' + pageInfoHTML + '</div></section>'
		+ ssHTML
		+ (fieldRows ? '<section><h2>&#128203; Field Values</h2><table><tbody>' + fieldRows + '</tbody></table></section>' : '')
		+ (recRows ? '<section><h2>&#128451; Record Data (API) &mdash; ' + escHtml(rec?.apiName || '') + '</h2><table><tbody>' + recRows + '</tbody></table></section>' : '')
		+ (lwcHTML ? '<section><h2>&#129513; LWC Components (' + String(lwcComps.length) + ')</h2>' + lwcHTML + '</section>' : '')
		+ (relHTML ? '<section><h2>&#128206; Related Lists</h2>' + relHTML + '</section>' : '')
		+ (valHTML ? '<section><h2>&#9888; Validation</h2>' + valHTML + '</section>' : '')
		+ (sfContext?.contextSummary ? '<section><details><summary style="cursor:pointer;font-weight:600;font-size:12px">&#128196; Raw Summary</summary><pre style="margin-top:10px;font-size:11px;white-space:pre-wrap;opacity:.8">' + escHtml(sfContext.contextSummary) + '</pre></details></section>' : '')
		+ '</body></html>';
}

// ─── Deactivation ─────────────────────────────────────────────────────────────

export function deactivate(): void {
	if (outputChannel) { outputChannel.dispose(); }
	if (contextPanel) { contextPanel.dispose(); }
}

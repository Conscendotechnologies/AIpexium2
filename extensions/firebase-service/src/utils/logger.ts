import * as vscode from 'vscode';

export class Logger {
	private outputChannel: vscode.OutputChannel;
	private debugEnabled: boolean;

	constructor() {
		this.outputChannel = vscode.window.createOutputChannel('Firebase Service');
		this.debugEnabled = vscode.workspace.getConfiguration('firebase-service').get<boolean>('enableDebugLogging', false);

		// Update debug setting when configuration changes
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('firebase-service.enableDebugLogging')) {
				this.debugEnabled = vscode.workspace.getConfiguration('firebase-service').get<boolean>('enableDebugLogging', false);
			}
		});
	}

	info(message: string, ...args: any[]): void {
		const timestamp = new Date().toISOString();
		const formattedMessage = `[${timestamp}] INFO: ${message}`;
		this.outputChannel.appendLine(formattedMessage);
		if (args.length > 0) {
			this.outputChannel.appendLine(`  Details: ${JSON.stringify(args, null, 2)}`);
		}
		console.log(`Firebase Service: ${message}`, ...args);
	}

	warn(message: string, ...args: any[]): void {
		const timestamp = new Date().toISOString();
		const formattedMessage = `[${timestamp}] WARN: ${message}`;
		this.outputChannel.appendLine(formattedMessage);
		if (args.length > 0) {
			this.outputChannel.appendLine(`  Details: ${JSON.stringify(args, null, 2)}`);
		}
		console.warn(`Firebase Service: ${message}`, ...args);
	}

	error(message: string, error?: any): void {
		const timestamp = new Date().toISOString();
		const formattedMessage = `[${timestamp}] ERROR: ${message}`;
		this.outputChannel.appendLine(formattedMessage);

		if (error) {
			const errorDetails = error instanceof Error ? error.stack || error.message : JSON.stringify(error, null, 2);
			this.outputChannel.appendLine(`  Error: ${errorDetails}`);
		}

		console.error(`Firebase Service: ${message}`, error);
	}

	debug(message: string, ...args: any[]): void {
		if (!this.debugEnabled) {
			return;
		}

		const timestamp = new Date().toISOString();
		const formattedMessage = `[${timestamp}] DEBUG: ${message}`;
		this.outputChannel.appendLine(formattedMessage);
		if (args.length > 0) {
			this.outputChannel.appendLine(`  Details: ${JSON.stringify(args, null, 2)}`);
		}
		console.debug(`Firebase Service: ${message}`, ...args);
	}

	dispose(): void {
		this.outputChannel.dispose();
	}
}

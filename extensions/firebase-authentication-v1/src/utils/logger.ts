import * as vscode from 'vscode';

export class Logger {
	private readonly outputChannel: vscode.OutputChannel;

	constructor() {
		this.outputChannel = vscode.window.createOutputChannel('Firebase Authentication');
	}

	public info(message: string, ...args: any[]): void {
		this.log('INFO', message, ...args);
	}

	public warn(message: string, ...args: any[]): void {
		this.log('WARN', message, ...args);
	}

	public error(message: string, error?: any): void {
		const errorMessage = error ? `${message}: ${this.formatError(error)}` : message;
		this.log('ERROR', errorMessage);
	}

	public debug(message: string, ...args: any[]): void {
		const config = vscode.workspace.getConfiguration('firebase-authentication-v1');
		if (config.get('enableDebugLogging', false)) {
			this.log('DEBUG', message, ...args);
		}
	}

	private log(level: string, message: string, ...args: any[]): void {
		const timestamp = new Date().toISOString();
		const formattedMessage = args.length > 0
			? `${message} ${args.map(arg => JSON.stringify(arg)).join(' ')}`
			: message;

		this.outputChannel.appendLine(`[${timestamp}] [${level}] ${formattedMessage}`);
	}

	private formatError(error: any): string {
		if (error instanceof Error) {
			return `${error.message} ${error.stack ? '\n' + error.stack : ''}`;
		}
		return JSON.stringify(error);
	}

	public show(): void {
		this.outputChannel.show();
	}

	public dispose(): void {
		this.outputChannel.dispose();
	}
}

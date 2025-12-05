import * as vscode from 'vscode';

export class MarketplaceLogger {
	private outputChannel: vscode.OutputChannel;

	constructor() {
		this.outputChannel = vscode.window.createOutputChannel('Marketplace');
	}

	private get isEnabled(): boolean {
		return vscode.workspace.getConfiguration('marketplace').get('enableLogging', true);
	}

	info(message: string): void {
		this.log('INFO', message);
	}

	warn(message: string): void {
		this.log('WARN', message);
	}

	error(message: string): void {
		this.log('ERROR', message);
	}

	log(level: string, message: string): void {
		if (!this.isEnabled) {
			return;
		}
		const timestamp = new Date().toISOString();
		this.outputChannel.appendLine(`[${timestamp}] [${level}] ${message}`);
	}

	show(): void {
		this.outputChannel.show();
	}

	clear(): void {
		this.outputChannel.clear();
	}

	dispose(): void {
		this.outputChannel.dispose();
	}
}

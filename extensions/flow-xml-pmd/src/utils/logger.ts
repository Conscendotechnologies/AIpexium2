/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export class Logger {
	private static instance: Logger;
	private outputChannel: vscode.OutputChannel;

	private constructor() {
		this.outputChannel = vscode.window.createOutputChannel('Flow XML PMD');
	}

	public static getInstance(): Logger {
		if (!Logger.instance) {
			Logger.instance = new Logger();
		}
		return Logger.instance;
	}

	public info(message: string): void {
		const timestamp = new Date().toLocaleTimeString();
		this.outputChannel.appendLine(`[${timestamp}] [INFO] ${message}`);
	}

	public warn(message: string): void {
		const timestamp = new Date().toLocaleTimeString();
		this.outputChannel.appendLine(`[${timestamp}] [WARN] ${message}`);
	}

	public error(message: string, error?: Error): void {
		const timestamp = new Date().toLocaleTimeString();
		this.outputChannel.appendLine(`[${timestamp}] [ERROR] ${message}`);
		if (error) {
			this.outputChannel.appendLine(`  ${error.message}`);
			if (error.stack) {
				this.outputChannel.appendLine(`  ${error.stack}`);
			}
		}
	}

	public debug(message: string): void {
		const timestamp = new Date().toLocaleTimeString();
		this.outputChannel.appendLine(`[${timestamp}] [DEBUG] ${message}`);
	}

	public show(): void {
		this.outputChannel.show();
	}

	public clear(): void {
		this.outputChannel.clear();
	}

	public dispose(): void {
		this.outputChannel.dispose();
	}

	public getOutputChannel(): vscode.OutputChannel {
		return this.outputChannel;
	}
}

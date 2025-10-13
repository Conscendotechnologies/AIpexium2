import * as vscode from 'vscode';

export enum LogLevel {
	DEBUG = 0,
	INFO = 1,
	WARN = 2,
	ERROR = 3
}

export class LoggerService {
	private static instance: LoggerService;
	private outputChannel: vscode.OutputChannel;
	private logLevel: LogLevel = LogLevel.INFO;

	private constructor() {
		this.outputChannel = vscode.window.createOutputChannel('Siid Marketplace');
		this.loadLogLevelFromConfig();

		// Listen for configuration changes
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('siid.marketplace.logLevel')) {
				this.loadLogLevelFromConfig();
			}
		});
	}

	private loadLogLevelFromConfig(): void {
		const config = vscode.workspace.getConfiguration('siid.marketplace');
		const logLevelString = config.get<string>('logLevel', 'INFO');

		switch (logLevelString.toUpperCase()) {
			case 'DEBUG':
				this.logLevel = LogLevel.DEBUG;
				break;
			case 'INFO':
				this.logLevel = LogLevel.INFO;
				break;
			case 'WARN':
				this.logLevel = LogLevel.WARN;
				break;
			case 'ERROR':
				this.logLevel = LogLevel.ERROR;
				break;
			default:
				this.logLevel = LogLevel.INFO;
		}

		this.debug(`Log level set to: ${LogLevel[this.logLevel]}`);
	}

	public static getInstance(): LoggerService {
		if (!LoggerService.instance) {
			LoggerService.instance = new LoggerService();
		}
		return LoggerService.instance;
	}

	/**
	 * Set the minimum log level
	 */
	public setLogLevel(level: LogLevel): void {
		this.logLevel = level;
	}

	/**
	 * Show the output channel
	 */
	public show(): void {
		this.outputChannel.show();
	}

	/**
	 * Clear the output channel
	 */
	public clear(): void {
		this.outputChannel.clear();
	}

	/**
	 * Log a debug message
	 */
	public debug(message: string, ...args: any[]): void {
		if (this.logLevel <= LogLevel.DEBUG) {
			this.log('DEBUG', message, ...args);
		}
	}

	/**
	 * Log an info message
	 */
	public info(message: string, ...args: any[]): void {
		if (this.logLevel <= LogLevel.INFO) {
			this.log('INFO', message, ...args);
		}
	}

	/**
	 * Log a warning message
	 */
	public warn(message: string, ...args: any[]): void {
		if (this.logLevel <= LogLevel.WARN) {
			this.log('WARN', message, ...args);
		}
	}

	/**
	 * Log an error message
	 */
	public error(message: string, error?: Error | any, ...args: any[]): void {
		if (this.logLevel <= LogLevel.ERROR) {
			let errorDetails = '';
			if (error) {
				if (error instanceof Error) {
					errorDetails = `\nError: ${error.message}\nStack: ${error.stack}`;
				} else {
					errorDetails = `\nError details: ${JSON.stringify(error, null, 2)}`;
				}
			}
			this.log('ERROR', message + errorDetails, ...args);
		}
	}

	/**
	 * Log a message with timestamp and level
	 */
	private log(level: string, message: string, ...args: any[]): void {
		const timestamp = new Date().toISOString();
		const formattedArgs = args.length > 0 ? ` | Args: ${JSON.stringify(args)}` : '';
		const logMessage = `[${timestamp}] [${level}] ${message}${formattedArgs}`;

		this.outputChannel.appendLine(logMessage);

		// Also log to console for development
		switch (level) {
			case 'DEBUG':
				console.debug(logMessage);
				break;
			case 'INFO':
				console.info(logMessage);
				break;
			case 'WARN':
				console.warn(logMessage);
				break;
			case 'ERROR':
				console.error(logMessage);
				break;
		}
	}

	/**
	 * Dispose of the output channel
	 */
	public dispose(): void {
		this.outputChannel.dispose();
	}
}

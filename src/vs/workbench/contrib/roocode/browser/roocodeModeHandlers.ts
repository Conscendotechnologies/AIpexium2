/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { RoocodeMode } from '../common/roocode.js';
import { RoocodeAIService } from './roocodeAIService.js';
import { RoocodeFileSystemService } from './roocodeFileSystemService.js';

/**
 * Base class for Roo Code mode handlers
 */
export abstract class RoocodeModeHandler extends Disposable {
	constructor(
		protected readonly mode: RoocodeMode,
		@ILogService protected readonly logService: ILogService
	) {
		super();
		this.logService.info(`RoocodeModeHandler: Initializing ${mode} mode handler`);
	}

	abstract handleRequest(input: string, context?: any): Promise<any>;
}

/**
 * Code mode handler - for code generation and editing
 */
export class RoocodeCodeModeHandler extends RoocodeModeHandler {
	constructor(
		@ILogService logService: ILogService,
		private readonly aiService: RoocodeAIService
	) {
		super(RoocodeMode.Code, logService);
	}

	async handleRequest(input: string, context?: {
		fileName?: string;
		existingCode?: string;
		language?: string;
	}): Promise<string> {
		this.logService.info('RoocodeCodeModeHandler: Handling code generation request');

		try {
			let prompt = input;

			if (context?.existingCode) {
				prompt = `Modify this code:\n\n${context.existingCode}\n\nInstruction: ${input}`;
			} else if (context?.language) {
				prompt = `Generate ${context.language} code: ${input}`;
			}

			const generatedCode = await this.aiService.generateCode(prompt);
			return generatedCode;
		} catch (error) {
			this.logService.error('RoocodeCodeModeHandler: Code generation failed', error);
			throw error;
		}
	}
}

/**
 * Architect mode handler - for architecture and design
 */
export class RoocodeArchitectModeHandler extends RoocodeModeHandler {
	constructor(
		@ILogService logService: ILogService,
		private readonly aiService: RoocodeAIService
	) {
		super(RoocodeMode.Architect, logService);
	}

	async handleRequest(input: string, context?: {
		existingArchitecture?: string;
		constraints?: string[];
	}): Promise<string> {
		this.logService.info('RoocodeArchitectModeHandler: Handling architecture design request');

		try {
			let prompt = input;

			if (context?.existingArchitecture) {
				prompt = `Current architecture:\n${context.existingArchitecture}\n\nRequirement: ${input}`;
			}

			if (context?.constraints && context.constraints.length > 0) {
				prompt += `\n\nConstraints:\n${context.constraints.join('\n')}`;
			}

			const architecture = await this.aiService.designArchitecture(prompt);
			return architecture;
		} catch (error) {
			this.logService.error('RoocodeArchitectModeHandler: Architecture design failed', error);
			throw error;
		}
	}
}

/**
 * Ask mode handler - for Q&A and documentation
 */
export class RoocodeAskModeHandler extends RoocodeModeHandler {
	constructor(
		@ILogService logService: ILogService,
		private readonly aiService: RoocodeAIService,
		private readonly fileService: RoocodeFileSystemService
	) {
		super(RoocodeMode.Ask, logService);
	}

	async handleRequest(input: string, context?: {
		codeContext?: string;
		files?: string[];
	}): Promise<string> {
		this.logService.info('RoocodeAskModeHandler: Handling question');

		try {
			let contextText = context?.codeContext;

			// If files are provided, read and include their content
			if (context?.files && context.files.length > 0) {
				const fileContents: string[] = [];
				for (const filePath of context.files) {
					const uri = this.fileService.resolveWorkspacePath(filePath);
					if (uri) {
						const content = await this.fileService.readFile(uri);
						fileContents.push(`File: ${filePath}\n${content}`);
					}
				}
				contextText = fileContents.join('\n\n---\n\n');
			}

			const answer = await this.aiService.answerQuestion(input, contextText);
			return answer;
		} catch (error) {
			this.logService.error('RoocodeAskModeHandler: Question handling failed', error);
			throw error;
		}
	}
}

/**
 * Debug mode handler - for debugging assistance
 */
export class RoocodeDebugModeHandler extends RoocodeModeHandler {
	constructor(
		@ILogService logService: ILogService,
		private readonly aiService: RoocodeAIService,
		private readonly fileService: RoocodeFileSystemService
	) {
		super(RoocodeMode.Debug, logService);
	}

	async handleRequest(input: string, context?: {
		code?: string;
		errorMessage?: string;
		stackTrace?: string;
		fileName?: string;
	}): Promise<string> {
		this.logService.info('RoocodeDebugModeHandler: Handling debug request');

		try {
			let code = context?.code;

			// If no code provided but fileName is given, read from file
			if (!code && context?.fileName) {
				const uri = this.fileService.resolveWorkspacePath(context.fileName);
				if (uri) {
					code = await this.fileService.readFile(uri);
				}
			}

			if (!code) {
				throw new Error('No code provided for debugging');
			}

			const errorInfo = [
				context?.errorMessage,
				context?.stackTrace
			].filter(Boolean).join('\n\n');

			const debugSuggestion = await this.aiService.debugCode(code, errorInfo || input);
			return debugSuggestion;
		} catch (error) {
			this.logService.error('RoocodeDebugModeHandler: Debug handling failed', error);
			throw error;
		}
	}
}

/**
 * Custom mode handler - for custom workflows
 */
export class RoocodeCustomModeHandler extends RoocodeModeHandler {
	constructor(
		@ILogService logService: ILogService,
		private readonly aiService: RoocodeAIService
	) {
		super(RoocodeMode.Custom, logService);
	}

	async handleRequest(input: string, context?: {
		workflow?: string;
		steps?: string[];
		parameters?: Record<string, any>;
	}): Promise<any> {
		this.logService.info('RoocodeCustomModeHandler: Handling custom workflow');

		try {
			// Custom workflows can be defined and executed here
			// This is a flexible mode that allows users to create their own AI-powered workflows

			if (context?.workflow) {
				this.logService.info(`Executing custom workflow: ${context.workflow}`);
			}

			// Execute workflow steps if provided
			if (context?.steps) {
				const results = [];
				for (const step of context.steps) {
					this.logService.info(`Executing step: ${step}`);
					// Step execution logic would go here
					results.push({ step, status: 'completed' });
				}
				return { workflow: context.workflow, results };
			}

			// Default: treat as a general AI request
			const response = await this.aiService.answerQuestion(input);
			return { response };
		} catch (error) {
			this.logService.error('RoocodeCustomModeHandler: Custom workflow failed', error);
			throw error;
		}
	}
}

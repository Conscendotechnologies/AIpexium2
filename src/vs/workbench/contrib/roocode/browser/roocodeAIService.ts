/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IRoocodeConfiguration } from '../common/roocode.js';
import { Emitter, Event } from '../../../../base/common/event.js';

/**
 * AI request options
 */
export interface IAIRequestOptions {
	model?: string;
	maxTokens?: number;
	temperature?: number;
	stream?: boolean;
	systemPrompt?: string;
}

/**
 * AI response
 */
export interface IAIResponse {
	content: string;
	model: string;
	usage?: {
		promptTokens: number;
		completionTokens: number;
		totalTokens: number;
	};
	finishReason?: string;
}

/**
 * Service for AI integration in Roo Code
 * Handles communication with various AI providers (OpenAI, Anthropic, etc.)
 */
export class RoocodeAIService extends Disposable {
	private readonly _onDidReceiveResponse = this._register(new Emitter<IAIResponse>());
	readonly onDidReceiveResponse: Event<IAIResponse> = this._onDidReceiveResponse.event;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		super();
		this.logService.info('RoocodeAIService: Initializing AI service');
	}

	/**
	 * Generate code with AI
	 */
	async generateCode(prompt: string, options?: IAIRequestOptions): Promise<string> {
		this.logService.info('RoocodeAIService: Generating code');

		try {
			const response = await this.sendRequest(prompt, {
				...options,
				systemPrompt: 'You are an expert software engineer. Generate clean, efficient, and well-documented code based on the user\'s requirements.'
			});

			return response.content;
		} catch (error) {
			this.logService.error('RoocodeAIService: Code generation failed', error);
			throw error;
		}
	}

	/**
	 * Analyze code with AI
	 */
	async analyzeCode(code: string, question?: string): Promise<string> {
		this.logService.info('RoocodeAIService: Analyzing code');

		const prompt = question 
			? `Analyze this code and answer the question:\n\nCode:\n${code}\n\nQuestion: ${question}`
			: `Analyze this code and provide insights:\n\n${code}`;

		try {
			const response = await this.sendRequest(prompt, {
				systemPrompt: 'You are an expert code reviewer. Analyze code for quality, bugs, performance, and best practices.'
			});

			return response.content;
		} catch (error) {
			this.logService.error('RoocodeAIService: Code analysis failed', error);
			throw error;
		}
	}

	/**
	 * Debug code with AI
	 */
	async debugCode(code: string, error: string): Promise<string> {
		this.logService.info('RoocodeAIService: Debugging code');

		const prompt = `Debug this code that produces the following error:\n\nCode:\n${code}\n\nError: ${error}`;

		try {
			const response = await this.sendRequest(prompt, {
				systemPrompt: 'You are an expert debugger. Identify issues in code and provide clear fixes.'
			});

			return response.content;
		} catch (error) {
			this.logService.error('RoocodeAIService: Debugging failed', error);
			throw error;
		}
	}

	/**
	 * Design architecture with AI
	 */
	async designArchitecture(requirements: string): Promise<string> {
		this.logService.info('RoocodeAIService: Designing architecture');

		const prompt = `Design a software architecture for these requirements:\n\n${requirements}`;

		try {
			const response = await this.sendRequest(prompt, {
				systemPrompt: 'You are an expert software architect. Design scalable, maintainable, and robust system architectures.'
			});

			return response.content;
		} catch (error) {
			this.logService.error('RoocodeAIService: Architecture design failed', error);
			throw error;
		}
	}

	/**
	 * Answer technical questions with AI
	 */
	async answerQuestion(question: string, context?: string): Promise<string> {
		this.logService.info('RoocodeAIService: Answering question');

		const prompt = context 
			? `Answer this question with the following context:\n\nContext:\n${context}\n\nQuestion: ${question}`
			: question;

		try {
			const response = await this.sendRequest(prompt, {
				systemPrompt: 'You are a knowledgeable software development expert. Provide clear, accurate, and helpful answers to technical questions.'
			});

			return response.content;
		} catch (error) {
			this.logService.error('RoocodeAIService: Question answering failed', error);
			throw error;
		}
	}

	/**
	 * Send request to AI provider
	 */
	private async sendRequest(prompt: string, options?: IAIRequestOptions): Promise<IAIResponse> {
		const config = this.getConfiguration();
		const model = options?.model || config.model || 'gpt-4';
		const maxTokens = options?.maxTokens || config.maxTokens || 4096;

		this.logService.info('RoocodeAIService: Sending request to AI', { model, maxTokens });

		// Validate API key
		if (!config.apiKey) {
			throw new Error('AI API key not configured. Please set roocode.apiKey in settings.');
		}

		try {
			// AI API integration logic would go here
			// For now, return a placeholder response
			const response: IAIResponse = {
				content: `[AI Response Placeholder]\n\nModel: ${model}\nPrompt: ${prompt.substring(0, 100)}...`,
				model,
				usage: {
					promptTokens: Math.floor(prompt.length / 4),
					completionTokens: 100,
					totalTokens: Math.floor(prompt.length / 4) + 100
				},
				finishReason: 'stop'
			};

			this._onDidReceiveResponse.fire(response);
			return response;
		} catch (error) {
			this.logService.error('RoocodeAIService: AI request failed', error);
			throw error;
		}
	}

	/**
	 * Get AI configuration
	 */
	private getConfiguration(): IRoocodeConfiguration {
		return this.configurationService.getValue<IRoocodeConfiguration>('roocode') || {};
	}

	override dispose(): void {
		this.logService.info('RoocodeAIService: Disposing AI service');
		super.dispose();
	}
}

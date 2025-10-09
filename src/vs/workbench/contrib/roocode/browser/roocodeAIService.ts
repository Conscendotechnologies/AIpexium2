/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IRoocodeConfiguration } from '../common/roocode.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { IRequestService } from '../../../../platform/request/common/request.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';

/**
 * AI Provider type
 */
export enum AIProvider {
	OpenAI = 'openai',
	Anthropic = 'anthropic'
}

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

	private readonly _onDidReceiveStreamChunk = this._register(new Emitter<string>());
	readonly onDidReceiveStreamChunk: Event<string> = this._onDidReceiveStreamChunk.event;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IRequestService private readonly requestService: IRequestService
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
		const temperature = options?.temperature || 0.7;

		this.logService.info('RoocodeAIService: Sending request to AI', { model, maxTokens });

		// Validate API key
		if (!config.apiKey) {
			throw new Error('AI API key not configured. Please set roocode.apiKey in settings.');
		}

		// Determine provider from model
		const provider = this.getProviderFromModel(model);

		try {
			const response = await this.callAIProvider(provider, {
				model,
				maxTokens,
				temperature,
				systemPrompt: options?.systemPrompt,
				userPrompt: prompt
			});

			this._onDidReceiveResponse.fire(response);
			return response;
		} catch (error) {
			this.logService.error('RoocodeAIService: AI request failed', error);
			throw error;
		}
	}

	/**
	 * Get AI provider from model name
	 */
	private getProviderFromModel(model: string): AIProvider {
		if (model.startsWith('gpt-') || model.startsWith('o1-')) {
			return AIProvider.OpenAI;
		} else if (model.startsWith('claude-')) {
			return AIProvider.Anthropic;
		}
		// Default to OpenAI
		return AIProvider.OpenAI;
	}

	/**
	 * Call AI provider API
	 */
	private async callAIProvider(provider: AIProvider, params: {
		model: string;
		maxTokens: number;
		temperature: number;
		systemPrompt?: string;
		userPrompt: string;
	}): Promise<IAIResponse> {
		const config = this.getConfiguration();

		if (provider === AIProvider.OpenAI) {
			return await this.callOpenAI(config.apiKey!, params);
		} else if (provider === AIProvider.Anthropic) {
			return await this.callAnthropic(config.apiKey!, params);
		}

		throw new Error(`Unsupported AI provider: ${provider}`);
	}

	/**
	 * Call OpenAI API
	 */
	private async callOpenAI(apiKey: string, params: {
		model: string;
		maxTokens: number;
		temperature: number;
		systemPrompt?: string;
		userPrompt: string;
	}): Promise<IAIResponse> {
		const messages: any[] = [];

		if (params.systemPrompt) {
			messages.push({
				role: 'system',
				content: params.systemPrompt
			});
		}

		messages.push({
			role: 'user',
			content: params.userPrompt
		});

		const requestBody = {
			model: params.model,
			messages: messages,
			max_tokens: params.maxTokens,
			temperature: params.temperature
		};

		const response = await this.requestService.request({
			type: 'POST',
			url: 'https://api.openai.com/v1/chat/completions',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${apiKey}`
			},
			data: JSON.stringify(requestBody)
		}, CancellationToken.None);

		if (response.res.statusCode !== 200) {
			const errorText = await this.streamToString(response.stream);
			throw new Error(`OpenAI API error (${response.res.statusCode}): ${errorText}`);
		}

		const responseText = await this.streamToString(response.stream);
		const responseData = JSON.parse(responseText);

		return {
			content: responseData.choices[0].message.content,
			model: responseData.model,
			usage: {
				promptTokens: responseData.usage.prompt_tokens,
				completionTokens: responseData.usage.completion_tokens,
				totalTokens: responseData.usage.total_tokens
			},
			finishReason: responseData.choices[0].finish_reason
		};
	}

	/**
	 * Call Anthropic API
	 */
	private async callAnthropic(apiKey: string, params: {
		model: string;
		maxTokens: number;
		temperature: number;
		systemPrompt?: string;
		userPrompt: string;
	}): Promise<IAIResponse> {
		const requestBody: any = {
			model: params.model,
			max_tokens: params.maxTokens,
			temperature: params.temperature,
			messages: [
				{
					role: 'user',
					content: params.userPrompt
				}
			]
		};

		if (params.systemPrompt) {
			requestBody.system = params.systemPrompt;
		}

		const response = await this.requestService.request({
			type: 'POST',
			url: 'https://api.anthropic.com/v1/messages',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': apiKey,
				'anthropic-version': '2023-06-01'
			},
			data: JSON.stringify(requestBody)
		}, CancellationToken.None);

		if (response.res.statusCode !== 200) {
			const errorText = await this.streamToString(response.stream);
			throw new Error(`Anthropic API error (${response.res.statusCode}): ${errorText}`);
		}

		const responseText = await this.streamToString(response.stream);
		const responseData = JSON.parse(responseText);

		return {
			content: responseData.content[0].text,
			model: responseData.model,
			usage: {
				promptTokens: responseData.usage.input_tokens,
				completionTokens: responseData.usage.output_tokens,
				totalTokens: responseData.usage.input_tokens + responseData.usage.output_tokens
			},
			finishReason: responseData.stop_reason
		};
	}

	/**
	 * Convert stream to string
	 */
	private async streamToString(stream: NodeJS.ReadableStream): Promise<string> {
		return new Promise((resolve, reject) => {
			const chunks: Buffer[] = [];
			stream.on('data', chunk => chunks.push(Buffer.from(chunk)));
			stream.on('error', reject);
			stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
		});
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

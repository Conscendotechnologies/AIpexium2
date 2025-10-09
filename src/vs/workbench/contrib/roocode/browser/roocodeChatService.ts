/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IRoocodeMessage, IRoocodeConversation, ICreateMessageOptions } from '../common/roocodeChat.js';
import { RoocodeMode } from '../common/roocode.js';

const CONVERSATION_STORAGE_KEY = 'roocode.conversations';
const MAX_STORED_CONVERSATIONS = 50;

/**
 * Service for managing Roo Code chat conversations and messages
 */
export class RoocodeChatService extends Disposable {
	private readonly _onDidAddMessage = this._register(new Emitter<IRoocodeMessage>());
	readonly onDidAddMessage: Event<IRoocodeMessage> = this._onDidAddMessage.event;

	private readonly _onDidUpdateConversation = this._register(new Emitter<IRoocodeConversation>());
	readonly onDidUpdateConversation: Event<IRoocodeConversation> = this._onDidUpdateConversation.event;

	private currentConversation: IRoocodeConversation | undefined;
	private conversationHistory: IRoocodeConversation[] = [];

	constructor(
		@ILogService private readonly logService: ILogService,
		@IStorageService private readonly storageService: IStorageService
	) {
		super();
		this.logService.info('RoocodeChatService: Initializing chat service');
		this.loadConversationHistory();
	}

	/**
	 * Create a new conversation
	 */
	createConversation(sessionId: string, mode: RoocodeMode): IRoocodeConversation {
		const conversation: IRoocodeConversation = {
			id: `conv-${Date.now()}`,
			sessionId,
			messages: [],
			mode,
			createdAt: new Date(),
			updatedAt: new Date(),
			metadata: {
				totalTokens: 0,
				messageCount: 0
			}
		};

		this.currentConversation = conversation;
		this.conversationHistory.unshift(conversation);

		// Keep only the latest conversations
		if (this.conversationHistory.length > MAX_STORED_CONVERSATIONS) {
			this.conversationHistory = this.conversationHistory.slice(0, MAX_STORED_CONVERSATIONS);
		}

		this.saveConversationHistory();
		this.logService.info(`RoocodeChatService: Created conversation ${conversation.id}`);

		return conversation;
	}

	/**
	 * Add a message to the current conversation
	 */
	addMessage(options: ICreateMessageOptions): IRoocodeMessage {
		if (!this.currentConversation) {
			throw new Error('No active conversation');
		}

		const message: IRoocodeMessage = {
			id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
			role: options.role,
			content: options.content,
			timestamp: new Date(),
			mode: options.mode || this.currentConversation.mode,
			metadata: options.metadata
		};

		this.currentConversation.messages.push(message);
		this.currentConversation.updatedAt = new Date();

		// Update metadata
		if (this.currentConversation.metadata) {
			this.currentConversation.metadata.messageCount = this.currentConversation.messages.length;
			if (message.metadata?.tokenCount) {
				this.currentConversation.metadata.totalTokens =
					(this.currentConversation.metadata.totalTokens || 0) + message.metadata.tokenCount;
			}
		}

		this.saveConversationHistory();
		this._onDidAddMessage.fire(message);
		this._onDidUpdateConversation.fire(this.currentConversation);

		this.logService.info(`RoocodeChatService: Added message ${message.id} to conversation ${this.currentConversation.id}`);

		return message;
	}

	/**
	 * Get current conversation
	 */
	getCurrentConversation(): IRoocodeConversation | undefined {
		return this.currentConversation;
	}

	/**
	 * Get all messages in current conversation
	 */
	getMessages(): IRoocodeMessage[] {
		return this.currentConversation?.messages || [];
	}

	/**
	 * Clear current conversation
	 */
	clearCurrentConversation(): void {
		if (this.currentConversation) {
			this.logService.info(`RoocodeChatService: Clearing conversation ${this.currentConversation.id}`);
			this.currentConversation = undefined;
		}
	}

	/**
	 * Get conversation history
	 */
	getConversationHistory(): IRoocodeConversation[] {
		return this.conversationHistory;
	}

	/**
	 * Load a previous conversation
	 */
	loadConversation(conversationId: string): IRoocodeConversation | undefined {
		const conversation = this.conversationHistory.find(c => c.id === conversationId);
		if (conversation) {
			this.currentConversation = conversation;
			this.logService.info(`RoocodeChatService: Loaded conversation ${conversationId}`);
			this._onDidUpdateConversation.fire(conversation);
		}
		return conversation;
	}

	/**
	 * Delete a conversation from history
	 */
	deleteConversation(conversationId: string): void {
		const index = this.conversationHistory.findIndex(c => c.id === conversationId);
		if (index !== -1) {
			this.conversationHistory.splice(index, 1);
			if (this.currentConversation?.id === conversationId) {
				this.currentConversation = undefined;
			}
			this.saveConversationHistory();
			this.logService.info(`RoocodeChatService: Deleted conversation ${conversationId}`);
		}
	}

	/**
	 * Save conversation history to storage
	 */
	private saveConversationHistory(): void {
		try {
			const historyData = JSON.stringify(this.conversationHistory);
			this.storageService.store(
				CONVERSATION_STORAGE_KEY,
				historyData,
				StorageScope.WORKSPACE,
				StorageTarget.MACHINE
			);
		} catch (error) {
			this.logService.error('RoocodeChatService: Failed to save conversation history', error);
		}
	}

	/**
	 * Load conversation history from storage
	 */
	private loadConversationHistory(): void {
		try {
			const historyData = this.storageService.get(CONVERSATION_STORAGE_KEY, StorageScope.WORKSPACE);
			if (historyData) {
				this.conversationHistory = JSON.parse(historyData);
				// Convert date strings back to Date objects
				this.conversationHistory.forEach(conv => {
					conv.createdAt = new Date(conv.createdAt);
					conv.updatedAt = new Date(conv.updatedAt);
					conv.messages.forEach(msg => {
						msg.timestamp = new Date(msg.timestamp);
					});
				});
				this.logService.info(`RoocodeChatService: Loaded ${this.conversationHistory.length} conversations from history`);
			}
		} catch (error) {
			this.logService.error('RoocodeChatService: Failed to load conversation history', error);
			this.conversationHistory = [];
		}
	}

	override dispose(): void {
		this.saveConversationHistory();
		super.dispose();
	}
}

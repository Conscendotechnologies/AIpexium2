/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import * as dom from '../../../../base/browser/dom.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IRoocodeMessage, RoocodeMessageRole } from '../common/roocodeChat.js';
import { RoocodeChatService } from './roocodeChatService.js';
import { localize } from '../../../../nls.js';
import { RoocodeMode } from '../common/roocode.js';
import { KeyCode } from '../../../../base/common/keyCodes.js';
import { StandardKeyboardEvent } from '../../../../base/browser/keyboardEvent.js';

/**
 * Chat widget for Roo Code panel
 * Handles message display and user input
 */
export class RoocodeChatWidget extends Disposable {
	private messagesContainer!: HTMLElement;
	private inputContainer!: HTMLElement;
	private inputTextarea!: HTMLTextAreaElement;
	private sendButton!: HTMLButtonElement;
	private modeSelector!: HTMLSelectElement;

	constructor(
		private readonly container: HTMLElement,
		private readonly chatService: RoocodeChatService,
		private readonly onSendMessage: (message: string, mode: RoocodeMode) => Promise<void>,
		@ILogService private readonly logService: ILogService
	) {
		super();
		this.logService.info('RoocodeChatWidget: Initializing chat widget');

		// Create main chat structure
		this.createChatStructure();

		// Setup event listeners
		this.setupEventListeners();

		// Listen to chat service events
		this._register(this.chatService.onDidAddMessage(message => {
			this.renderMessage(message);
			this.scrollToBottom();
		}));

		// Render existing messages if any
		this.renderExistingMessages();
	}

	private createChatStructure(): void {
		// Messages container
		this.messagesContainer = dom.append(this.container, dom.$('.roocode-messages-container'));

		// Input container
		this.inputContainer = dom.append(this.container, dom.$('.roocode-input-container'));

		// Mode selector
		const modeSelectorContainer = dom.append(this.inputContainer, dom.$('.roocode-mode-selector-container'));
		const modeLabel = dom.append(modeSelectorContainer, dom.$('label'));
		modeLabel.textContent = localize('roocode.chat.mode', "Mode:");

		this.modeSelector = dom.append(modeSelectorContainer, dom.$('select.roocode-mode-selector')) as HTMLSelectElement;
		this.addModeOptions();

		// Input textarea
		const inputWrapper = dom.append(this.inputContainer, dom.$('.roocode-input-wrapper'));
		this.inputTextarea = dom.append(inputWrapper, dom.$('textarea.roocode-input-textarea')) as HTMLTextAreaElement;
		this.inputTextarea.placeholder = localize('roocode.chat.placeholder.input', "Type your message... (Ctrl+Enter to send)");
		this.inputTextarea.rows = 3;

		// Send button
		const buttonContainer = dom.append(this.inputContainer, dom.$('.roocode-button-container'));
		this.sendButton = dom.append(buttonContainer, dom.$('button.monaco-button.monaco-text-button')) as HTMLButtonElement;
		this.sendButton.textContent = localize('roocode.chat.send', "Send");
	}

	private addModeOptions(): void {
		const modes = [
			{ value: RoocodeMode.Code, label: localize('roocode.mode.code', "Code") },
			{ value: RoocodeMode.Architect, label: localize('roocode.mode.architect', "Architect") },
			{ value: RoocodeMode.Ask, label: localize('roocode.mode.ask', "Ask") },
			{ value: RoocodeMode.Debug, label: localize('roocode.mode.debug', "Debug") },
			{ value: RoocodeMode.Custom, label: localize('roocode.mode.custom', "Custom") }
		];

		modes.forEach(mode => {
			const option = dom.append(this.modeSelector, dom.$('option')) as HTMLOptionElement;
			option.value = mode.value;
			option.textContent = mode.label;
		});
	}

	private setupEventListeners(): void {
		// Send button click
		this._register(dom.addDisposableListener(this.sendButton, dom.EventType.CLICK, () => {
			this.handleSendMessage();
		}));

		// Textarea keyboard shortcuts
		this._register(dom.addDisposableListener(this.inputTextarea, dom.EventType.KEY_DOWN, (e: KeyboardEvent) => {
			const event = new StandardKeyboardEvent(e);

			// Ctrl+Enter or Cmd+Enter to send
			if ((event.ctrlKey || event.metaKey) && event.keyCode === KeyCode.Enter) {
				e.preventDefault();
				this.handleSendMessage();
			}

			// Shift+Enter for new line (default behavior)
		}));

		// Auto-resize textarea
		this._register(dom.addDisposableListener(this.inputTextarea, dom.EventType.INPUT, () => {
			this.autoResizeTextarea();
		}));
	}

	private async handleSendMessage(): Promise<void> {
		const message = this.inputTextarea.value.trim();
		if (!message) {
			return;
		}

		const selectedMode = this.modeSelector.value as RoocodeMode;

		// Clear input
		this.inputTextarea.value = '';
		this.autoResizeTextarea();

		// Disable input while processing
		this.setInputEnabled(false);

		try {
			// Add user message immediately
			this.chatService.addMessage({
				role: RoocodeMessageRole.User,
				content: message,
				mode: selectedMode
			});

			// Call the handler to get AI response
			await this.onSendMessage(message, selectedMode);
		} catch (error) {
			this.logService.error('RoocodeChatWidget: Error sending message', error);

			// Add error message
			this.chatService.addMessage({
				role: RoocodeMessageRole.Error,
				content: localize('roocode.chat.error.send', "Failed to send message: {0}", error instanceof Error ? error.message : String(error))
			});
		} finally {
			// Re-enable input
			this.setInputEnabled(true);
			this.inputTextarea.focus();
		}
	}

	private renderExistingMessages(): void {
		const messages = this.chatService.getMessages();
		messages.forEach(message => this.renderMessage(message));
		this.scrollToBottom();
	}

	private renderMessage(message: IRoocodeMessage): void {
		const messageElement = dom.append(this.messagesContainer, dom.$('.roocode-message'));
		messageElement.classList.add(`roocode-message-${message.role}`);

		// Message header with role and timestamp
		const header = dom.append(messageElement, dom.$('.roocode-message-header'));

		const roleLabel = dom.append(header, dom.$('span.roocode-message-role'));
		roleLabel.textContent = this.getRoleLabel(message.role);

		const timestamp = dom.append(header, dom.$('span.roocode-message-timestamp'));
		timestamp.textContent = this.formatTimestamp(message.timestamp);

		if (message.mode) {
			const modeLabel = dom.append(header, dom.$('span.roocode-message-mode'));
			modeLabel.textContent = `[${message.mode}]`;
		}

		// Message content
		const content = dom.append(messageElement, dom.$('.roocode-message-content'));

		// For now, render as plain text. In Phase 1.4, we'll add markdown rendering
		const lines = message.content.split('\n');
		lines.forEach((line, index) => {
			if (index > 0) {
				dom.append(content, dom.$('br'));
			}
			const span = dom.append(content, dom.$('span'));
			span.textContent = line;
		});

		// Add metadata if available
		if (message.metadata) {
			const metadata = dom.append(messageElement, dom.$('.roocode-message-metadata'));

			if (message.metadata.tokenCount) {
				const tokens = dom.append(metadata, dom.$('span.roocode-message-tokens'));
				tokens.textContent = localize('roocode.chat.tokens', "Tokens: {0}", message.metadata.tokenCount);
			}

			if (message.metadata.model) {
				const model = dom.append(metadata, dom.$('span.roocode-message-model'));
				model.textContent = localize('roocode.chat.model', "Model: {0}", message.metadata.model);
			}
		}
	}

	private getRoleLabel(role: RoocodeMessageRole): string {
		switch (role) {
			case RoocodeMessageRole.User:
				return localize('roocode.chat.role.user', "You");
			case RoocodeMessageRole.Assistant:
				return localize('roocode.chat.role.assistant', "Roo Code");
			case RoocodeMessageRole.System:
				return localize('roocode.chat.role.system', "System");
			case RoocodeMessageRole.Error:
				return localize('roocode.chat.role.error', "Error");
			default:
				return role;
		}
	}

	private formatTimestamp(date: Date): string {
		const now = new Date();
		const diff = now.getTime() - date.getTime();

		// Less than 1 minute
		if (diff < 60000) {
			return localize('roocode.chat.time.now', "Just now");
		}

		// Less than 1 hour
		if (diff < 3600000) {
			const minutes = Math.floor(diff / 60000);
			return localize('roocode.chat.time.minutes', "{0}m ago", minutes);
		}

		// Less than 24 hours
		if (diff < 86400000) {
			const hours = Math.floor(diff / 3600000);
			return localize('roocode.chat.time.hours', "{0}h ago", hours);
		}

		// Format as date
		return date.toLocaleString();
	}

	private autoResizeTextarea(): void {
		// Reset height to auto to get the correct scrollHeight
		this.inputTextarea.style.height = 'auto';

		// Set height to scrollHeight with a max height
		const maxHeight = 200;
		const newHeight = Math.min(this.inputTextarea.scrollHeight, maxHeight);
		this.inputTextarea.style.height = newHeight + 'px';
	}

	private scrollToBottom(): void {
		// Use requestAnimationFrame to ensure DOM is updated
		requestAnimationFrame(() => {
			this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
		});
	}

	private setInputEnabled(enabled: boolean): void {
		this.inputTextarea.disabled = !enabled;
		this.sendButton.disabled = !enabled;
		this.modeSelector.disabled = !enabled;
	}

	/**
	 * Clear all messages from the display
	 */
	clearMessages(): void {
		dom.clearNode(this.messagesContainer);
	}

	/**
	 * Focus the input textarea
	 */
	focus(): void {
		this.inputTextarea.focus();
	}

	/**
	 * Set the current mode
	 */
	setMode(mode: RoocodeMode): void {
		this.modeSelector.value = mode;
	}
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { ChatMessage } from './openaiClient';

interface ConversationContext {
	messages: ChatMessage[];
	lastActivity: number;
}

class ContextManager {
	private contexts: Map<string, ConversationContext> = new Map();
	private readonly CONTEXT_TIMEOUT = 30 * 60 * 1000; // 30 minutes
	private readonly sessionId = 'vscode-session'; // Single session for VS Code

	constructor() {
		console.log('[Context] 🚀 ContextManager initialized');
		// Clean up old contexts periodically
		setInterval(() => this.cleanupOldContexts(), 5 * 60 * 1000); // Every 5 minutes
	}

	private cleanupOldContexts() {
		console.log('[Context] 🧹 Starting context cleanup...');
		const now = Date.now();
		let cleanedCount = 0;

		for (const [id, context] of this.contexts.entries()) {
			if (now - context.lastActivity > this.CONTEXT_TIMEOUT) {
				this.contexts.delete(id);
				cleanedCount++;
				console.log(`[Context] 🗑️ Cleaned up old context: ${id}`);
			}
		}

		if (cleanedCount === 0) {
			console.log('[Context] ✅ No contexts needed cleanup');
		} else {
			console.log(`[Context] ✅ Cleaned up ${cleanedCount} old contexts`);
		}
	}

	addMessage(role: 'system' | 'user' | 'assistant' | 'tool', content: string, name?: string) {
		console.log(`[Context] 💬 Adding ${role} message...`);
		console.log(`[Context] 📊 Message content length: ${content.length}`);
		if (name) {
			console.log(`[Context] 🏷️ Message name: ${name}`);
		}

		const context = this.getContext();
		const message: ChatMessage = { role, content, name };

		context.messages.push(message);
		context.lastActivity = Date.now();

		// Keep only last 20 messages to prevent token limit issues
		if (context.messages.length > 20) {
			console.log('[Context] ⚠️ Context too large, trimming messages...');
			// Always keep the system message (first message)
			const systemMessage = context.messages[0];
			const recentMessages = context.messages.slice(-19);
			context.messages = [systemMessage, ...recentMessages];
			console.log('[Context] ✂️ Trimmed context to 20 messages (kept system message)');
		}

		console.log(`[Context] ✅ Added ${role} message. Total messages: ${context.messages.length}`);
	}

	getMessages(): ChatMessage[] {
		console.log('[Context] 📋 Getting conversation messages...');
		const context = this.getContext();
		console.log(`[Context] 📊 Returning ${context.messages.length} messages`);
		return [...context.messages]; // Return a copy
	}

	private getContext(): ConversationContext {
		if (!this.contexts.has(this.sessionId)) {
			console.log('[Context] 🆕 Creating new context session');
			this.contexts.set(this.sessionId, {
				messages: [],
				lastActivity: Date.now()
			});
		} else {
			console.log('[Context] ✅ Using existing context session');
		}
		return this.contexts.get(this.sessionId)!;
	}

	clearContext() {
		console.log('[Context] 🧹 Clearing context session...');
		const hadContext = this.contexts.has(this.sessionId);
		this.contexts.delete(this.sessionId);

		if (hadContext) {
			console.log('[Context] ✅ Context session cleared');
		} else {
			console.log('[Context] ℹ️ No context session to clear');
		}
	}

	initializeWithSystemPrompt(systemPrompt: string) {
		console.log('[Context] 🔧 Initializing with system prompt...');
		console.log('[Context] 📊 System prompt length:', systemPrompt.length);

		const context = this.getContext();
		if (context.messages.length === 0 || context.messages[0].role !== 'system') {
			// Add or update system message
			if (context.messages.length > 0 && context.messages[0].role === 'system') {
				console.log('[Context] 🔄 Updating existing system message');
				context.messages[0] = { role: 'system', content: systemPrompt };
			} else {
				console.log('[Context] 🆕 Adding new system message');
				context.messages.unshift({ role: 'system', content: systemPrompt });
			}
			console.log('[Context] ✅ Initialized with system prompt');
		} else {
			console.log('[Context] ✅ System prompt already exists');
		}
	}
}

// Export singleton instance
export const contextManager = new ContextManager();

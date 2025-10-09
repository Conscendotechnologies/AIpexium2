/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RoocodeMode } from './roocode.js';

/**
 * Message types in a Roo Code conversation
 */
export enum RoocodeMessageRole {
	User = 'user',
	Assistant = 'assistant',
	System = 'system',
	Error = 'error'
}

/**
 * Represents a single message in a Roo Code conversation
 */
export interface IRoocodeMessage {
	id: string;
	role: RoocodeMessageRole;
	content: string;
	timestamp: Date;
	mode?: RoocodeMode;
	metadata?: {
		tokenCount?: number;
		model?: string;
		error?: string;
	};
}

/**
 * Represents a complete conversation with history
 */
export interface IRoocodeConversation {
	id: string;
	sessionId: string;
	messages: IRoocodeMessage[];
	mode: RoocodeMode;
	createdAt: Date;
	updatedAt: Date;
	metadata?: {
		totalTokens?: number;
		messageCount?: number;
	};
}

/**
 * Options for creating a message
 */
export interface ICreateMessageOptions {
	role: RoocodeMessageRole;
	content: string;
	mode?: RoocodeMode;
	metadata?: IRoocodeMessage['metadata'];
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const IRoocodeService = createDecorator<IRoocodeService>('roocodeService');

/**
 * Main service interface for Roo Code (Pro-Code) integration
 */
export interface IRoocodeService {
	readonly _serviceBrand: undefined;

	/**
	 * Start a new Roo Code session
	 */
	startSession(): Promise<void>;

	/**
	 * Stop the current Roo Code session
	 */
	stopSession(): Promise<void>;

	/**
	 * Execute a command in Roo Code
	 */
	executeCommand(command: string, args?: any[]): Promise<any>;

	/**
	 * Get the current session status
	 */
	getSessionStatus(): RoocodeSessionStatus;
}

/**
 * Roo Code session status
 */
export enum RoocodeSessionStatus {
	Inactive = 'inactive',
	Active = 'active',
	Processing = 'processing',
	Error = 'error'
}

/**
 * Roo Code operation modes
 */
export enum RoocodeMode {
	Code = 'code',
	Architect = 'architect',
	Ask = 'ask',
	Debug = 'debug',
	Custom = 'custom'
}

/**
 * Roo Code configuration interface
 */
export interface IRoocodeConfiguration {
	apiKey?: string;
	model?: string;
	mode?: RoocodeMode;
	autoSave?: boolean;
	maxTokens?: number;
}

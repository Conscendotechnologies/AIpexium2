/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RawContextKey, IContextKeyService, IContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { RoocodeSessionStatus } from '../common/roocode.js';

/**
 * Context keys for Roo Code
 */
export namespace RoocodeContextKeys {
	/** Whether Roo Code is enabled */
	export const enabled = new RawContextKey<boolean>('roocode.enabled', true);

	/** Whether a Roo Code session is active */
	export const sessionActive = new RawContextKey<boolean>('roocode.sessionActive', false);

	/** Current session status */
	export const sessionStatus = new RawContextKey<string>('roocode.sessionStatus', 'inactive');

	/** Current operation mode */
	export const mode = new RawContextKey<string>('roocode.mode', 'code');

	/** Whether terminal integration is available */
	export const hasTerminal = new RawContextKey<boolean>('roocode.hasTerminal', false);

	/** Whether MCP is connected */
	export const mcpConnected = new RawContextKey<boolean>('roocode.mcpConnected', false);

	/** Whether AI service is configured */
	export const aiConfigured = new RawContextKey<boolean>('roocode.aiConfigured', false);
}

/**
 * Service for managing Roo Code context keys
 */
export class RoocodeContextKeyService extends Disposable {
	private readonly enabledKey: IContextKey<boolean>;
	private readonly sessionActiveKey: IContextKey<boolean>;
	private readonly sessionStatusKey: IContextKey<string>;
	private readonly modeKey: IContextKey<string>;
	private readonly hasTerminalKey: IContextKey<boolean>;
	private readonly mcpConnectedKey: IContextKey<boolean>;
	private readonly aiConfiguredKey: IContextKey<boolean>;

	constructor(
		@IContextKeyService contextKeyService: IContextKeyService
	) {
		super();

		this.enabledKey = RoocodeContextKeys.enabled.bindTo(contextKeyService);
		this.sessionActiveKey = RoocodeContextKeys.sessionActive.bindTo(contextKeyService);
		this.sessionStatusKey = RoocodeContextKeys.sessionStatus.bindTo(contextKeyService);
		this.modeKey = RoocodeContextKeys.mode.bindTo(contextKeyService);
		this.hasTerminalKey = RoocodeContextKeys.hasTerminal.bindTo(contextKeyService);
		this.mcpConnectedKey = RoocodeContextKeys.mcpConnected.bindTo(contextKeyService);
		this.aiConfiguredKey = RoocodeContextKeys.aiConfigured.bindTo(contextKeyService);
	}

	setEnabled(enabled: boolean): void {
		this.enabledKey.set(enabled);
	}

	setSessionActive(active: boolean): void {
		this.sessionActiveKey.set(active);
	}

	setSessionStatus(status: RoocodeSessionStatus): void {
		this.sessionStatusKey.set(status);
	}

	setMode(mode: string): void {
		this.modeKey.set(mode);
	}

	setHasTerminal(hasTerminal: boolean): void {
		this.hasTerminalKey.set(hasTerminal);
	}

	setMCPConnected(connected: boolean): void {
		this.mcpConnectedKey.set(connected);
	}

	setAIConfigured(configured: boolean): void {
		this.aiConfiguredKey.set(configured);
	}
}

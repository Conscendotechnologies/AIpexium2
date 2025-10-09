/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IRoocodeConfiguration, IRoocodeService, RoocodeMode, RoocodeSessionStatus } from '../common/roocode.js';
import { RoocodeSession } from '../common/roocodeModel.js';
import { Emitter } from '../../../../base/common/event.js';

const ROOCODE_SESSION_KEY = 'roocode.currentSession';
const ROOCODE_CONFIG_KEY = 'roocode.configuration';

/**
 * Implementation of the Roo Code service
 */
export class RoocodeService extends Disposable implements IRoocodeService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeSession = this._register(new Emitter<RoocodeSession | undefined>());
	readonly onDidChangeSession = this._onDidChangeSession.event;

	private _currentSession: RoocodeSession | undefined;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IStorageService private readonly storageService: IStorageService
	) {
		super();
		this.logService.info('RoocodeService: Initializing');
		this.initialize();
	}

	private initialize(): void {
		// Restore previous session if exists
		const savedSessionId = this.storageService.get(ROOCODE_SESSION_KEY, StorageScope.WORKSPACE);
		if (savedSessionId) {
			this.logService.info(`RoocodeService: Restoring session ${savedSessionId}`);
			// Session restoration logic will be implemented later
		}
	}

	async startSession(): Promise<void> {
		if (this._currentSession && this._currentSession.status === RoocodeSessionStatus.Active) {
			this.logService.warn('RoocodeService: Session already active');
			return;
		}

		const sessionId = `session-${Date.now()}`;
		const config = this.getConfiguration();
		const mode = config.mode || RoocodeMode.Code;

		this._currentSession = new RoocodeSession(sessionId, mode);
		this._currentSession.start();

		// Save session to storage
		this.storageService.store(
			ROOCODE_SESSION_KEY,
			sessionId,
			StorageScope.WORKSPACE,
			StorageTarget.MACHINE
		);

		this.logService.info(`RoocodeService: Started session ${sessionId} in ${mode} mode`);
		this._onDidChangeSession.fire(this._currentSession);
	}

	async stopSession(): Promise<void> {
		if (!this._currentSession) {
			this.logService.warn('RoocodeService: No active session to stop');
			return;
		}

		this._currentSession.stop();
		this._currentSession.dispose();

		// Clear session from storage
		this.storageService.remove(ROOCODE_SESSION_KEY, StorageScope.WORKSPACE);

		this.logService.info(`RoocodeService: Stopped session ${this._currentSession.id}`);
		this._currentSession = undefined;
		this._onDidChangeSession.fire(undefined);
	}

	async executeCommand(command: string, args?: any[]): Promise<any> {
		if (!this._currentSession) {
			throw new Error('No active Roo Code session');
		}

		this.logService.info(`RoocodeService: Executing command ${command}`, args);
		this._currentSession.setStatus(RoocodeSessionStatus.Processing);

		try {
			// Command execution logic will be implemented later
			// This is a placeholder for the actual implementation
			const result = { success: true, command, args };
			
			this._currentSession.setStatus(RoocodeSessionStatus.Active);
			return result;
		} catch (error) {
			this._currentSession.setStatus(RoocodeSessionStatus.Error);
			this.logService.error('RoocodeService: Command execution failed', error);
			throw error;
		}
	}

	getSessionStatus(): RoocodeSessionStatus {
		return this._currentSession?.status ?? RoocodeSessionStatus.Inactive;
	}

	private getConfiguration(): IRoocodeConfiguration {
		const config = this.configurationService.getValue<IRoocodeConfiguration>('roocode');
		return config || {};
	}

	override dispose(): void {
		if (this._currentSession) {
			this._currentSession.dispose();
		}
		super.dispose();
	}
}

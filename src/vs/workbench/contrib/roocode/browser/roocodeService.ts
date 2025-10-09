/*--------------------------------------------------------------		// Initialize file service
		this._fileService = this._register(new RoocodeFileSystemService(
			this.fileServiceBase,
			this.workspaceService,
			this.logService
		));-------------------
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
import { RoocodeAIService } from './roocodeAIService.js';
import { RoocodeFileSystemService } from './roocodeFileSystemService.js';
import {
	RoocodeModeHandler,
	RoocodeCodeModeHandler,
	RoocodeArchitectModeHandler,
	RoocodeAskModeHandler,
	RoocodeDebugModeHandler,
	RoocodeCustomModeHandler
} from './roocodeModeHandlers.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';

const ROOCODE_SESSION_KEY = 'roocode.currentSession';

/**
 * Implementation of the Roo Code service
 */
export class RoocodeService extends Disposable implements IRoocodeService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeSession = this._register(new Emitter<RoocodeSession | undefined>());
	readonly onDidChangeSession = this._onDidChangeSession.event;

	private _currentSession: RoocodeSession | undefined;
	private _aiService: RoocodeAIService | undefined;
	private _fileService: RoocodeFileSystemService | undefined;
	private _modeHandlers = new Map<RoocodeMode, RoocodeModeHandler>();

	constructor(
		@ILogService private readonly logService: ILogService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IStorageService private readonly storageService: IStorageService,
		@IFileService private readonly fileServiceBase: IFileService,
		@IWorkspaceContextService private readonly workspaceService: IWorkspaceContextService
	) {
		super();
		this.logService.info('RoocodeService: Initializing');
		this.initializeServices();
		this.initialize();
	}

	private initializeServices(): void {
		// Initialize AI service
		this._aiService = this._register(new RoocodeAIService(
			this.logService,
			this.configurationService
		));

		// Initialize file system service
		this._fileService = this._register(new RoocodeFileSystemService(
			this.fileServiceBase,
			this.workspaceService,
			this.logService
		));

		// Initialize mode handlers
		this._modeHandlers.set(
			RoocodeMode.Code,
			this._register(new RoocodeCodeModeHandler(
				this.logService,
				this._aiService
			))
		);

		this._modeHandlers.set(
			RoocodeMode.Architect,
			this._register(new RoocodeArchitectModeHandler(
				this.logService,
				this._aiService
			))
		);

		this._modeHandlers.set(
			RoocodeMode.Ask,
			this._register(new RoocodeAskModeHandler(
				this.logService,
				this._aiService,
				this._fileService
			))
		);

		this._modeHandlers.set(
			RoocodeMode.Debug,
			this._register(new RoocodeDebugModeHandler(
				this.logService,
				this._aiService,
				this._fileService
			))
		);

		this._modeHandlers.set(
			RoocodeMode.Custom,
			this._register(new RoocodeCustomModeHandler(
				this.logService,
				this._aiService
			))
		);

		this.logService.info('RoocodeService: All services initialized');
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
			// Get the mode handler for the current session
			const handler = this._modeHandlers.get(this._currentSession.mode);
			if (!handler) {
				throw new Error(`No handler found for mode: ${this._currentSession.mode}`);
			}

			// Execute command using the appropriate mode handler
			const result = await handler.handleRequest(command, args?.[0]);

			this._currentSession.setStatus(RoocodeSessionStatus.Active);
			return { success: true, result, mode: this._currentSession.mode };
		} catch (error) {
			this._currentSession.setStatus(RoocodeSessionStatus.Error);
			this.logService.error('RoocodeService: Command execution failed', error);
			throw error;
		}
	}

	getSessionStatus(): RoocodeSessionStatus {
		return this._currentSession?.status ?? RoocodeSessionStatus.Inactive;
	}

	getCurrentSession(): RoocodeSession | undefined {
		return this._currentSession;
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

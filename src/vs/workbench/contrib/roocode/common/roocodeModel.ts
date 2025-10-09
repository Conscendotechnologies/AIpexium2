/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { RoocodeMode, RoocodeSessionStatus } from './roocode.js';

/**
 * Model representing a Roo Code session
 */
export class RoocodeSession extends Disposable {
	private readonly _onDidChangeStatus = this._register(new Emitter<RoocodeSessionStatus>());
	readonly onDidChangeStatus: Event<RoocodeSessionStatus> = this._onDidChangeStatus.event;

	private _status: RoocodeSessionStatus = RoocodeSessionStatus.Inactive;
	private _mode: RoocodeMode = RoocodeMode.Code;
	private _startTime?: Date;

	constructor(
		public readonly id: string,
		mode: RoocodeMode = RoocodeMode.Code
	) {
		super();
		this._mode = mode;
	}

	get status(): RoocodeSessionStatus {
		return this._status;
	}

	get mode(): RoocodeMode {
		return this._mode;
	}

	get startTime(): Date | undefined {
		return this._startTime;
	}

	setStatus(status: RoocodeSessionStatus): void {
		if (this._status !== status) {
			this._status = status;
			this._onDidChangeStatus.fire(status);
		}
	}

	setMode(mode: RoocodeMode): void {
		this._mode = mode;
	}

	start(): void {
		this._startTime = new Date();
		this.setStatus(RoocodeSessionStatus.Active);
	}

	stop(): void {
		this.setStatus(RoocodeSessionStatus.Inactive);
	}
}

/**
 * Model representing a Roo Code message
 */
export interface IRoocodeMessage {
	id: string;
	sessionId: string;
	role: 'user' | 'assistant' | 'system';
	content: string;
	timestamp: Date;
	mode: RoocodeMode;
}

/**
 * Model representing a Roo Code task
 */
export interface IRoocodeTask {
	id: string;
	sessionId: string;
	description: string;
	status: 'pending' | 'in-progress' | 'completed' | 'failed';
	createdAt: Date;
	completedAt?: Date;
	result?: any;
	error?: string;
}

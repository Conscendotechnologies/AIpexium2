/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { RoocodeSession } from '../../common/roocodeModel.js';
import { RoocodeMode, RoocodeSessionStatus } from '../../common/roocode.js';

suite('RoocodeModel', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('RoocodeSession - initialization', () => {
		const session = new RoocodeSession('test-session-1', RoocodeMode.Code);
		
		assert.strictEqual(session.id, 'test-session-1');
		assert.strictEqual(session.mode, RoocodeMode.Code);
		assert.strictEqual(session.status, RoocodeSessionStatus.Inactive);
		assert.strictEqual(session.startTime, undefined);

		session.dispose();
	});

	test('RoocodeSession - start', () => {
		const session = new RoocodeSession('test-session-2', RoocodeMode.Code);
		
		session.start();
		
		assert.strictEqual(session.status, RoocodeSessionStatus.Active);
		assert.notStrictEqual(session.startTime, undefined);

		session.dispose();
	});

	test('RoocodeSession - stop', () => {
		const session = new RoocodeSession('test-session-3', RoocodeMode.Code);
		
		session.start();
		assert.strictEqual(session.status, RoocodeSessionStatus.Active);
		
		session.stop();
		assert.strictEqual(session.status, RoocodeSessionStatus.Inactive);

		session.dispose();
	});

	test('RoocodeSession - status change events', () => {
		const session = new RoocodeSession('test-session-4', RoocodeMode.Code);
		let statusChanges = 0;
		
		session.onDidChangeStatus(() => {
			statusChanges++;
		});
		
		session.setStatus(RoocodeSessionStatus.Active);
		assert.strictEqual(statusChanges, 1);
		
		session.setStatus(RoocodeSessionStatus.Processing);
		assert.strictEqual(statusChanges, 2);
		
		// Setting to same status should not fire event
		session.setStatus(RoocodeSessionStatus.Processing);
		assert.strictEqual(statusChanges, 2);

		session.dispose();
	});

	test('RoocodeSession - mode change', () => {
		const session = new RoocodeSession('test-session-5', RoocodeMode.Code);
		
		assert.strictEqual(session.mode, RoocodeMode.Code);
		
		session.setMode(RoocodeMode.Debug);
		assert.strictEqual(session.mode, RoocodeMode.Debug);

		session.dispose();
	});
});

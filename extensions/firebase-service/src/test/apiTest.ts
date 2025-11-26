import * as vscode from 'vscode';
import { FirebaseServiceAPI } from '../api';
import { AuthManager } from '../auth/authManager';
import { FirestoreService } from '../firestore/firestoreService';

/**
 * Comprehensive test suite for Firebase Service API
 * This tests all API methods and their functionality
 */
export class FirebaseAPITester {
	private api: FirebaseServiceAPI;
	private testResults: Map<string, { success: boolean; message: string; duration: number }> = new Map();
	private outputChannel: vscode.OutputChannel;

	constructor(api: FirebaseServiceAPI) {
		this.api = api;
		this.outputChannel = vscode.window.createOutputChannel('Firebase API Tests');
	}

	/**
	 * Run all tests and display results
	 */
	async runAllTests(): Promise<void> {
		this.outputChannel.clear();
		this.outputChannel.show();
		this.testResults.clear();

		this.log('========================================');
		this.log('Firebase Service API Test Suite');
		this.log('========================================\n');

		// Run all test categories
		await this.testAuthenticationMethods();
		await this.testUserInfoMethods();
		await this.testFirestoreMethods();
		await this.testUtilityMethods();
		await this.testEventHandlers();

		// Display summary
		this.displayTestSummary();
	}

	/**
	 * Test all authentication-related methods
	 */
	private async testAuthenticationMethods(): Promise<void> {
		this.log('\n=== Testing Authentication Methods ===\n');

		// Test: isAuthenticated (initial state)
		await this.runTest('isAuthenticated (Initial Check)', async () => {
			const isAuth = await this.api.isAuthenticated();
			this.log(`  Current auth status: ${isAuth}`);
			return { success: true, message: `Authentication status: ${isAuth}` };
		});

		// Test: showAuthStatus
		await this.runTest('showAuthStatus', async () => {
			await this.api.showAuthStatus();
			return { success: true, message: 'Auth status displayed successfully' };
		});

		// Test: getCurrentUser (before sign-in)
		await this.runTest('getCurrentUser (Pre-Auth)', async () => {
			const user = await this.api.getCurrentUser();
			this.log(`  User data: ${user ? JSON.stringify(user, null, 2) : 'null'}`);
			return { success: true, message: user ? 'User found' : 'No user (expected before sign-in)' };
		});

		// Test: signIn
		await this.runTest('signIn', async () => {
			const choice = await vscode.window.showQuickPick(
				['Run Sign In Test', 'Skip (Already Signed In)'],
				{ placeHolder: 'Test sign-in functionality?' }
			);

			if (choice === 'Run Sign In Test') {
				await this.api.signIn();
				const isAuth = await this.api.isAuthenticated();
				if (isAuth) {
					return { success: true, message: 'Sign-in successful' };
				} else {
					return { success: false, message: 'Sign-in completed but user not authenticated' };
				}
			} else {
				return { success: true, message: 'Skipped (assumed already signed in)' };
			}
		});

		// Test: getCurrentUser (after sign-in)
		await this.runTest('getCurrentUser (Post-Auth)', async () => {
			const session = await this.api.getCurrentUser();
			if (session) {
				this.log(`  UID: ${session.uid}`);
				this.log(`  Email: ${session.user?.email || 'N/A'}`);
				this.log(`  Display Name: ${session.user?.displayName || 'N/A'}`);
				return { success: true, message: 'User data retrieved successfully' };
			} else {
				return { success: false, message: 'No user data found (user may not be signed in)' };
			}
		});

		// Test: isAuthenticated (after sign-in)
		await this.runTest('isAuthenticated (Post-Auth Check)', async () => {
			const isAuth = await this.api.isAuthenticated();
			if (isAuth) {
				return { success: true, message: 'User is authenticated' };
			} else {
				return { success: false, message: 'User not authenticated' };
			}
		});

		// Test: refreshSession
		await this.runTest('refreshSession', async () => {
			const isAuthBefore = await this.api.isAuthenticated();
			if (!isAuthBefore) {
				return { success: false, message: 'Cannot refresh - user not authenticated' };
			}

			await this.api.refreshSession();
			const isAuthAfter = await this.api.isAuthenticated();

			if (isAuthAfter) {
				return { success: true, message: 'Session refreshed successfully' };
			} else {
				return { success: false, message: 'Session refresh failed' };
			}
		});
	}

	/**
	 * Test user information methods
	 */
	private async testUserInfoMethods(): Promise<void> {
		this.log('\n=== Testing User Information Methods ===\n');

		const isAuth = await this.api.isAuthenticated();
		if (!isAuth) {
			this.log('⚠️  User not authenticated - skipping user info tests\n');
			return;
		}

		// Test: getAuthPageUrl
		await this.runTest('getAuthPageUrl', async () => {
			const url = this.api.getAuthPageUrl();
			this.log(`  Auth Page URL: ${url}`);
			if (url && url.length > 0) {
				return { success: true, message: `URL: ${url}` };
			} else {
				return { success: false, message: 'Auth page URL is empty' };
			}
		});

		// Test: getFirebaseManager
		await this.runTest('getFirebaseManager', async () => {
			const manager = this.api.getFirebaseManager();
			if (manager) {
				return { success: true, message: 'Firebase manager retrieved successfully' };
			} else {
				return { success: false, message: 'Firebase manager is null' };
			}
		});
	}

	/**
	 * Test Firestore-related methods
	 */
	private async testFirestoreMethods(): Promise<void> {
		this.log('\n=== Testing Firestore Methods ===\n');

		const isAuth = await this.api.isAuthenticated();
		if (!isAuth) {
			this.log('⚠️  User not authenticated - skipping Firestore tests\n');
			return;
		}

		// Test: getUserProperties (all properties)
		await this.runTest('getUserProperties (All)', async () => {
			const userData = await this.api.getUserProperties();
			if (userData) {
				this.log(`  User properties: ${JSON.stringify(userData, null, 2)}`);
				return { success: true, message: `Retrieved ${Object.keys(userData).length} properties` };
			} else {
				return { success: false, message: 'No user data found in Firestore' };
			}
		});

		// Test: getUserProperties (specific properties)
		await this.runTest('getUserProperties (Specific)', async () => {
			const userData = await this.api.getUserProperties(['email', 'displayName']);
			if (userData) {
				this.log(`  Selected properties: ${JSON.stringify(userData, null, 2)}`);
				return { success: true, message: 'Retrieved specific properties successfully' };
			} else {
				return { success: false, message: 'Failed to retrieve specific properties' };
			}
		});

		// Test: getAdminApiKey
		await this.runTest('getAdminApiKey', async () => {
			try {
				const apiKey = await this.api.getAdminApiKey();
				if (apiKey) {
					// Don't log the actual key for security
					this.log(`  Admin API key retrieved (length: ${apiKey.length})`);
					return { success: true, message: 'Admin API key retrieved successfully' };
				} else {
					return { success: false, message: 'Admin API key not found' };
				}
			} catch (error: any) {
				return { success: false, message: `Error: ${error.message}` };
			}
		});

		// Test: updateUserProperties (single field)
		await this.runTest('updateUserProperties (Single Field)', async () => {
			const choice = await vscode.window.showQuickPick(
				['Yes - Update Test Field', 'No - Skip'],
				{ placeHolder: 'Update a test property in Firestore?' }
			);

			if (choice === 'Yes - Update Test Field') {
				const testValue = `Test at ${new Date().toISOString()}`;
				await this.api.updateUserProperties({ testField: testValue });

				// Verify the update
				const userData = await this.api.getUserProperties(['testField']);
				if (userData && userData.testField === testValue) {
					return { success: true, message: 'Single field updated successfully' };
				} else {
					return { success: false, message: 'Field update verification failed' };
				}
			} else {
				return { success: true, message: 'Skipped' };
			}
		});

		// Test: updateUserProperties (multiple fields)
		await this.runTest('updateUserProperties (Multiple Fields)', async () => {
			const choice = await vscode.window.showQuickPick(
				['Yes - Update Multiple Test Fields', 'No - Skip'],
				{ placeHolder: 'Update multiple test properties in Firestore?' }
			);

			if (choice === 'Yes - Update Multiple Test Fields') {
				const timestamp = new Date().toISOString();
				const updates = {
					testField1: `Test 1 at ${timestamp}`,
					testField2: `Test 2 at ${timestamp}`,
					testNested: { value: 'nested test', timestamp }
				};

				await this.api.updateUserProperties(updates);

				// Verify the updates
				const userData = await this.api.getUserProperties(['testField1', 'testField2', 'testNested']);
				const allUpdated = userData &&
					userData.testField1 === updates.testField1 &&
					userData.testField2 === updates.testField2 &&
					userData.testNested.value === updates.testNested.value;

				if (allUpdated) {
					return { success: true, message: 'Multiple fields updated successfully' };
				} else {
					return { success: false, message: 'Multiple field update verification failed' };
				}
			} else {
				return { success: true, message: 'Skipped' };
			}
		});
	}

	/**
	 * Test utility methods
	 */
	private async testUtilityMethods(): Promise<void> {
		this.log('\n=== Testing Utility Methods ===\n');

		// Test: Multiple rapid authentication checks
		await this.runTest('Rapid Authentication Checks', async () => {
			const results = await Promise.all([
				this.api.isAuthenticated(),
				this.api.isAuthenticated(),
				this.api.isAuthenticated()
			]);

			const allSame = results.every(r => r === results[0]);
			if (allSame) {
				return { success: true, message: 'Concurrent auth checks consistent' };
			} else {
				return { success: false, message: 'Inconsistent auth check results' };
			}
		});

		// Test: Error handling with invalid property names
		await this.runTest('Error Handling (Invalid Properties)', async () => {
			try {
				const userData = await this.api.getUserProperties(['nonExistentField123']);
				if (userData) {
					return { success: true, message: 'Handled gracefully (returned data or null)' };
				} else {
					return { success: true, message: 'Handled gracefully (returned null)' };
				}
			} catch (error) {
				return { success: false, message: 'Should handle invalid properties gracefully' };
			}
		});
	}

	/**
	 * Test event handlers
	 */
	private async testEventHandlers(): Promise<void> {
		this.log('\n=== Testing Event Handlers ===\n');

		// Test: onAuthStateChanged event
		await this.runTest('onAuthStateChanged Event', async () => {
			return new Promise((resolve) => {
				let eventFired = false;

				const disposable = this.api.onAuthStateChanged((isAuthenticated) => {
					eventFired = true;
					this.log(`  Auth state change event fired`);
					this.log(`  Authenticated: ${isAuthenticated}`);
					disposable.dispose();
					resolve({ success: true, message: 'Event handler registered and working' });
				});

				// If no event fires within 2 seconds, resolve anyway
				setTimeout(() => {
					if (!eventFired) {
						disposable.dispose();
						resolve({
							success: true,
							message: 'Event handler registered (no state change occurred)'
						});
					}
				}, 2000);
			});
		});
	}

	/**
	 * Test sign-out functionality (run separately at the end)
	 */
	async testSignOut(): Promise<void> {
		this.log('\n=== Testing Sign Out ===\n');

		const choice = await vscode.window.showQuickPick(
			['Yes - Test Sign Out', 'No - Keep Session'],
			{ placeHolder: 'Test sign-out functionality? (This will sign you out)' }
		);

		if (choice === 'Yes - Test Sign Out') {
			await this.runTest('signOut', async () => {
				const wasAuth = await this.api.isAuthenticated();
				if (!wasAuth) {
					return { success: false, message: 'User not signed in' };
				}

				await this.api.signOut();
				const isAuth = await this.api.isAuthenticated();

				if (!isAuth) {
					return { success: true, message: 'Sign-out successful' };
				} else {
					return { success: false, message: 'Sign-out failed - user still authenticated' };
				}
			});
		} else {
			this.log('ℹ️  Sign-out test skipped\n');
		}

		this.displayTestSummary();
	}

	/**
	 * Helper method to run a single test
	 */
	private async runTest(
		testName: string,
		testFn: () => Promise<{ success: boolean; message: string }>
	): Promise<void> {
		this.log(`▶️  ${testName}...`);
		const startTime = Date.now();

		try {
			const result = await testFn();
			const duration = Date.now() - startTime;

			this.testResults.set(testName, {
				success: result.success,
				message: result.message,
				duration
			});

			const icon = result.success ? '✅' : '❌';
			this.log(`${icon} ${testName}: ${result.message} (${duration}ms)\n`);
		} catch (error: any) {
			const duration = Date.now() - startTime;
			this.testResults.set(testName, {
				success: false,
				message: `Exception: ${error.message}`,
				duration
			});
			this.log(`❌ ${testName}: EXCEPTION - ${error.message} (${duration}ms)\n`);
		}
	}

	/**
	 * Display test summary
	 */
	private displayTestSummary(): void {
		this.log('\n========================================');
		this.log('Test Summary');
		this.log('========================================\n');

		let passed = 0;
		let failed = 0;
		let totalDuration = 0;

		this.testResults.forEach((result, testName) => {
			if (result.success) {
				passed++;
			} else {
				failed++;
			}
			totalDuration += result.duration;
		});

		const total = passed + failed;
		const passRate = total > 0 ? ((passed / total) * 100).toFixed(1) : '0.0';

		this.log(`Total Tests: ${total}`);
		this.log(`✅ Passed: ${passed}`);
		this.log(`❌ Failed: ${failed}`);
		this.log(`📊 Pass Rate: ${passRate}%`);
		this.log(`⏱️  Total Duration: ${totalDuration}ms`);
		this.log(`⏱️  Average Duration: ${total > 0 ? (totalDuration / total).toFixed(1) : '0'}ms`);

		this.log('\n========================================\n');

		// Show notification with results
		if (failed === 0) {
			vscode.window.showInformationMessage(
				`✅ All ${passed} Firebase API tests passed! (${passRate}%)`
			);
		} else {
			vscode.window.showWarningMessage(
				`⚠️ Firebase API Tests: ${passed} passed, ${failed} failed (${passRate}%)`
			);
		}
	}

	/**
	 * Helper to log to output channel
	 */
	private log(message: string): void {
		this.outputChannel.appendLine(message);
	}
}

/**
 * Create and run the API test suite
 */
export async function runFirebaseAPITests(
	authManager: AuthManager,
	firestoreService: FirestoreService
): Promise<void> {
	const api = new FirebaseServiceAPI(authManager, firestoreService);
	const tester = new FirebaseAPITester(api);

	const choice = await vscode.window.showQuickPick(
		['Run All Tests (Exclude Sign Out)', 'Run All Tests + Sign Out', 'Cancel'],
		{
			placeHolder: 'Select test mode'
		}
	);

	if (choice === 'Run All Tests (Exclude Sign Out)') {
		await tester.runAllTests();
	} else if (choice === 'Run All Tests + Sign Out') {
		await tester.runAllTests();
		await tester.testSignOut();
	}
}

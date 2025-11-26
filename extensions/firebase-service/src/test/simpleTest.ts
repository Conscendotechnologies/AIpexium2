/**
 * Simple standalone test script for Firebase Service API
 * This can be used to quickly test API functionality without the full test suite
 */

import * as vscode from 'vscode';

/**
 * Quick test function that can be called from anywhere
 * Tests all API methods in sequence
 */
export async function quickAPITest() {
	const outputChannel = vscode.window.createOutputChannel('Firebase Quick Test');
	outputChannel.clear();
	outputChannel.show();

	const log = (msg: string) => outputChannel.appendLine(msg);

	log('=== Firebase API Quick Test ===\n');

	try {
		// Get the Firebase Service API
		const firebaseExt = vscode.extensions.getExtension('ConscendoTechInc.firebase-service');

		if (!firebaseExt) {
			log('❌ Firebase Service extension not found!');
			vscode.window.showErrorMessage('Firebase Service extension not installed or enabled');
			return;
		}

		log('✅ Extension found');

		// Activate the extension
		const api = await firebaseExt.activate();
		log('✅ Extension activated\n');

		// Test 1: Check Authentication Status
		log('▶️  Test 1: Check Authentication Status');
		const isAuth = await api.isAuthenticated();
		log(`   Result: ${isAuth ? '✅ Authenticated' : '⚠️  Not authenticated'}\n`);

		// Test 2: Get Current User
		log('▶️  Test 2: Get Current User');
		const user = await api.getCurrentUser();
		if (user) {
			log(`   ✅ User: ${user.email || user.uid}`);
			log(`   UID: ${user.uid}`);
			if (user.displayName) log(`   Name: ${user.displayName}`);
		} else {
			log('   ⚠️  No user (not signed in)');
		}
		log('');

		// Test 3: Get Auth Page URL
		log('▶️  Test 3: Get Auth Page URL');
		const authUrl = api.getAuthPageUrl();
		log(`   ✅ URL: ${authUrl}\n`);

		// Test 4: Get Firebase Manager
		log('▶️  Test 4: Get Firebase Manager');
		const manager = api.getFirebaseManager();
		log(`   ${manager ? '✅ Manager available' : '❌ Manager not available'}\n`);

		if (isAuth) {
			// Test 5: Get User Properties (all)
			log('▶️  Test 5: Get User Properties (All)');
			try {
				const userProps = await api.getUserProperties();
				if (userProps) {
					log(`   ✅ Retrieved ${Object.keys(userProps).length} properties`);
					log(`   Properties: ${Object.keys(userProps).join(', ')}`);
				} else {
					log('   ⚠️  No properties found');
				}
			} catch (error: any) {
				log(`   ❌ Error: ${error.message}`);
			}
			log('');

			// Test 6: Get User Properties (specific)
			log('▶️  Test 6: Get User Properties (Specific Fields)');
			try {
				const specificProps = await api.getUserProperties(['email', 'displayName']);
				if (specificProps) {
					log(`   ✅ Email: ${specificProps.email || 'N/A'}`);
					log(`   ✅ Display Name: ${specificProps.displayName || 'N/A'}`);
				} else {
					log('   ⚠️  No properties found');
				}
			} catch (error: any) {
				log(`   ❌ Error: ${error.message}`);
			}
			log('');

			// Test 7: Get Admin API Key
			log('▶️  Test 7: Get Admin API Key');
			try {
				const apiKey = await api.getAdminApiKey();
				if (apiKey) {
					log(`   ✅ API Key retrieved (length: ${apiKey.length})`);
				} else {
					log('   ⚠️  No API key found');
				}
			} catch (error: any) {
				log(`   ❌ Error: ${error.message}`);
			}
			log('');

			// Test 8: Test Auth State Change Event
			log('▶️  Test 8: Auth State Change Event Listener');
			let eventReceived = false;
			const disposable = api.onAuthStateChanged((isAuthenticated: boolean) => {
				if (!eventReceived) {
					eventReceived = true;
					log(`   ✅ Event listener working - Authenticated: ${isAuthenticated}`);
				}
			});
			// Wait a moment for the event
			await new Promise(resolve => setTimeout(resolve, 1000));
			disposable.dispose();
			if (!eventReceived) {
				log('   ℹ️  Event listener registered (no state change occurred)');
			}
			log('');

			// Test 9: Show Auth Status
			log('▶️  Test 9: Show Auth Status');
			try {
				await api.showAuthStatus();
				log('   ✅ Auth status shown\n');
			} catch (error: any) {
				log(`   ❌ Error: ${error.message}\n`);
			}

		} else {
			log('⚠️  Skipping authenticated-only tests (user not signed in)\n');
			log('💡 To test all functionality, run: FBS: Sign In\n');
		}

		// Summary
		log('=== Test Complete ===');
		log(`Authentication: ${isAuth ? '✅ Yes' : '❌ No'}`);
		log(`User Available: ${user ? '✅ Yes' : '❌ No'}`);
		log(`Firebase Manager: ${manager ? '✅ Yes' : '❌ No'}`);

		vscode.window.showInformationMessage('Firebase Quick Test completed! Check output for results.');

	} catch (error: any) {
		log(`\n❌ Critical Error: ${error.message}`);
		log(`Stack: ${error.stack}`);
		vscode.window.showErrorMessage(`Test failed: ${error.message}`);
	}
}

/**
 * Test specific API method
 */
export async function testSpecificMethod(methodName: string) {
	const outputChannel = vscode.window.createOutputChannel('Firebase Method Test');
	outputChannel.clear();
	outputChannel.show();

	const log = (msg: string) => outputChannel.appendLine(msg);

	log(`=== Testing: ${methodName} ===\n`);

	try {
		const firebaseExt = vscode.extensions.getExtension('ConscendoTechInc.firebase-service');
		if (!firebaseExt) {
			throw new Error('Firebase Service extension not found');
		}

		const api = await firebaseExt.activate();

		switch (methodName.toLowerCase()) {
			case 'isauthenticated':
				const isAuth = await api.isAuthenticated();
				log(`Result: ${isAuth}`);
				break;

			case 'getcurrentuser':
				const user = await api.getCurrentUser();
				log(`Result: ${JSON.stringify(user, null, 2)}`);
				break;

			case 'getuserproperties':
				const props = await api.getUserProperties();
				log(`Result: ${JSON.stringify(props, null, 2)}`);
				break;

			case 'getadminapikey':
				const apiKey = await api.getAdminApiKey();
				log(`Result: ${apiKey ? `Key retrieved (length: ${apiKey.length})` : 'null'}`);
				break;

			case 'getauthpageurl':
				const url = api.getAuthPageUrl();
				log(`Result: ${url}`);
				break;

			case 'getfirebasemanager':
				const manager = api.getFirebaseManager();
				log(`Result: ${manager ? 'Manager available' : 'null'}`);
				break;

			default:
				log(`Unknown method: ${methodName}`);
				log('Available methods:');
				log('- isAuthenticated');
				log('- getCurrentUser');
				log('- getUserProperties');
				log('- getAdminApiKey');
				log('- getAuthPageUrl');
				log('- getFirebaseManager');
		}

		log('\n✅ Test completed');

	} catch (error: any) {
		log(`❌ Error: ${error.message}`);
		log(`Stack: ${error.stack}`);
	}
}

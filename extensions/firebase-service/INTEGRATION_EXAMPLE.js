"use strict";
/**
 * Example: How to use Firebase Service API from another extension
 *
 * This file demonstrates how other extensions can integrate with Firebase Service
 * to access user authentication and data storage.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deactivate = exports.activate = exports.logUserActivity = exports.executeProtectedCommand = exports.loadExtensionSettings = exports.saveExtensionSettings = exports.displayUserInfo = exports.checkUserAuthentication = void 0;
const vscode = __importStar(require("vscode"));
/**
 * Example 1: Simple authentication check
 */
async function checkUserAuthentication() {
    const isAuthenticated = await vscode.commands.executeCommand('firebase-service.api.isAuthenticated');
    if (isAuthenticated) {
        vscode.window.showInformationMessage('✅ User is authenticated');
    }
    else {
        vscode.window.showWarningMessage('❌ User is not authenticated');
    }
    return isAuthenticated;
}
exports.checkUserAuthentication = checkUserAuthentication;
/**
 * Example 2: Get and display user details
 */
async function displayUserInfo() {
    const userDetails = await vscode.commands.executeCommand('firebase-service.api.getUserDetails');
    if (userDetails.authenticated && userDetails.user) {
        const user = userDetails.user;
        const info = `
User Information:
- ID: ${user.uid}
- Email: ${user.email || 'N/A'}
- Name: ${user.displayName || 'N/A'}
- Provider: ${user.provider}
- Email Verified: ${user.emailVerified}
        `.trim();
        vscode.window.showInformationMessage(info);
        return user;
    }
    else {
        vscode.window.showWarningMessage('No user signed in');
        return null;
    }
}
exports.displayUserInfo = displayUserInfo;
/**
 * Example 3: Store extension-specific user data
 */
async function saveExtensionSettings(settings) {
    // First, check if user is authenticated
    const userId = await vscode.commands.executeCommand('firebase-service.api.getUserId');
    if (!userId) {
        const signIn = await vscode.window.showWarningMessage('Please sign in to save settings', 'Sign In');
        if (signIn === 'Sign In') {
            await vscode.commands.executeCommand('firebase-service.signIn');
        }
        return false;
    }
    try {
        // Store data in Firestore
        await vscode.commands.executeCommand('firebase-service.storeData', 'myExtension_settings', // collection name
        userId, // document ID
        {
            ...settings,
            lastModified: new Date().toISOString()
        });
        vscode.window.showInformationMessage('✅ Settings saved successfully');
        return true;
    }
    catch (error) {
        vscode.window.showErrorMessage(`Failed to save settings: ${error}`);
        return false;
    }
}
exports.saveExtensionSettings = saveExtensionSettings;
/**
 * Example 4: Load extension-specific user data
 */
async function loadExtensionSettings() {
    const userId = await vscode.commands.executeCommand('firebase-service.api.getUserId');
    if (!userId) {
        return null;
    }
    try {
        const data = await vscode.commands.executeCommand('firebase-service.retrieveData', 'myExtension_settings', userId);
        if (data?.data) {
            vscode.window.showInformationMessage('✅ Settings loaded');
            return data.data;
        }
        return null;
    }
    catch (error) {
        console.error('Failed to load settings:', error);
        return null;
    }
}
exports.loadExtensionSettings = loadExtensionSettings;
/**
 * Example 5: Protected command that requires authentication
 */
async function executeProtectedCommand() {
    const userDetails = await vscode.commands.executeCommand('firebase-service.api.getUserDetails');
    if (!userDetails.authenticated) {
        const action = await vscode.window.showWarningMessage('This feature requires authentication', 'Sign In', 'Cancel');
        if (action === 'Sign In') {
            await vscode.commands.executeCommand('firebase-service.signIn');
            // After sign in, you might want to retry the command
        }
        return;
    }
    // Execute the protected functionality
    const user = userDetails.user;
    vscode.window.showInformationMessage(`Executing protected command for ${user.displayName || user.email}`);
    // Your protected logic here
    console.log('Protected command executed by:', user.uid);
}
exports.executeProtectedCommand = executeProtectedCommand;
/**
 * Example 6: Store user activity log
 */
async function logUserActivity(activity, metadata) {
    const userId = await vscode.commands.executeCommand('firebase-service.api.getUserId');
    if (!userId) {
        return; // Silently skip if not authenticated
    }
    try {
        const activityLog = {
            userId,
            activity,
            timestamp: new Date().toISOString(),
            metadata: metadata || {}
        };
        await vscode.commands.executeCommand('firebase-service.storeData', 'myExtension_activity_logs', `${userId}_${Date.now()}`, // unique document ID
        activityLog);
        console.log('Activity logged:', activity);
    }
    catch (error) {
        console.error('Failed to log activity:', error);
    }
}
exports.logUserActivity = logUserActivity;
/**
 * Example 7: Complete extension activation with Firebase integration
 */
function activate(context) {
    // Command 1: Check authentication
    context.subscriptions.push(vscode.commands.registerCommand('myExtension.checkAuth', async () => {
        await checkUserAuthentication();
    }));
    // Command 2: Show user info
    context.subscriptions.push(vscode.commands.registerCommand('myExtension.showUserInfo', async () => {
        await displayUserInfo();
    }));
    // Command 3: Save settings
    context.subscriptions.push(vscode.commands.registerCommand('myExtension.saveSettings', async () => {
        const settings = {
            theme: 'dark',
            notifications: true,
            autoSave: false
        };
        await saveExtensionSettings(settings);
    }));
    // Command 4: Load settings
    context.subscriptions.push(vscode.commands.registerCommand('myExtension.loadSettings', async () => {
        const settings = await loadExtensionSettings();
        if (settings) {
            vscode.window.showInformationMessage(`Loaded settings: ${JSON.stringify(settings, null, 2)}`);
        }
    }));
    // Command 5: Protected action
    context.subscriptions.push(vscode.commands.registerCommand('myExtension.protectedAction', async () => {
        await executeProtectedCommand();
    }));
    // Log activation
    logUserActivity('extension_activated', { version: '1.0.0' });
    console.log('Extension activated with Firebase Service integration');
}
exports.activate = activate;
function deactivate() {
    // Log deactivation
    logUserActivity('extension_deactivated');
}
exports.deactivate = deactivate;
//# sourceMappingURL=INTEGRATION_EXAMPLE.js.map
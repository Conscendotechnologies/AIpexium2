/**
 * Firebase Configuration for Custom IDE
 *
 * This file contains the embedded Firebase configuration that will be
 * bundled with your custom IDE distribution.
 */

export interface FirebaseConfig {
	apiKey: string,
	authDomain: string,
	projectId: string,
	storageBucket: string,
	messagingSenderId: string,
	appId: string,
	measurementId: string
}

/**
 * Default Firebase configuration embedded in the IDE
 * Replace these values with your actual Firebase project configuration
 */
export const DEFAULT_FIREBASE_CONFIG: FirebaseConfig = {
	apiKey: "AIzaSyCWlxqKOJL97X-NFRmigOWX8dZuCUwkP8s",
	authDomain: "salesforce-ide-c1761.firebaseapp.com",
	projectId: "salesforce-ide-c1761",
	storageBucket: "salesforce-ide-c1761.firebasestorage.app",
	messagingSenderId: "676849933137",
	appId: "1:676849933137:web:5794af7bd7582a0e1cd170",
	measurementId: "G-853MW5VR9D"
};

/**
 * Environment-specific configurations
 * Useful if you have different Firebase projects for development/production
 */
export const FIREBASE_CONFIGS = {
	development: {
		apiKey: "AIzaSyCWlxqKOJL97X-NFRmigOWX8dZuCUwkP8s",
		authDomain: "salesforce-ide-c1761.firebaseapp.com",
		projectId: "salesforce-ide-c1761",
		storageBucket: "salesforce-ide-c1761.firebasestorage.app",
		messagingSenderId: "676849933137",
		appId: "1:676849933137:web:5794af7bd7582a0e1cd170",
		measurementId: "G-853MW5VR9D"
	},
	production: {
		apiKey: "AIzaSyCWlxqKOJL97X-NFRmigOWX8dZuCUwkP8s",
		authDomain: "salesforce-ide-c1761.firebaseapp.com",
		projectId: "salesforce-ide-c1761",
		storageBucket: "salesforce-ide-c1761.firebasestorage.app",
		messagingSenderId: "676849933137",
		appId: "1:676849933137:web:5794af7bd7582a0e1cd170",
		measurementId: "G-853MW5VR9D"
	}
};

/**
 * Get Firebase configuration based on environment or use default
 */
export function getFirebaseConfig(): FirebaseConfig {
	// Check if we're in development mode
	const isDevelopment = process.env.NODE_ENV === 'development' ||
		process.env.VSCODE_DEV === 'true';

	// Return environment-specific config if available
	if (isDevelopment && FIREBASE_CONFIGS.development) {
		return FIREBASE_CONFIGS.development;
	}

	if (!isDevelopment && FIREBASE_CONFIGS.production) {
		return FIREBASE_CONFIGS.production;
	}

	// Fallback to default configuration
	return DEFAULT_FIREBASE_CONFIG;
}

/**
 * Validate that Firebase configuration is properly set
 */
export function validateFirebaseConfig(config: FirebaseConfig): boolean {
	return !!(
		config.apiKey &&
		config.authDomain &&
		config.projectId &&
		config.apiKey !== "AIzaSyBxxxxxxxxxxxxxxxxxxxxxxxx" // Ensure it's not the placeholder
	);
}

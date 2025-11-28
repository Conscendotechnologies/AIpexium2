// Interfaces for external OAuth flow
export interface ExternalAuthState {
	timestamp: number;
	auth_status: string;
	provider?: string;
	nonce: string;
}

export interface ExternalAuthResult {
	uid?: string;
	idToken?: string;
	state?: string;
	error?: string;
}

export interface FirebaseUser {
	uid: string;
	email?: string | null;
	displayName?: string | null;
	photoURL?: string | null;
	provider?: string;
	lastLoginAt?: any;
	updatedAt?: any;
}

export interface AuthSession {
	uid: string;
	idToken: string;
	expiresAt: number;
	user?: FirebaseUser; // Optional cached user data from Firestore
}

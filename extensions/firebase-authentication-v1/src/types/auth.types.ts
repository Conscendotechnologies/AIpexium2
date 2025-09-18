export interface AuthResult {
	token?: string;
	idToken?: string;
	refreshToken?: string;
	user?: FirebaseUser;
	error?: string;
	state?: string;
	provider?: string;
}

export interface FirebaseUser {
	uid: string;
	email?: string;
	displayName?: string;
	photoURL?: string;
	emailVerified: boolean;
	providerId: string;
}

export interface AuthState {
	csrfToken: string;
	sessionId: string;
	timestamp: number;
	provider?: string;
}

export interface FirebaseConfig {
	apiKey: string;
	authDomain: string;
	projectId: string;
	storageBucket: string;
	messagingSenderId: string;
	appId: string;
	measurementId?: string;
}

export interface AuthSession {
	user: FirebaseUser;
	token: string;
	refreshToken: string;
	expiresAt: number;
}

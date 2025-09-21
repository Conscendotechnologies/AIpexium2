export interface AuthResult {
	uid?: string;
	state?: string;
	error?: string;
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
	timestamp: number;
	auth_status: string;
}

export interface AuthSession {
	user: FirebaseUser;
	token: string;
	refreshToken: string;
	expiresAt: number;
}

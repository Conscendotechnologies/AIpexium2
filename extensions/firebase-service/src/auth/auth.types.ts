import { User } from '@firebase/auth';

export interface AuthUser {
	uid: string;
	email: string | null;
	displayName: string | null;
	photoURL: string | null;
	emailVerified: boolean;
	isAnonymous: boolean;
	metadata: {
		creationTime?: string;
		lastSignInTime?: string;
	};
}

export interface AuthState {
	isAuthenticated: boolean;
	user: AuthUser | null;
	isLoading: boolean;
	error: string | null;
}

export interface SignInOptions {
	provider?: 'google' | 'github' | 'email';
	email?: string;
	password?: string;
}

export interface AuthResult {
	success: boolean;
	user?: AuthUser;
	error?: string;
}

// New interfaces for external OAuth flow
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
	emailVerified: boolean;
	providerId: string;
}

export interface AuthSession {
	user: FirebaseUser;
	token: string;
	refreshToken: string;
	expiresAt: number;
}

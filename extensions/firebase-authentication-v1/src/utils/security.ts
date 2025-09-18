import { randomBytes } from 'crypto';
import { AuthState } from '../types/auth.types';

export class Security {
	/**
	 * Generate a secure CSRF token for state validation
	 */
	public static generateCSRFToken(): string {
		return randomBytes(32).toString('hex');
	}

	/**
	 * Generate a unique session ID
	 */
	public static generateSessionId(): string {
		return randomBytes(16).toString('hex');
	}

	/**
	 * Create auth state object with CSRF protection
	 */
	public static createAuthState(provider?: string): AuthState {
		return {
			csrfToken: this.generateCSRFToken(),
			sessionId: this.generateSessionId(),
			timestamp: Date.now(),
			provider
		};
	}

	/**
	 * Validate auth state to prevent CSRF attacks
	 */
	public static validateAuthState(receivedState: string, expectedState: AuthState): boolean {
		try {
			const parsed = JSON.parse(receivedState);

			// Check CSRF token match
			if (parsed.csrfToken !== expectedState.csrfToken) {
				return false;
			}

			// Check session ID match
			if (parsed.sessionId !== expectedState.sessionId) {
				return false;
			}

			// Check timestamp (reject if older than 10 minutes)
			const maxAge = 10 * 60 * 1000; // 10 minutes in milliseconds
			if (Date.now() - parsed.timestamp > maxAge) {
				return false;
			}

			return true;
		} catch (error) {
			return false;
		}
	}

	/**
	 * Encode auth state for URL transmission
	 */
	public static encodeAuthState(state: AuthState): string {
		return encodeURIComponent(JSON.stringify(state));
	}

	/**
	 * Decode auth state from URL
	 */
	public static decodeAuthState(encodedState: string): AuthState | null {
		try {
			const decoded = decodeURIComponent(encodedState);
			return JSON.parse(decoded);
		} catch (error) {
			return null;
		}
	}
}

import { ExternalAuthState } from '../auth/auth.types';
import * as crypto from 'crypto';

export class Security {
	/**
	 * Create a secure auth state for CSRF protection
	 */
	public static createAuthState(provider?: string): ExternalAuthState {
		return {
			timestamp: Date.now(),
			auth_status: 'pending',
			provider: provider || 'default',
			nonce: this.generateNonce()
		};
	}

	/**
	 * Generate a secure random nonce
	 */
	private static generateNonce(): string {
		return crypto.randomBytes(16).toString('hex');
	}

	/**
	 * Encode auth state for URL transmission
	 */
	public static encodeAuthState(authState: ExternalAuthState): string {
		return Buffer.from(JSON.stringify(authState)).toString('base64');
	}

	/**
	 * Decode auth state from URL
	 */
	public static decodeAuthState(encoded: string): ExternalAuthState {
		try {
			return JSON.parse(Buffer.from(encoded, 'base64').toString());
		} catch (error) {
			throw new Error('Invalid auth state encoding');
		}
	}

	/**
	 * Validate auth state for security
	 */
	public static validateAuthState(authState: ExternalAuthState): boolean {
		// Check if timestamp is not too old (5 minutes max)
		const maxAge = 5 * 60 * 1000; // 5 minutes
		const age = Date.now() - authState.timestamp;

		if (age > maxAge) {
			return false;
		}

		// Validate required fields
		return !!(
			authState.timestamp &&
			authState.auth_status &&
			authState.nonce
		);
	}
}

import { Logger } from './logger';

/**
 * Utility class for hackathon date checking and management
 */
export class HackathonUtils {
	private static readonly logger = new Logger();

	/**
	 * Check if hackathon has ended based on stored hackDate
	 * @param hackDate The stored hack date from Firestore
	 * @returns true if hackathon has ended, false if still ongoing
	 */
	public static isHackathonEnded(hackDate: any): boolean {
		if (!hackDate) {
			this.logger.warn('🎯 [HackathonUtils] No hackDate provided');
			return false;
		}

		try {
			// Convert hackDate to Date object if it's a string
			let endDate: Date;

			if (typeof hackDate === 'string') {
				endDate = new Date(hackDate);
			} else if (hackDate instanceof Date) {
				endDate = hackDate;
			} else if (hackDate?.toDate && typeof hackDate.toDate === 'function') {
				// Firebase Timestamp object
				endDate = hackDate.toDate();
			} else {
				this.logger.warn('🎯 [HackathonUtils] Unknown hackDate format:', hackDate);
				return false;
			}

			// Check if endDate is valid
			if (isNaN(endDate.getTime())) {
				this.logger.warn('🎯 [HackathonUtils] Invalid hackDate:', hackDate);
				return false;
			}

			const now = new Date();
			const hasEnded = now > endDate;

			this.logger.info(
				`🎯 [HackathonUtils] Hackathon check - Now: ${now.toISOString()}, End: ${endDate.toISOString()}, Ended: ${hasEnded}`
			);

			return hasEnded;
		} catch (error) {
			this.logger.error('🎯 [HackathonUtils] Error checking hackathon end date:', error);
			return false;
		}
	}

	/**
	 * Get time remaining until hackathon ends
	 * @param hackDate The stored hack date from Firestore
	 * @returns Time remaining in milliseconds, or -1 if already ended
	 */
	public static getTimeUntilEnd(hackDate: any): number {
		if (!hackDate) {
			return -1;
		}

		try {
			let endDate: Date;

			if (typeof hackDate === 'string') {
				endDate = new Date(hackDate);
			} else if (hackDate instanceof Date) {
				endDate = hackDate;
			} else if (hackDate?.toDate && typeof hackDate.toDate === 'function') {
				endDate = hackDate.toDate();
			} else {
				return -1;
			}

			if (isNaN(endDate.getTime())) {
				return -1;
			}

			const now = new Date();
			const timeRemaining = endDate.getTime() - now.getTime();

			return timeRemaining > 0 ? timeRemaining : -1;
		} catch (error) {
			this.logger.error('🎯 [HackathonUtils] Error calculating time until end:', error);
			return -1;
		}
	}

	/**
	 * Format time remaining for display
	 * @param milliseconds Time in milliseconds
	 * @returns Formatted string like "2 days 3 hours 45 minutes"
	 */
	public static formatTimeRemaining(milliseconds: number): string {
		if (milliseconds <= 0) {
			return 'Ended';
		}

		const totalSeconds = Math.floor(milliseconds / 1000);
		const days = Math.floor(totalSeconds / (24 * 60 * 60));
		const hours = Math.floor((totalSeconds % (24 * 60 * 60)) / (60 * 60));
		const minutes = Math.floor((totalSeconds % (60 * 60)) / 60);

		const parts: string[] = [];
		if (days > 0) parts.push(`${days} day${days > 1 ? 's' : ''}`);
		if (hours > 0) parts.push(`${hours} hour${hours > 1 ? 's' : ''}`);
		if (minutes > 0) parts.push(`${minutes} minute${minutes > 1 ? 's' : ''}`);

		return parts.length > 0 ? parts.join(' ') : 'Less than a minute';
	}
}

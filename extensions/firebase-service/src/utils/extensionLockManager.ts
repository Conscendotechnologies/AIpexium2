import { Logger } from './logger';
import { parseHackDate } from './dateUtils';

export class ExtensionLockManager {
	constructor(private logger: Logger) { }

	/**
	 * Check if extension should be locked based on hackDate
	 * SIID IDE Lock Policy:
	 * - Agent builds (VSCODE_QUALITY='agent'): Extension lock ENABLED
	 * - Stable/OSS builds (VSCODE_QUALITY='stable'): Extension lock DISABLED
	 * - Locks if hackDate exists and difference > 2 days
	 * @param hackDate The hack date to check against
	 * @returns true if extension should be locked, false otherwise
	 */
	public shouldLockExtension(hackDate: any): boolean {
		// TODO: Uncomment quality check after testing
		// Check if this is an Agent build (lock enabled only for agent)
		// const vscodeQuality = process.env.VSCODE_QUALITY;
		// if (vscodeQuality !== 'agent') {
		//     this.logger.debug(`SIID build quality: ${vscodeQuality} - Extension lock disabled (only enabled for 'agent' builds)`);
		//     return false;
		// }

		// Check if hackDate exists
		if (!hackDate) {
			this.logger.debug('🔍 [DEBUG] No hackDate found, extension is not locked');
			return false;
		}

		this.logger.info(`🔍 [DEBUG] hackDate received: ${JSON.stringify(hackDate)}`);

		// Parse hackDate
		this.logger.info('🔍 [DEBUG] Calling parseHackDate()...');
		const hackDateTime = parseHackDate(hackDate);
		if (!hackDateTime) {
			this.logger.warn('❌ [DEBUG] Failed to parse hackDate, extension is not locked');
			return false;
		}

		this.logger.info(`🔍 [DEBUG] hackDate parsed successfully: ${hackDateTime.toISOString()}`);

		// Calculate difference in days
		this.logger.info('🔍 [DEBUG] Calling calculateDaysDifference()...');
		const daysDifference = this.calculateDaysDifference(hackDateTime);
		this.logger.info(`🔍 [DEBUG] Days elapsed since hackDate: ${daysDifference} days`);
		this.logger.info(`🔍 [DEBUG] Threshold for lock: > 2 days`);

		// Lock if > 2 days
		const shouldLock = daysDifference > 2;
		this.logger.info(`🔍 [DEBUG] SIID Extension lock status (Agent build): ${shouldLock ? 'LOCKED ✅' : 'ACTIVE'} (${daysDifference} days)`);

		return shouldLock;
	}



	/**
	 * Calculate the difference in days between hackDate and current date
	 * @param hackDate The hack date
	 * @returns Number of days elapsed (rounded down)
	 */
	private calculateDaysDifference(hackDate: Date): number {
		const now = new Date();
		this.logger.info(`🔍 [DEBUG] calculateDaysDifference() - Current time: ${now.toISOString()}`);
		this.logger.info(`🔍 [DEBUG] calculateDaysDifference() - hackDate: ${hackDate.toISOString()}`);

		const diffInMs = now.getTime() - hackDate.getTime();
		this.logger.info(`🔍 [DEBUG] calculateDaysDifference() - Difference in milliseconds: ${diffInMs}`);

		const diffInDays = Math.ceil(diffInMs / (1000 * 60 * 60 * 24));
		this.logger.info(`🔍 [DEBUG] calculateDaysDifference() - Difference in days (ceiled): ${diffInDays}`);

		return diffInDays;
	}

	/**
	 * Get lock status message for logging/display
	 */
	public getLockStatusMessage(hackDate: any): string {
		const vscodeQuality = process.env.VSCODE_QUALITY;
		if (vscodeQuality !== 'insider') {
			return `Stable/OSS build - Extension lock disabled`;
		}

		if (!hackDate) {
			return `No hackDate set - Extension active`;
		}

		const hackDateTime = parseHackDate(hackDate);
		if (!hackDateTime) {
			return `Invalid hackDate - Extension active`;
		}

		const daysDifference = this.calculateDaysDifference(hackDateTime);
		if (daysDifference > 2) {
			return `Insider build - Extension LOCKED (${daysDifference} days elapsed)`;
		}

		return `Insider build - Extension active (${daysDifference} days elapsed, ${2 - daysDifference} days remaining)`;
	}
}

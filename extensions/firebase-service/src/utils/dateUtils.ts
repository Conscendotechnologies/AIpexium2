/**
 * Utility functions for date parsing and formatting
 * Handles multiple date formats including locale strings from Firebase
 */

/**
 * Parse hackDate from different formats
 * Supports: Date object, timestamp (ms), ISO string, locale string, Firebase Timestamp, etc.
 * @param hackDate The date to parse
 * @returns Parsed Date object or null if parsing fails
 * @example
 * // Parse ISO string
 * parseHackDate('2026-03-03T12:00:00Z');
 *
 * // Parse locale string (as returned from Firebase)
 * parseHackDate('March 3, 2026 at 12:00:00 AM UTC+5:30');
 *
 * // Parse Date object
 * parseHackDate(new Date());
 *
 * // Parse Firebase Timestamp
 * parseHackDate(firebaseTimestamp);
 */
export function parseHackDate(hackDate: any): Date | null {
	try {
		// Handle Date objects
		if (hackDate instanceof Date) {
			if (!isNaN(hackDate.getTime())) {
				return hackDate;
			}
		}

		// Handle serialized Firestore Timestamp objects
		// Format: { type: 'firestore/timestamp/1.0', seconds: number, nanoseconds: number }
		if (hackDate && typeof hackDate === 'object' && hackDate.type === 'firestore/timestamp/1.0' && typeof hackDate.seconds === 'number') {
			const parsed = new Date(hackDate.seconds * 1000); // Convert seconds to milliseconds
			if (!isNaN(parsed.getTime())) {
				return parsed;
			}
		}

		// Handle Firebase Timestamp objects (have toDate method)
		if (hackDate && typeof hackDate.toDate === 'function') {
			const parsed = hackDate.toDate();
			if (!isNaN(parsed.getTime())) {
				return parsed;
			}
		}

		// Handle numeric timestamps (milliseconds or seconds)
		if (typeof hackDate === 'number') {
			// Try both milliseconds and seconds
			let parsed = new Date(hackDate);
			if (!isNaN(parsed.getTime())) {
				return parsed;
			}

			// Try as seconds
			parsed = new Date(hackDate * 1000);
			if (!isNaN(parsed.getTime())) {
				return parsed;
			}
		}

		// Handle string formats
		if (typeof hackDate === 'string') {

			// Try ISO string first
			let parsed = new Date(hackDate);
			if (!isNaN(parsed.getTime())) {
				return parsed;
			}

			// Try parsing locale string format like "March 3, 2026 at 12:00:00 AM UTC+5:30"
			// Pattern: "Month Day, Year at Hour:Minute:Second AM/PM" (with optional timezone)
			const localeRegex = /^(\w+)\s+(\d{1,2}),\s+(\d{4})\s+at\s+(\d{1,2}):(\d{2}):(\d{2})\s+(AM|PM)/i;
			let match = hackDate.match(localeRegex);
			if (match) {
				const [, month, day, year, hour, minute, second, ampm] = match;
				const monthMap: { [key: string]: number } = {
					'january': 0, 'february': 1, 'march': 2, 'april': 3, 'may': 4, 'june': 5,
					'july': 6, 'august': 7, 'september': 8, 'october': 9, 'november': 10, 'december': 11
				};
				const monthIndex = monthMap[month.toLowerCase()];
				if (monthIndex !== undefined) {
					let hours = parseInt(hour);
					if (ampm.toUpperCase() === 'PM' && hours !== 12) {
						hours += 12;
					} else if (ampm.toUpperCase() === 'AM' && hours === 12) {
						hours = 0;
					}
					parsed = new Date(parseInt(year), monthIndex, parseInt(day), hours, parseInt(minute), parseInt(second));
					if (!isNaN(parsed.getTime())) {
						return parsed;
					}
				}
			}

			// Try more flexible locale formats
			// Pattern: "Month Day, Year" without time
			const simpleDateRegex = /^(\w+)\s+(\d{1,2}),\s+(\d{4})$/;
			match = hackDate.match(simpleDateRegex);
			if (match) {
				const [, month, day, year] = match;
				const monthMap: { [key: string]: number } = {
					'january': 0, 'february': 1, 'march': 2, 'april': 3, 'may': 4, 'june': 5,
					'july': 6, 'august': 7, 'september': 8, 'october': 9, 'november': 10, 'december': 11
				};
				const monthIndex = monthMap[month.toLowerCase()];
				if (monthIndex !== undefined) {
					parsed = new Date(parseInt(year), monthIndex, parseInt(day), 0, 0, 0);
					if (!isNaN(parsed.getTime())) {
						return parsed;
					}
				}
			}

			// Try YYYY-MM-DD format
			const isoDateRegex = /^(\d{4})-(\d{2})-(\d{2})$/;
			match = hackDate.match(isoDateRegex);
			if (match) {
				const [, year, month, day] = match;
				parsed = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), 0, 0, 0);
				if (!isNaN(parsed.getTime())) {
					return parsed;
				}
			}

		}

		return null;
	} catch (error) {
		console.error('🔍 [parseHackDate] Error parsing hackDate:', error);
		return null;
	}
}

/**
 * Convert hackDate to a readable string format
 * @param hackDate The date to convert
 * @returns Readable date string or 'N/A' if parsing fails
 */
export function formatHackDateForDisplay(hackDate: any): string {
	if (!hackDate) {
		return 'N/A';
	}

	try {
		const parsed = parseHackDate(hackDate);
		if (parsed && !isNaN(parsed.getTime())) {
			return parsed.toLocaleString();
		}
		return `${hackDate} (parse error)`;
	} catch (error) {
		return `${hackDate} (parse error)`;
	}
}

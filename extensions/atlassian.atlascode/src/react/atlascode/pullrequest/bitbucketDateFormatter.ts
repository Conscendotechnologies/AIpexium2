import { format, parseISO } from 'date-fns';

/**
 * Bitbucket Server and Cloud use different date formats. This will format either one.
 * @param date An unformatted date from either Bitubucket Server or Cloud.
 * @returns A human readable date.
 */
export const formatDate = (date: number | string): string => {
    if (!date) {
        return '';
    }
    if (typeof date === 'number') {
        return format(new Date(date), 'yyyy-MM-dd h:mm a');
    }
    return format(parseISO(date), 'yyyy-MM-dd h:mm a');
};

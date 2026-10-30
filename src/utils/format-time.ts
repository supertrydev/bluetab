import { formatRelativeTimeFromPast } from '@/i18n/format';

export function formatRelativeTime(ts: number): string {
    return formatRelativeTimeFromPast(ts);
}

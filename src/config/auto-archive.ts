/**
 * @module config/auto-archive
 *
 * Day choices for Settings > General > Auto-archive, shared by the settings
 * UI and the service-worker scan (src/services/auto-archive-service.ts).
 */

export const AUTO_ARCHIVE_DAY_OPTIONS = [3, 7, 14, 30] as const;
export const AUTO_ARCHIVE_DEFAULT_DAYS = 7;

/** Settings value -> a supported day count (anything else falls back to 7). */
export function resolveAutoArchiveDays(value: unknown): number {
    return (AUTO_ARCHIVE_DAY_OPTIONS as readonly number[]).includes(value as number)
        ? (value as number)
        : AUTO_ARCHIVE_DEFAULT_DAYS;
}

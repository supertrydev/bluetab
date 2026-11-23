import type { Settings } from '@/types/models';
import { Storage } from '@/utils/storage';

export const GROUP_MEMORY_NOTICE_EVENT = 'bluetab:group-memory-notice';
export const GROUP_MEMORY_NOTICE_KEY = 'groupMemoryNoticeShown';
export const GROUP_MEMORY_NOTICE_MS = 30_000;

export async function shouldShowGroupMemoryNotice(settings: Partial<Settings>): Promise<boolean> {
    return typeof window !== 'undefined' && (settings.restoreBehavior || 'removeFromList') === 'removeFromList'
        && settings.groupMemoryEnabled !== false
        && settings.groupMemoryAutoRemember !== false
        && !(await Storage.get<boolean>(GROUP_MEMORY_NOTICE_KEY));
}

/** Dispatch only in the page that performed the restore, never in other open views. */
export async function showGroupMemoryNotice(settings: Partial<Settings>): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    const show = async () => {
        if (!(await shouldShowGroupMemoryNotice(settings))) return false;
        await Storage.set(GROUP_MEMORY_NOTICE_KEY, true);
        window.dispatchEvent(new Event(GROUP_MEMORY_NOTICE_EVENT));
        return true;
    };
    // Extension pages share an origin: serialize the once-ever claim across views.
    if (typeof navigator !== 'undefined' && navigator.locks) {
        return navigator.locks.request(GROUP_MEMORY_NOTICE_KEY, show);
    }
    return show();
}

/**
 * @module utils/social-share
 *
 * WHY:  Enable users to share their tab collections to social platforms
 *       (X, WhatsApp, LinkedIn, Telegram, Reddit, Facebook, Email) or
 *       clipboard with one click.
 *       Uses intent URLs -- no OAuth or API keys required.
 *
 * WHAT: Share text generation, intent URL builders, clipboard copy,
 *       and Bluet URL resolution from shared refs.
 *
 * NOT:  Does not handle UI rendering -- consumers (GroupMenu, BulkEditToolbar)
 *       import these utilities and wire them to buttons.
 */

import { ToastManager } from '@/components/Toast';
import type { BluetSharedRef } from '@/types/bluet';

// ============================================================================
// Platform definitions
// ============================================================================

export interface SharePlatform {
    id: 'x' | 'whatsapp' | 'linkedin' | 'telegram' | 'reddit' | 'facebook' | 'email' | 'clipboard';
    name: string;
    icon: string;
}

export type SharePlatformId = SharePlatform['id'];
type LegacySharePlatformId = SharePlatformId | 'twitter';

/**
 * Supported share platforms with display names and Lucide icon names.
 */
export const SHARE_PLATFORMS: SharePlatform[] = [
    { id: 'x', name: 'X', icon: 'X' },
    { id: 'whatsapp', name: 'WhatsApp', icon: 'MessageCircle' },
    { id: 'linkedin', name: 'LinkedIn', icon: 'Linkedin' },
    { id: 'telegram', name: 'Telegram', icon: 'Send' },
    { id: 'email', name: 'Email', icon: 'Mail' },
    { id: 'reddit', name: 'Reddit', icon: 'MessageCircle' },
    { id: 'facebook', name: 'Facebook', icon: 'Share2' },
    { id: 'clipboard', name: 'Copy share text', icon: 'Copy' },
];

function getFirstHttpUrl(text?: string): string | undefined {
    const match = text?.match(/https?:\/\/[^\s)]+/i)?.[0];
    return match?.replace(/[.,;:!?]+$/, '');
}

function getShareUrl(url?: string, text?: string): string | undefined {
    return url || getFirstHttpUrl(text);
}

function getFacebookShareUrl(text?: string, fallbackUrl?: string): string | undefined {
    return getFirstHttpUrl(text) || fallbackUrl;
}

function combineShareText(text?: string, url?: string): string {
    return [text, url].filter(Boolean).join('\n\n');
}

function removeShareUrlFromText(text: string | undefined, url: string | undefined): string | undefined {
    if (!text || !url) return text;

    const lines = text.split('\n');
    let removed = false;
    const cleanedLines = lines
        .map((line) => {
            if (removed || !line.includes(url)) return line;
            removed = true;
            const withoutUrl = line
                .replace(` - ${url}`, '')
                .replace(url, '')
                .replace(/[ \t]+-\s*$/, '')
                .trimEnd();
            return withoutUrl.trim() ? withoutUrl : null;
        })
        .filter((line): line is string => line !== null);

    return cleanedLines.join('\n');
}

function buildTelegramWebShareUrl(text?: string, url?: string): string {
    const params = new URLSearchParams();
    if (url) params.set('url', url);
    if (text) params.set('text', text);
    return `https://t.me/share/url?${params.toString()}`;
}

async function copyTextForLimitedComposer(platform: LegacySharePlatformId, text?: string, url?: string): Promise<boolean> {
    if (!text || (platform !== 'linkedin' && platform !== 'facebook')) return false;
    if (!navigator.clipboard?.writeText) return false;
    try {
        await navigator.clipboard.writeText(combineShareText(text, url));
        const platformName = platform === 'facebook' ? 'Facebook' : 'LinkedIn';
        ToastManager.getInstance().info(`Share text copied. Paste it into the ${platformName} composer.`);
        return true;
    } catch {
        // Some share surfaces do not expose clipboard access; the intent URL still opens.
        return false;
    }
}

// ============================================================================
// Text builders
// ============================================================================

/**
 * Build share text for a single group.
 * Format: Check out my "{groupName}" collection ({tabCount} tabs):
 *   Note:
 *   {notes}
 *   • Title - url
 *   • Title - url
 *   -- {bluetUrl}
 */
export function buildShareText(
    groupName: string,
    tabCount: number,
    bluetUrl?: string,
    tabs?: Array<{ title: string; url: string }>,
    notes?: string,
): string {
    const base = `Check out my "${groupName}" collection (${tabCount} tabs)`;

    const parts: string[] = [base];
    const normalizedNotes = notes?.trim();

    if (normalizedNotes) {
        parts.push(`Note:\n${normalizedNotes}`);
    }

    if (tabs && tabs.length > 0) {
        const tabLines = tabs.map(t => `• ${t.title} - ${t.url}`).join('\n');
        parts.push(tabLines);
    }

    if (bluetUrl) {
        parts.push(`-- ${bluetUrl}`);
    }

    return parts.join('\n');
}

/**
 * Build share text for multiple groups (bulk share).
 * Lists group names with their tabs, appends Bluet URLs if available.
 */
export function buildBulkShareText(
    groups: Array<{ name: string; tabCount: number; tabs?: Array<{ title: string; url: string }>; notes?: string }>,
    bluetUrls?: string[],
): string {
    const parts: string[] = ['Check out my tab collections:'];

    for (const g of groups) {
        parts.push(`\n📁 ${g.name} (${g.tabCount} tabs)`);
        const normalizedNotes = g.notes?.trim();
        if (normalizedNotes) {
            parts.push(`Note:\n${normalizedNotes}`);
        }
        if (g.tabs && g.tabs.length > 0) {
            for (const t of g.tabs) {
                parts.push(`• ${t.title} - ${t.url}`);
            }
        }
    }

    if (bluetUrls && bluetUrls.length > 0) {
        parts.push(`\n-- ${bluetUrls.join(' ')}`);
    }

    return parts.join('\n');
}

// ============================================================================
// URL builders
// ============================================================================

/**
 * Build a share intent URL for the given platform.
 *
 * - X: https://x.com/intent/tweet?text={text}&url={url}
 * - WhatsApp: https://api.whatsapp.com/send?text={text} {url}
 * - LinkedIn: https://www.linkedin.com/feed/?shareActive=true&mini=true&text={text}
 * - Telegram app: tg://msg_url?url={url}&text={text-without-duplicate-url}
 * - Reddit: https://www.reddit.com/submit?selftext=true&title={title}&text={text}
 * - Facebook: https://www.facebook.com/sharer/sharer.php?u={first-link}
 *   Full text is copied by openShareUrl because Facebook may ignore quote text.
 * - Email: mailto:?subject=Bluetab collection&body={text} {url}
 */
export function buildShareUrl(
    platform: LegacySharePlatformId,
    text?: string,
    url?: string,
): string {
    const directUrl = getShareUrl(url, text);

    switch (platform) {
        case 'twitter':
        case 'x': {
            const params = new URLSearchParams();
            if (text) params.set('text', text);
            if (url) params.set('url', url);
            return `https://x.com/intent/tweet?${params.toString()}`;
        }
        case 'whatsapp': {
            const combined = [text, url].filter(Boolean).join(' ');
            const params = new URLSearchParams({ text: combined });
            return `https://api.whatsapp.com/send?${params.toString()}`;
        }
        case 'linkedin': {
            const combined = combineShareText(text, url);
            const params = new URLSearchParams({ shareActive: 'true', mini: 'true' });
            if (combined) params.set('text', combined);
            return `https://www.linkedin.com/feed/?${params.toString()}`;
        }
        case 'telegram': {
            const telegramUrl = directUrl || url;
            const params = new URLSearchParams();
            if (telegramUrl) params.set('url', telegramUrl);
            const cleanedText = removeShareUrlFromText(text, telegramUrl);
            if (cleanedText) params.set('text', cleanedText);
            return `tg://msg_url?${params.toString()}`;
        }
        case 'reddit': {
            const title = text?.split('\n').find(line => line.trim())?.slice(0, 300) || 'Bluetab collection';
            const params = new URLSearchParams({ selftext: 'true', title });
            const combined = combineShareText(text, url);
            if (combined) params.set('text', combined);
            return `https://www.reddit.com/submit?${params.toString()}`;
        }
        case 'facebook': {
            const facebookUrl = getFacebookShareUrl(text, url);
            if (!facebookUrl) return '';
            const params = new URLSearchParams({ u: facebookUrl });
            const quote = combineShareText(text, url);
            if (quote) params.set('quote', quote);
            return `https://www.facebook.com/sharer/sharer.php?${params.toString()}`;
        }
        case 'email': {
            const combined = combineShareText(text, url);
            const params = new URLSearchParams({
                subject: 'Bluetab collection',
                body: combined,
            });
            return `mailto:?${params.toString()}`;
        }
        case 'clipboard':
            return '';
    }
}

/**
 * Open a share URL for the given platform, or copy to clipboard.
 *
 * For social platforms: builds intent URL and opens in a new tab.
 * For 'clipboard': copies text (+url) to clipboard and shows a toast.
 */
export async function openShareUrl(
    platform: string,
    text: string,
    url?: string,
): Promise<void> {
    if (platform === 'clipboard') {
        const content = [text, url].filter(Boolean).join(' ');
        try {
            await navigator.clipboard.writeText(content);
            ToastManager.getInstance().success('Share text copied to clipboard');
        } catch {
            ToastManager.getInstance().error('Failed to copy to clipboard');
        }
        return;
    }

    const typedPlatform = platform as LegacySharePlatformId;
    const shareUrl = buildShareUrl(typedPlatform, text, url);

    if (!shareUrl) {
        ToastManager.getInstance().info('This platform needs at least one link to share');
        return;
    }

    await copyTextForLimitedComposer(typedPlatform, text, url);

    try {
        await chrome.tabs.create({ url: shareUrl, active: true });
    } catch (error) {
        if (typedPlatform !== 'telegram') throw error;
        const fallbackUrl = getShareUrl(url, text);
        await chrome.tabs.create({
            url: buildTelegramWebShareUrl(removeShareUrlFromText(text, fallbackUrl), fallbackUrl),
            active: true,
        });
    }
}

// ============================================================================
// Bluet URL resolution
// ============================================================================

/** Bluet base URL for constructing full URLs from relative pageUrl paths. */
const BLUET_BASE_URL = 'https://bluet.in';

/**
 * Get the full Bluet URL for a group from shared refs.
 * Constructs full URL from the relative pageUrl stored in BluetSharedRef.
 *
 * @returns Full Bluet URL (e.g. "https://bluet.in/user/tabs") or undefined
 */
export function getGroupBluetUrl(
    groupId: string,
    sharedRefs: BluetSharedRef[],
): string | undefined {
    const ref = sharedRefs.find(r => r.id === groupId);
    if (!ref || !ref.pageUrl) return undefined;

    // pageUrl is relative (e.g. "/user/tabs"), construct full URL
    if (ref.pageUrl.startsWith('http')) {
        return ref.pageUrl;
    }
    return `${BLUET_BASE_URL}${ref.pageUrl}`;
}

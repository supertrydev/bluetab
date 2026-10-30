/**
 * Tests for social-share utility module.
 * Covers: buildShareText, buildBulkShareText, buildShareUrl, openShareUrl,
 *         copyShareText, getGroupBluetUrl, SHARE_PLATFORMS.
 */

import {
    buildShareText,
    buildBulkShareText,
    buildShareUrl,
    openShareUrl,
    getGroupBluetUrl,
    SHARE_PLATFORMS,
} from './social-share';

// Mock ToastManager
jest.mock('../components/Toast', () => ({
    ToastManager: {
        getInstance: () => ({
            success: jest.fn(),
            error: jest.fn(),
            info: jest.fn(),
            warning: jest.fn(),
        }),
    },
}));

// Track ToastManager calls via a stable reference
const mockToastSuccess = jest.fn();
const mockToastError = jest.fn();
jest.mock('../components/Toast', () => ({
    ToastManager: {
        getInstance: () => ({
            success: mockToastSuccess,
            error: mockToastError,
            info: jest.fn(),
            warning: jest.fn(),
        }),
    },
}));

describe('social-share', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('SHARE_PLATFORMS', () => {
        it('exports platform definitions for supported share targets', () => {
            expect(SHARE_PLATFORMS).toHaveLength(8);
            const ids = SHARE_PLATFORMS.map(p => p.id);
            expect(ids).toContain('x');
            expect(ids).toContain('whatsapp');
            expect(ids).toContain('linkedin');
            expect(ids).toContain('telegram');
            expect(ids).toContain('reddit');
            expect(ids).toContain('facebook');
            expect(ids).toContain('email');
            expect(ids).toContain('clipboard');
        });

        it('each platform has id, name, and icon fields', () => {
            for (const platform of SHARE_PLATFORMS) {
                expect(platform).toHaveProperty('id');
                expect(platform).toHaveProperty('name');
                expect(platform).toHaveProperty('icon');
            }
        });
    });

    describe('buildShareText', () => {
        it('includes group name, tab count, and Bluet URL', () => {
            const result = buildShareText('My Tabs', 5, 'https://bluet.in/user/my-tabs');
            expect(result).toContain('Check out my "My Tabs" collection (5 tabs)');
            expect(result).toContain('-- https://bluet.in/user/my-tabs');
        });

        it('omits URL suffix when no bluetUrl provided', () => {
            const result = buildShareText('My Tabs', 5);
            expect(result).toBe('Check out my "My Tabs" collection (5 tabs)');
        });

        it('handles singular tab count', () => {
            const result = buildShareText('Solo', 1);
            expect(result).toBe('Check out my "Solo" collection (1 tabs)');
        });

        it('includes tab links when tabs are provided', () => {
            const tabs = [
                { title: 'Google', url: 'https://google.com' },
                { title: 'GitHub', url: 'https://github.com' },
            ];
            const result = buildShareText('Dev', 2, undefined, tabs);
            expect(result).toContain('• Google - https://google.com');
            expect(result).toContain('• GitHub - https://github.com');
        });

        it('includes both tab links and Bluet URL', () => {
            const tabs = [{ title: 'MDN', url: 'https://developer.mozilla.org' }];
            const result = buildShareText('Docs', 1, 'https://bluet.in/user/docs', tabs);
            expect(result).toContain('• MDN - https://developer.mozilla.org');
            expect(result).toContain('-- https://bluet.in/user/docs');
        });

        it('includes group notes when provided', () => {
            const result = buildShareText(
                'Research',
                2,
                undefined,
                [{ title: 'Paper', url: 'https://example.com/paper' }],
                'Follow up after the meeting',
            );
            expect(result).toContain('Note:\nFollow up after the meeting');
            expect(result).toContain('• Paper - https://example.com/paper');
        });
    });

    describe('buildBulkShareText', () => {
        it('combines multiple groups into one text', () => {
            const result = buildBulkShareText(
                [{ name: 'A', tabCount: 3 }, { name: 'B', tabCount: 5 }],
                ['https://bluet.in/a'],
            );
            expect(result).toContain('A (3 tabs)');
            expect(result).toContain('B (5 tabs)');
            expect(result).toContain('https://bluet.in/a');
        });

        it('works without Bluet URLs', () => {
            const result = buildBulkShareText(
                [{ name: 'X', tabCount: 2 }, { name: 'Y', tabCount: 4 }],
            );
            expect(result).toContain('X (2 tabs)');
            expect(result).toContain('Y (4 tabs)');
            expect(result).not.toContain('http');
        });

        it('includes tab links per group', () => {
            const result = buildBulkShareText([
                {
                    name: 'Dev',
                    tabCount: 2,
                    notes: 'Needs review',
                    tabs: [
                        { title: 'Google', url: 'https://google.com' },
                        { title: 'GitHub', url: 'https://github.com' },
                    ],
                },
                {
                    name: 'News',
                    tabCount: 1,
                    tabs: [{ title: 'HN', url: 'https://news.ycombinator.com' }],
                },
            ]);
            expect(result).toContain('Dev (2 tabs)');
            expect(result).toContain('Note:\nNeeds review');
            expect(result).toContain('• Google - https://google.com');
            expect(result).toContain('• GitHub - https://github.com');
            expect(result).toContain('News (1 tabs)');
            expect(result).toContain('• HN - https://news.ycombinator.com');
        });
    });

    describe('buildShareUrl', () => {
        it('returns correct X intent URL with text and url', () => {
            const result = buildShareUrl('x', 'hello world', 'https://bluet.in/x');
            expect(result).toContain('https://x.com/intent/tweet');
            expect(result).toContain('text=');
            expect(result).toContain('url=');
        });

        it('returns correct X URL without url param', () => {
            const result = buildShareUrl('x', 'hello world');
            expect(result).toContain('https://x.com/intent/tweet');
            expect(result).toContain('text=');
            expect(result).not.toContain('url=');
        });

        it('keeps the legacy twitter platform alias on the X endpoint', () => {
            const result = buildShareUrl('twitter', 'hello world');
            expect(result).toContain('https://x.com/intent/tweet');
        });

        it('returns correct WhatsApp URL with text param', () => {
            const result = buildShareUrl('whatsapp', 'hello');
            expect(result).toContain('https://api.whatsapp.com/send');
            expect(result).toContain('text=');
        });

        it('combines text and url in WhatsApp text param', () => {
            const result = buildShareUrl('whatsapp', 'hello', 'https://bluet.in/x');
            expect(result).toContain('https://api.whatsapp.com/send');
            // WhatsApp combines text + url in the text param
            const url = new URL(result);
            const text = url.searchParams.get('text');
            expect(text).toContain('hello');
            expect(text).toContain('https://bluet.in/x');
        });

        it('returns LinkedIn share-offsite URL with url param', () => {
            const result = buildShareUrl('linkedin', undefined, 'https://bluet.in/x');
            expect(result).toContain('https://www.linkedin.com/feed/');
            expect(result).toContain('shareActive=true');
            expect(result).toContain('mini=true');
            expect(result).toContain('text=');
        });

        it('returns LinkedIn compose URL without requiring a public URL', () => {
            const result = buildShareUrl('linkedin', 'text only');
            expect(result).toContain('https://www.linkedin.com/feed/');
            expect(result).toContain('shareActive=true');
            expect(result).toContain('text=');
        });

        it('returns Telegram app deep link with text and optional url', () => {
            const result = buildShareUrl('telegram', 'hello', 'https://bluet.in/x');
            expect(result).toContain('tg://msg_url');
            const url = new URL(result);
            expect(url.searchParams.get('text')).toBe('hello');
            expect(url.searchParams.get('url')).toBe('https://bluet.in/x');
        });

        it('removes the Telegram url from text to avoid duplicate first-link rendering', () => {
            const text = 'hello\n• Docs - https://example.com/docs\n• Other - https://example.com/other';
            const result = buildShareUrl('telegram', text);
            const url = new URL(result);

            expect(url.searchParams.get('url')).toBe('https://example.com/docs');
            expect(url.searchParams.get('text')).toBe('hello\n• Docs\n• Other - https://example.com/other');
        });

        it('shares Reddit as a text post instead of a link post', () => {
            const text = 'hello\n• Docs - https://example.com/docs';
            const reddit = buildShareUrl('reddit', text);
            expect(reddit).toContain('reddit.com/submit');
            expect(reddit).toContain('selftext=true');
            expect(reddit).toContain('text=');
            expect(reddit).not.toContain('url=');
        });

        it('opens Facebook share dialog with the first direct link and quote text', () => {
            const facebook = buildShareUrl('facebook', 'hello\n• Docs - https://example.com/docs', 'https://bluet.in/x');
            expect(facebook).toContain('https://www.facebook.com/sharer/sharer.php');
            const url = new URL(facebook);
            expect(url.searchParams.get('u')).toBe('https://example.com/docs');
            expect(url.searchParams.get('quote')).toContain('hello');
            expect(url.searchParams.get('quote')).toContain('https://bluet.in/x');
        });

        it('can create a Reddit text submission without any URL', () => {
            const result = buildShareUrl('reddit', 'hello');
            expect(result).toContain('reddit.com/submit');
            expect(result).toContain('text=');
            expect(result).not.toContain('url=');
        });

        it('returns a mailto URL for email sharing', () => {
            const result = buildShareUrl('email', 'hello', 'https://bluet.in/x');
            expect(result).toContain('mailto:?');
            expect(result).toContain('subject=');
            expect(result).toContain('body=');
        });
    });

    describe('openShareUrl', () => {
        it('opens X intent URL via chrome.tabs.create', async () => {
            (chrome.tabs.create as jest.Mock).mockResolvedValue({ id: 1 });
            await openShareUrl('x', 'hello', 'https://bluet.in/x');
            expect(chrome.tabs.create).toHaveBeenCalledWith(
                expect.objectContaining({ active: true }),
            );
            const call = (chrome.tabs.create as jest.Mock).mock.calls[0][0];
            expect(call.url).toContain('x.com/intent/tweet');
        });

        it('copies to clipboard and shows toast for clipboard platform', async () => {
            const writeTextMock = jest.fn().mockResolvedValue(undefined);
            Object.defineProperty(navigator, 'clipboard', {
                value: { writeText: writeTextMock },
                writable: true,
                configurable: true,
            });

            await openShareUrl('clipboard', 'hello text', 'https://bluet.in/x');
            expect(writeTextMock).toHaveBeenCalled();
            const clipboardArg = writeTextMock.mock.calls[0][0];
            expect(clipboardArg).toContain('hello text');
        });

        it('falls back to Telegram web share if the app protocol fails', async () => {
            (chrome.tabs.create as jest.Mock)
                .mockRejectedValueOnce(new Error('External protocol blocked'))
                .mockResolvedValueOnce({ id: 2 });

            await openShareUrl('telegram', 'hello', 'https://bluet.in/x');

            expect(chrome.tabs.create).toHaveBeenCalledTimes(2);
            expect((chrome.tabs.create as jest.Mock).mock.calls[0][0].url).toContain('tg://msg_url');
            expect((chrome.tabs.create as jest.Mock).mock.calls[1][0].url).toContain('https://t.me/share/url');
        });

        it('opens LinkedIn compose without requiring a Bluet URL', async () => {
            const writeTextMock = jest.fn().mockResolvedValue(undefined);
            Object.defineProperty(navigator, 'clipboard', {
                value: { writeText: writeTextMock },
                writable: true,
                configurable: true,
            });
            (chrome.tabs.create as jest.Mock).mockResolvedValue({ id: 3 });

            await openShareUrl('linkedin', 'text only');

            expect(chrome.tabs.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    active: true,
                    url: expect.stringContaining('https://www.linkedin.com/feed/'),
                }),
            );
            expect(writeTextMock).toHaveBeenCalledWith('text only');
        });

        it('copies full text and opens Facebook share dialog', async () => {
            const writeTextMock = jest.fn().mockResolvedValue(undefined);
            Object.defineProperty(navigator, 'clipboard', {
                value: { writeText: writeTextMock },
                writable: true,
                configurable: true,
            });
            (chrome.tabs.create as jest.Mock).mockResolvedValue({ id: 4 });
            const text = 'hello\n• Docs - https://example.com/docs';

            await openShareUrl('facebook', text, 'https://bluet.in/x');

            expect(writeTextMock).toHaveBeenCalledWith(`${text}\n\nhttps://bluet.in/x`);
            expect(chrome.tabs.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    active: true,
                    url: expect.stringContaining('https://www.facebook.com/sharer/sharer.php'),
                }),
            );
            const openedUrl = new URL((chrome.tabs.create as jest.Mock).mock.calls[0][0].url);
            expect(openedUrl.searchParams.get('u')).toBe('https://example.com/docs');
        });
    });

    describe('getGroupBluetUrl', () => {
        it('returns pageUrl-based full URL for matching group', () => {
            const refs = [
                { id: 'g1', type: 'tabgroup' as const, pageUrl: '/user/tabs', sharedAt: 0, lastSyncedAt: 0 },
                { id: 'g2', type: 'tabgroup' as const, pageUrl: '/user/other', sharedAt: 0, lastSyncedAt: 0 },
            ];
            const result = getGroupBluetUrl('g1', refs);
            expect(result).toBe('https://bluet.in/user/tabs');
        });

        it('returns undefined for non-matching group', () => {
            const refs = [
                { id: 'g1', type: 'tabgroup' as const, pageUrl: '/user/tabs', sharedAt: 0, lastSyncedAt: 0 },
            ];
            const result = getGroupBluetUrl('g99', refs);
            expect(result).toBeUndefined();
        });

        it('returns undefined for empty refs', () => {
            const result = getGroupBluetUrl('g1', []);
            expect(result).toBeUndefined();
        });
    });
});

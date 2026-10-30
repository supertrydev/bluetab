/** @jest-environment jsdom */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { TeamsSessionView } from '../TeamsSessionView'
import type { Participant, TeamsServiceState } from '@/types/teams'

const mockCloseSession = jest.fn()
const mockDisconnect = jest.fn()
const mockSetShareAllMode = jest.fn()
const mockSetSelectedTabs = jest.fn()
const mockPushGroup = jest.fn()
const mockSendChat = jest.fn()
const mockMarkChatRead = jest.fn()
const mockStorageGet = jest.fn()
let mockLanguage = 'en'

jest.mock('@/services/teams-service', () => ({
    TeamsService: {
        closeSession: (...args: unknown[]) => mockCloseSession(...args),
        disconnect: (...args: unknown[]) => mockDisconnect(...args),
        setShareAllMode: (...args: unknown[]) => mockSetShareAllMode(...args),
        setSelectedTabs: (...args: unknown[]) => mockSetSelectedTabs(...args),
        pushGroup: (...args: unknown[]) => mockPushGroup(...args),
        sendChat: (...args: unknown[]) => mockSendChat(...args),
        markChatRead: (...args: unknown[]) => mockMarkChatRead(...args),
        joinSession: jest.fn(),
    },
}))

jest.mock('@/utils/storage', () => ({
    Storage: {
        get: (...args: unknown[]) => mockStorageGet(...args),
        set: jest.fn(),
    },
}))

jest.mock('@/utils/auth-state', () => ({
    getAuthState: jest.fn().mockResolvedValue({
        user: { id: 'host-user', name: 'Alex Doe' },
    }),
}))

const translations: Record<string, string> = {
    'common.cancel': 'Cancel',
    'common.tabsCount': '{{count}} tabs',
    'sidepanel.teamsChat.label': 'Chat',
    'sidepanel.teamsChat.disclaimer': 'Messages are temporary and not saved.',
    'sidepanel.teamsChat.dismiss': 'Dismiss',
    'sidepanel.teamsChat.empty': 'No messages yet. Say hi!',
    'sidepanel.teamsChat.inputPlaceholder': 'Type a message...',
    'sidepanel.teamsChat.notConnected': 'Not connected',
    'sidepanel.teamsChat.send': 'Send',
    'sidepanel.teamsSession.copySessionCode': 'Copy session code',
    'sidepanel.teamsSession.live': 'Live',
    'sidepanel.teamsSession.connecting': 'Connecting...',
    'sidepanel.teamsSession.offline': 'Offline',
    'sidepanel.teamsSession.end': 'End',
    'sidepanel.teamsSession.leave': 'Leave',
    'sidepanel.teamsSession.participants': 'Participants',
    'sidepanel.teamsSession.participantsCount': 'Participants ({{count}})',
    'sidepanel.teamsSession.waitingForOthers': 'Waiting for others to join...',
    'sidepanel.teamsSession.yourSharing': 'Your sharing',
    'sidepanel.teamsSession.off': 'off',
    'sidepanel.teamsSession.shareAllTabs': 'Share all tabs',
    'sidepanel.teamsSession.selectIndividualTabs': 'Select individual tabs',
    'sidepanel.teamsSession.selectAll': 'Select All',
    'sidepanel.teamsSession.deselectAll': 'Deselect All',
    'sidepanel.teamsSession.sharedGroups': 'Shared Groups',
    'sidepanel.teamsSession.noGroupsSharedYet': 'No groups shared yet',
    'sidepanel.teamsSession.shareGroupTitle': 'Share a Group',
    'sidepanel.teamsSession.noSavedGroups': 'No saved groups yet.',
    'sidepanel.teamsSession.sharedByYou': 'Shared by you',
    'sidepanel.teamsSession.sharedByOther': 'Shared by {{name}}',
    'sidepanel.teamsSession.saved': 'Saved',
    'sidepanel.teamsSession.saveToMyBluetab': 'Save to my Bluetab',
}

jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        i18n: {
            language: mockLanguage,
            resolvedLanguage: mockLanguage,
        },
        t: (key: string, values?: Record<string, string | number>) => {
            let value = translations[key] ?? key
            for (const [name, replacement] of Object.entries(values ?? {})) {
                value = value.replace(`{{${name}}}`, String(replacement))
            }
            return value
        },
    }),
}))

const host: Participant = {
    userId: 'host-user',
    displayName: 'Alex Doe',
    role: 'host',
    status: 'online',
    tabs: [],
    lastSeen: 1,
}

const guest: Participant = {
    userId: 'guest-user',
    displayName: 'Sam Lee',
    role: 'participant',
    status: 'online',
    tabs: [],
    lastSeen: 1,
}

function state(overrides: Partial<TeamsServiceState> = {}): TeamsServiceState {
    return {
        connectionState: 'connected',
        session: {
            code: 'ABC123',
            role: 'host',
            hostId: host.userId,
            startedAt: 1,
            expiresAt: 2,
        },
        participants: [host],
        chatMessages: [],
        unreadCount: 0,
        groupShares: [],
        ...overrides,
    }
}

function getByTestId(container: HTMLElement, testId: string): HTMLElement {
    const element = container.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
    if (!element) throw new Error(`Missing element: ${testId}`)
    return element
}

async function flush(): Promise<void> {
    await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
    })
}

describe('TeamsSessionView compact sidepanel behavior', () => {
    let container: HTMLDivElement
    let root: Root

    beforeAll(() => {
        ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText: jest.fn().mockResolvedValue(undefined) },
        })
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
            configurable: true,
            value: jest.fn(),
        })
    })

    beforeEach(async () => {
        jest.clearAllMocks()
        mockLanguage = 'en'
        mockStorageGet.mockImplementation(async (key: string) => (
            key === 'groups'
                ? [{
                    id: 'saved-group',
                    name: 'Research',
                    tabs: [{ id: 'tab-1', title: 'Docs', url: 'https://example.com', timestamp: 1, groupId: 'saved-group' }],
                    created: 1,
                    modified: 1,
                }]
                : undefined
        ))
        ;(chrome.tabs.query as jest.Mock).mockResolvedValue([
            { id: 11, title: 'First tab', url: 'https://example.com/first' },
            { id: 12, title: 'Second tab', url: 'https://example.com/second' },
        ])
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
    })

    afterEach(async () => {
        await act(async () => root.unmount())
        container.remove()
    })

    async function render(viewState: TeamsServiceState): Promise<void> {
        await act(async () => root.render(<TeamsSessionView state={viewState} />))
        await flush()
    }

    it('shows one participant as a compact named summary and preserves accessible session-code copy', async () => {
        await render(state())

        expect(getByTestId(container, 'teams-session-header')).not.toBeNull()
        const codeButton = getByTestId(container, 'session-code-button')
        expect(codeButton.tagName).toBe('BUTTON')
        expect(codeButton.getAttribute('title')).toContain('ABC123')
        expect(codeButton.getAttribute('aria-label')).toContain('ABC123')
        expect(getByTestId(container, 'participants-summary').textContent).toContain('Alex Doe')

        await act(async () => codeButton.click())
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('ABC123')
    })

    it('keeps individual selection collapsed while sharing all is off and hides it after sharing all is enabled', async () => {
        await render(state())

        const disclosure = getByTestId(container, 'select-individual-tabs-trigger')
        expect(disclosure.getAttribute('aria-expanded')).toBe('false')
        expect(container.textContent).not.toContain('First tab')

        await act(async () => disclosure.click())
        expect(container.textContent).toContain('First tab')

        const shareAll = getByTestId(container, 'share-all-tabs-switch')
        await act(async () => shareAll.click())

        expect(mockSetShareAllMode).toHaveBeenCalledWith(true)
        expect(container.querySelector('[data-testid="select-individual-tabs-trigger"]')).toBeNull()
    })

    it('keeps a URL-only tab label left-to-right inside the localized selector', async () => {
        ;(chrome.tabs.query as jest.Mock).mockResolvedValue([
            { id: 13, title: '', url: 'https://example.com/arabic-safe' },
        ])
        await render(state())

        await act(async () => getByTestId(container, 'select-individual-tabs-trigger').click())

        const url = Array.from(container.querySelectorAll('bdi'))
            .find((element) => element.textContent === 'https://example.com/arabic-safe')
        expect(url?.getAttribute('dir')).toBe('ltr')
    })

    it('opens the existing participant drawer for multiple participants without changing participant state', async () => {
        await render(state({ participants: [host, guest] }))

        const summary = getByTestId(container, 'participants-summary')
        expect(summary.textContent).toContain('Participants (2)')
        expect(summary.getAttribute('aria-expanded')).toBe('false')
        expect(getByTestId(container, 'participants-drawer-arrow').getAttribute('data-direction')).toBe('right')

        await act(async () => summary.click())

        expect(summary.getAttribute('aria-expanded')).toBe('true')
        const drawer = getByTestId(container, 'participants-drawer')
        expect(drawer.getAttribute('data-side')).toBe('right')
        expect(drawer.textContent).toContain('Alex Doe')
        expect(drawer.textContent).toContain('Sam Lee')
    })

    it('places the participant drawer and directional arrow on the Arabic start side while isolating names and codes', async () => {
        mockLanguage = 'ar'
        const arabicHost = { ...host, displayName: 'ليلى أحمد' }
        await render(state({ participants: [arabicHost] }))

        const codeButton = getByTestId(container, 'session-code-button')
        expect(codeButton.getAttribute('title')).toContain('\u2066ABC123\u2069')
        expect(codeButton.getAttribute('aria-label')).toContain('\u2066ABC123\u2069')
        expect(getByTestId(container, 'session-code-text').getAttribute('dir')).toBe('ltr')
        expect(getByTestId(container, 'participants-drawer-arrow').getAttribute('data-direction')).toBe('left')

        const summaryName = Array.from(getByTestId(container, 'participants-summary').querySelectorAll('bdi'))
            .find((element) => element.textContent === 'ليلى أحمد')
        expect(summaryName?.getAttribute('dir')).toBe('auto')

        await act(async () => getByTestId(container, 'participants-summary').click())

        const drawer = getByTestId(container, 'participants-drawer')
        expect(drawer.getAttribute('data-side')).toBe('left')
        expect(drawer.className).toContain('left-0')
        expect(drawer.className).toContain('slide-in-from-left')
        const drawerName = Array.from(drawer.querySelectorAll('bdi'))
            .find((element) => element.textContent === 'ليلى أحمد')
        expect(drawerName?.getAttribute('dir')).toBe('auto')
    })

    it('renders a compact empty group state and reuses the existing group picker and push callback', async () => {
        await render(state())

        expect(getByTestId(container, 'shared-groups-empty').textContent).toContain('No groups shared yet')
        const shareGroup = getByTestId(container, 'share-group-button')
        await act(async () => shareGroup.click())
        expect(container.textContent).toContain('Research')

        const savedGroup = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Research'))
        if (!savedGroup) throw new Error('Saved group option not found')
        await act(async () => savedGroup.click())

        expect(mockPushGroup).toHaveBeenCalledTimes(1)
        expect(mockPushGroup).toHaveBeenCalledWith({
            id: 'saved-group',
            name: 'Research',
            tabs: [{ title: 'Docs', url: 'https://example.com', favicon: undefined }],
        })
    })

    it('keeps existing shared-group rendering and host End callback', async () => {
        await render(state({
            groupShares: [{
                senderId: host.userId,
                senderName: host.displayName,
                group: { id: 'shared-1', name: 'Launch', tabs: [{ title: 'Board', url: 'https://example.com/board' }] },
                receivedAt: 10,
            }],
        }))

        expect(container.textContent).toContain('Launch')
        expect(container.querySelector('[data-testid="shared-groups-empty"]')).toBeNull()

        await act(async () => getByTestId(container, 'end-session-button').click())
        expect(mockCloseSession).toHaveBeenCalledTimes(1)
        expect(mockDisconnect).not.toHaveBeenCalled()
    })
})

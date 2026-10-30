/** @jest-environment jsdom */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SearchBar } from '../SearchBar'
import { TeamsCodeDisplay } from '../TeamsCodeDisplay'
import { TeamsPreSession } from '../TeamsPreSession'

const mockCloseSession = jest.fn()
let mockLanguage = 'en'

jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, values?: { code?: string }) => {
            if (key === 'sidepanel.teamsCode.shareMessage') {
                return mockLanguage === 'ar'
                    ? `انضم إلى جلسة Bluetab الخاصة بي: ${values?.code ?? ''}`
                    : mockLanguage === 'tr'
                        ? `Bluetab oturumuma kat\u0131l: ${values?.code ?? ''}`
                        : `Join my Bluetab session: ${values?.code ?? ''}`
            }
            return key
        },
    }),
}))

jest.mock('@/components/Toast', () => ({
    ToastManager: {
        getInstance: () => ({
            success: jest.fn(),
            error: jest.fn(),
            info: jest.fn(),
        }),
    },
}))

jest.mock('@/services/teams-service', () => ({
    TeamsService: {
        closeSession: (...args: unknown[]) => mockCloseSession(...args),
        createSession: jest.fn().mockResolvedValue({ success: true }),
        joinSession: jest.fn().mockResolvedValue({ success: true }),
    },
}))

jest.mock('@/utils/feature-gate', () => ({
    getFeatureGateUI: jest.fn().mockResolvedValue({ isAllowed: true }),
}))

describe('Teams sidepanel direction-sensitive values', () => {
    let container: HTMLDivElement
    let root: Root

    beforeAll(() => {
        ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText: jest.fn().mockResolvedValue(undefined) },
        })
    })

    beforeEach(() => {
        mockLanguage = 'en'
        jest.clearAllMocks()
        jest.useFakeTimers()
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
    })

    afterEach(async () => {
        await act(async () => root.unmount())
        container.remove()
        jest.useRealTimers()
    })

    it('keeps the share code and elapsed duration left-to-right', async () => {
        await act(async () => {
            root.render(<TeamsCodeDisplay code="ABC123" participantCount={1} sessionStartedAt={Date.now()} />)
        })

        const code = Array.from(container.querySelectorAll('p')).find((element) => element.textContent === 'ABC123')
        const duration = Array.from(container.querySelectorAll('span')).find((element) => element.textContent === '00:00')

        expect(code?.getAttribute('dir')).toBe('ltr')
        expect(duration?.getAttribute('dir')).toBe('ltr')
    })

    it('uses the localized WhatsApp share template while preserving the opaque code', async () => {
        mockLanguage = 'ar'
        await act(async () => {
            root.render(<TeamsCodeDisplay code="ABC123" participantCount={1} sessionStartedAt={Date.now()} />)
        })

        const shareButton = Array.from(container.querySelectorAll('button'))
            .find((button) => button.textContent === 'sidepanel.teamsCode.share')
        if (!shareButton) throw new Error('Share button not found')
        await act(async () => shareButton.click())

        const [{ url }] = (chrome.tabs.create as jest.Mock).mock.calls[0] as [{ url: string }]
        expect(new URL(url).searchParams.get('text')).toBe('انضم إلى جلسة Bluetab الخاصة بي: \u2066ABC123\u2069')
    })

    it.each([
        ['en', 'Join my Bluetab session: \u2066ABC123\u2069'],
        ['tr', 'Bluetab oturumuma kat\u0131l: \u2066ABC123\u2069'],
    ])('renders the reviewed %s WhatsApp share copy', async (language, expectedMessage) => {
        mockLanguage = language
        await act(async () => {
            root.render(<TeamsCodeDisplay code="ABC123" participantCount={1} sessionStartedAt={Date.now()} />)
        })

        const shareButton = Array.from(container.querySelectorAll('button'))
            .find((button) => button.textContent === 'sidepanel.teamsCode.share')
        if (!shareButton) throw new Error('Share button not found')
        await act(async () => shareButton.click())

        const [{ url }] = (chrome.tabs.create as jest.Mock).mock.calls[0] as [{ url: string }]
        expect(new URL(url).searchParams.get('text')).toBe(expectedMessage)
    })

    it('keeps the join code input left-to-right', async () => {
        await act(async () => root.render(<TeamsPreSession />))

        expect(container.querySelector('input[maxlength="6"]')?.getAttribute('dir')).toBe('ltr')
    })

    it('uses logical search affordance spacing and auto direction for user input', async () => {
        await act(async () => {
            root.render(<SearchBar value="بحث" onChange={jest.fn()} />)
        })

        const input = container.querySelector('input')
        const searchIcon = container.querySelector('svg')
        const clearButton = container.querySelector('button')

        expect(input?.getAttribute('dir')).toBe('auto')
        expect(input?.className).toContain('ps-8')
        expect(input?.className).toContain('pe-8')
        expect(searchIcon?.getAttribute('class')).toContain('start-2.5')
        expect(clearButton?.className).toContain('end-2')
    })
})

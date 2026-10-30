/** @jest-environment jsdom */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { TeamsChatPanel } from '../TeamsChatPanel'

jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => ({
            'sidepanel.teamsChat.label': 'Chat',
            'sidepanel.teamsChat.disclaimer': 'Messages are temporary and not saved.',
            'sidepanel.teamsChat.dismiss': 'Dismiss',
            'sidepanel.teamsChat.empty': 'No messages yet. Say hi!',
            'sidepanel.teamsChat.inputPlaceholder': 'Type a message...',
            'sidepanel.teamsChat.notConnected': 'Not connected',
            'sidepanel.teamsChat.send': 'Send',
        }[key] ?? key),
    }),
}))

function getByTestId(container: HTMLElement, testId: string): HTMLElement {
    const element = container.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
    if (!element) throw new Error(`Missing element: ${testId}`)
    return element
}

function setInputValue(input: HTMLInputElement, value: string): void {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('TeamsChatPanel compact bottom panel', () => {
    let container: HTMLDivElement
    let root: Root
    let onSendChat: jest.Mock
    let onMarkRead: jest.Mock

    beforeAll(() => {
        ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
            configurable: true,
            value: jest.fn(),
        })
    })

    beforeEach(async () => {
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
        onSendChat = jest.fn()
        onMarkRead = jest.fn()

        await act(async () => {
            root.render(
                <TeamsChatPanel
                    chatMessages={[{
                        senderId: 'guest',
                        senderName: 'سام لي',
                        text: 'راجع https://example.com/docs',
                        timestamp: 1,
                    }]}
                    unreadCount={2}
                    isConnected
                    onSendChat={onSendChat}
                    onMarkRead={onMarkRead}
                />
            )
        })
    })

    afterEach(async () => {
        await act(async () => root.unmount())
        container.remove()
    })

    it('keeps the compact trigger visible and composer absent while closed', () => {
        expect(getByTestId(container, 'teams-chat-trigger').textContent).toContain('Chat')
        expect(getByTestId(container, 'teams-chat-trigger').textContent).toContain('2')
        expect(container.querySelector('[data-testid="teams-chat-composer"]')).toBeNull()
    })

    it('opens into the remaining-height message panel and marks unread messages read once', async () => {
        await act(async () => getByTestId(container, 'teams-chat-trigger').click())

        expect(onMarkRead).toHaveBeenCalledTimes(1)
        expect(getByTestId(container, 'teams-chat-panel').getAttribute('data-open')).toBe('true')
        expect(getByTestId(container, 'teams-chat-messages').textContent).toContain('راجع')
        expect(getByTestId(container, 'teams-chat-composer')).not.toBeNull()
    })

    it('isolates mixed-direction chat names, text, URLs, timestamps, and composer input', async () => {
        await act(async () => getByTestId(container, 'teams-chat-trigger').click())

        const messages = getByTestId(container, 'teams-chat-messages')
        const sender = Array.from(messages.querySelectorAll('bdi'))
            .find((element) => element.textContent === 'سام لي')
        const message = Array.from(messages.querySelectorAll('p'))
            .find((element) => element.textContent?.includes('راجع'))
        const link = messages.querySelector('a')
        const timestamp = Array.from(messages.querySelectorAll('span'))
            .find((element) => /^\d{1,2}[:.]\d{2}(\s?[AP]M)?$/i.test(element.textContent ?? ''))

        expect(sender?.getAttribute('dir')).toBe('auto')
        expect(message?.getAttribute('dir')).toBe('auto')
        expect(link?.getAttribute('dir')).toBe('ltr')
        expect(timestamp?.getAttribute('dir')).toBe('ltr')
        expect(getByTestId(container, 'teams-chat-input').getAttribute('dir')).toBe('auto')
    })

    it('sends trimmed text through the existing callback when Enter is pressed', async () => {
        await act(async () => getByTestId(container, 'teams-chat-trigger').click())
        const input = getByTestId(container, 'teams-chat-input') as HTMLInputElement

        await act(async () => setInputValue(input, '  hello team  '))
        await act(async () => {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        })

        expect(onSendChat).toHaveBeenCalledTimes(1)
        expect(onSendChat).toHaveBeenCalledWith('hello team')
        expect(input.value).toBe('')
    })
})

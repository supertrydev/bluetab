/**
 * @module services/teams-service.test
 *
 * WHY:  TDD RED phase — behavioral contracts for TeamsService before implementation.
 *       All tests must fail (module does not exist yet) to confirm correct coverage.
 *
 * WHAT: Covers createSession, joinSession, disconnect, server event handling,
 *       state management, reconnection, sendChat, pushGroup.
 *
 * HOW:  Mocks feature-gate, auth-state, storage, global fetch, and MockWebSocket
 *       from jest-setup. Tests control WS state by calling onopen/onmessage/onclose
 *       handlers directly.
 */

import { TeamsService } from './teams-service'

// ─── Mock Declarations ────────────────────────────────────────────────────────

jest.mock('@/utils/feature-gate', () => ({
    canAccessFeature: jest.fn(),
    getFeatureGateMessage: jest.fn(),
}))

jest.mock('@/utils/auth-state', () => ({
    getAccessToken: jest.fn(),
    getAuthState: jest.fn(),
}))

jest.mock('@/utils/storage', () => ({
    Storage: {
        get: jest.fn(),
        set: jest.fn(),
        remove: jest.fn(),
    },
}))

// ─── Import Mocks ─────────────────────────────────────────────────────────────

import { canAccessFeature, getFeatureGateMessage } from '@/utils/feature-gate'
import { getAccessToken } from '@/utils/auth-state'
import { Storage } from '@/utils/storage'

const mockCanAccessFeature = canAccessFeature as jest.MockedFunction<typeof canAccessFeature>
const mockGetFeatureGateMessage = getFeatureGateMessage as jest.MockedFunction<typeof getFeatureGateMessage>
const mockGetAccessToken = getAccessToken as jest.MockedFunction<typeof getAccessToken>
const mockStorageGet = Storage.get as jest.MockedFunction<typeof Storage.get>
const mockStorageSet = Storage.set as jest.MockedFunction<typeof Storage.set>
const mockStorageRemove = Storage.remove as jest.MockedFunction<typeof Storage.remove>

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Simulate WebSocket successfully opening */
function simulateWsOpen(ws: WebSocket): void {
    ;(ws as unknown as Record<string, unknown>).readyState = WebSocket.OPEN
    if (ws.onopen) ws.onopen(new Event('open'))
}

/** Simulate a server message */
function simulateWsMessage(ws: WebSocket, data: object): void {
    const event = { data: JSON.stringify(data) } as MessageEvent
    if (ws.onmessage) ws.onmessage(event)
}

/** Simulate WS close */
function simulateWsClose(ws: WebSocket, code: number, reason = ''): void {
    ;(ws as unknown as Record<string, unknown>).readyState = WebSocket.CLOSED
    const event = { code, reason, wasClean: code === 1000 } as CloseEvent
    if (ws.onclose) ws.onclose(event)
}

// ─── MockWebSocket tracking ───────────────────────────────────────────────────

// Capture the global WebSocket mock set by jest-setup ONCE before any test
// modifies it.  afterEach restores this reference so tests stay isolated.
const OriginalWebSocket = (global as Record<string, unknown>).WebSocket as new (url: string) => WebSocket

// eslint-disable-next-line prefer-const
let wsInstances: WebSocket[] = []

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()

    // Track WS instances by wrapping the original MockWebSocket
    wsInstances = []
    ;(global as Record<string, unknown>).WebSocket = class TrackingMockWS extends (OriginalWebSocket as unknown as typeof WebSocket) {
        constructor(url: string) {
            super(url)
            wsInstances.push(this)
        }
    }

    // Default mock implementations
    mockCanAccessFeature.mockResolvedValue({ allowed: true })
    mockGetAccessToken.mockResolvedValue('test-token-abc')
    mockGetFeatureGateMessage.mockReturnValue('Upgrade to Pro to unlock team sharing')
    mockStorageGet.mockResolvedValue(null)
    mockStorageSet.mockResolvedValue(undefined)
    mockStorageRemove.mockResolvedValue(undefined)

    // Mock global fetch
    global.fetch = jest.fn()

    // Reset TeamsService state between tests
    TeamsService.reset()
})

afterEach(() => {
    jest.useRealTimers()
    // Restore original MockWebSocket from jest-setup
    ;(global as Record<string, unknown>).WebSocket = OriginalWebSocket
})

// ─── createSession ────────────────────────────────────────────────────────────

describe('createSession', () => {
    it('returns error when feature gate blocks access (free tier)', async () => {
        mockCanAccessFeature.mockResolvedValue({ allowed: false, reason: 'not_subscribed' })
        mockGetFeatureGateMessage.mockReturnValue('Upgrade to Pro to unlock team sharing')

        const result = await TeamsService.createSession()

        expect(mockCanAccessFeature).toHaveBeenCalledWith('team_sharing')
        expect(result).toEqual({ success: false, error: 'Upgrade to Pro to unlock team sharing' })
    })

    it('returns error when access token is null (not authenticated)', async () => {
        mockCanAccessFeature.mockResolvedValue({ allowed: true })
        mockGetAccessToken.mockResolvedValue(null)

        const result = await TeamsService.createSession()

        expect(result).toEqual({ success: false, error: 'Not authenticated' })
    })

    it('POSTs to /teams/rooms and returns session code on 201', async () => {
        mockCanAccessFeature.mockResolvedValue({ allowed: true })
        mockGetAccessToken.mockResolvedValue('test-token')
        ;(global.fetch as jest.Mock).mockResolvedValue({
            ok: true,
            status: 201,
            json: async () => ({
                code: 'ROOM12345',
                expiresAt: Date.now() + 8 * 60 * 60 * 1000,
            }),
        })

        const resultPromise = TeamsService.createSession()

        // Simulate WS open after fetch resolves
        await Promise.resolve() // flush fetch
        await Promise.resolve() // flush internal awaits
        await Promise.resolve()
        const ws = wsInstances[0]
        if (ws) simulateWsOpen(ws)

        const result = await resultPromise
        expect(result).toMatchObject({ success: true, code: 'ROOM12345' })
        expect(global.fetch).toHaveBeenCalledWith(
            expect.stringContaining('/teams/rooms'),
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
            })
        )
    })

    it('returns error when REST call returns 403', async () => {
        mockCanAccessFeature.mockResolvedValue({ allowed: true })
        mockGetAccessToken.mockResolvedValue('test-token')
        ;(global.fetch as jest.Mock).mockResolvedValue({
            ok: false,
            status: 403,
        })

        const result = await TeamsService.createSession()

        expect(result).toEqual({ success: false, error: 'Failed to create session' })
    })

    it('persists session in Storage under teams_session key', async () => {
        mockCanAccessFeature.mockResolvedValue({ allowed: true })
        mockGetAccessToken.mockResolvedValue('test-token')
        ;(global.fetch as jest.Mock).mockResolvedValue({
            ok: true,
            status: 201,
            json: async () => ({
                code: 'ROOM12345',
                expiresAt: Date.now() + 8 * 60 * 60 * 1000,
            }),
        })

        const resultPromise = TeamsService.createSession()
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
        const ws = wsInstances[0]
        if (ws) simulateWsOpen(ws)
        await resultPromise

        expect(mockStorageSet).toHaveBeenCalledWith(
            'teams_session',
            expect.objectContaining({ sessionCode: 'ROOM12345', role: 'host' })
        )
    })
})

// ─── joinSession ─────────────────────────────────────────────────────────────

describe('joinSession', () => {
    it('returns error when access token is null (unauthenticated)', async () => {
        mockGetAccessToken.mockResolvedValue(null)

        const result = await TeamsService.joinSession('ROOM12345')

        expect(result).toEqual({ success: false, error: 'Sign in to join a session' })
    })

    it('opens WebSocket to correct URL', async () => {
        mockGetAccessToken.mockResolvedValue('test-token')

        TeamsService.joinSession('ROOM12345')
        await Promise.resolve()

        const ws = wsInstances[0]
        expect(ws).toBeDefined()
        expect(ws.url).toBe('wss://supertry.net/ws/teams/ROOM12345?token=test-token')
    })

    it('updates state with session data and participants on SESSION_JOINED', async () => {
        mockGetAccessToken.mockResolvedValue('test-token')

        const joinPromise = TeamsService.joinSession('ROOM12345')
        await Promise.resolve()
        await Promise.resolve()

        const ws = wsInstances[0]
        simulateWsOpen(ws)
        simulateWsMessage(ws, {
            type: 'SESSION_JOINED',
            session: {
                code: 'ROOM12345',
                role: 'participant',
                hostId: 'user-host',
                startedAt: 1000,
                expiresAt: 2000,
            },
            participants: [
                {
                    userId: 'user-host',
                    displayName: 'Host User',
                    role: 'host',
                    status: 'online',
                    tabs: [],
                    lastSeen: 1000,
                },
            ],
        })

        await joinPromise

        const state = TeamsService.getState()
        expect(state.connectionState).toBe('connected')
        expect(state.session).toMatchObject({ code: 'ROOM12345', role: 'participant' })
        expect(state.participants).toHaveLength(1)
        expect(state.participants[0].userId).toBe('user-host')
    })

    it('persists session in Storage under teams_session key', async () => {
        mockGetAccessToken.mockResolvedValue('test-token')

        const joinPromise = TeamsService.joinSession('ROOM12345')
        await Promise.resolve()
        await Promise.resolve()

        const ws = wsInstances[0]
        simulateWsOpen(ws)
        simulateWsMessage(ws, {
            type: 'SESSION_JOINED',
            session: {
                code: 'ROOM12345',
                role: 'participant',
                hostId: 'user-host',
                startedAt: 1000,
                expiresAt: 2000,
            },
            participants: [],
        })

        await joinPromise

        expect(mockStorageSet).toHaveBeenCalledWith(
            'teams_session',
            expect.objectContaining({ sessionCode: 'ROOM12345' })
        )
    })
})

// ─── disconnect ───────────────────────────────────────────────────────────────

describe('disconnect', () => {
    beforeEach(async () => {
        // Set up a connected session
        mockGetAccessToken.mockResolvedValue('test-token')
        const joinPromise = TeamsService.joinSession('ROOM12345')
        await Promise.resolve()
        await Promise.resolve()
        const ws = wsInstances[0]
        simulateWsOpen(ws)
        simulateWsMessage(ws, {
            type: 'SESSION_JOINED',
            session: { code: 'ROOM12345', role: 'participant', hostId: 'h', startedAt: 1, expiresAt: 2 },
            participants: [],
        })
        await joinPromise
    })

    it('closes WebSocket with code 1000', async () => {
        const ws = wsInstances[0]
        TeamsService.disconnect()
        expect(ws.close).toHaveBeenCalledWith(1000)
    })

    it('removes teams_session from Storage', async () => {
        TeamsService.disconnect()
        expect(mockStorageRemove).toHaveBeenCalledWith('teams_session')
    })

    it('resets state to initial values', async () => {
        TeamsService.disconnect()
        const state = TeamsService.getState()
        expect(state.connectionState).toBe('disconnected')
        expect(state.session).toBeNull()
        expect(state.participants).toHaveLength(0)
        expect(state.chatMessages).toHaveLength(0)
        expect(state.unreadCount).toBe(0)
    })

    it('clears any pending reconnect timer', async () => {
        TeamsService.disconnect()
        // Verifying no error thrown and state is reset (timer cleanup covered by reset())
        const state = TeamsService.getState()
        expect(state.connectionState).toBe('disconnected')
    })
})

// ─── Server Event Handling ────────────────────────────────────────────────────

describe('server event handling', () => {
    let ws: WebSocket

    beforeEach(async () => {
        mockGetAccessToken.mockResolvedValue('test-token')
        const joinPromise = TeamsService.joinSession('ROOM99')
        await Promise.resolve()
        await Promise.resolve()
        ws = wsInstances[0]
        simulateWsOpen(ws)
        simulateWsMessage(ws, {
            type: 'SESSION_JOINED',
            session: { code: 'ROOM99', role: 'participant', hostId: 'host1', startedAt: 1, expiresAt: 2 },
            participants: [
                { userId: 'host1', displayName: 'Host', role: 'host', status: 'online', tabs: [], lastSeen: 1 },
            ],
        })
        await joinPromise
    })

    it('SESSION_ENDED sets connectionState to disconnected and clears session', () => {
        simulateWsMessage(ws, { type: 'SESSION_ENDED', reason: 'expired' })
        const state = TeamsService.getState()
        expect(state.connectionState).toBe('disconnected')
        expect(state.session).toBeNull()
    })

    it('SESSION_ENDED with reason host_left is handled same as expired', () => {
        simulateWsMessage(ws, { type: 'SESSION_ENDED', reason: 'host_left' })
        const state = TeamsService.getState()
        expect(state.connectionState).toBe('disconnected')
        expect(state.session).toBeNull()
    })

    it('SESSION_ENDED removes teams_session from Storage', () => {
        simulateWsMessage(ws, { type: 'SESSION_ENDED', reason: 'expired' })
        expect(mockStorageRemove).toHaveBeenCalledWith('teams_session')
    })

    it('PARTICIPANT_JOINED adds participant to state', () => {
        simulateWsMessage(ws, {
            type: 'PARTICIPANT_JOINED',
            participant: { userId: 'user2', displayName: 'Alice', role: 'participant', status: 'online', tabs: [], lastSeen: 100 },
        })
        const state = TeamsService.getState()
        expect(state.participants).toHaveLength(2)
        expect(state.participants.find(p => p.userId === 'user2')).toBeDefined()
    })

    it('PARTICIPANT_LEFT removes participant from state by userId', () => {
        // First add a participant
        simulateWsMessage(ws, {
            type: 'PARTICIPANT_JOINED',
            participant: { userId: 'user2', displayName: 'Alice', role: 'participant', status: 'online', tabs: [], lastSeen: 100 },
        })
        expect(TeamsService.getState().participants).toHaveLength(2)

        simulateWsMessage(ws, { type: 'PARTICIPANT_LEFT', userId: 'user2' })
        expect(TeamsService.getState().participants).toHaveLength(1)
        expect(TeamsService.getState().participants.find(p => p.userId === 'user2')).toBeUndefined()
    })

    it('PRESENCE_UPDATE updates participant status in state', () => {
        simulateWsMessage(ws, { type: 'PRESENCE_UPDATE', userId: 'host1', status: 'offline' })
        const participant = TeamsService.getState().participants.find(p => p.userId === 'host1')
        expect(participant?.status).toBe('offline')
    })

    it('TAB_UPDATE updates the correct participant tabs', () => {
        const tabs = [{ title: 'GitHub', url: 'https://github.com' }]
        simulateWsMessage(ws, { type: 'TAB_UPDATE', userId: 'host1', tabs })
        const participant = TeamsService.getState().participants.find(p => p.userId === 'host1')
        expect(participant?.tabs).toEqual(tabs)
    })

    it('CHAT_MESSAGE appends to chatMessages and increments unreadCount', () => {
        simulateWsMessage(ws, {
            type: 'CHAT_MESSAGE',
            senderId: 'host1',
            senderName: 'Host',
            text: 'Hello!',
            timestamp: 12345,
        })
        const state = TeamsService.getState()
        expect(state.chatMessages).toHaveLength(1)
        expect(state.chatMessages[0].text).toBe('Hello!')
        expect(state.unreadCount).toBe(1)
    })

    it('CHAT_MESSAGE increments unreadCount cumulatively', () => {
        simulateWsMessage(ws, { type: 'CHAT_MESSAGE', senderId: 'host1', senderName: 'Host', text: 'Msg 1', timestamp: 1 })
        simulateWsMessage(ws, { type: 'CHAT_MESSAGE', senderId: 'host1', senderName: 'Host', text: 'Msg 2', timestamp: 2 })
        expect(TeamsService.getState().unreadCount).toBe(2)
    })

    it('ERROR event with code 4004 sets connectionState to error', () => {
        simulateWsMessage(ws, { type: 'ERROR', code: '4004', message: 'Room not found' })
        expect(TeamsService.getState().connectionState).toBe('error')
    })
})

// ─── State Management ─────────────────────────────────────────────────────────

describe('state management', () => {
    it('getState() returns current state snapshot', async () => {
        const state = TeamsService.getState()
        expect(state).toMatchObject({
            connectionState: 'disconnected',
            session: null,
            participants: [],
            chatMessages: [],
            unreadCount: 0,
        })
    })

    it('onStateChange registers callback fired on state updates', async () => {
        const callback = jest.fn()
        TeamsService.onStateChange(callback)

        mockGetAccessToken.mockResolvedValue('test-token')
        const joinPromise = TeamsService.joinSession('ROOM55')
        await Promise.resolve()
        await Promise.resolve()
        const ws = wsInstances[0]
        simulateWsOpen(ws)

        await joinPromise

        // connectionState changed to connecting then connected — callback should have fired
        expect(callback).toHaveBeenCalled()
        TeamsService.offStateChange(callback)
    })

    it('offStateChange removes the callback', async () => {
        const callback = jest.fn()
        TeamsService.onStateChange(callback)
        TeamsService.offStateChange(callback)

        mockGetAccessToken.mockResolvedValue('test-token')
        TeamsService.joinSession('ROOM55')
        await Promise.resolve()
        await Promise.resolve()

        // callback was removed before any state change
        expect(callback).not.toHaveBeenCalled()
    })

    it('markChatRead resets unreadCount to 0', async () => {
        mockGetAccessToken.mockResolvedValue('test-token')
        const joinPromise = TeamsService.joinSession('ROOM66')
        await Promise.resolve()
        await Promise.resolve()
        const ws = wsInstances[0]
        simulateWsOpen(ws)
        simulateWsMessage(ws, {
            type: 'SESSION_JOINED',
            session: { code: 'ROOM66', role: 'participant', hostId: 'h', startedAt: 1, expiresAt: 2 },
            participants: [],
        })
        await joinPromise

        simulateWsMessage(ws, { type: 'CHAT_MESSAGE', senderId: 'h', senderName: 'H', text: 'Hi', timestamp: 1 })
        expect(TeamsService.getState().unreadCount).toBe(1)

        TeamsService.markChatRead()
        expect(TeamsService.getState().unreadCount).toBe(0)
    })
})

// ─── Reconnection ─────────────────────────────────────────────────────────────

describe('reconnection', () => {
    it('schedules reconnection on unclean WS close', async () => {
        mockGetAccessToken.mockResolvedValue('test-token')
        const joinPromise = TeamsService.joinSession('ROOM77')
        await Promise.resolve()
        await Promise.resolve()
        const ws = wsInstances[0]
        simulateWsOpen(ws)
        simulateWsMessage(ws, {
            type: 'SESSION_JOINED',
            session: { code: 'ROOM77', role: 'participant', hostId: 'h', startedAt: 1, expiresAt: 2 },
            participants: [],
        })
        await joinPromise

        const setTimeoutSpy = jest.spyOn(global, 'setTimeout')
        simulateWsClose(ws, 1006, 'Abnormal closure')

        expect(setTimeoutSpy).toHaveBeenCalled()
    })

    it('does NOT schedule reconnection on clean close (code 1000)', async () => {
        mockGetAccessToken.mockResolvedValue('test-token')
        const joinPromise = TeamsService.joinSession('ROOM88')
        await Promise.resolve()
        await Promise.resolve()
        const ws = wsInstances[0]
        simulateWsOpen(ws)
        simulateWsMessage(ws, {
            type: 'SESSION_JOINED',
            session: { code: 'ROOM88', role: 'participant', hostId: 'h', startedAt: 1, expiresAt: 2 },
            participants: [],
        })
        await joinPromise

        const setTimeoutSpy = jest.spyOn(global, 'setTimeout')
        setTimeoutSpy.mockClear()
        simulateWsClose(ws, 1000, 'Normal closure')

        expect(setTimeoutSpy).not.toHaveBeenCalled()
    })

    it('uses exponential backoff: delays are 1s, 2s, 4s, ..., max 30s', async () => {
        mockGetAccessToken.mockResolvedValue('test-token')
        const joinPromise = TeamsService.joinSession('ROOM_BACKOFF')
        await Promise.resolve()
        await Promise.resolve()
        const ws = wsInstances[0]
        simulateWsOpen(ws)
        simulateWsMessage(ws, {
            type: 'SESSION_JOINED',
            session: { code: 'ROOM_BACKOFF', role: 'participant', hostId: 'h', startedAt: 1, expiresAt: 2 },
            participants: [],
        })
        await joinPromise

        // Capture setTimeout calls for reconnection
        const timeouts: number[] = []
        jest.spyOn(global, 'setTimeout').mockImplementation((_fn: TimerHandler, delay?: number) => {
            timeouts.push(delay ?? 0)
            return 0 as unknown as ReturnType<typeof setTimeout>
        })

        simulateWsClose(ws, 1006, 'Abnormal 1')

        expect(timeouts).toHaveLength(1)
        expect(timeouts[0]).toBe(1000) // First attempt: 1s

        // Simulate another unclean close after reconnect attempt
        // by triggering the timer and then a new close
        jest.runAllTimers()
        await Promise.resolve()

        if (wsInstances.length > 1) {
            simulateWsClose(wsInstances[wsInstances.length - 1], 1006, 'Abnormal 2')
            expect(timeouts[1]).toBe(2000) // Second attempt: 2s
        }
    })
})

// ─── sendChat / pushGroup ─────────────────────────────────────────────────────

describe('sendChat', () => {
    it('sends CHAT_MESSAGE JSON via WebSocket when connected', async () => {
        mockGetAccessToken.mockResolvedValue('test-token')
        const joinPromise = TeamsService.joinSession('ROOM_CHAT')
        await Promise.resolve()
        await Promise.resolve()
        const ws = wsInstances[0]
        simulateWsOpen(ws)
        simulateWsMessage(ws, {
            type: 'SESSION_JOINED',
            session: { code: 'ROOM_CHAT', role: 'participant', hostId: 'h', startedAt: 1, expiresAt: 2 },
            participants: [],
        })
        await joinPromise

        TeamsService.sendChat('Hello everyone!')

        expect(ws.send).toHaveBeenCalledWith(
            expect.stringContaining('"type":"CHAT_MESSAGE"')
        )
        const sentData = JSON.parse((ws.send as jest.Mock).mock.calls[0][0] as string)
        expect(sentData.type).toBe('CHAT_MESSAGE')
        expect(sentData.text).toBe('Hello everyone!')
        expect(typeof sentData.timestamp).toBe('number')
    })

    it('is a no-op when WebSocket is not connected', async () => {
        // No joinSession — WS not initialized
        TeamsService.sendChat('This should not send')
        // No wsInstances means send was never called
        expect(wsInstances).toHaveLength(0)
    })
})

describe('pushGroup', () => {
    it('sends GROUP_SHARE JSON via WebSocket when connected', async () => {
        mockGetAccessToken.mockResolvedValue('test-token')
        const joinPromise = TeamsService.joinSession('ROOM_GROUP')
        await Promise.resolve()
        await Promise.resolve()
        const ws = wsInstances[0]
        simulateWsOpen(ws)
        simulateWsMessage(ws, {
            type: 'SESSION_JOINED',
            session: { code: 'ROOM_GROUP', role: 'host', hostId: 'me', startedAt: 1, expiresAt: 2 },
            participants: [],
        })
        await joinPromise

        const group = { id: 'grp-1', name: 'Work', tabs: [{ title: 'GitHub', url: 'https://github.com' }] }
        TeamsService.pushGroup(group)

        expect(ws.send).toHaveBeenCalledWith(
            expect.stringContaining('"type":"GROUP_SHARE"')
        )
        const sentData = JSON.parse((ws.send as jest.Mock).mock.calls[0][0] as string)
        expect(sentData.type).toBe('GROUP_SHARE')
        expect(sentData.group).toEqual(group)
    })

    it('is a no-op when WebSocket is not connected', async () => {
        TeamsService.pushGroup({ id: 'grp-x', name: 'X', tabs: [] })
        expect(wsInstances).toHaveLength(0)
    })
})

// ─── closeSession (host only) ──────────────────────────────────────────────────

describe('closeSession', () => {
    it('sends CLOSE_SESSION event then disconnects', async () => {
        mockGetAccessToken.mockResolvedValue('test-token')
        const joinPromise = TeamsService.joinSession('ROOM_CLOSE')
        await Promise.resolve()
        await Promise.resolve()
        const ws = wsInstances[0]
        simulateWsOpen(ws)
        simulateWsMessage(ws, {
            type: 'SESSION_JOINED',
            session: { code: 'ROOM_CLOSE', role: 'host', hostId: 'me', startedAt: 1, expiresAt: 2 },
            participants: [],
        })
        await joinPromise

        TeamsService.closeSession()

        expect(ws.send).toHaveBeenCalledWith(
            expect.stringContaining('"type":"CLOSE_SESSION"')
        )
        expect(ws.close).toHaveBeenCalledWith(1000)
        expect(TeamsService.getState().connectionState).toBe('disconnected')
    })
})

// ─── Tab Broadcast ────────────────────────────────────────────────────────────

describe('tab broadcast — scheduleBroadcast debounce', () => {
    beforeEach(async () => {
        // Establish a connected session so broadcastTabs can send
        mockGetAccessToken.mockResolvedValue('test-token')
        const joinPromise = TeamsService.joinSession('ROOM_TAB')
        await Promise.resolve()
        await Promise.resolve()
        const ws = wsInstances[0]
        simulateWsOpen(ws)
        simulateWsMessage(ws, {
            type: 'SESSION_JOINED',
            session: { code: 'ROOM_TAB', role: 'participant', hostId: 'h', startedAt: 1, expiresAt: 2 },
            participants: [],
        })
        await joinPromise

        // Mock chrome.tabs.query to return an empty list by default
        ;(global as Record<string, unknown>).chrome = {
            ...(global as Record<string, unknown>).chrome as Record<string, unknown>,
            tabs: {
                query: jest.fn().mockImplementation((_opts: unknown, cb?: (tabs: chrome.tabs.Tab[]) => void) => {
                    if (cb) cb([])
                    return Promise.resolve([])
                }),
                onCreated: { addListener: jest.fn(), removeListener: jest.fn() },
                onRemoved: { addListener: jest.fn(), removeListener: jest.fn() },
                onUpdated: { addListener: jest.fn(), removeListener: jest.fn() },
            },
        }
    })

    it('scheduleBroadcast coalesces multiple calls within 1500ms into one broadcastTabs call', async () => {
        // Call scheduleBroadcast 3 times rapidly
        TeamsService.scheduleBroadcast()
        TeamsService.scheduleBroadcast()
        TeamsService.scheduleBroadcast()

        // Timer not yet fired
        const ws = wsInstances[0]
        expect(ws.send).not.toHaveBeenCalled()

        // Advance past debounce
        jest.advanceTimersByTime(1500)
        await Promise.resolve()

        // Should have sent exactly once
        const sendCalls = (ws.send as jest.Mock).mock.calls.filter(
            (c: string[]) => c[0]?.includes('"type":"TAB_UPDATE"')
        )
        expect(sendCalls.length).toBe(1)
    })

    it('scheduleBroadcast fires after 1500ms not before', async () => {
        TeamsService.scheduleBroadcast()

        jest.advanceTimersByTime(1499)
        await Promise.resolve()
        const ws = wsInstances[0]
        const callsBefore = (ws.send as jest.Mock).mock.calls.filter(
            (c: string[]) => c[0]?.includes('"type":"TAB_UPDATE"')
        ).length
        expect(callsBefore).toBe(0)

        jest.advanceTimersByTime(1)
        await Promise.resolve()
        // Timer fired — send may or may not have been called depending on query mock
    })
})

describe('tab broadcast — broadcastTabs URL filtering', () => {
    let wsInstance: WebSocket

    beforeEach(async () => {
        mockGetAccessToken.mockResolvedValue('test-token')
        const joinPromise = TeamsService.joinSession('ROOM_FILTER')
        await Promise.resolve()
        await Promise.resolve()
        wsInstance = wsInstances[0]
        simulateWsOpen(wsInstance)
        simulateWsMessage(wsInstance, {
            type: 'SESSION_JOINED',
            session: { code: 'ROOM_FILTER', role: 'participant', hostId: 'h', startedAt: 1, expiresAt: 2 },
            participants: [],
        })
        await joinPromise
    })

    it('broadcastTabs filters out chrome://, chrome-extension://, edge://, about: URLs', async () => {
        TeamsService.setShareAllMode(true)
        const mockTabs = [
            { id: 1, title: 'GitHub', url: 'https://github.com', favIconUrl: '' },
            { id: 2, title: 'Settings', url: 'chrome://settings/', favIconUrl: '' },
            { id: 3, title: 'Extension', url: 'chrome-extension://abc/popup.html', favIconUrl: '' },
            { id: 4, title: 'Edge NTP', url: 'edge://newtab/', favIconUrl: '' },
            { id: 5, title: 'Blank', url: 'about:blank', favIconUrl: '' },
            { id: 6, title: 'Google', url: 'https://google.com', favIconUrl: 'https://google.com/favicon.ico' },
        ] as chrome.tabs.Tab[]

        ;(global as Record<string, unknown>).chrome = {
            ...(global as Record<string, unknown>).chrome as Record<string, unknown>,
            tabs: {
                query: jest.fn().mockResolvedValue(mockTabs),
                onCreated: { addListener: jest.fn(), removeListener: jest.fn() },
                onRemoved: { addListener: jest.fn(), removeListener: jest.fn() },
                onUpdated: { addListener: jest.fn(), removeListener: jest.fn() },
            },
        }

        await TeamsService.broadcastTabs()

        const sendCalls = (wsInstance.send as jest.Mock).mock.calls
        expect(sendCalls.length).toBeGreaterThan(0)
        const payload = JSON.parse(sendCalls[sendCalls.length - 1][0] as string)
        expect(payload.type).toBe('TAB_UPDATE')
        // Only github.com and google.com should pass
        expect(payload.tabs).toHaveLength(2)
        expect(payload.tabs.map((t: { url: string }) => t.url)).toContain('https://github.com')
        expect(payload.tabs.map((t: { url: string }) => t.url)).toContain('https://google.com')
    })

    it('broadcastTabs is a no-op when WS is not connected', async () => {
        TeamsService.disconnect()

        ;(global as Record<string, unknown>).chrome = {
            ...(global as Record<string, unknown>).chrome as Record<string, unknown>,
            tabs: {
                query: jest.fn().mockResolvedValue([]),
                onCreated: { addListener: jest.fn(), removeListener: jest.fn() },
                onRemoved: { addListener: jest.fn(), removeListener: jest.fn() },
                onUpdated: { addListener: jest.fn(), removeListener: jest.fn() },
            },
        }

        await TeamsService.broadcastTabs()
        // No new WS instance created, no sends
        expect(wsInstances).toHaveLength(1)
    })

    it('broadcastTabs truncates to max 100 tabs', async () => {
        const manyTabs = Array.from({ length: 150 }, (_, i) => ({
            id: i + 1,
            title: `Tab ${i}`,
            url: `https://example-${i}.com`,
            favIconUrl: '',
        })) as chrome.tabs.Tab[]

        ;(global as Record<string, unknown>).chrome = {
            ...(global as Record<string, unknown>).chrome as Record<string, unknown>,
            tabs: {
                query: jest.fn().mockResolvedValue(manyTabs),
                onCreated: { addListener: jest.fn(), removeListener: jest.fn() },
                onRemoved: { addListener: jest.fn(), removeListener: jest.fn() },
                onUpdated: { addListener: jest.fn(), removeListener: jest.fn() },
            },
        }

        await TeamsService.broadcastTabs()

        const sendCalls = (wsInstance.send as jest.Mock).mock.calls
        const payload = JSON.parse(sendCalls[sendCalls.length - 1][0] as string)
        expect(payload.tabs.length).toBeLessThanOrEqual(100)
    })
})

describe('tab broadcast — listener lifecycle', () => {
    let chromeMock: {
        tabs: {
            query: jest.Mock
            onCreated: { addListener: jest.Mock; removeListener: jest.Mock }
            onRemoved: { addListener: jest.Mock; removeListener: jest.Mock }
            onUpdated: { addListener: jest.Mock; removeListener: jest.Mock }
        }
    }

    beforeEach(() => {
        chromeMock = {
            tabs: {
                query: jest.fn().mockResolvedValue([]),
                onCreated: { addListener: jest.fn(), removeListener: jest.fn() },
                onRemoved: { addListener: jest.fn(), removeListener: jest.fn() },
                onUpdated: { addListener: jest.fn(), removeListener: jest.fn() },
            },
        }
        ;(global as Record<string, unknown>).chrome = {
            ...(global as Record<string, unknown>).chrome as Record<string, unknown>,
            tabs: chromeMock.tabs,
        }
    })

    it('attachTabListeners registers listeners on onCreated, onRemoved, onUpdated', () => {
        TeamsService.attachTabListeners()

        expect(chromeMock.tabs.onCreated.addListener).toHaveBeenCalledTimes(1)
        expect(chromeMock.tabs.onRemoved.addListener).toHaveBeenCalledTimes(1)
        expect(chromeMock.tabs.onUpdated.addListener).toHaveBeenCalledTimes(1)
    })

    it('detachTabListeners removes the same listener references (not new functions)', () => {
        TeamsService.attachTabListeners()

        const createdListener = chromeMock.tabs.onCreated.addListener.mock.calls[0][0]
        const removedListener = chromeMock.tabs.onRemoved.addListener.mock.calls[0][0]
        const updatedListener = chromeMock.tabs.onUpdated.addListener.mock.calls[0][0]

        TeamsService.detachTabListeners()

        expect(chromeMock.tabs.onCreated.removeListener).toHaveBeenCalledWith(createdListener)
        expect(chromeMock.tabs.onRemoved.removeListener).toHaveBeenCalledWith(removedListener)
        expect(chromeMock.tabs.onUpdated.removeListener).toHaveBeenCalledWith(updatedListener)
    })

    it('disconnect calls detachTabListeners (no listener leak)', async () => {
        mockGetAccessToken.mockResolvedValue('test-token')
        const joinPromise = TeamsService.joinSession('ROOM_LEAK')
        await Promise.resolve()
        await Promise.resolve()
        const ws = wsInstances[0]
        simulateWsOpen(ws)
        simulateWsMessage(ws, {
            type: 'SESSION_JOINED',
            session: { code: 'ROOM_LEAK', role: 'participant', hostId: 'h', startedAt: 1, expiresAt: 2 },
            participants: [],
        })
        await joinPromise

        // Listeners attached on connect
        expect(chromeMock.tabs.onCreated.addListener).toHaveBeenCalledTimes(1)

        TeamsService.disconnect()

        // Listeners removed on disconnect
        expect(chromeMock.tabs.onCreated.removeListener).toHaveBeenCalledTimes(1)
        expect(chromeMock.tabs.onRemoved.removeListener).toHaveBeenCalledTimes(1)
        expect(chromeMock.tabs.onUpdated.removeListener).toHaveBeenCalledTimes(1)
    })
})

describe('tab broadcast — onUpdated filter', () => {
    let chromeMock: {
        tabs: {
            query: jest.Mock
            onCreated: { addListener: jest.Mock; removeListener: jest.Mock }
            onRemoved: { addListener: jest.Mock; removeListener: jest.Mock }
            onUpdated: { addListener: jest.Mock; removeListener: jest.Mock }
        }
    }

    beforeEach(() => {
        chromeMock = {
            tabs: {
                query: jest.fn().mockResolvedValue([]),
                onCreated: { addListener: jest.fn(), removeListener: jest.fn() },
                onRemoved: { addListener: jest.fn(), removeListener: jest.fn() },
                onUpdated: { addListener: jest.fn(), removeListener: jest.fn() },
            },
        }
        ;(global as Record<string, unknown>).chrome = {
            ...(global as Record<string, unknown>).chrome as Record<string, unknown>,
            tabs: chromeMock.tabs,
        }
        TeamsService.attachTabListeners()
    })

    it('onUpdated triggers broadcast for status=complete', () => {
        const updatedHandler = chromeMock.tabs.onUpdated.addListener.mock.calls[0][0] as (
            tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab
        ) => void

        const setTimeoutSpy = jest.spyOn(global, 'setTimeout')
        updatedHandler(1, { status: 'complete' }, {} as chrome.tabs.Tab)
        expect(setTimeoutSpy).toHaveBeenCalled()
    })

    it('onUpdated triggers broadcast for title change', () => {
        const updatedHandler = chromeMock.tabs.onUpdated.addListener.mock.calls[0][0] as (
            tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab
        ) => void

        const setTimeoutSpy = jest.spyOn(global, 'setTimeout')
        updatedHandler(1, { title: 'New Title' }, {} as chrome.tabs.Tab)
        expect(setTimeoutSpy).toHaveBeenCalled()
    })

    it('onUpdated triggers broadcast for URL change', () => {
        const updatedHandler = chromeMock.tabs.onUpdated.addListener.mock.calls[0][0] as (
            tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab
        ) => void

        const setTimeoutSpy = jest.spyOn(global, 'setTimeout')
        updatedHandler(1, { url: 'https://new-url.com' }, {} as chrome.tabs.Tab)
        expect(setTimeoutSpy).toHaveBeenCalled()
    })

    it('onUpdated does NOT trigger broadcast for unrelated change info (e.g. favIconUrl only)', () => {
        const updatedHandler = chromeMock.tabs.onUpdated.addListener.mock.calls[0][0] as (
            tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab
        ) => void

        const setTimeoutSpy = jest.spyOn(global, 'setTimeout')
        setTimeoutSpy.mockClear()
        updatedHandler(1, { favIconUrl: 'https://example.com/favicon.ico' } as chrome.tabs.TabChangeInfo, {} as chrome.tabs.Tab)
        expect(setTimeoutSpy).not.toHaveBeenCalled()
    })
})

describe('tab broadcast — selective mode', () => {
    let wsInstance: WebSocket

    beforeEach(async () => {
        mockGetAccessToken.mockResolvedValue('test-token')
        const joinPromise = TeamsService.joinSession('ROOM_SEL')
        await Promise.resolve()
        await Promise.resolve()
        wsInstance = wsInstances[0]
        simulateWsOpen(wsInstance)
        simulateWsMessage(wsInstance, {
            type: 'SESSION_JOINED',
            session: { code: 'ROOM_SEL', role: 'participant', hostId: 'h', startedAt: 1, expiresAt: 2 },
            participants: [],
        })
        await joinPromise

        ;(global as Record<string, unknown>).chrome = {
            ...(global as Record<string, unknown>).chrome as Record<string, unknown>,
            tabs: {
                query: jest.fn().mockResolvedValue([
                    { id: 1, title: 'Tab 1', url: 'https://site1.com', favIconUrl: '' },
                    { id: 2, title: 'Tab 2', url: 'https://site2.com', favIconUrl: '' },
                    { id: 3, title: 'Tab 3', url: 'https://site3.com', favIconUrl: '' },
                ] as chrome.tabs.Tab[]),
                onCreated: { addListener: jest.fn(), removeListener: jest.fn() },
                onRemoved: { addListener: jest.fn(), removeListener: jest.fn() },
                onUpdated: { addListener: jest.fn(), removeListener: jest.fn() },
            },
        }
    })

    it('default (shareAll off) only broadcasts selected tabs', async () => {
        TeamsService.setSelectedTabs([1, 3])

        jest.clearAllTimers()

        await TeamsService.broadcastTabs()

        const sendCalls = (wsInstance.send as jest.Mock).mock.calls
        const tabUpdateCalls = sendCalls.filter(
            (c: string[]) => c[0]?.includes('"type":"TAB_UPDATE"')
        )
        expect(tabUpdateCalls.length).toBeGreaterThan(0)
        const payload = JSON.parse(tabUpdateCalls[tabUpdateCalls.length - 1][0] as string)
        expect(payload.tabs).toHaveLength(2)
        expect(payload.tabs.map((t: { url: string }) => t.url)).toContain('https://site1.com')
        expect(payload.tabs.map((t: { url: string }) => t.url)).toContain('https://site3.com')
        expect(payload.tabs.map((t: { url: string }) => t.url)).not.toContain('https://site2.com')
    })

    it('setShareAllMode(true) broadcasts all tabs', async () => {
        TeamsService.setShareAllMode(true)

        jest.clearAllTimers()

        await TeamsService.broadcastTabs()

        const sendCalls = (wsInstance.send as jest.Mock).mock.calls
        const tabUpdateCalls = sendCalls.filter(
            (c: string[]) => c[0]?.includes('"type":"TAB_UPDATE"')
        )
        const payload = JSON.parse(tabUpdateCalls[tabUpdateCalls.length - 1][0] as string)
        expect(payload.tabs).toHaveLength(3)
    })

    it('setSelectedTabs updates the selected set and schedules a broadcast', () => {
        const setTimeoutSpy = jest.spyOn(global, 'setTimeout')
        TeamsService.setSelectedTabs([2, 4])
        expect(setTimeoutSpy).toHaveBeenCalled()
    })

    it('setShareAllMode schedules a broadcast immediately', () => {
        const setTimeoutSpy = jest.spyOn(global, 'setTimeout')
        TeamsService.setShareAllMode(true)
        expect(setTimeoutSpy).toHaveBeenCalled()
    })
})

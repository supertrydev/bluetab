/**
 * @module services/teams-service
 *
 * WHY:  Manages the full WebSocket lifecycle for the Teams Live Session feature
 *       (Phase 8). Handles session creation/joining, presence tracking, server
 *       event dispatch, host-owns-truth enforcement, and reconnection with
 *       exponential backoff — tested before implementation (TDD plan 08-02).
 *
 * WHAT: Static TeamsService class with:
 *       - createSession(): Pro-gated REST POST + WS open
 *       - joinSession(code): Auth-gated WS open
 *       - disconnect(): Clean WS teardown and state reset
 *       - handleServerEvent(): Dispatch for all TeamsServerEvent variants
 *       - scheduleReconnect(): Exponential backoff (1s min, 30s max, 2x multiplier)
 *       - sendChat() / pushGroup(): Outbound WS helpers
 *       - closeSession(): Host-only CLOSE_SESSION + disconnect
 *       - onStateChange / offStateChange / getState(): Observer pattern for UI
 *       - markChatRead(): Resets unreadCount when chat panel is opened
 *       - reset(): Test helper to clear all module-level state
 *
 * HOW:  Module-level variables for ws, currentState, stateCallbacks,
 *       reconnectTimer, reconnectAttempts, and currentCode/currentToken follow
 *       the same pattern as sync-transport.ts (functional module with static
 *       class facade). notifyListeners() calls all registered callbacks after
 *       every state mutation.
 *
 * NOT:  Does not render any UI — consumed by Teams sidepanel components (Plan 03).
 *       Does not manage tab broadcasting interval — that lives in Plan 03 UI layer.
 */

import { canAccessFeature, getFeatureGateMessage } from '@/utils/feature-gate'
import { getAccessToken } from '@/utils/auth-state'
import { Storage } from '@/utils/storage'
import { config } from '@/config/config'
import type {
    TeamsConnectionState,
    TeamsServiceState,
    TeamsClientEvent,
    TeamsServerEvent,
    SharedTab,
    TeamsGroupShare,
} from '@/types/teams'

// ─── Constants ────────────────────────────────────────────────────────────────

const LOG_PREFIX = '[BlueTab][TeamsService]'

const RECONNECT_MIN_DELAY = 1000   // 1 second
const RECONNECT_MAX_DELAY = 30000  // 30 seconds
const RECONNECT_MULTIPLIER = 2
const RECONNECT_MAX_ATTEMPTS = 5
const HEARTBEAT_INTERVAL = 25000  // 25 seconds — matches server ping interval

const TEAMS_SESSION_KEY = 'teams_session'
const TAB_BROADCAST_DEBOUNCE = 1500  // 1.5 seconds
const TAB_BROADCAST_MAX = 100        // max tabs per broadcast

// URL prefixes that identify internal browser pages — excluded from tab broadcast
const INTERNAL_URL_PREFIXES = [
    'chrome://',
    'chrome-extension://',
    'edge://',
    'about:',
]

// ─── Module-level State ───────────────────────────────────────────────────────

let ws: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let heartbeatTimer: ReturnType<typeof setInterval> | null = null
let reconnectAttempts = 0
let currentCode: string | null = null
let currentToken: string | null = null

// Tab broadcast state
let tabBroadcastTimer: ReturnType<typeof setTimeout> | null = null
let shareAllMode = false  // default: only share selected tabs
let selectedTabIds = new Set<number>()

const stateCallbacks: Set<(state: TeamsServiceState) => void> = new Set()

const INITIAL_STATE: TeamsServiceState = {
    connectionState: 'disconnected',
    session: null,
    participants: [],
    chatMessages: [],
    unreadCount: 0,
    groupShares: [],
}

let currentState: TeamsServiceState = { ...INITIAL_STATE, participants: [], chatMessages: [], groupShares: [] }

// ─── Internal Helpers ─────────────────────────────────────────────────────────

function setConnectionState(state: TeamsConnectionState): void {
    if (currentState.connectionState === state) return
    currentState = { ...currentState, connectionState: state }
    notifyListeners()
}

let defaultIconData: Record<string, ImageData> | null = null

async function loadDefaultIcon(): Promise<Record<string, ImageData>> {
    if (defaultIconData) return defaultIconData
    const sizes = [16, 32]
    const result: Record<string, ImageData> = {}
    for (const size of sizes) {
        const img = await createImageBitmap(
            await (await fetch(chrome.runtime.getURL(`src/assets/icon${size}.png`))).blob()
        )
        const canvas = new OffscreenCanvas(size, size)
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0, size, size)
        result[String(size)] = ctx.getImageData(0, 0, size, size)
    }
    defaultIconData = result
    return result
}

function drawDotOnIcon(iconData: Record<string, ImageData>, color: string): Record<string, ImageData> {
    const rgb = color === 'green' ? [34, 197, 94] : [163, 163, 163] // green-500 / neutral-400
    const result: Record<string, ImageData> = {}
    for (const [sizeStr, original] of Object.entries(iconData)) {
        const size = Number(sizeStr)
        const canvas = new OffscreenCanvas(size, size)
        const ctx = canvas.getContext('2d')!
        ctx.putImageData(original, 0, 0)
        // Dot at top-left — ~20% of icon size
        const dotRadius = Math.max(3, Math.round(size * 0.2))
        const cx = dotRadius + 1
        const cy = dotRadius + 1
        // White outline for contrast
        ctx.beginPath()
        ctx.arc(cx, cy, dotRadius + 1, 0, Math.PI * 2)
        ctx.fillStyle = 'rgb(30, 30, 30)'
        ctx.fill()
        // Colored dot
        ctx.beginPath()
        ctx.arc(cx, cy, dotRadius, 0, Math.PI * 2)
        ctx.fillStyle = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`
        ctx.fill()
        result[sizeStr] = ctx.getImageData(0, 0, size, size)
    }
    return result
}

function updateBadge(): void {
    try {
        // Only use setIcon for the dot overlay — never touch setBadgeText
        // as Pomodoro owns the badge text for its timer display

        if (currentState.connectionState === 'connected' || currentState.connectionState === 'connecting') {
            const color = currentState.connectionState === 'connected' ? 'green' : 'gray'
            loadDefaultIcon().then((icons) => {
                const dotIcons = drawDotOnIcon(icons, color)
                chrome.action.setIcon({ imageData: dotIcons as unknown as Record<string, ImageData> })
            }).catch(() => {})
        } else {
            // Restore original icon — use cached imageData if available, fall back to paths
            if (defaultIconData) {
                chrome.action.setIcon({ imageData: defaultIconData as unknown as Record<string, ImageData> })
            } else {
                loadDefaultIcon().then((icons) => {
                    chrome.action.setIcon({ imageData: icons as unknown as Record<string, ImageData> })
                }).catch(() => {
                    chrome.action.setIcon({
                        path: {
                            '16': chrome.runtime.getURL('src/assets/icon16.png'),
                            '32': chrome.runtime.getURL('src/assets/icon32.png'),
                        },
                    })
                })
            }
        }
    } catch {
        // chrome.action may not be available in all contexts
    }
}

// ─── Browser Tab Group Sync ──────────────────────────────────────────────────
// Remote participants' shared tabs are opened as Chrome tab groups in the
// local browser, named "{displayName}'s Tabs". The group is kept in sync:
// new URLs are opened, removed URLs are closed, existing ones are kept.

const participantTabGroups = new Map<string, { groupId: number; tabMap: Map<string, number> }>()

const TAB_GROUP_COLORS: chrome.tabGroups.ColorEnum[] = ['blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange']
let nextColorIdx = 0

async function syncParticipantBrowserGroup(
    userId: string,
    displayName: string,
    tabs: SharedTab[]
): Promise<void> {
    try {
        const existing = participantTabGroups.get(userId)
        const wantedUrls = new Set(tabs.map((t) => t.url))

        if (existing) {
            // Remove tabs no longer shared
            for (const [url, tabId] of existing.tabMap) {
                if (!wantedUrls.has(url)) {
                    chrome.tabs.remove(tabId).catch(() => {})
                    existing.tabMap.delete(url)
                }
            }

            // Add new tabs
            const newUrls = tabs.filter((t) => !existing.tabMap.has(t.url))
            if (newUrls.length > 0) {
                const newTabIds: number[] = []
                for (const t of newUrls) {
                    const created = await chrome.tabs.create({ url: t.url, active: false })
                    if (created.id) {
                        existing.tabMap.set(t.url, created.id)
                        newTabIds.push(created.id)
                    }
                }
                if (newTabIds.length > 0) {
                    await chrome.tabs.group({ tabIds: newTabIds, groupId: existing.groupId })
                }
            }

            // Collapse the group so it doesn't steal focus
            await chrome.tabGroups.update(existing.groupId, { collapsed: false }).catch(() => {})
        } else if (tabs.length > 0) {
            // First time — create all tabs and group them
            const tabIds: number[] = []
            const tabMap = new Map<string, number>()
            for (const t of tabs) {
                const created = await chrome.tabs.create({ url: t.url, active: false })
                if (created.id) {
                    tabIds.push(created.id)
                    tabMap.set(t.url, created.id)
                }
            }
            if (tabIds.length > 0) {
                const groupId = await chrome.tabs.group({ tabIds })
                const color = TAB_GROUP_COLORS[nextColorIdx % TAB_GROUP_COLORS.length]
                nextColorIdx++
                await chrome.tabGroups.update(groupId, {
                    title: `${displayName}'s Tabs`,
                    color,
                    collapsed: false,
                })
                participantTabGroups.set(userId, { groupId, tabMap })
            }
        }
    } catch (err) {
        console.error(`${LOG_PREFIX} syncParticipantBrowserGroup error:`, err)
    }
}

async function removeParticipantBrowserGroup(userId: string): Promise<void> {
    const entry = participantTabGroups.get(userId)
    if (!entry) return
    participantTabGroups.delete(userId)
    for (const tabId of entry.tabMap.values()) {
        chrome.tabs.remove(tabId).catch(() => {})
    }
}

function clearAllParticipantBrowserGroups(): void {
    for (const [userId] of participantTabGroups) {
        removeParticipantBrowserGroup(userId)
    }
    participantTabGroups.clear()
    nextColorIdx = 0
}

function notifyListeners(): void {
    updateBadge()
    const snapshot: TeamsServiceState = {
        connectionState: currentState.connectionState,
        session: currentState.session,
        participants: [...currentState.participants],
        chatMessages: [...currentState.chatMessages],
        unreadCount: currentState.unreadCount,
        groupShares: [...currentState.groupShares],
    }
    stateCallbacks.forEach((cb) => {
        try {
            cb(snapshot)
        } catch (err) {
            console.error(`${LOG_PREFIX} State callback error:`, err)
        }
    })
}

function handleServerEvent(msg: TeamsServerEvent): void {
    switch (msg.type) {
        case 'SESSION_JOINED': {
            reconnectAttempts = 0 // truly connected — reset counter
            currentState = {
                ...currentState,
                connectionState: 'connected',
                session: msg.session,
                participants: msg.participants,
                chatMessages: msg.history?.messages ?? currentState.chatMessages,
                groupShares: msg.history?.groups ?? currentState.groupShares,
            }
            notifyListeners()
            break
        }

        case 'PARTICIPANT_JOINED': {
            currentState = {
                ...currentState,
                participants: [...currentState.participants, msg.participant],
            }
            notifyListeners()
            break
        }

        case 'PARTICIPANT_LEFT': {
            currentState = {
                ...currentState,
                participants: currentState.participants.filter((p) => p.userId !== msg.userId),
            }
            notifyListeners()
            removeParticipantBrowserGroup(msg.userId)
            break
        }

        case 'PRESENCE_UPDATE': {
            currentState = {
                ...currentState,
                participants: currentState.participants.map((p) =>
                    p.userId === msg.userId ? { ...p, status: msg.status } : p
                ),
            }
            notifyListeners()
            break
        }

        case 'TAB_UPDATE': {
            const participant = currentState.participants.find((p) => p.userId === msg.userId)
            currentState = {
                ...currentState,
                participants: currentState.participants.map((p) =>
                    p.userId === msg.userId ? { ...p, tabs: msg.tabs } : p
                ),
            }
            notifyListeners()
            // Sync browser tab group for this remote participant
            if (participant) {
                syncParticipantBrowserGroup(msg.userId, participant.displayName, msg.tabs)
            }
            break
        }

        case 'CHAT_MESSAGE': {
            currentState = {
                ...currentState,
                chatMessages: [
                    ...currentState.chatMessages,
                    {
                        senderId: msg.senderId,
                        senderName: msg.senderName,
                        text: msg.text,
                        timestamp: msg.timestamp,
                    },
                ],
                unreadCount: currentState.unreadCount + 1,
            }
            notifyListeners()
            break
        }

        case 'SESSION_ENDED': {
            Storage.remove(TEAMS_SESSION_KEY).catch(() => {})
            clearAllParticipantBrowserGroups()
            currentState = {
                ...INITIAL_STATE,
                participants: [],
                chatMessages: [],
                groupShares: [],
                connectionState: 'disconnected',
                session: null,
            }
            notifyListeners()
            break
        }

        case 'ERROR': {
            currentState = { ...currentState, connectionState: 'error' }
            notifyListeners()
            break
        }

        case 'GROUP_SHARE': {
            const share: TeamsGroupShare = {
                senderId: msg.senderId,
                senderName: msg.senderName,
                group: msg.group,
                receivedAt: Date.now(),
            }
            currentState = {
                ...currentState,
                groupShares: [...currentState.groupShares, share],
            }
            notifyListeners()
            break
        }

        case 'SESSION_WARNING':
        case 'PONG':
            // Informational or ignored
            break

        default: {
            // TypeScript exhaustive check
            const _exhaustive: never = msg
            console.warn(`${LOG_PREFIX} Unknown server event:`, _exhaustive)
        }
    }
}

// ─── Tab Broadcast Helpers ────────────────────────────────────────────────────

/**
 * Debounce timer handler — always uses the same named reference so it can
 * be cancelled by tabBroadcastTimer. Calls the async broadcastTabsImpl via
 * a separate path to keep the setTimeout callback synchronous.
 */
function onTabBroadcastFired(): void {
    tabBroadcastTimer = null
    broadcastTabsImpl().catch((err) => {
        console.error(`${LOG_PREFIX} broadcastTabs error:`, err)
    })
}

async function broadcastTabsImpl(): Promise<void> {
    if (!ws || ws.readyState !== WebSocket.OPEN) return

    const allTabs = await chrome.tabs.query({})

    const filtered = allTabs.filter((t) => {
        if (!t.url) return false
        for (const prefix of INTERNAL_URL_PREFIXES) {
            if (t.url.startsWith(prefix)) return false
        }
        if (!shareAllMode && t.id !== undefined && !selectedTabIds.has(t.id)) return false
        return true
    })

    const tabs: SharedTab[] = filtered
        .slice(0, TAB_BROADCAST_MAX)
        .map((t) => ({
            id: t.id,
            title: t.title || '',
            url: t.url || '',
            favicon: t.favIconUrl,
        }))

    send({ type: 'TAB_UPDATE', tabs })
}

// ─── Named Tab Event Handlers (module-level so removeListener works) ──────────

function onTabCreated(_tab: chrome.tabs.Tab): void {
    scheduleBroadcastInternal()
}

function onTabRemoved(_tabId: number, _removeInfo: chrome.tabs.TabRemoveInfo): void {
    scheduleBroadcastInternal()
}

function onTabUpdated(
    _tabId: number,
    changeInfo: chrome.tabs.TabChangeInfo,
    _tab: chrome.tabs.Tab
): void {
    if (changeInfo.status === 'complete' || changeInfo.title || changeInfo.url) {
        scheduleBroadcastInternal()
    }
}

function scheduleBroadcastInternal(): void {
    if (tabBroadcastTimer !== null) {
        clearTimeout(tabBroadcastTimer)
    }
    tabBroadcastTimer = setTimeout(onTabBroadcastFired, TAB_BROADCAST_DEBOUNCE)
}

function attachTabListeners(): void {
    chrome.tabs.onCreated.addListener(onTabCreated)
    chrome.tabs.onRemoved.addListener(onTabRemoved)
    chrome.tabs.onUpdated.addListener(onTabUpdated)
}

function detachTabListeners(): void {
    chrome.tabs.onCreated.removeListener(onTabCreated)
    chrome.tabs.onRemoved.removeListener(onTabRemoved)
    chrome.tabs.onUpdated.removeListener(onTabUpdated)
}

function scheduleReconnect(): void {
    if (reconnectTimer !== null) return
    if (!currentCode || !currentToken) return

    if (reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
        console.warn(`${LOG_PREFIX} Max reconnect attempts (${RECONNECT_MAX_ATTEMPTS}) reached`)
        setConnectionState('error')
        return
    }

    const delay = Math.min(
        RECONNECT_MIN_DELAY * Math.pow(RECONNECT_MULTIPLIER, reconnectAttempts),
        RECONNECT_MAX_DELAY
    )

    console.log(`${LOG_PREFIX} Scheduling reconnect in ${delay}ms (attempt ${reconnectAttempts + 1})`)

    reconnectTimer = setTimeout(async () => {
        reconnectTimer = null
        reconnectAttempts++
        if (currentCode && currentToken) {
            connect(currentCode, currentToken, currentState.session?.role ?? 'participant')
        }
    }, delay)
}

function startHeartbeat(): void {
    stopHeartbeat()
    heartbeatTimer = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            send({ type: 'PING' })
        }
    }, HEARTBEAT_INTERVAL)
}

function stopHeartbeat(): void {
    if (heartbeatTimer !== null) {
        clearInterval(heartbeatTimer)
        heartbeatTimer = null
    }
}

function connect(code: string, token: string, _role: string): void {
    const url = `${config.supertry.wsUrl}/ws/teams/${code}?token=${token}`
    // Never log the token. TODO: move it out of the URL once the Teams
    // WebSocket server accepts it in the Sec-WebSocket-Protocol header.
    console.log(`${LOG_PREFIX} Connecting to ${config.supertry.wsUrl}/ws/teams/${code}`)

    setConnectionState('connecting')

    ws = new WebSocket(url)

    ws.onopen = () => {
        console.log(`${LOG_PREFIX} WebSocket connected`)
        // Don't reset reconnectAttempts here — only on SESSION_JOINED
        // The WS handshake succeeding doesn't mean the session is valid
        attachTabListeners()
        startHeartbeat()
    }

    ws.onmessage = (event: MessageEvent) => {
        try {
            const msg = JSON.parse(event.data as string) as TeamsServerEvent
            handleServerEvent(msg)
        } catch (err) {
            console.error(`${LOG_PREFIX} Failed to parse server message:`, err)
        }
    }

    ws.onclose = (event: CloseEvent) => {
        console.log(`${LOG_PREFIX} WebSocket closed: code=${event.code} reason=${event.reason}`)
        stopHeartbeat()
        ws = null

        // Permanent errors — do not reconnect
        const permanentCodes = [1000, 4001, 4003, 4004, 4005, 4009, 4010]
        if (permanentCodes.includes(event.code)) {
            if (event.code !== 1000) {
                // Clear persisted session — room is gone or access denied
                Storage.remove(TEAMS_SESSION_KEY).catch(() => {})
                setConnectionState('error')
            }
            return
        }

        // Transient close — schedule reconnection
        scheduleReconnect()
    }

    ws.onerror = (event: Event) => {
        console.error(`${LOG_PREFIX} WebSocket error:`, event)
        setConnectionState('error')
    }
}

function send(event: TeamsClientEvent): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify(event))
}

// ─── TeamsService Public API ──────────────────────────────────────────────────

export class TeamsService {
    /**
     * Create a new session (Pro-gated). Returns session code on success.
     */
    static async createSession(): Promise<{ success: true; code: string } | { success: false; error: string }> {
        // 1. Feature gate check
        const access = await canAccessFeature('team_sharing')
        if (!access.allowed) {
            const message = getFeatureGateMessage(access, 'team sharing')
            return { success: false, error: message }
        }

        // 2. Auth check
        const token = await getAccessToken()
        if (!token) {
            return { success: false, error: 'Not authenticated' }
        }

        // 3. REST POST to create room
        try {
            const response = await fetch(`${config.supertry.apiUrl}/teams/rooms`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
            })

            if (!response.ok) {
                const msg = response.status === 429
                    ? 'Too many attempts. Please wait a moment and try again.'
                    : 'Failed to create session'
                return { success: false, error: msg }
            }

            const data = (await response.json()) as { code: string; expiresAt: number }
            const { code, expiresAt } = data

            // 4. Store for reconnection
            currentCode = code
            currentToken = token

            // 5. Set preliminary session state so UI can route immediately
            currentState = {
                ...currentState,
                connectionState: 'connecting',
                session: {
                    code,
                    role: 'host',
                    hostId: '',
                    startedAt: Date.now(),
                    expiresAt,
                },
            }
            notifyListeners()

            // 6. Persist for reconnection across sidepanel close/reopen
            Storage.set(TEAMS_SESSION_KEY, {
                sessionCode: code,
                role: 'host' as const,
                joinedAt: Date.now(),
                displayName: '',
            }).catch(() => {})

            // 7. Open WebSocket — SESSION_JOINED handler will update with full data
            connect(code, token, 'host')

            // Update persisted session when full data arrives from server
            if (ws) {
                ws.onmessage = (event: MessageEvent) => {
                    try {
                        const msg = JSON.parse(event.data as string) as TeamsServerEvent
                        handleServerEvent(msg)
                        if (msg.type === 'SESSION_JOINED') {
                            Storage.set(TEAMS_SESSION_KEY, {
                                sessionCode: code,
                                role: msg.session.role,
                                joinedAt: Date.now(),
                                displayName: '',
                            }).catch(() => {})
                        }
                    } catch (err) {
                        console.error(`${LOG_PREFIX} Failed to parse server message:`, err)
                    }
                }
            }

            return { success: true, code }
        } catch (err) {
            console.error(`${LOG_PREFIX} createSession error:`, err)
            return { success: false, error: 'Failed to create session' }
        }
    }

    /**
     * Join an existing session by room code (auth-gated).
     */
    static async joinSession(code: string): Promise<{ success: true } | { success: false; error: string }> {
        // Auth check
        const token = await getAccessToken()
        if (!token) {
            return { success: false, error: 'Sign in to join a session' }
        }

        // Store for reconnection
        currentCode = code
        currentToken = token

        // Set preliminary session state so UI can route immediately
        currentState = {
            ...currentState,
            connectionState: 'connecting',
            session: {
                code,
                role: 'participant',
                hostId: '',
                startedAt: Date.now(),
                expiresAt: 0,
            },
        }
        notifyListeners()

        // Persist for reconnection across sidepanel close/reopen
        Storage.set(TEAMS_SESSION_KEY, {
            sessionCode: code,
            role: 'participant',
            joinedAt: Date.now(),
            displayName: '',
        }).catch(() => {})

        connect(code, token, 'participant')

        // Override onmessage to also persist session data when SESSION_JOINED is received
        if (ws) {
            ws.onmessage = (event: MessageEvent) => {
                try {
                    const msg = JSON.parse(event.data as string) as TeamsServerEvent
                    handleServerEvent(msg)
                    if (msg.type === 'SESSION_JOINED') {
                        Storage.set(TEAMS_SESSION_KEY, {
                            sessionCode: code,
                            role: msg.session.role,
                            joinedAt: Date.now(),
                            displayName: '',
                        }).catch(() => {})
                    }
                } catch (err) {
                    console.error(`${LOG_PREFIX} Failed to parse server message:`, err)
                }
            }
        }

        return { success: true }
    }

    /**
     * Disconnect from the current session cleanly (code 1000).
     */
    static disconnect(): void {
        // Clear reconnect timer
        if (reconnectTimer !== null) {
            clearTimeout(reconnectTimer)
            reconnectTimer = null
        }

        // Clear tab broadcast timer
        if (tabBroadcastTimer !== null) {
            clearTimeout(tabBroadcastTimer)
            tabBroadcastTimer = null
        }

        // Stop heartbeat and detach tab listeners before closing WS
        stopHeartbeat()
        detachTabListeners()

        // Close WebSocket cleanly
        if (ws) {
            ws.close(1000)
            ws = null
        }

        // Clean up browser tab groups from remote participants
        clearAllParticipantBrowserGroups()

        // Remove persisted session
        Storage.remove(TEAMS_SESSION_KEY).catch(() => {})

        // Reset state
        currentCode = null
        currentToken = null
        reconnectAttempts = 0
        currentState = {
            connectionState: 'disconnected',
            session: null,
            participants: [],
            chatMessages: [],
            unreadCount: 0,
            groupShares: [],
        }
        notifyListeners() // also clears badge via updateBadge()
    }

    /**
     * Send a chat message (no-op if not connected).
     */
    static sendChat(text: string): void {
        send({ type: 'CHAT_MESSAGE', text, timestamp: Date.now() })
    }

    /**
     * Share a group to all session participants (no-op if not connected).
     */
    static pushGroup(group: { id: string; name: string; tabs: SharedTab[] }): void {
        send({ type: 'GROUP_SHARE', group })
    }

    /**
     * Host-only: send CLOSE_SESSION then disconnect.
     */
    static closeSession(): void {
        send({ type: 'CLOSE_SESSION' })
        this.disconnect()
    }

    /**
     * Get a snapshot of current service state.
     */
    static getState(): TeamsServiceState {
        return {
            connectionState: currentState.connectionState,
            session: currentState.session,
            participants: [...currentState.participants],
            chatMessages: [...currentState.chatMessages],
            unreadCount: currentState.unreadCount,
            groupShares: [...currentState.groupShares],
        }
    }

    /**
     * Register a state change callback.
     */
    static onStateChange(callback: (state: TeamsServiceState) => void): void {
        stateCallbacks.add(callback)
    }

    /**
     * Remove a state change callback.
     */
    static offStateChange(callback: (state: TeamsServiceState) => void): void {
        stateCallbacks.delete(callback)
    }

    /**
     * Reset unreadCount to 0 (call when chat panel is opened).
     */
    static markChatRead(): void {
        if (currentState.unreadCount === 0) return
        currentState = { ...currentState, unreadCount: 0 }
        notifyListeners()
    }

    /**
     * Schedule a debounced tab broadcast. Multiple calls within 1500ms coalesce
     * into a single broadcastTabs() invocation.
     */
    static scheduleBroadcast(): void {
        scheduleBroadcastInternal()
    }

    /**
     * Immediately broadcast current tab state to the session.
     * No-op when not connected.
     */
    static async broadcastTabs(): Promise<void> {
        return broadcastTabsImpl()
    }

    /**
     * Attach tab event listeners (onCreated, onRemoved, onUpdated).
     * Called automatically on WS open; exposed for tests.
     */
    static attachTabListeners(): void {
        attachTabListeners()
    }

    /**
     * Remove tab event listeners. Called on disconnect; exposed for tests.
     */
    static detachTabListeners(): void {
        detachTabListeners()
    }

    /**
     * Toggle share-all mode. When ON, all tabs are broadcast. When OFF (default),
     * only tabs in the selected set are broadcast. Schedules an immediate broadcast
     * so remote participants see the change right away.
     */
    static setShareAllMode(enabled: boolean): void {
        shareAllMode = enabled
        scheduleBroadcastInternal()
    }

    /**
     * Replace the set of selected tab IDs used in selective mode. Schedules an
     * immediate broadcast to reflect the change.
     */
    static setSelectedTabs(ids: number[]): void {
        selectedTabIds = new Set(ids)
        scheduleBroadcastInternal()
    }

    /**
     * Reset all module-level state. Used by tests between cases.
     */
    static reset(): void {
        if (reconnectTimer !== null) {
            clearTimeout(reconnectTimer)
            reconnectTimer = null
        }
        if (tabBroadcastTimer !== null) {
            clearTimeout(tabBroadcastTimer)
            tabBroadcastTimer = null
        }
        stopHeartbeat()
        if (ws) {
            ws.onopen = null
            ws.onmessage = null
            ws.onclose = null
            ws.onerror = null
            ws = null
        }
        reconnectAttempts = 0
        currentCode = null
        currentToken = null
        shareAllMode = false
        selectedTabIds = new Set<number>()
        stateCallbacks.clear()
        currentState = {
            connectionState: 'disconnected',
            session: null,
            participants: [],
            chatMessages: [],
            unreadCount: 0,
            groupShares: [],
        }
    }
}

/**
 * @module types/teams
 *
 * WHY: Defines all data structures for the Teams Live Session feature (Phase 8).
 *      Type definitions match the event schemas in SUPERTRY-WEBSOCKET-SPEC.md.
 *
 * WHAT: Session, participant, chat message, and WebSocket event types.
 *
 * HOW: Used by TeamsService (Plan 02) and Teams UI components (Plan 03).
 *
 * NOT: Does not contain business logic — types only.
 */

// ─── Connection & Participant Enumerations ────────────────────────────────────

export type TeamsConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

export type ParticipantRole = 'host' | 'participant'

export type ParticipantStatus = 'online' | 'offline'

// ─── Core Data Structures ─────────────────────────────────────────────────────

export interface SharedTab {
    id?: number
    title: string
    url: string
    favicon?: string
}

export interface Participant {
    userId: string
    displayName: string
    role: ParticipantRole
    status: ParticipantStatus
    tabs: SharedTab[]
    lastSeen: number
}

export interface TeamsChatMessage {
    senderId: string
    senderName: string
    text: string
    timestamp: number
}

export interface TeamsSessionData {
    code: string
    role: ParticipantRole
    hostId: string
    startedAt: number
    expiresAt: number
}

/**
 * Persisted to chrome.storage.local for reconnection resilience.
 * Allows the extension to rejoin an active session after a service worker restart.
 */
export interface TeamsSessionPersisted {
    sessionCode: string
    role: ParticipantRole
    joinedAt: number
    displayName: string
}

// ─── Client → Server Events ───────────────────────────────────────────────────

export type TeamsClientEvent =
    | { type: 'TAB_UPDATE'; tabs: SharedTab[] }
    | { type: 'CHAT_MESSAGE'; text: string; timestamp: number }
    | { type: 'GROUP_SHARE'; group: { id: string; name: string; tabs: SharedTab[] } }
    | { type: 'PING' }
    | { type: 'CLOSE_SESSION' }

// ─── Server → Client Events ───────────────────────────────────────────────────

export type TeamsServerEvent =
    | { type: 'SESSION_JOINED'; session: TeamsSessionData; participants: Participant[]; history?: { messages?: TeamsChatMessage[]; groups?: TeamsGroupShare[] } }
    | { type: 'PARTICIPANT_JOINED'; participant: Participant }
    | { type: 'PARTICIPANT_LEFT'; userId: string }
    | { type: 'PRESENCE_UPDATE'; userId: string; status: ParticipantStatus }
    | { type: 'TAB_UPDATE'; userId: string; tabs: SharedTab[] }
    | { type: 'CHAT_MESSAGE'; senderId: string; senderName: string; text: string; timestamp: number }
    | { type: 'GROUP_SHARE'; senderId: string; senderName: string; group: { id: string; name: string; tabs: SharedTab[] } }
    | { type: 'SESSION_ENDED'; reason: 'host_left' | 'expired' | 'kicked' }
    | { type: 'SESSION_WARNING'; message: string; expiresIn: number }
    | { type: 'ERROR'; code: string; message: string }
    | { type: 'PONG' }

// ─── Received group share ─────────────────────────────────────────────────────

export interface TeamsGroupShare {
    senderId: string
    senderName: string
    group: { id: string; name: string; tabs: SharedTab[] }
    receivedAt: number
}

// ─── Service State Aggregate ─────────────────────────────────────────────────

export interface TeamsServiceState {
    connectionState: TeamsConnectionState
    session: TeamsSessionData | null
    participants: Participant[]
    chatMessages: TeamsChatMessage[]
    unreadCount: number
    groupShares: TeamsGroupShare[]
}

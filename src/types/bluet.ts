/**
 * @module types/bluet
 *
 * WHY: Define TypeScript interfaces for the Bluetab → Bluet bridge feature.
 *      Bluet (bluet.in) is a link sharing platform. This bridge allows
 *      Bluetab users to share their TabGroups/Projects to Bluet pages.
 *
 * WHAT: Contains interfaces for bridge connection, shared references,
 *       API request/response types.
 *
 * NOT: Does not contain implementation logic - purely type definitions.
 */

// ============================================================================
// Bridge Connection (device-local, NOT synced)
// ============================================================================

/**
 * Bridge connection data stored per-device.
 * Storage key: "bluet_bridge" — device-local, NOT in SYNCABLE_KEYS.
 * Each device maintains its own bridge token for security.
 */
export interface BluetBridgeData {
  /** JWT bridge token (90-day lifetime, scope: "bridge") */
  token: string
  /** Token expiration as Unix timestamp (ms) */
  tokenExpiresAt: number
  /** Connected Bluet user info */
  bluet: {
    userId: string
    username: string
    baseUrl: string
  }
  /** When the bridge connection was established (ms) */
  connectedAt: number
}

// ============================================================================
// Shared References (synced across devices)
// ============================================================================

/**
 * Tracks which TabGroup or Project has been shared to Bluet.
 * Storage key: "bluet_shared_refs" — included in cross-device sync.
 *
 * The `id` field equals the TabGroup/Project ID from Bluetab.
 * This is required for delta-tracker compatibility (IdentifiableEntity).
 */
export interface BluetSharedRef {
  /** TabGroup or Project ID (must be named `id` for delta-tracker) */
  id: string
  /** Source entity type */
  type: 'tabgroup' | 'project'
  /** Bluet page URL path (e.g. "/emre/github-repos") */
  pageUrl: string
  /** When first shared (ms) */
  sharedAt: number
  /** Last successful sync to Bluet (ms) */
  lastSyncedAt: number
}

// ============================================================================
// API Response Types
// ============================================================================

/**
 * Machine-readable reason for a failed Bluet call. UI maps these to translated text.
 * Server codes (see bluet lib/bridge-response.ts) plus client-side ones.
 */
export type BluetErrorCode =
  | 'not_connected'
  | 'nothing_to_share'
  | 'session_expired'
  | 'revoked'
  | 'subscription_required'
  | 'bluetab_pro_required'
  | 'linked_elsewhere'
  | 'rate_limited'
  | 'limit_exceeded'
  | 'invalid_payload'
  | 'payload_too_large'
  | 'invalid_token'
  | 'token_expired'
  | 'server_error'
  | 'network'

/**
 * Result from a share or re-sync operation.
 */
export interface BluetShareResult {
  success: boolean
  pageId?: string
  /** Relative page URL (e.g. "/emre/github-repos") */
  pageUrl?: string
  /** Full page URL (e.g. "https://bluet.in/emre/github-repos") */
  fullUrl?: string
  /** Number of links on the page */
  linkCount?: number
  /** Number of groups (only for project shares) */
  groupCount?: number
  /** Tabs Bluet could not publish (internal/private URLs, duplicates, over the per-group limit) */
  skippedCount?: number
  /** Error message if success is false (English fallback) */
  error?: string
  /** Error reason if success is false */
  code?: BluetErrorCode
  /** True when trying again later may work (network, 5xx, rate limit) */
  retryable?: boolean
  /** Server-provided wait before retrying (ms) */
  retryAfterMs?: number
}

/**
 * Bridge connection status from Bluet API.
 */
export interface BluetBridgeStatus {
  connected: boolean
  username?: string
  totalPages?: number
  totalLinks?: number
  /** Whether this Bluet account can share right now (verified Bluetab Pro and Bluet Pro access) */
  access?: boolean
  /** Why `access` is false when the Bluetab Pro proof was not accepted (e.g. "not_pro", "linked_elsewhere") */
  accessReason?: string
  /** Bluet Pro access comes from the user's Bluetab Pro subscription */
  bluetabPro?: boolean
  /** Why the status could not be confirmed (only set when the API was not reachable) */
  unreachable?: boolean
}

// ============================================================================
// Internal Types
// ============================================================================

/**
 * URLs that should be filtered out before sharing to Bluet.
 */
export const BLUET_FILTERED_URL_PREFIXES = [
  'chrome://',
  'chrome-extension://',
  'about:',
  'file://',
  'edge://',
  'brave://',
  'opera://',
] as const

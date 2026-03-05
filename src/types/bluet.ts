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
 * Storage key: "bluet_bridge" — excluded from cross-device sync.
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
  /** Error message if success is false */
  error?: string
}

/**
 * Bridge connection status from Bluet API.
 */
export interface BluetBridgeStatus {
  connected: boolean
  username?: string
  totalPages?: number
  totalLinks?: number
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

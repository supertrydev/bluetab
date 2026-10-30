/**
 * @module services/bluet-bridge-service
 *
 * WHY: Enable Bluetab users to share TabGroups/Projects to Bluet (bluet.in).
 *      Provides bridge connection management, sharing operations, and auto re-sync.
 *
 * WHAT: Provides BluetBridgeService class with static methods for:
 *       - Bridge connection (connect/disconnect via Bluet auth)
 *       - Bluetab Pro → Bluet Pro: a short-lived, Supertry-signed assertion is sent to
 *         Bluet on connect (URL fragment of the auth page) and on status/sync calls
 *       - Sharing TabGroups and Projects to Bluet pages, and removing them again
 *       - Tracking shared references across devices
 *       - Auto re-sync when shared groups change (with retry for transient failures)
 *
 * HOW: Uses chrome.tabs for auth flow, fetch API for Bluet endpoints.
 *      Stores bridge token in chrome.storage.local (device-local, never synced).
 *      Stores shared refs in chrome.storage.local (synced via delta-tracker).
 *
 * NOT: Does not handle UI - use BluetConnectionSection and context menus for that.
 *      Does not handle Bluet server logic - that lives in the bluet repo.
 */

import { config } from '../config/config'
import { Storage } from '../utils/storage'
import { getAccessToken, getAuthState } from '../utils/auth-state'
import type { TabGroup, Project, TabItem } from '../types/models'
import type {
  BluetBridgeData,
  BluetSharedRef,
  BluetShareResult,
  BluetBridgeStatus,
  BluetErrorCode,
} from '../types/bluet'

// ============================================================================
// Constants
// ============================================================================

const STORAGE_KEY_BRIDGE = 'bluet_bridge'
const STORAGE_KEY_SHARED_REFS = 'bluet_shared_refs'
const LOG_PREFIX = '[BlueTab][BluetBridge]'

/** Header Bluet reads to renew Bluet Pro from Bluetab Pro. */
const ASSERTION_HEADER = 'X-Bluetab-Assertion'

/** Bluet limits (bluet lib/bridge-payload.ts, lib/constants.ts). */
export const BLUET_MAX_TITLE_LENGTH = 80
export const BLUET_MAX_TABS_PER_GROUP = 100
export const BLUET_MAX_GROUPS_PER_PROJECT = 100
const MAX_URL_LENGTH = 2048

/** Reuse an assertion while it has at least this much lifetime left. */
const ASSERTION_MIN_REMAINING_MS = 60_000

// ============================================================================
// Pure helpers (exported for tests)
// ============================================================================

/** Only public web pages can be published on Bluet. */
export function isShareableUrl(url: string | undefined): boolean {
  if (!url || url.length > MAX_URL_LENGTH) return false
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/** Collapses whitespace and shortens to Bluet's 80-character title limit. */
export function clampBluetTitle(value: string | undefined, fallback: string): string {
  const text = (value ?? '').replace(/\s+/g, ' ').trim()
  const title = text || fallback.trim() || 'Untitled'
  return title.length > BLUET_MAX_TITLE_LENGTH
    ? `${title.slice(0, BLUET_MAX_TITLE_LENGTH - 1).trimEnd()}…`
    : title
}

interface BridgeTab {
  id: string
  url: string
  title: string
  favicon?: string
}

/** Keeps the tabs Bluet accepts and reports how many were left out. */
export function toShareableTabs(tabs: TabItem[]): { tabs: BridgeTab[]; skipped: number } {
  const seen = new Set<string>()
  const result: BridgeTab[] = []
  for (const tab of tabs) {
    if (!isShareableUrl(tab.url) || seen.has(tab.id)) continue
    seen.add(tab.id)
    result.push({
      id: tab.id,
      url: tab.url,
      title: clampBluetTitle(tab.title, tab.url),
      // Bluet only keeps public https icons; data: URIs would just bloat the request.
      favicon: tab.favicon?.startsWith('https://') ? tab.favicon : undefined,
    })
  }
  const kept = result.slice(0, BLUET_MAX_TABS_PER_GROUP)
  return { tabs: kept, skipped: tabs.length - kept.length }
}

/** Seconds from a Retry-After header (delta-seconds or HTTP date), falling back to the body. */
export function parseRetryAfterMs(header: string | null, bodyValue: unknown, now = Date.now()): number | undefined {
  if (header) {
    const seconds = Number(header)
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
    const date = Date.parse(header)
    if (!Number.isNaN(date)) return Math.max(0, date - now)
  }
  if (typeof bodyValue === 'number' && Number.isFinite(bodyValue) && bodyValue >= 0) return bodyValue * 1000
  return undefined
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function failure(code: BluetErrorCode, error: string, extra: Partial<BluetShareResult> = {}): BluetShareResult {
  return { success: false, code, error, ...extra }
}

function timeoutSignal(): AbortSignal {
  return AbortSignal.timeout(config.bluet.requestTimeoutMs)
}

/** Network and timeout errors from fetch. */
function networkFailure(error: unknown): BluetShareResult {
  const timedOut = error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')
  return failure('network', timedOut ? 'Bluet did not respond in time' : 'Could not reach Bluet', { retryable: true })
}

// ============================================================================
// Service
// ============================================================================

let cachedAssertion: { value: string; expiresAtMs: number } | null = null

export class BluetBridgeService {
  // ==========================================================================
  // Connection Management
  // ==========================================================================

  /**
   * Check if this device has an active bridge connection.
   */
  static async isConnected(): Promise<boolean> {
    const token = await this.getToken()
    return token !== null
  }

  /**
   * Get the stored bridge data (device-local).
   */
  static async getBridgeData(): Promise<BluetBridgeData | null> {
    return Storage.get<BluetBridgeData>(STORAGE_KEY_BRIDGE)
  }

  /**
   * Get a valid bridge token, or null if expired/missing.
   * On expiry: clears the local token only (does NOT call Bluet API).
   */
  static async getToken(): Promise<string | null> {
    const data = await this.getBridgeData()
    if (!data?.token) return null

    if (Date.now() >= data.tokenExpiresAt) {
      console.log(LOG_PREFIX, 'Token expired, clearing local bridge token (not calling API)')
      await this.clearLocalData({ keepSharedRefs: true })
      return null
    }

    return data.token
  }

  /**
   * Clear local bridge data without notifying Bluet API.
   * Shared refs are synced across devices and belong to the Bluet account, so an expired
   * token on one device keeps them; revocation (account-wide) clears them.
   */
  static async clearLocalData(options: { keepSharedRefs?: boolean } = {}): Promise<void> {
    await Storage.remove(STORAGE_KEY_BRIDGE)
    if (!options.keepSharedRefs) await Storage.remove(STORAGE_KEY_SHARED_REFS)
    cachedAssertion = null
    console.log(LOG_PREFIX, options.keepSharedRefs ? 'Local bridge token cleared' : 'Local bridge data cleared')
  }

  /**
   * Signed proof of Bluetab Pro from Supertry, or null when the user is not Pro,
   * not signed in, or Supertry cannot issue one. Cached until shortly before expiry.
   */
  static async fetchEntitlementAssertion(options: { force?: boolean } = {}): Promise<string | null> {
    if (!options.force && cachedAssertion && cachedAssertion.expiresAtMs - Date.now() > ASSERTION_MIN_REMAINING_MS) {
      return cachedAssertion.value
    }

    try {
      const auth = await getAuthState()
      if (!auth.isPro) {
        cachedAssertion = null
        return null
      }
      const accessToken = await getAccessToken()
      if (!accessToken) return null

      const response = await fetch(`${config.supertry.apiUrl}${config.bluet.entitlementEndpoint}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) {
        if (response.status === 403) cachedAssertion = null
        console.log(LOG_PREFIX, `Bluetab Pro assertion unavailable (${response.status})`)
        return null
      }

      const data = (await response.json()) as { assertion?: unknown; expiresAt?: unknown }
      if (typeof data.assertion !== 'string' || typeof data.expiresAt !== 'number') return null
      cachedAssertion = { value: data.assertion, expiresAtMs: data.expiresAt * 1000 }
      return data.assertion
    } catch {
      return null
    }
  }

  /**
   * Open Bluet auth page so the user can get a bridge token.
   * For Bluetab Pro users the Supertry assertion travels in the URL fragment,
   * which browsers never send to the server or in Referer headers.
   */
  static async openAuthPage(): Promise<void> {
    const assertion = await this.fetchEntitlementAssertion({ force: true })
    const base = `${config.bluet.baseUrl}${config.bluet.bridgeAuthPath}`
    const url = assertion ? `${base}#bluetab=${encodeURIComponent(assertion)}` : base
    await chrome.tabs.create({ url })
  }

  /**
   * Connect using a manually pasted bridge token.
   * The token is checked with Bluet before it is stored.
   */
  static async connectWithToken(
    token: string,
  ): Promise<{ success: boolean; error?: string; code?: BluetErrorCode }> {
    const trimmed = token.trim()
    if (!trimmed) {
      return { success: false, code: 'invalid_token', error: 'Token is empty' }
    }

    // JWT payload: { userId, scope: 'bridge', iat, exp } — username comes from /api/bridge/status
    let userId: string
    let expMs: number
    try {
      const parts = trimmed.split('.')
      if (parts.length !== 3) {
        return { success: false, code: 'invalid_token', error: 'Invalid token format' }
      }
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
      userId = String(payload.userId || payload.sub || '')
      if (!userId) {
        return { success: false, code: 'invalid_token', error: 'Token does not contain user info' }
      }
      expMs = typeof payload.exp === 'number'
        ? payload.exp * 1000
        : Date.now() + config.bluet.tokenLifetimeDays * 24 * 60 * 60 * 1000
    } catch (error) {
      console.error(LOG_PREFIX, 'Failed to parse token:', error)
      return { success: false, code: 'invalid_token', error: 'Failed to parse token' }
    }

    if (Date.now() >= expMs) {
      return { success: false, code: 'token_expired', error: 'Token has expired' }
    }

    let status: Record<string, unknown>
    try {
      const response = await fetch(`${config.bluet.baseUrl}${config.bluet.statusEndpoint}`, {
        headers: await this.bridgeHeaders(trimmed),
        signal: timeoutSignal(),
      })
      if (response.status === 401) {
        return { success: false, code: 'invalid_token', error: 'Bluet did not accept this token' }
      }
      if (!response.ok) {
        const result = await this.readError(response)
        return { success: false, code: result.code, error: result.error }
      }
      status = await response.json()
    } catch (error) {
      const result = networkFailure(error)
      return { success: false, code: result.code, error: result.error }
    }

    if (status.connected === false) {
      return { success: false, code: 'revoked', error: 'This token was disconnected on Bluet. Get a new one.' }
    }

    const bridgeData: BluetBridgeData = {
      token: trimmed,
      tokenExpiresAt: expMs,
      bluet: {
        userId: String(status.userId ?? userId),
        username: typeof status.username === 'string' ? status.username : '',
        baseUrl: config.bluet.baseUrl,
      },
      connectedAt: Date.now(),
    }
    await Storage.set(STORAGE_KEY_BRIDGE, bridgeData)

    console.log(LOG_PREFIX, `Connected as @${bridgeData.bluet.username || '(unknown)'}`)
    return { success: true }
  }

  /**
   * Disconnect from Bluet.
   * Notifies Bluet API (which revokes the bridge on every device), then removes
   * the local token and the synced shared refs.
   */
  static async disconnect(): Promise<void> {
    const token = await this.getToken()
    if (token) {
      try {
        await fetch(`${config.bluet.baseUrl}${config.bluet.disconnectEndpoint}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          signal: timeoutSignal(),
        })
      } catch {
        // Best-effort: don't block disconnect if API is unreachable
      }
    }

    await this.clearLocalData()
    console.log(LOG_PREFIX, 'Disconnected from Bluet (bridge + shared refs cleared)')
  }

  // ==========================================================================
  // Sharing Operations
  // ==========================================================================

  /**
   * Share a TabGroup to Bluet.
   * Sharing a group that is already shared with no publishable tabs left clears its page.
   */
  static async shareTabGroup(group: TabGroup): Promise<BluetShareResult> {
    const token = await this.getToken()
    if (!token) return failure('not_connected', 'Not connected to Bluet')

    const { tabs, skipped } = toShareableTabs(group.tabs)
    if (tabs.length === 0 && !(await this.isShared(group.id))) {
      return failure('nothing_to_share', 'No shareable tabs in this group')
    }

    return this.postShare(token, {
      sourceId: group.id,
      type: 'tabgroup',
      name: group.name,
      clientSkipped: skipped,
      body: {
        type: 'tabgroup',
        data: { id: group.id, name: clampBluetTitle(group.name, 'Untitled group'), tabs },
      },
    })
  }

  /**
   * Share a Project (with all its groups) to Bluet.
   */
  static async shareProject(project: Project, groups: TabGroup[]): Promise<BluetShareResult> {
    const token = await this.getToken()
    if (!token) return failure('not_connected', 'Not connected to Bluet')

    let skipped = 0
    const projectGroups = groups
      .filter(g => g.projectId === project.id)
      .map(group => {
        const shareable = toShareableTabs(group.tabs)
        skipped += shareable.skipped
        return { id: group.id, name: clampBluetTitle(group.name, 'Untitled group'), tabs: shareable.tabs }
      })
      .filter(g => g.tabs.length > 0)
      .slice(0, BLUET_MAX_GROUPS_PER_PROJECT)

    if (projectGroups.length === 0 && !(await this.isShared(project.id))) {
      return failure('nothing_to_share', 'No shareable tabs in this project')
    }

    return this.postShare(token, {
      sourceId: project.id,
      type: 'project',
      name: project.name,
      clientSkipped: skipped,
      body: {
        type: 'project',
        data: { id: project.id, name: clampBluetTitle(project.name, 'Untitled project'), groups: projectGroups },
      },
    })
  }

  /**
   * Stop sharing: removes the page from bluet.in, then the local reference.
   * The reference is kept when Bluet could not be reached, so the heartbeat retries.
   */
  static async unshare(sourceId: string): Promise<BluetShareResult> {
    const refs = await this.getSharedRefs()
    const ref = refs.find(r => r.id === sourceId)
    if (!ref) return { success: true }

    const token = await this.getToken()
    if (!token) return failure('not_connected', 'Not connected to Bluet')

    try {
      const response = await fetch(`${config.bluet.baseUrl}${config.bluet.unshareEndpoint}`, {
        method: 'POST',
        headers: { ...(await this.bridgeHeaders(token)), 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: ref.type, id: ref.id }),
        signal: timeoutSignal(),
      })
      if (!response.ok) return this.handleApiError(response)
    } catch (error) {
      console.error(LOG_PREFIX, 'Unshare failed:', error)
      return networkFailure(error)
    }

    await this.removeSharedRef(sourceId)
    console.log(LOG_PREFIX, `Unshared ${sourceId}`)
    return { success: true }
  }

  // ==========================================================================
  // Status & References
  // ==========================================================================

  /**
   * Get bridge status from Bluet API. Also renews Bluet Pro from Bluetab Pro.
   */
  static async getStatus(): Promise<BluetBridgeStatus> {
    const token = await this.getToken()
    if (!token) {
      return { connected: false }
    }

    try {
      const response = await fetch(`${config.bluet.baseUrl}${config.bluet.statusEndpoint}`, {
        headers: await this.bridgeHeaders(token),
        signal: timeoutSignal(),
      })

      if (response.status === 401) {
        // Token expired or invalid — clear local token only (don't call API)
        await this.clearLocalData({ keepSharedRefs: true })
        return { connected: false }
      }
      if (!response.ok) {
        // 429/5xx: the connection itself is fine as far as we know
        return { connected: true, unreachable: true }
      }

      const data = await response.json()

      // Handle revocation (dashboard disconnect) — clear local data
      if (data.connected === false && data.reason === 'revoked') {
        console.log(LOG_PREFIX, 'Bridge revoked by Bluet dashboard, clearing local data')
        await this.clearLocalData()
        return { connected: false }
      }

      // Prune shared refs that no longer exist on Bluet (e.g. page deleted by user)
      if (Array.isArray(data.activeSourceRefs)) {
        const activeSet = new Set<string>(data.activeSourceRefs)
        const refs = await this.getSharedRefs()
        const stale = refs.filter(r => !activeSet.has(r.id))
        if (stale.length > 0) {
          const updated = refs.filter(r => activeSet.has(r.id))
          await Storage.set(STORAGE_KEY_SHARED_REFS, updated)
          console.log(LOG_PREFIX, `Pruned ${stale.length} stale shared ref(s):`, stale.map(r => r.id))
        }
      }

      if (typeof data.username === 'string' && data.username) {
        await this.updateUsername(data.username)
      }

      return {
        connected: true,
        username: data.username,
        totalPages: data.bridgePages,
        totalLinks: data.totalLinks,
        access: typeof data.access === 'boolean' ? data.access : undefined,
        accessReason: typeof data.accessReason === 'string' ? data.accessReason : undefined,
        bluetabPro: typeof data.bluetabPro === 'boolean' ? data.bluetabPro : undefined,
      }
    } catch {
      return { connected: true, unreachable: true }
    }
  }

  /**
   * Get all shared references.
   */
  static async getSharedRefs(): Promise<BluetSharedRef[]> {
    return (await Storage.get<BluetSharedRef[]>(STORAGE_KEY_SHARED_REFS)) || []
  }

  /**
   * Check if a specific TabGroup or Project is shared.
   */
  static async isShared(sourceId: string): Promise<boolean> {
    const refs = await this.getSharedRefs()
    return refs.some(r => r.id === sourceId)
  }

  // ==========================================================================
  // Auto Re-sync
  // ==========================================================================

  /**
   * Re-sync a group to Bluet if it's shared and this device is connected.
   * Called from the storage.onChanged hook when tabGroups change.
   * Returns null when nothing had to be done.
   */
  static async syncIfShared(groupId: string): Promise<BluetShareResult | null> {
    const refs = await this.getSharedRefs()
    const ref = refs.find(r => r.id === groupId)
    if (!ref) return null

    const token = await this.getToken()
    if (!token) {
      console.log(LOG_PREFIX, `Group ${groupId} is shared but no bridge token on this device, skipping re-sync`)
      return null
    }

    // Re-share the group (Bluet handles diff/update on same sourceId)
    if (ref.type === 'tabgroup') {
      const groups = await Storage.get<TabGroup[]>('groups')
      const group = groups?.find(g => g.id === groupId)
      if (!group) {
        console.log(LOG_PREFIX, `Shared group ${groupId} was deleted, unsharing`)
        return this.unshare(groupId)
      }
      const result = await this.shareTabGroup(group)
      if (result.success) console.log(LOG_PREFIX, `Auto re-synced TabGroup "${group.name}"`)
      return result
    }

    const projects = await Storage.get<Project[]>('projects')
    const project = projects?.find(p => p.id === groupId)
    if (!project) {
      console.log(LOG_PREFIX, `Shared project ${groupId} was deleted, unsharing`)
      return this.unshare(groupId)
    }
    const groups = await Storage.get<TabGroup[]>('groups') || []
    const result = await this.shareProject(project, groups)
    if (result.success) console.log(LOG_PREFIX, `Auto re-synced Project "${project.name}"`)
    return result
  }

  /**
   * Heartbeat catch-up: removes pages whose group/project was deleted and re-syncs
   * items changed since their last successful sync (e.g. after a failed auto re-sync).
   */
  static async reconcileSharedRefs(): Promise<void> {
    if (!(await this.isConnected())) return
    const refs = await this.getSharedRefs()
    if (refs.length === 0) return

    const groups = (await Storage.get<TabGroup[]>('groups')) || []
    const projects = (await Storage.get<Project[]>('projects')) || []

    for (const ref of refs) {
      let lastChange: number | null
      if (ref.type === 'tabgroup') {
        lastChange = groups.find(g => g.id === ref.id)?.modified ?? null
      } else {
        const project = projects.find(p => p.id === ref.id)
        lastChange = project
          ? Math.max(project.modified ?? 0, ...groups.filter(g => g.projectId === ref.id).map(g => g.modified ?? 0))
          : null
      }

      if (lastChange !== null && lastChange <= ref.lastSyncedAt) continue
      const result = await this.syncIfShared(ref.id)
      // Stop early on errors that will fail the rest too
      if (result && !result.success && result.code !== 'nothing_to_share' && result.code !== 'limit_exceeded') break
    }
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  /** Bearer token plus the Bluetab Pro assertion when one is available. */
  private static async bridgeHeaders(token: string): Promise<Record<string, string>> {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
    const assertion = await this.fetchEntitlementAssertion()
    if (assertion) headers[ASSERTION_HEADER] = assertion
    return headers
  }

  private static async postShare(
    token: string,
    share: {
      sourceId: string
      type: BluetSharedRef['type']
      name: string
      clientSkipped: number
      body: unknown
    },
  ): Promise<BluetShareResult> {
    try {
      const response = await fetch(`${config.bluet.baseUrl}${config.bluet.syncEndpoint}`, {
        method: 'POST',
        headers: { ...(await this.bridgeHeaders(token)), 'Content-Type': 'application/json' },
        body: JSON.stringify(share.body),
        signal: timeoutSignal(),
      })

      if (!response.ok) {
        return this.handleApiError(response)
      }

      const raw = await response.json()
      const serverSkipped = Array.isArray(raw.skipped) ? raw.skipped.length : 0

      // Normalize: a 2xx response IS success
      const result: BluetShareResult = {
        success: true,
        pageId: raw.pageId || raw.page?.id || raw.id,
        pageUrl: raw.pageUrl || raw.page?.url || raw.url || raw.slug,
        fullUrl: raw.fullUrl || raw.page?.fullUrl,
        linkCount: raw.linkCount ?? raw.links?.length ?? raw.totalLinks,
        groupCount: raw.groupCount ?? raw.groups?.length,
        skippedCount: share.clientSkipped + serverSkipped,
      }

      // Build fullUrl if not provided by API
      if (!result.fullUrl && result.pageUrl) {
        const base = result.pageUrl.startsWith('http') ? '' : config.bluet.baseUrl
        result.fullUrl = `${base}${result.pageUrl}`
      }
      if (!result.fullUrl) {
        const bridgeData = await this.getBridgeData()
        if (bridgeData?.bluet.username) {
          const slug = slugify(share.name)
          result.fullUrl = `${config.bluet.baseUrl}/${bridgeData.bluet.username}/${slug}`
          result.pageUrl = result.pageUrl || `/${bridgeData.bluet.username}/${slug}`
        }
      }

      const now = Date.now()
      await this.addSharedRef({
        id: share.sourceId,
        type: share.type,
        pageUrl: result.pageUrl || '',
        sharedAt: now,
        lastSyncedAt: now,
      })

      // Backfill username from pageUrl if missing (e.g. "/alexcreates/supertry" → "alexcreates")
      await this.backfillUsernameFromPageUrl(result.pageUrl)

      console.log(LOG_PREFIX, `Shared ${share.type} ${share.sourceId} → ${result.fullUrl}`)
      return result
    } catch (error) {
      console.error(LOG_PREFIX, `Share ${share.type} failed:`, error)
      return networkFailure(error)
    }
  }

  /**
   * Add or update a shared reference.
   */
  private static async addSharedRef(ref: BluetSharedRef): Promise<void> {
    const refs = await this.getSharedRefs()
    const existingIdx = refs.findIndex(r => r.id === ref.id)

    if (existingIdx >= 0) {
      // Update existing ref (keep original sharedAt)
      refs[existingIdx] = {
        ...ref,
        sharedAt: refs[existingIdx].sharedAt,
      }
    } else {
      refs.push(ref)
    }

    await Storage.set(STORAGE_KEY_SHARED_REFS, refs)
  }

  private static async removeSharedRef(sourceId: string): Promise<void> {
    const refs = await this.getSharedRefs()
    await Storage.set(STORAGE_KEY_SHARED_REFS, refs.filter(r => r.id !== sourceId))
  }

  private static async updateUsername(username: string): Promise<void> {
    const bridgeData = await this.getBridgeData()
    if (!bridgeData || bridgeData.bluet.username === username) return
    bridgeData.bluet.username = username
    await Storage.set(STORAGE_KEY_BRIDGE, bridgeData)
  }

  /**
   * Extract username from pageUrl (e.g. "/alexcreates/supertry" → "alexcreates")
   * and update bridge data if username was missing.
   */
  private static async backfillUsernameFromPageUrl(pageUrl?: string): Promise<void> {
    if (!pageUrl) return
    const bridgeData = await this.getBridgeData()
    if (!bridgeData || bridgeData.bluet.username) return

    const match = pageUrl.match(/^\/([^/]+)\//)
    if (match?.[1]) {
      bridgeData.bluet.username = match[1]
      await Storage.set(STORAGE_KEY_BRIDGE, bridgeData)
      console.log(LOG_PREFIX, `Username backfilled from pageUrl: @${match[1]}`)
    }
  }

  /** Maps a non-OK Bluet response to a result without side effects. */
  private static async readError(response: Response): Promise<BluetShareResult> {
    const body = (await response.json().catch(() => ({}))) as {
      error?: unknown
      code?: unknown
      retryAfter?: unknown
      bluetabAssertion?: unknown
    }
    const message = typeof body.error === 'string' ? body.error : `Bluet error ${response.status}`
    const code = typeof body.code === 'string' ? body.code : undefined

    if (response.status === 401) return failure('session_expired', 'Session expired. Please reconnect to Bluet.')
    if (code === 'bluetab_pro_required') {
      // The bridge is a Bluetab Pro feature; Bluet checks a fresh Supertry proof on every share.
      if (body.bluetabAssertion === 'linked_elsewhere') return failure('linked_elsewhere', message)
      if (response.status >= 500) {
        const retryAfterMs = parseRetryAfterMs(response.headers.get('Retry-After'), body.retryAfter) ?? 60_000
        return failure('server_error', message, { retryable: true, retryAfterMs })
      }
      return failure('bluetab_pro_required', message)
    }
    if (response.status === 403 && code === 'revoked') {
      return failure('revoked', 'This Bluet connection was disconnected. Please reconnect.')
    }
    if (response.status === 403) return failure('subscription_required', message)
    if (response.status === 429) {
      const retryAfterMs = parseRetryAfterMs(response.headers.get('Retry-After'), body.retryAfter) ?? 60_000
      return failure('rate_limited', `Too many requests. Try again in ${Math.ceil(retryAfterMs / 1000)}s.`, {
        retryable: true,
        retryAfterMs,
      })
    }
    if (response.status === 413) return failure('payload_too_large', message)
    if (response.status >= 500) return failure('server_error', message, { retryable: true })
    if (code === 'limit_exceeded' || code === 'nothing_to_share' || code === 'invalid_payload') {
      return failure(code, message)
    }
    return failure('invalid_payload', message)
  }

  /**
   * Handle non-OK API responses: 401 drops the local token (no server call — the token
   * is already invalid), revocation drops the whole local bridge.
   */
  private static async handleApiError(response: Response): Promise<BluetShareResult> {
    const result = await this.readError(response)
    if (result.code === 'session_expired') {
      console.log(LOG_PREFIX, 'Token rejected by Bluet, clearing local token')
      await this.clearLocalData({ keepSharedRefs: true })
    } else if (result.code === 'revoked') {
      console.log(LOG_PREFIX, 'Bridge revoked by Bluet, clearing local data')
      await this.clearLocalData()
    }
    return result
  }
}

// ============================================================================
// Auto Re-sync Helpers (exported for service-worker)
// ============================================================================

/**
 * Debounce timers per shared group/project.
 */
const syncTimers = new Map<string, ReturnType<typeof setTimeout>>()

/** Waits before retrying a transient failure; later attempts are left to the heartbeat. */
export const BLUET_RETRY_DELAYS_MS = [5_000, 20_000] as const
/** Service workers sleep after ~30s idle; longer waits are left to the heartbeat. */
const MAX_RETRY_WAIT_MS = 25_000

/**
 * Debounced re-sync for a specific group.
 * Waits 3 seconds to batch rapid changes; retries network/5xx/429 failures twice.
 */
export function debouncedBluetSync(groupId: string, delayMs = 3000, attempt = 0): void {
  console.log(LOG_PREFIX, `Scheduling re-sync for ${groupId} (${delayMs}ms debounce)`)
  const existing = syncTimers.get(groupId)
  if (existing) clearTimeout(existing)

  syncTimers.set(groupId, setTimeout(() => {
    syncTimers.delete(groupId)
    console.log(LOG_PREFIX, `Executing re-sync for ${groupId}`)
    BluetBridgeService.syncIfShared(groupId)
      .then(result => {
        if (!result || result.success || !result.retryable) return
        if (attempt >= BLUET_RETRY_DELAYS_MS.length) return
        const wait = result.retryAfterMs ?? BLUET_RETRY_DELAYS_MS[attempt]
        if (wait > MAX_RETRY_WAIT_MS) return
        // A newer change may already have scheduled its own sync
        if (syncTimers.has(groupId)) return
        debouncedBluetSync(groupId, wait, attempt + 1)
      })
      .catch(err => {
        console.error(LOG_PREFIX, 'Debounced sync failed:', err)
      })
  }, delayMs))
}

/**
 * Find which group IDs changed between old and new tabGroups arrays.
 */
export function findChangedGroupIds(oldGroups: TabGroup[], newGroups: TabGroup[]): string[] {
  const changed: string[] = []

  for (const newGroup of newGroups) {
    const oldGroup = oldGroups.find(g => g.id === newGroup.id)

    if (!oldGroup) {
      // New group added — might be shared (e.g. via sync from another device)
      changed.push(newGroup.id)
      continue
    }

    // Check modified timestamp
    if (newGroup.modified !== oldGroup.modified) {
      changed.push(newGroup.id)
      continue
    }

    // Deep check: tab count change
    if (newGroup.tabs.length !== oldGroup.tabs.length) {
      changed.push(newGroup.id)
      continue
    }

    // Deep check: tab URLs changed
    const oldUrls = new Set(oldGroup.tabs.map(t => t.url))
    const newUrls = new Set(newGroup.tabs.map(t => t.url))
    if (oldUrls.size !== newUrls.size || [...newUrls].some(u => !oldUrls.has(u))) {
      changed.push(newGroup.id)
    }
  }

  // Deleted groups
  for (const oldGroup of oldGroups) {
    if (!newGroups.find(g => g.id === oldGroup.id)) {
      changed.push(oldGroup.id)
    }
  }

  return changed
}

/**
 * @module services/bluet-bridge-service
 *
 * WHY: Enable Bluetab users to share TabGroups/Projects to Bluet (bluet.in).
 *      Provides bridge connection management, sharing operations, and auto re-sync.
 *
 * WHAT: Provides BluetBridgeService class with static methods for:
 *       - Bridge connection (connect/disconnect via Bluet auth)
 *       - Sharing TabGroups and Projects to Bluet pages
 *       - Tracking shared references across devices
 *       - Auto re-sync when shared groups change
 *
 * HOW: Uses chrome.tabs for auth flow, fetch API for Bluet endpoints.
 *      Stores bridge token in chrome.storage.local (device-local).
 *      Stores shared refs in chrome.storage.local (synced via delta-tracker).
 *
 * NOT: Does not handle UI - use BluetConnectionSection and context menus for that.
 *      Does not handle Bluet server logic - that's already implemented.
 */

import { config } from '../config/config'
import { Storage } from '../utils/storage'
import type { TabGroup, Project } from '../types/models'
import type {
  BluetBridgeData,
  BluetSharedRef,
  BluetShareResult,
  BluetBridgeStatus,
} from '../types/bluet'
import { BLUET_FILTERED_URL_PREFIXES } from '../types/bluet'

// ============================================================================
// Constants
// ============================================================================

const STORAGE_KEY_BRIDGE = 'bluet_bridge'
const STORAGE_KEY_SHARED_REFS = 'bluet_shared_refs'
const LOG_PREFIX = '[BlueTab][BluetBridge]'

// ============================================================================
// Service
// ============================================================================

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
   * On expiry: clears local data only (does NOT call Bluet API).
   * Bluet's cron will unpublish stale pages separately.
   */
  static async getToken(): Promise<string | null> {
    const data = await this.getBridgeData()
    if (!data?.token) return null

    if (Date.now() >= data.tokenExpiresAt) {
      console.log(LOG_PREFIX, 'Token expired, clearing local bridge data (not calling API)')
      await this.clearLocalData()
      return null
    }

    return data.token
  }

  /**
   * Clear local bridge data without notifying Bluet API.
   * Used for token expiry and revocation (where API call is pointless).
   */
  static async clearLocalData(): Promise<void> {
    await Storage.remove(STORAGE_KEY_BRIDGE)
    await Storage.remove(STORAGE_KEY_SHARED_REFS)
    console.log(LOG_PREFIX, 'Local bridge data cleared')
  }

  /**
   * Open Bluet auth page so the user can get a bridge token.
   * The token is displayed on the page for the user to copy.
   */
  static async openAuthPage(): Promise<void> {
    const authUrl = `${config.bluet.baseUrl}${config.bluet.bridgeAuthPath}?bluetabPro=true`
    chrome.tabs.create({ url: authUrl })
  }

  /**
   * Connect using a manually pasted bridge token.
   * Decodes the JWT payload to extract userId and username.
   */
  static async connectWithToken(token: string): Promise<{ success: boolean; error?: string }> {
    const trimmed = token.trim()
    if (!trimmed) {
      return { success: false, error: 'Token is empty' }
    }

    // Decode JWT payload (middle segment)
    // JWT contains: { userId: number, scope: 'bridge', bluetabPro: boolean, iat, exp }
    // NOTE: username is NOT in JWT — must be fetched from /api/bridge/status
    try {
      const parts = trimmed.split('.')
      if (parts.length !== 3) {
        return { success: false, error: 'Invalid token format' }
      }

      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))

      const userId = String(payload.userId || payload.sub || '')
      if (!userId) {
        return { success: false, error: 'Token does not contain user info' }
      }

      // Check expiration from JWT
      const expMs = payload.exp ? payload.exp * 1000 : Date.now() + config.bluet.tokenLifetimeDays * 24 * 60 * 60 * 1000
      if (Date.now() >= expMs) {
        return { success: false, error: 'Token has expired' }
      }

      // Save bridge data with empty username first
      const bridgeData: BluetBridgeData = {
        token: trimmed,
        tokenExpiresAt: expMs,
        bluet: {
          userId,
          username: '',
          baseUrl: config.bluet.baseUrl,
        },
        connectedAt: Date.now(),
      }
      await Storage.set(STORAGE_KEY_BRIDGE, bridgeData)

      // Fetch username and stats from /api/bridge/status
      try {
        const statusRes = await fetch(`${config.bluet.baseUrl}${config.bluet.statusEndpoint}`, {
          headers: { 'Authorization': `Bearer ${trimmed}` },
        })
        if (statusRes.ok) {
          const data = await statusRes.json()
          bridgeData.bluet.username = data.username || ''
          bridgeData.bluet.userId = String(data.userId || userId)
          await Storage.set(STORAGE_KEY_BRIDGE, bridgeData)
        }
      } catch {
        console.log(LOG_PREFIX, 'Could not fetch status from API')
      }

      console.log(LOG_PREFIX, `Connected as @${bridgeData.bluet.username || '(unknown)'}`)
      return { success: true }
    } catch (error) {
      console.error(LOG_PREFIX, 'Failed to parse token:', error)
      return { success: false, error: 'Failed to parse token' }
    }
  }

  /**
   * Disconnect from Bluet.
   * Notifies Bluet API, then removes bridge data and shared refs.
   * Since both keys are synced, all devices will be disconnected.
   */
  static async disconnect(): Promise<void> {
    // Notify Bluet API before removing the token
    const token = await this.getToken()
    if (token) {
      try {
        await fetch(`${config.bluet.baseUrl}/api/bridge/disconnect`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
        })
      } catch {
        // Best-effort: don't block disconnect if API is unreachable
      }
    }

    await Storage.remove(STORAGE_KEY_BRIDGE)
    await Storage.remove(STORAGE_KEY_SHARED_REFS)
    console.log(LOG_PREFIX, 'Disconnected from Bluet (bridge + shared refs cleared)')
  }

  // ==========================================================================
  // Sharing Operations
  // ==========================================================================

  /**
   * Share a TabGroup to Bluet.
   */
  static async shareTabGroup(group: TabGroup): Promise<BluetShareResult> {
    const token = await this.getToken()
    if (!token) {
      return { success: false, error: 'Not connected to Bluet' }
    }

    const filteredTabs = group.tabs.filter(tab => !this.isFilteredUrl(tab.url))

    if (filteredTabs.length === 0) {
      return { success: false, error: 'No shareable tabs in this group' }
    }

    try {
      const response = await fetch(`${config.bluet.baseUrl}${config.bluet.syncEndpoint}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'tabgroup',
          data: {
            id: group.id,
            name: group.name,
            tabs: filteredTabs.map(tab => ({
              id: tab.id,
              url: tab.url,
              title: tab.title,
              favicon: tab.favicon,
            })),
          },
        }),
      })

      if (!response.ok) {
        return this.handleApiError(response)
      }

      const raw = await response.json()
      console.log(LOG_PREFIX, 'Share TabGroup API response:', JSON.stringify(raw))

      // Normalize: API may not return { success: true } — a 2xx response IS success
      const result: BluetShareResult = {
        success: true,
        pageId: raw.pageId || raw.page?.id || raw.id,
        pageUrl: raw.pageUrl || raw.page?.url || raw.url || raw.slug,
        fullUrl: raw.fullUrl || raw.page?.fullUrl,
        linkCount: raw.linkCount ?? raw.links?.length ?? raw.totalLinks,
        groupCount: raw.groupCount,
      }

      // Build fullUrl if not provided by API
      if (!result.fullUrl && result.pageUrl) {
        const base = result.pageUrl.startsWith('http') ? '' : config.bluet.baseUrl
        result.fullUrl = `${base}${result.pageUrl}`
      }
      if (!result.fullUrl) {
        const bridgeData = await this.getBridgeData()
        if (bridgeData?.bluet.username) {
          const slug = group.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
          result.fullUrl = `${config.bluet.baseUrl}/${bridgeData.bluet.username}/${slug}`
          result.pageUrl = result.pageUrl || `/${bridgeData.bluet.username}/${slug}`
        }
      }

      // Save shared ref
      await this.addSharedRef({
        id: group.id,
        type: 'tabgroup',
        pageUrl: result.pageUrl || '',
        sharedAt: Date.now(),
        lastSyncedAt: Date.now(),
      })

      // Backfill username from pageUrl if missing (e.g. "/alexcreates/supertry" → "alexcreates")
      await this.backfillUsernameFromPageUrl(result.pageUrl)

      console.log(LOG_PREFIX, `Shared TabGroup "${group.name}" → ${result.fullUrl}`)
      return result
    } catch (error) {
      console.error(LOG_PREFIX, 'Share TabGroup failed:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Network error' }
    }
  }

  /**
   * Share a Project (with all its groups) to Bluet.
   */
  static async shareProject(project: Project, groups: TabGroup[]): Promise<BluetShareResult> {
    const token = await this.getToken()
    if (!token) {
      return { success: false, error: 'Not connected to Bluet' }
    }

    const projectGroups = groups
      .filter(g => g.projectId === project.id)
      .map(group => ({
        id: group.id,
        name: group.name,
        tabs: group.tabs
          .filter(tab => !this.isFilteredUrl(tab.url))
          .map(tab => ({
            id: tab.id,
            url: tab.url,
            title: tab.title,
            favicon: tab.favicon,
          })),
      }))
      .filter(g => g.tabs.length > 0)

    if (projectGroups.length === 0) {
      return { success: false, error: 'No shareable tabs in this project' }
    }

    try {
      const response = await fetch(`${config.bluet.baseUrl}${config.bluet.syncEndpoint}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'project',
          data: {
            id: project.id,
            name: project.name,
            groups: projectGroups,
          },
        }),
      })

      if (!response.ok) {
        return this.handleApiError(response)
      }

      const raw = await response.json()
      console.log(LOG_PREFIX, 'Share Project API response:', JSON.stringify(raw))

      // Normalize: API may not return { success: true } — a 2xx response IS success
      const result: BluetShareResult = {
        success: true,
        pageId: raw.pageId || raw.page?.id || raw.id,
        pageUrl: raw.pageUrl || raw.page?.url || raw.url || raw.slug,
        fullUrl: raw.fullUrl || raw.page?.fullUrl,
        linkCount: raw.linkCount ?? raw.links?.length ?? raw.totalLinks,
        groupCount: raw.groupCount ?? raw.groups?.length,
      }

      // Build fullUrl if not provided by API
      if (!result.fullUrl && result.pageUrl) {
        const base = result.pageUrl.startsWith('http') ? '' : config.bluet.baseUrl
        result.fullUrl = `${base}${result.pageUrl}`
      }
      if (!result.fullUrl) {
        const bridgeData = await this.getBridgeData()
        if (bridgeData?.bluet.username) {
          const slug = project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
          result.fullUrl = `${config.bluet.baseUrl}/${bridgeData.bluet.username}/${slug}`
          result.pageUrl = result.pageUrl || `/${bridgeData.bluet.username}/${slug}`
        }
      }

      // Save shared ref
      await this.addSharedRef({
        id: project.id,
        type: 'project',
        pageUrl: result.pageUrl || '',
        sharedAt: Date.now(),
        lastSyncedAt: Date.now(),
      })

      await this.backfillUsernameFromPageUrl(result.pageUrl)

      console.log(LOG_PREFIX, `Shared Project "${project.name}" → ${result.fullUrl}`)
      return result
    } catch (error) {
      console.error(LOG_PREFIX, 'Share Project failed:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Network error' }
    }
  }

  /**
   * Remove a shared reference (stop tracking, Bluet page remains).
   */
  static async unshare(sourceId: string): Promise<void> {
    const refs = await this.getSharedRefs()
    const updated = refs.filter(r => r.id !== sourceId)
    await Storage.set(STORAGE_KEY_SHARED_REFS, updated)
    console.log(LOG_PREFIX, `Unshared ${sourceId}`)
  }

  // ==========================================================================
  // Status & References
  // ==========================================================================

  /**
   * Get bridge status from Bluet API.
   */
  static async getStatus(): Promise<BluetBridgeStatus> {
    const token = await this.getToken()
    if (!token) {
      return { connected: false }
    }

    try {
      const response = await fetch(`${config.bluet.baseUrl}${config.bluet.statusEndpoint}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      if (!response.ok) {
        if (response.status === 401) {
          // Token expired or invalid — clear local data only (don't call API)
          await this.clearLocalData()
          return { connected: false }
        }
        return { connected: false }
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

      return {
        connected: true,
        username: data.username,
        totalPages: data.bridgePages,
        totalLinks: data.totalLinks,
      }
    } catch {
      return { connected: false }
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
   */
  static async syncIfShared(groupId: string): Promise<void> {
    const refs = await this.getSharedRefs()
    const ref = refs.find(r => r.id === groupId)
    if (!ref) return

    const token = await this.getToken()
    if (!token) {
      console.log(LOG_PREFIX, `Group ${groupId} is shared but no bridge token on this device, skipping re-sync`)
      return
    }

    // Re-share the group (Bluet handles diff/update on same sourceId)
    if (ref.type === 'tabgroup') {
      const groups = await Storage.get<TabGroup[]>('groups')
      const group = groups?.find(g => g.id === groupId)
      if (!group) {
        console.log(LOG_PREFIX, `Shared group ${groupId} was deleted, unsharing`)
        await this.unshare(groupId)
        return
      }
      const result = await this.shareTabGroup(group)
      if (result.success) {
        console.log(LOG_PREFIX, `Auto re-synced TabGroup "${group.name}"`)
      }
    } else if (ref.type === 'project') {
      const projects = await Storage.get<Project[]>('projects')
      const project = projects?.find(p => p.id === groupId)
      if (!project) {
        console.log(LOG_PREFIX, `Shared project ${groupId} was deleted, unsharing`)
        await this.unshare(groupId)
        return
      }
      const groups = await Storage.get<TabGroup[]>('groups') || []
      const result = await this.shareProject(project, groups)
      if (result.success) {
        console.log(LOG_PREFIX, `Auto re-synced Project "${project.name}"`)
      }
    }
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

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

  /**
   * Check if a URL should be filtered out from sharing.
   */
  private static isFilteredUrl(url: string): boolean {
    return BLUET_FILTERED_URL_PREFIXES.some(prefix => url.startsWith(prefix))
  }

  /**
   * Extract username from pageUrl (e.g. "/alexcreates/supertry" → "alexcreates")
   * and update bridge data if username was missing.
   */
  private static async backfillUsernameFromPageUrl(pageUrl?: string): Promise<void> {
    if (!pageUrl) return
    const bridgeData = await this.getBridgeData()
    if (!bridgeData || bridgeData.bluet.username) return

    // Extract username: first path segment after leading slash
    const match = pageUrl.match(/^\/([^/]+)\//)
    if (match?.[1]) {
      bridgeData.bluet.username = match[1]
      await Storage.set(STORAGE_KEY_BRIDGE, bridgeData)
      console.log(LOG_PREFIX, `Username backfilled from pageUrl: @${match[1]}`)
    }
  }

  /**
   * Handle non-OK API responses.
   */
  private static async handleApiError(response: Response): Promise<BluetShareResult> {
    const errorData = await response.json().catch(() => ({}))
    const error = errorData.error || `API error: ${response.status}`

    if (response.status === 401) {
      console.log(LOG_PREFIX, 'Token invalid, disconnecting')
      await this.disconnect()
      return { success: false, error: 'Session expired. Please reconnect to Bluet.' }
    }

    if (response.status === 429) {
      const retryAfter = errorData.retryAfter || 60
      return { success: false, error: `Rate limit exceeded. Try again in ${retryAfter}s.` }
    }

    return { success: false, error }
  }
}

// ============================================================================
// Auto Re-sync Helpers (exported for service-worker)
// ============================================================================

/**
 * Debounce timers per shared group/project.
 */
const syncTimers = new Map<string, ReturnType<typeof setTimeout>>()

/**
 * Debounced re-sync for a specific group.
 * Waits 3 seconds to batch rapid changes.
 */
export function debouncedBluetSync(groupId: string, delayMs = 3000): void {
  console.log(LOG_PREFIX, `Scheduling re-sync for ${groupId} (${delayMs}ms debounce)`)
  const existing = syncTimers.get(groupId)
  if (existing) clearTimeout(existing)

  syncTimers.set(groupId, setTimeout(() => {
    syncTimers.delete(groupId)
    console.log(LOG_PREFIX, `Executing re-sync for ${groupId}`)
    BluetBridgeService.syncIfShared(groupId).catch(err => {
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

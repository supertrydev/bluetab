import { config } from '@/config/config'
import { AIAllowanceService } from '@/services/ai-allowance-service'
import { getAccessToken } from '@/utils/auth-state'
import { Storage } from '../utils/storage'
import type { TabGroup, TabItem } from '../types/models'

export const ORGANIZE_BATCH_LIMIT = 500
const MAX_ORGANIZE_TIMEOUT_MS = 60_000

export interface OrganizeBucketSegment {
  group: TabGroup
  tabs: TabItem[]
  startIndex: number
  isPartial: boolean
}

export interface OrganizeBucketBatch {
  segments: OrganizeBucketSegment[]
  totalTabs: number
}

export interface OrganizeBatchTab {
  id: number
  title: string
  url: string
  sourceGroupName: string
  sourceGroupId: string
  sourceTabId: string
}

export interface OrganizeBatchRequest {
  projectId: string | null
  batchIndex: number
  totalBatches: number
  seedCategories?: string[]
  tabs: OrganizeBatchTab[]
}

export interface OrganizeBatchResponse {
  categories: Array<{ name: string; tabIds: number[] }>
}

export interface OrganizeProgress {
  phase: 'analyzing' | 'organizing' | 'applying'
  bucketIndex: number
  totalBuckets: number
  batchIndex: number
  totalBatches: number
  projectId: string | null
}

export interface OrganizeSnapshotOptions {
  now?: number
  organizeBatch: (request: OrganizeBatchRequest) => Promise<OrganizeBatchResponse>
  onProgress?: (progress: OrganizeProgress) => void
}

export interface OrganizeSnapshotResult {
  groups: TabGroup[]
  skippedLockedGroupCount: number
  organizedTabCount: number
  batchCount: number
  createdGroupCount: number
  createdCategoryNames: string[]
  fallbackGroupCount: number
  fallbackTabCount: number
}

export interface OrganizePreview {
  eligibleGroupCount: number
  eligibleTabCount: number
  skippedLockedGroupCount: number
  batchCount: number
  bucketCount: number
}

export class AIGroupOrganizerError extends Error {
  constructor(
    public readonly code:
      | 'auth_required'
      | 'allowance_exhausted'
      | 'rate_limited'
      | 'network_error'
      | 'backend_error'
      | 'empty_result',
    message: string,
  ) {
    super(message)
    this.name = 'AIGroupOrganizerError'
  }
}

function generateId(): string {
  const randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto)
  if (randomUUID) return randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function normalizeCategoryName(name: string): string {
  const trimmed = name.trim()
  return trimmed.length > 0 ? trimmed : 'Untitled'
}

function normalizeCategoryKey(name: string): string {
  return normalizeCategoryName(name).toLocaleLowerCase()
}

export function buildOrganizeBuckets(
  groups: TabGroup[],
  maxTabs: number = ORGANIZE_BATCH_LIMIT,
): OrganizeBucketBatch[] {
  const batches: OrganizeBucketBatch[] = []
  let current: OrganizeBucketBatch = { segments: [], totalTabs: 0 }

  const flushCurrent = () => {
    if (current.totalTabs === 0) return
    batches.push(current)
    current = { segments: [], totalTabs: 0 }
  }

  for (const group of groups) {
    const tabs = group.tabs ?? []
    if (tabs.length === 0) continue

    if (tabs.length > maxTabs) {
      flushCurrent()
      for (let startIndex = 0; startIndex < tabs.length; startIndex += maxTabs) {
        const slice = tabs.slice(startIndex, startIndex + maxTabs)
        batches.push({
          segments: [{
            group,
            tabs: slice,
            startIndex,
            isPartial: true,
          }],
          totalTabs: slice.length,
        })
      }
      continue
    }

    if (current.totalTabs > 0 && current.totalTabs + tabs.length > maxTabs) {
      flushCurrent()
    }

    current.segments.push({
      group,
      tabs,
      startIndex: 0,
      isPartial: false,
    })
    current.totalTabs += tabs.length
  }

  flushCurrent()
  return batches
}

function splitByProject(groups: TabGroup[]): Map<string | null, TabGroup[]> {
  const buckets = new Map<string | null, TabGroup[]>()

  for (const group of groups) {
    const key = group.projectId ?? null
    const current = buckets.get(key)
    if (current) {
      current.push(group)
    } else {
      buckets.set(key, [group])
    }
  }

  return buckets
}

export function summarizeOrganizeScope(groups: TabGroup[]): OrganizePreview {
  const eligibleGroups = groups.filter((group) => group.locked !== true && (group.tabs?.length ?? 0) > 0)
  const bucketCount = splitByProject(eligibleGroups).size
  const batchCount = Array.from(splitByProject(eligibleGroups).values())
    .reduce((total, bucketGroups) => total + buildOrganizeBuckets(bucketGroups).length, 0)

  return {
    eligibleGroupCount: eligibleGroups.length,
    eligibleTabCount: eligibleGroups.reduce((total, group) => total + (group.tabs?.length ?? 0), 0),
    skippedLockedGroupCount: groups.filter((group) => group.locked === true).length,
    batchCount,
    bucketCount,
  }
}

export async function organizeGroupsSnapshot(
  groups: TabGroup[],
  {
    now = Date.now(),
    organizeBatch,
    onProgress,
  }: OrganizeSnapshotOptions,
): Promise<OrganizeSnapshotResult> {
  const preservedGroups = groups.filter((group) => group.locked === true)
  const eligibleGroups = groups.filter((group) => group.locked !== true && (group.tabs?.length ?? 0) > 0)
  const projectBuckets = Array.from(splitByProject(eligibleGroups).entries())
  const createdGroups: TabGroup[] = []
  const fallbackGroupsBySourceId = new Map<string, TabGroup>()
  let organizedTabCount = 0
  let totalBatchCount = 0

  onProgress?.({
    phase: 'analyzing',
    bucketIndex: 0,
    totalBuckets: projectBuckets.length,
    batchIndex: 0,
    totalBatches: 0,
    projectId: null,
  })

  for (const [bucketIndex, [projectId, bucketGroups]] of projectBuckets.entries()) {
    const batches = buildOrganizeBuckets(bucketGroups)
    const bucketGroupsByName = new Map<string, TabGroup>()
    let seedCategories: string[] = []
    totalBatchCount += batches.length

    for (const [batchIndex, batch] of batches.entries()) {
      onProgress?.({
        phase: 'organizing',
        bucketIndex: bucketIndex + 1,
        totalBuckets: projectBuckets.length,
        batchIndex: batchIndex + 1,
        totalBatches: batches.length,
        projectId,
      })

      const batchTabs: OrganizeBatchTab[] = []
      let nextId = 0
      for (const segment of batch.segments) {
        for (const tab of segment.tabs) {
          batchTabs.push({
            id: nextId++,
            title: tab.title,
            url: tab.url,
            sourceGroupName: segment.group.name,
            sourceGroupId: segment.group.id,
            sourceTabId: tab.id,
          })
        }
      }

      const response = await organizeBatch({
        projectId,
        batchIndex: batchIndex + 1,
        totalBatches: batches.length,
        seedCategories,
        tabs: batchTabs,
      })

      const byId = new Map<number, TabItem>()
      for (const segment of batch.segments) {
        for (const tab of segment.tabs) {
          const next = batchTabs.find((item) => item.sourceTabId === tab.id && item.sourceGroupId === segment.group.id)
          if (next) byId.set(next.id, tab)
        }
      }

      const assigned = new Set<string>()
      const nextSeeds: string[] = []
      const sourceTabsById = new Map<string, { tab: TabItem; sourceGroup: TabGroup }>()
      for (const segment of batch.segments) {
        for (const tab of segment.tabs) {
          sourceTabsById.set(`${segment.group.id}:${tab.id}`, { tab, sourceGroup: segment.group })
        }
      }

      for (const category of response.categories) {
        const normalizedName = normalizeCategoryName(category.name)
        const normalizedKey = normalizeCategoryKey(normalizedName)
        nextSeeds.push(normalizedName)

        let targetGroup = bucketGroupsByName.get(normalizedKey)
        if (!targetGroup) {
          targetGroup = {
            id: generateId(),
            name: normalizedName,
            tabs: [],
            created: now,
            modified: now,
            ...(projectId ? { projectId } : {}),
          }
          bucketGroupsByName.set(normalizedKey, targetGroup)
          createdGroups.push(targetGroup)
        }

        for (const tabId of category.tabIds) {
          const tab = byId.get(tabId)
          if (!tab) continue
          const dedupeKey = `${tab.id}:${tab.url}`
          if (assigned.has(dedupeKey)) continue
          assigned.add(dedupeKey)
          targetGroup.tabs.push({ ...tab, groupId: targetGroup.id })
          targetGroup.modified = now
          organizedTabCount += 1
        }
      }

      for (const { tab, sourceGroup } of sourceTabsById.values()) {
        if (assigned.has(`${tab.id}:${tab.url}`)) continue

        let fallbackGroup = fallbackGroupsBySourceId.get(sourceGroup.id)
        if (!fallbackGroup) {
          fallbackGroup = {
            ...sourceGroup,
            tabs: [],
            modified: now,
          }
          fallbackGroupsBySourceId.set(sourceGroup.id, fallbackGroup)
        }

        fallbackGroup.tabs.push({ ...tab, groupId: fallbackGroup.id })
        fallbackGroup.modified = now
      }

      seedCategories = Array.from(new Set([...seedCategories, ...nextSeeds]))
    }
  }

  onProgress?.({
    phase: 'applying',
    bucketIndex: projectBuckets.length,
    totalBuckets: projectBuckets.length,
    batchIndex: totalBatchCount,
    totalBatches: totalBatchCount,
    projectId: null,
  })

  return {
    groups: [
      ...preservedGroups,
      ...createdGroups.filter((group) => group.tabs.length > 0),
      ...Array.from(fallbackGroupsBySourceId.values()).filter((group) => group.tabs.length > 0),
    ],
    skippedLockedGroupCount: preservedGroups.length,
    organizedTabCount,
    batchCount: totalBatchCount,
    createdGroupCount: createdGroups.filter((group) => group.tabs.length > 0).length,
    createdCategoryNames: createdGroups
      .filter((group) => group.tabs.length > 0)
      .map((group) => group.name),
    fallbackGroupCount: Array.from(fallbackGroupsBySourceId.values()).filter((group) => group.tabs.length > 0).length,
    fallbackTabCount: Array.from(fallbackGroupsBySourceId.values()).reduce(
      (total, group) => total + group.tabs.length,
      0,
    ),
  }
}

export async function runAtomicGroupOrganize(
  options: OrganizeSnapshotOptions,
): Promise<OrganizeSnapshotResult> {
  const groups = (await Storage.get<TabGroup[]>('groups')) ?? []
  const result = await organizeGroupsSnapshot(groups, options)
  await Storage.set('groups', result.groups)
  return result
}

function mapOrganizeApiError(
  response: Response,
  payload: { error?: string; message?: string; retryAfter?: number } | null,
): AIGroupOrganizerError {
  if (response.status === 401) {
    return new AIGroupOrganizerError('auth_required', 'Sign in again to organize your groups.')
  }

  if (response.status === 429 && payload?.error === 'token_cap_exceeded') {
    return new AIGroupOrganizerError('allowance_exhausted', 'Your AI allowance is used up for this billing period.')
  }

  if (response.status === 429) {
    return new AIGroupOrganizerError('rate_limited', 'AI organize is temporarily rate-limited. Please try again shortly.')
  }

  return new AIGroupOrganizerError(
    'backend_error',
    payload?.message?.trim() || payload?.error?.trim() || `Organize request failed (${response.status}).`,
  )
}

export class AIGroupOrganizerService {
  static async getPreview(): Promise<OrganizePreview> {
    const groups = (await Storage.get<TabGroup[]>('groups')) ?? []
    return summarizeOrganizeScope(groups)
  }

  static summarizeGroups(groups: TabGroup[]): OrganizePreview {
    return summarizeOrganizeScope(groups)
  }

  static async organizeSavedGroups(options: {
    now?: number
    onProgress?: (progress: OrganizeProgress) => void
  } = {}): Promise<OrganizeSnapshotResult> {
    const token = await getAccessToken()
    if (!token) {
      throw new AIGroupOrganizerError('auth_required', 'Sign in again to organize your groups.')
    }

    const result = await runAtomicGroupOrganize({
      now: options.now,
      onProgress: options.onProgress,
      organizeBatch: async ({ tabs, seedCategories, projectId, batchIndex, totalBatches }) => {
        let response: Response

        try {
          response = await fetch(`${config.supertry.apiUrl}${config.ai.organizeEndpoint}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              projectId,
              batchIndex,
              totalBatches,
              seedCategories,
              tabs: tabs.map((tab) => ({
                id: tab.id,
                title: tab.title.slice(0, 160),
                url: tab.url,
                sourceGroupName: tab.sourceGroupName.slice(0, 120),
              })),
            }),
            signal: AbortSignal.timeout(MAX_ORGANIZE_TIMEOUT_MS),
          })
        } catch (error) {
          throw new AIGroupOrganizerError(
            'network_error',
            `Organize request failed: ${error instanceof Error ? error.message : String(error)}`,
          )
        }

        await AIAllowanceService.syncFromAIResponse(response)

        if (!response.ok) {
          const payload = await response.clone().json().catch(() => null) as {
            error?: string
            message?: string
            retryAfter?: number
          } | null
          throw mapOrganizeApiError(response, payload)
        }

        const data = await response.json().catch(() => null) as OrganizeBatchResponse | null
        if (!data || !Array.isArray(data.categories) || data.categories.length === 0) {
          throw new AIGroupOrganizerError('empty_result', 'Organize returned no categories.')
        }

        return data
      },
    })

    return result
  }
}

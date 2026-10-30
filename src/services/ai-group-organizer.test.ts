import { Storage } from '../utils/storage'
import type { TabGroup, TabItem } from '../types/models'
import {
  buildOrganizeBuckets,
  organizeGroupsSnapshot,
  runAtomicGroupOrganize,
} from './ai-group-organizer'

jest.mock('../utils/storage', () => ({
  Storage: {
    get: jest.fn(),
    set: jest.fn(),
  },
}))

function makeTab(id: string, url: string, title: string = url): TabItem {
  return {
    id,
    url,
    title,
    timestamp: 1,
    groupId: 'placeholder',
  }
}

function makeGroup(
  id: string,
  name: string,
  tabs: TabItem[],
  overrides: Partial<TabGroup> = {},
): TabGroup {
  return {
    id,
    name,
    tabs: tabs.map((tab) => ({ ...tab, groupId: id })),
    created: 1,
    modified: 1,
    ...overrides,
  }
}

describe('buildOrganizeBuckets', () => {
  it('keeps groups whole when possible and only splits oversized groups', () => {
    const bucket = buildOrganizeBuckets([
      makeGroup('g1', 'One', Array.from({ length: 300 }, (_, i) => makeTab(`a-${i}`, `https://a${i}.example.com`))),
      makeGroup('g2', 'Two', Array.from({ length: 300 }, (_, i) => makeTab(`b-${i}`, `https://b${i}.example.com`))),
      makeGroup('g3', 'Huge', Array.from({ length: 620 }, (_, i) => makeTab(`c-${i}`, `https://c${i}.example.com`))),
    ])

    expect(bucket.map((batch) => batch.totalTabs)).toEqual([300, 300, 500, 120])
    expect(bucket[0].segments).toHaveLength(1)
    expect(bucket[1].segments).toHaveLength(1)
    expect(bucket[2].segments[0].isPartial).toBe(true)
    expect(bucket[3].segments[0].isPartial).toBe(true)
  })
})

describe('organizeGroupsSnapshot', () => {
  it('skips locked groups, preserves project boundaries, and forwards seed categories across batches', async () => {
    const locked = makeGroup('locked', 'Locked', [makeTab('l1', 'https://locked.example.com')], {
      locked: true,
      projectId: 'project-a',
      color: '#fff',
    })
    const projectOne = makeGroup('p1', 'Project A', Array.from({ length: 300 }, (_, i) => makeTab(`p1-${i}`, `https://proj-a-${i}.example.com`)), {
      projectId: 'project-a',
    })
    const projectTwo = makeGroup('p2', 'Project B', Array.from({ length: 260 }, (_, i) => makeTab(`p2-${i}`, `https://proj-b-${i}.example.com`)), {
      projectId: 'project-a',
    })
    const unassigned = makeGroup('u1', 'Inbox', [makeTab('u-tab', 'https://solo.example.com')])

    const calls: Array<{
      tabCount: number
      seedCategories: string[]
      projectId: string | null
      sourceGroupNames: string[]
    }> = []
    const result = await organizeGroupsSnapshot([locked, projectOne, projectTwo, unassigned], {
      now: 42,
      organizeBatch: async ({ tabs, seedCategories, projectId }) => {
        calls.push({
          tabCount: tabs.length,
          seedCategories: seedCategories ?? [],
          projectId,
          sourceGroupNames: Array.from(new Set(tabs.map((tab) => tab.sourceGroupName))).sort(),
        })
        return {
          categories: [
            {
              name: projectId === 'project-a' ? 'Research' : 'Inbox',
              tabIds: tabs.map((tab) => tab.id),
            },
          ],
        }
      },
    })

    expect(result.skippedLockedGroupCount).toBe(1)
    expect(calls).toEqual([
      { tabCount: 300, seedCategories: [], projectId: 'project-a', sourceGroupNames: ['Project A'] },
      { tabCount: 260, seedCategories: ['Research'], projectId: 'project-a', sourceGroupNames: ['Project B'] },
      { tabCount: 1, seedCategories: [], projectId: null, sourceGroupNames: ['Inbox'] },
    ])

    const lockedAfter = result.groups.find((group) => group.id === 'locked')
    expect(lockedAfter).toMatchObject({
      id: 'locked',
      locked: true,
      color: '#fff',
      projectId: 'project-a',
    })

    const projectGroups = result.groups.filter((group) => group.projectId === 'project-a' && !group.locked)
    expect(projectGroups.every((group) => group.name === 'Research')).toBe(true)
    expect(projectGroups.every((group) => group.locked !== true && group.projectId === 'project-a')).toBe(true)

    const unassignedGroups = result.groups.filter((group) => !group.projectId && group.id !== 'locked')
    expect(unassignedGroups).toHaveLength(1)
    expect(unassignedGroups[0].name).toBe('Inbox')
    expect(result.fallbackGroupCount).toBe(0)
    expect(result.fallbackTabCount).toBe(0)
  })
})

describe('runAtomicGroupOrganize', () => {
  const mockStorageGet = Storage.get as jest.MockedFunction<typeof Storage.get>
  const mockStorageSet = Storage.set as jest.MockedFunction<typeof Storage.set>

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('writes the final groups once after a successful run', async () => {
    mockStorageGet.mockResolvedValue([
      makeGroup('g1', 'One', [makeTab('t1', 'https://example.com')]),
    ] as never)
    mockStorageSet.mockResolvedValue(undefined)

    const result = await runAtomicGroupOrganize({
      now: 99,
      organizeBatch: async ({ tabs }) => ({
        categories: [{ name: 'Research', tabIds: tabs.map((tab) => tab.id) }],
      }),
    })

    expect(result.groups).toHaveLength(1)
    expect(mockStorageSet).toHaveBeenCalledTimes(1)
    expect(mockStorageSet).toHaveBeenCalledWith('groups', result.groups)
  })

  it('does not write storage when any batch fails', async () => {
    mockStorageGet.mockResolvedValue([
      makeGroup('g1', 'One', [makeTab('t1', 'https://example.com')]),
    ] as never)

    await expect(
      runAtomicGroupOrganize({
        organizeBatch: async () => {
          throw new Error('boom')
        },
      })
    ).rejects.toThrow('boom')

    expect(mockStorageSet).not.toHaveBeenCalled()
  })
})

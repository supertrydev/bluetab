import { getAccessToken, getAuthState } from '../utils/auth-state'
import { Storage } from '../utils/storage'
import type { TabGroup, TabItem } from '../types/models'
import {
  BluetBridgeService,
  clampBluetTitle,
  isShareableUrl,
  parseRetryAfterMs,
  toShareableTabs,
} from './bluet-bridge-service'

jest.mock('../utils/auth-state', () => ({
  getAuthState: jest.fn(),
  getAccessToken: jest.fn(),
}))

const store = new Map<string, unknown>()
jest.mock('../utils/storage', () => ({
  Storage: {
    get: jest.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    set: jest.fn(async (key: string, value: unknown) => {
      store.set(key, value)
    }),
    remove: jest.fn(async (key: string) => {
      store.delete(key)
    }),
  },
}))

const mockAuthState = getAuthState as jest.MockedFunction<typeof getAuthState>
const mockAccessToken = getAccessToken as jest.MockedFunction<typeof getAccessToken>
const fetchMock = jest.fn()

const NOW = 1_790_000_000_000

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'HS256' })}.${encode(payload)}.signature`
}

const TOKEN = jwt({ userId: 7, scope: 'bridge', exp: NOW / 1000 + 3600 })

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

function tab(id: string, url: string, title = `Tab ${id}`): TabItem {
  return { id, url, title } as TabItem
}

function group(id: string, tabs: TabItem[], extra: Partial<TabGroup> = {}): TabGroup {
  return { id, name: `Group ${id}`, tabs, created: NOW - 1000, modified: NOW - 1000, ...extra } as TabGroup
}

function connect() {
  store.set('bluet_bridge', {
    token: TOKEN,
    tokenExpiresAt: NOW + 3600_000,
    bluet: { userId: '7', username: 'emre', baseUrl: 'https://bluet.in' },
    connectedAt: NOW - 1000,
  })
}

function headersOf(call: unknown[]): Record<string, string> {
  return ((call[1] as RequestInit | undefined)?.headers ?? {}) as Record<string, string>
}

beforeEach(async () => {
  store.clear()
  fetchMock.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
  jest.spyOn(Date, 'now').mockReturnValue(NOW)
  mockAuthState.mockResolvedValue({ isPro: false } as never)
  mockAccessToken.mockResolvedValue('supertry-access')
  ;(globalThis as unknown as { chrome: { tabs: { create: jest.Mock } } }).chrome.tabs = { create: jest.fn() } as never
  await BluetBridgeService.clearLocalData() // also drops the cached assertion
  jest.mocked(Storage.set).mockClear()
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('pure helpers', () => {
  it('keeps only http(s) URLs', () => {
    expect(isShareableUrl('https://example.com')).toBe(true)
    expect(isShareableUrl('http://example.com/a')).toBe(true)
    expect(isShareableUrl('chrome://settings')).toBe(false)
    expect(isShareableUrl('file:///tmp/a.html')).toBe(false)
    expect(isShareableUrl('javascript:alert(1)')).toBe(false)
    expect(isShareableUrl('not a url')).toBe(false)
    expect(isShareableUrl(`https://example.com/${'a'.repeat(2100)}`)).toBe(false)
  })

  it('clamps titles to 80 characters and falls back to the URL', () => {
    expect(clampBluetTitle('  a \n  b ', 'x')).toBe('a b')
    expect(clampBluetTitle('', 'https://example.com')).toBe('https://example.com')
    const long = clampBluetTitle('x'.repeat(200), '')
    expect(long).toHaveLength(80)
    expect(long.endsWith('…')).toBe(true)
  })

  it('drops unsupported, duplicate and over-limit tabs and counts them', () => {
    const tabs = [
      tab('1', 'https://a.example', 'A'),
      tab('1', 'https://a.example', 'A again'),
      tab('2', 'chrome://newtab'),
      { ...tab('3', 'https://c.example'), favicon: 'data:image/png;base64,AAA' } as TabItem,
      { ...tab('4', 'https://d.example'), favicon: 'https://d.example/icon.png' } as TabItem,
    ]
    const result = toShareableTabs(tabs)
    expect(result.tabs.map(t => t.id)).toEqual(['1', '3', '4'])
    expect(result.tabs[1].favicon).toBeUndefined()
    expect(result.tabs[2].favicon).toBe('https://d.example/icon.png')
    expect(result.skipped).toBe(2)

    const many = Array.from({ length: 105 }, (_, i) => tab(String(i), `https://e.example/${i}`))
    expect(toShareableTabs(many)).toMatchObject({ skipped: 5 })
    expect(toShareableTabs(many).tabs).toHaveLength(100)
  })

  it('reads Retry-After as seconds or a date, then the body', () => {
    expect(parseRetryAfterMs('30', undefined)).toBe(30_000)
    expect(parseRetryAfterMs(new Date(NOW + 10_000).toUTCString(), undefined, NOW)).toBe(10_000)
    expect(parseRetryAfterMs(null, 12)).toBe(12_000)
    expect(parseRetryAfterMs(null, 'soon')).toBeUndefined()
  })
})

describe('Bluetab Pro assertion', () => {
  it('opens the auth page with the assertion in the URL fragment for Pro users', async () => {
    mockAuthState.mockResolvedValue({ isPro: true } as never)
    fetchMock.mockResolvedValueOnce(json(200, { assertion: 'signed.jwt.value', expiresAt: NOW / 1000 + 300 }))

    await BluetBridgeService.openAuthPage()

    expect(fetchMock).toHaveBeenCalledWith(
      'https://supertry.net/api/bluet/entitlement',
      expect.objectContaining({ method: 'POST', headers: { Authorization: 'Bearer supertry-access' } }),
    )
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'https://bluet.in/auth/bridge#bluetab=signed.jwt.value' })
  })

  it('opens the plain auth page when the user is not Pro or Supertry refuses', async () => {
    await BluetBridgeService.openAuthPage()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(chrome.tabs.create).toHaveBeenLastCalledWith({ url: 'https://bluet.in/auth/bridge' })

    mockAuthState.mockResolvedValue({ isPro: true } as never)
    fetchMock.mockResolvedValueOnce(json(403, { code: 'not_pro' }))
    await BluetBridgeService.openAuthPage()
    expect(chrome.tabs.create).toHaveBeenLastCalledWith({ url: 'https://bluet.in/auth/bridge' })
  })

  it('sends a cached assertion with status calls', async () => {
    connect()
    mockAuthState.mockResolvedValue({ isPro: true } as never)
    fetchMock
      .mockResolvedValueOnce(json(200, { assertion: 'proof', expiresAt: NOW / 1000 + 300 }))
      .mockResolvedValue(json(200, { connected: true, username: 'emre', access: true, bluetabPro: true, activeSourceRefs: [] }))

    const first = await BluetBridgeService.getStatus()
    await BluetBridgeService.getStatus()

    expect(first).toMatchObject({ connected: true, access: true, bluetabPro: true })
    const entitlementCalls = fetchMock.mock.calls.filter(c => String(c[0]).includes('/bluet/entitlement'))
    expect(entitlementCalls).toHaveLength(1)
    const statusCall = fetchMock.mock.calls.find(c => String(c[0]).endsWith('/api/bridge/status'))!
    expect(headersOf(statusCall)).toMatchObject({ Authorization: `Bearer ${TOKEN}`, 'X-Bluetab-Assertion': 'proof' })
  })
})

describe('connectWithToken', () => {
  it('stores the token only after Bluet accepts it', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { connected: true, userId: 7, username: 'emre' }))

    await expect(BluetBridgeService.connectWithToken(` ${TOKEN} `)).resolves.toEqual({ success: true })
    expect(store.get('bluet_bridge')).toMatchObject({ token: TOKEN, bluet: { userId: '7', username: 'emre' } })
  })

  it('does not store rejected, revoked, expired or unreachable tokens', async () => {
    fetchMock.mockResolvedValueOnce(json(401, { code: 'unauthorized' }))
    await expect(BluetBridgeService.connectWithToken(TOKEN)).resolves.toMatchObject({ success: false, code: 'invalid_token' })

    fetchMock.mockResolvedValueOnce(json(200, { connected: false, reason: 'revoked' }))
    await expect(BluetBridgeService.connectWithToken(TOKEN)).resolves.toMatchObject({ success: false, code: 'revoked' })

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(BluetBridgeService.connectWithToken(TOKEN)).resolves.toMatchObject({ success: false, code: 'network' })

    const expired = jwt({ userId: 7, exp: NOW / 1000 - 1 })
    await expect(BluetBridgeService.connectWithToken(expired)).resolves.toMatchObject({ success: false, code: 'token_expired' })
    await expect(BluetBridgeService.connectWithToken('garbage')).resolves.toMatchObject({ success: false, code: 'invalid_token' })

    expect(store.has('bluet_bridge')).toBe(false)
  })
})

describe('sharing', () => {
  it('sends only shareable tabs and reports skipped ones', async () => {
    connect()
    fetchMock.mockResolvedValueOnce(
      json(200, { success: true, pageId: 1, pageUrl: '/emre/group-g1', linkCount: 1, skipped: [{ tabId: 'x', reason: 'unsupported_url' }] }),
    )

    const result = await BluetBridgeService.shareTabGroup(
      group('g1', [tab('a', 'https://a.example', 'A'.repeat(120)), tab('b', 'chrome://extensions')]),
    )

    expect(result).toMatchObject({ success: true, fullUrl: 'https://bluet.in/emre/group-g1', skippedCount: 2 })
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(body.data.tabs).toHaveLength(1)
    expect(body.data.tabs[0].title).toHaveLength(80)
    expect(store.get('bluet_shared_refs')).toEqual([expect.objectContaining({ id: 'g1', type: 'tabgroup' })])
  })

  it('refuses a first share with nothing publishable but clears an existing share', async () => {
    connect()
    const empty = group('g1', [tab('b', 'chrome://extensions')])
    await expect(BluetBridgeService.shareTabGroup(empty)).resolves.toMatchObject({ success: false, code: 'nothing_to_share' })
    expect(fetchMock).not.toHaveBeenCalled()

    store.set('bluet_shared_refs', [{ id: 'g1', type: 'tabgroup', pageUrl: '/emre/g1', sharedAt: 1, lastSyncedAt: 1 }])
    fetchMock.mockResolvedValueOnce(json(200, { success: true, pageUrl: '/emre/g1', linkCount: 0 }))
    await expect(BluetBridgeService.shareTabGroup(empty)).resolves.toMatchObject({ success: true })
  })

  it('maps Bluet errors and only drops the token on 401', async () => {
    connect()
    store.set('bluet_shared_refs', [{ id: 'g1', type: 'tabgroup', pageUrl: '/emre/g1', sharedAt: 1, lastSyncedAt: 1 }])
    const g = group('g1', [tab('a', 'https://a.example')])

    fetchMock.mockResolvedValueOnce(json(403, { code: 'subscription_required', error: 'Bluet Pro is required.' }))
    const denied = await BluetBridgeService.shareTabGroup(g)
    expect(denied).toMatchObject({ code: 'subscription_required' })
    expect(denied.retryable).toBeFalsy()

    fetchMock.mockResolvedValueOnce(json(429, { code: 'rate_limited', retryAfter: 99 }, { 'Retry-After': '7' }))
    await expect(BluetBridgeService.shareTabGroup(g)).resolves.toMatchObject({ code: 'rate_limited', retryable: true, retryAfterMs: 7000 })

    fetchMock.mockResolvedValueOnce(json(500, { code: 'sync_failed', error: 'Sync failed' }))
    await expect(BluetBridgeService.shareTabGroup(g)).resolves.toMatchObject({ code: 'server_error', retryable: true })
    expect(store.has('bluet_bridge')).toBe(true)

    fetchMock.mockResolvedValueOnce(json(401, { code: 'unauthorized' }))
    await expect(BluetBridgeService.shareTabGroup(g)).resolves.toMatchObject({ code: 'session_expired' })
    expect(store.has('bluet_bridge')).toBe(false)
    expect(store.has('bluet_shared_refs')).toBe(true)
    // No server disconnect for an already invalid token
    expect(fetchMock.mock.calls.some(c => String(c[0]).includes('/disconnect'))).toBe(false)
  })

  it('maps "Bluetab Pro required" answers from Bluet', async () => {
    connect()
    store.set('bluet_shared_refs', [{ id: 'g1', type: 'tabgroup', pageUrl: '/emre/g1', sharedAt: 1, lastSyncedAt: 1 }])
    const g = group('g1', [tab('a', 'https://a.example')])

    fetchMock.mockResolvedValueOnce(json(403, { code: 'bluetab_pro_required', bluetabAssertion: 'missing', error: 'x' }))
    const required = await BluetBridgeService.shareTabGroup(g)
    expect(required).toMatchObject({ success: false, code: 'bluetab_pro_required' })
    expect(required.retryable).toBeFalsy()

    fetchMock.mockResolvedValueOnce(json(403, { code: 'bluetab_pro_required', bluetabAssertion: 'linked_elsewhere' }))
    await expect(BluetBridgeService.shareTabGroup(g)).resolves.toMatchObject({ code: 'linked_elsewhere' })

    fetchMock.mockResolvedValueOnce(
      json(503, { code: 'bluetab_pro_required', bluetabAssertion: 'unavailable' }, { 'Retry-After': '60' }),
    )
    await expect(BluetBridgeService.shareTabGroup(g)).resolves.toMatchObject({
      code: 'server_error',
      retryable: true,
      retryAfterMs: 60_000,
    })
    // None of these drop the connection
    expect(store.has('bluet_bridge')).toBe(true)
  })

  it('clears everything when the connection was revoked', async () => {
    connect()
    store.set('bluet_shared_refs', [{ id: 'g1', type: 'tabgroup', pageUrl: '/emre/g1', sharedAt: 1, lastSyncedAt: 1 }])
    fetchMock.mockResolvedValueOnce(json(403, { code: 'revoked', reason: 'revoked' }))

    await expect(
      BluetBridgeService.shareTabGroup(group('g1', [tab('a', 'https://a.example')])),
    ).resolves.toMatchObject({ code: 'revoked' })
    expect(store.has('bluet_bridge')).toBe(false)
    expect(store.has('bluet_shared_refs')).toBe(false)
  })

  it('reports network failures as retryable', async () => {
    connect()
    fetchMock.mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'))
    await expect(
      BluetBridgeService.shareTabGroup(group('g1', [tab('a', 'https://a.example')])),
    ).resolves.toMatchObject({ code: 'network', retryable: true })
  })
})

describe('unshare and reconcile', () => {
  it('removes the Bluet page before dropping the local reference', async () => {
    connect()
    store.set('bluet_shared_refs', [{ id: 'p1', type: 'project', pageUrl: '/emre/p1', sharedAt: 1, lastSyncedAt: 1 }])

    fetchMock.mockRejectedValueOnce(new TypeError('offline'))
    await expect(BluetBridgeService.unshare('p1')).resolves.toMatchObject({ success: false, code: 'network' })
    expect(store.get('bluet_shared_refs')).toHaveLength(1)

    fetchMock.mockResolvedValueOnce(json(200, { success: true, deleted: true }))
    await expect(BluetBridgeService.unshare('p1')).resolves.toEqual({ success: true })
    expect(store.get('bluet_shared_refs')).toEqual([])
    const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]
    expect(call[0]).toBe('https://bluet.in/api/bridge/unshare')
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({ type: 'project', id: 'p1' })
  })

  it('unshares deleted items and re-syncs items changed since their last sync', async () => {
    connect()
    store.set('groups', [
      group('changed', [tab('a', 'https://a.example')], { modified: NOW - 10 }),
      group('same', [tab('b', 'https://b.example')], { modified: NOW - 5000 }),
    ])
    store.set('projects', [])
    store.set('bluet_shared_refs', [
      { id: 'changed', type: 'tabgroup', pageUrl: '/emre/changed', sharedAt: 1, lastSyncedAt: NOW - 100 },
      { id: 'same', type: 'tabgroup', pageUrl: '/emre/same', sharedAt: 1, lastSyncedAt: NOW - 100 },
      { id: 'gone', type: 'tabgroup', pageUrl: '/emre/gone', sharedAt: 1, lastSyncedAt: NOW - 100 },
    ])
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith('/unshare') ? json(200, { success: true, deleted: true }) : json(200, { success: true, pageUrl: '/emre/changed' }),
    )

    await BluetBridgeService.reconcileSharedRefs()

    const urls = fetchMock.mock.calls.map(c => String(c[0]))
    expect(urls).toEqual(['https://bluet.in/api/bridge/sync', 'https://bluet.in/api/bridge/unshare'])
    expect((store.get('bluet_shared_refs') as Array<{ id: string }>).map(r => r.id)).toEqual(['changed', 'same'])
  })
})

describe('getStatus', () => {
  it('keeps the connection when Bluet is unreachable', async () => {
    connect()
    fetchMock.mockResolvedValueOnce(json(503, {}))
    await expect(BluetBridgeService.getStatus()).resolves.toEqual({ connected: true, unreachable: true })
    fetchMock.mockRejectedValueOnce(new TypeError('offline'))
    await expect(BluetBridgeService.getStatus()).resolves.toEqual({ connected: true, unreachable: true })
    expect(store.has('bluet_bridge')).toBe(true)
  })

  it('drops the token on 401 but keeps shared refs; revocation clears both', async () => {
    connect()
    store.set('bluet_shared_refs', [{ id: 'g1', type: 'tabgroup', pageUrl: '/x', sharedAt: 1, lastSyncedAt: 1 }])
    fetchMock.mockResolvedValueOnce(json(401, { code: 'unauthorized' }))
    await expect(BluetBridgeService.getStatus()).resolves.toEqual({ connected: false })
    expect(store.has('bluet_bridge')).toBe(false)
    expect(store.has('bluet_shared_refs')).toBe(true)

    connect()
    fetchMock.mockResolvedValueOnce(json(200, { connected: false, reason: 'revoked' }))
    await expect(BluetBridgeService.getStatus()).resolves.toEqual({ connected: false })
    expect(store.has('bluet_shared_refs')).toBe(false)
  })
})


describe('debouncedBluetSync', () => {
  it('retries transient failures twice, then leaves it to the heartbeat', async () => {
    jest.useFakeTimers()
    try {
      const { debouncedBluetSync } = await import('./bluet-bridge-service')
      const sync = jest
        .spyOn(BluetBridgeService, 'syncIfShared')
        .mockResolvedValue({ success: false, code: 'network', retryable: true })

      debouncedBluetSync('g1', 10)
      for (let i = 0; i < 4; i++) await jest.advanceTimersByTimeAsync(25_000)
      expect(sync).toHaveBeenCalledTimes(3)

      sync.mockClear()
      sync.mockResolvedValue({ success: false, code: 'subscription_required' })
      debouncedBluetSync('g2', 10)
      for (let i = 0; i < 3; i++) await jest.advanceTimersByTimeAsync(25_000)
      expect(sync).toHaveBeenCalledTimes(1)
    } finally {
      jest.useRealTimers()
    }
  })
})

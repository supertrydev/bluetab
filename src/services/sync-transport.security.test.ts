import * as AuthState from '@/utils/auth-state'
import { SyncTransport } from './sync-transport'

jest.mock('@/utils/auth-state', () => ({
  getAccessToken: jest.fn(),
}))

describe('SyncTransport credential boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    SyncTransport.disconnect()
    SyncTransport.configure({ apiBaseUrl: 'https://sync.example' })
    SyncTransport.setDeviceId('device-1')
    ;(AuthState.getAccessToken as jest.Mock).mockResolvedValue('session-secret')
  })

  afterEach(() => SyncTransport.disconnect())

  it('sends SSE credentials only in Authorization and never in the URL', async () => {
    const stream = new ReadableStream<Uint8Array>({ start() {} })
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(stream, { status: 200 }),
    )

    await expect(SyncTransport.connect()).resolves.toBe(true)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://sync.example/api/sync/events?deviceId=device-1')
    expect(String(url)).not.toContain('session-secret')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer session-secret')
    fetchMock.mockRestore()
  })

  it('parses default and named SSE events from the authenticated stream', async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(
          'data: {"type":"sync-required"}\n\n'
          + 'event: mcp-replay\ndata: {"type":"mcp-replay","clientId":"client-1"}\n\n',
        ))
      },
    })
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(stream, { status: 200 }))
    const received: unknown[] = []
    const unsubscribe = SyncTransport.onEvent((event) => received.push(event))

    await SyncTransport.connect()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(received).toEqual([
      { type: 'sync-required' },
      { type: 'mcp-replay', clientId: 'client-1' },
    ])
    unsubscribe()
    jest.restoreAllMocks()
  })

  it('retries with backoff when the event stream cannot be opened', async () => {
    jest.useFakeTimers()
    const fetchMock = jest.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(new Response(new ReadableStream<Uint8Array>({ start() {} }), { status: 200 }))

    await expect(SyncTransport.connect()).resolves.toBe(false)
    expect(SyncTransport.getConnectionState()).toBe('error')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await jest.advanceTimersByTimeAsync(1000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(SyncTransport.getConnectionState()).toBe('connected')

    fetchMock.mockRestore()
    jest.useRealTimers()
  })
})

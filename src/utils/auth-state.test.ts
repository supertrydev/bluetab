import { config } from '../config/config'
import type { StoredAuthData, SubscriptionStatus, User } from '../types/auth'
import * as AuthState from './auth-state'

const AUTH_SESSION_KEY = 'bluetab_auth_session_tokens'

const user: User = {
  id: 'user-1',
  email: 'emre@example.com',
  name: 'Emre',
  image: null,
  emailVerified: true,
  createdAt: '2026-05-31T00:00:00.000Z',
}

const subscription: SubscriptionStatus = {
  isActive: true,
  plan: 'pro',
  productId: 'prod_1',
  expiresAt: null,
  cancelAtPeriodEnd: false,
}

function pickStore(store: Record<string, unknown>, keys: string | string[] | null | Record<string, unknown>) {
  if (keys === null || typeof keys === 'undefined') {
    return { ...store }
  }

  if (typeof keys === 'string') {
    return { [keys]: store[keys] }
  }

  if (Array.isArray(keys)) {
    return keys.reduce<Record<string, unknown>>((picked, key) => {
      picked[key] = store[key]
      return picked
    }, {})
  }

  return Object.keys(keys).reduce<Record<string, unknown>>((picked, key) => {
    picked[key] = store[key] ?? keys[key]
    return picked
  }, {})
}

describe('auth-state session recovery', () => {
  let localStore: Record<string, unknown>
  let sessionStore: Record<string, unknown>

  beforeEach(() => {
    localStore = {}
    sessionStore = {}

    ;(chrome.storage.local.get as jest.Mock).mockImplementation(async (keys) => pickStore(localStore, keys))
    ;(chrome.storage.local.set as jest.Mock).mockImplementation(async (items) => {
      Object.assign(localStore, items)
    })
    ;(chrome.storage.local.remove as jest.Mock).mockImplementation(async (keys) => {
      const keyList = Array.isArray(keys) ? keys : [keys]
      keyList.forEach((key) => delete localStore[key])
    })
    ;(chrome.storage.local as unknown as { setAccessLevel: jest.Mock }).setAccessLevel = jest
      .fn()
      .mockResolvedValue(undefined)

    ;(chrome.storage.session.get as jest.Mock).mockImplementation(async (keys) => pickStore(sessionStore, keys))
    ;(chrome.storage.session.set as jest.Mock).mockImplementation(async (items) => {
      Object.assign(sessionStore, items)
    })
    ;(chrome.storage.session.remove as jest.Mock).mockImplementation(async (keys) => {
      const keyList = Array.isArray(keys) ? keys : [keys]
      keyList.forEach((key) => delete sessionStore[key])
    })
  })

  it('saves runtime tokens in session and a trusted-context recovery token locally', async () => {
    const tokenExpiry = Date.now() + 60_000

    await expect(
      AuthState.saveAuthState('session-token', 'session-token', user, subscription, tokenExpiry),
    ).resolves.toBe(true)

    expect(sessionStore[AUTH_SESSION_KEY]).toEqual({
      accessToken: 'session-token',
      refreshToken: 'session-token',
      tokenExpiry,
    })
    expect(localStore[config.storage.keys.refreshToken]).toBe('session-token')
    expect(localStore[config.storage.keys.authToken]).toEqual(
      expect.objectContaining({
        user,
        subscription,
        tokenExpiry,
        tokenStorage: 'session-with-local-recovery',
      }),
    )
    expect((chrome.storage.local as unknown as { setAccessLevel: jest.Mock }).setAccessLevel).toHaveBeenCalledWith({
      accessLevel: 'TRUSTED_CONTEXTS',
    })
  })

  it('rehydrates the session token from recovery storage after extension reload', async () => {
    const tokenExpiry = Date.now() + 60_000
    localStore[config.storage.keys.authToken] = {
      user,
      subscription,
      tokenExpiry,
      lastChecked: Date.now(),
      tokenStorage: 'session-with-local-recovery',
    } satisfies StoredAuthData
    localStore[config.storage.keys.refreshToken] = 'persisted-session-token'

    await expect(AuthState.getAccessToken()).resolves.toBe('persisted-session-token')
    expect(sessionStore[AUTH_SESSION_KEY]).toEqual({
      accessToken: 'persisted-session-token',
      refreshToken: 'persisted-session-token',
      tokenExpiry,
    })

    await expect(AuthState.getAuthState()).resolves.toEqual(
      expect.objectContaining({
        isLoggedIn: true,
        user,
        isPro: true,
      }),
    )
  })

  it('does not rehydrate an expired recovery token', async () => {
    localStore[config.storage.keys.authToken] = {
      user,
      subscription,
      tokenExpiry: Date.now() - 1,
      lastChecked: Date.now(),
      tokenStorage: 'session-with-local-recovery',
    } satisfies StoredAuthData
    localStore[config.storage.keys.refreshToken] = 'expired-session-token'

    await expect(AuthState.getAccessToken()).resolves.toBeNull()
    expect(sessionStore[AUTH_SESSION_KEY]).toBeUndefined()
    await expect(AuthState.getAuthState()).resolves.toEqual(
      expect.objectContaining({
        isLoggedIn: false,
        user: null,
      }),
    )
  })
})

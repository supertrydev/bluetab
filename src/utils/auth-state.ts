/**
 * @module utils/auth-state
 *
 * WHY: Manage authentication state without putting bearer tokens inside the
 *      main auth metadata record.
 *
 * WHAT: Provides methods to save/load/clear auth state. User and
 *       subscription metadata live in chrome.storage.local. Runtime tokens
 *       live in chrome.storage.session; a local recovery token lets the
 *       extension rehydrate after a developer reload or extension update.
 *
 * NOT: Does not handle API calls - use auth-service.ts for that.
 */

import { config } from '../config/config'
import type { AuthState, SessionAuthTokens, StoredAuthData, SubscriptionStatus, User } from '../types/auth'

const AUTH_SESSION_KEY = 'bluetab_auth_session_tokens'
const TRUSTED_CONTEXTS_ACCESS_LEVEL = 'TRUSTED_CONTEXTS'

let localStorageAccessLevelPromise: Promise<void> | null = null

const defaultFreeSubscription: SubscriptionStatus = {
    isActive: false,
    plan: 'free',
    productId: null,
    expiresAt: null,
    cancelAtPeriodEnd: false,
}

function emptyAuthState(): AuthState {
    return {
        isLoggedIn: false,
        user: null,
        subscription: null,
        isPro: false,
        lastChecked: 0,
        offlineSince: null,
    }
}

async function restrictLocalStorageToTrustedContexts(): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.storage?.local?.setAccessLevel) {
        return
    }

    localStorageAccessLevelPromise ??= Promise
        .resolve(chrome.storage.local.setAccessLevel({ accessLevel: TRUSTED_CONTEXTS_ACCESS_LEVEL }))
        .catch((error) => {
            console.warn('[BlueTab][AuthState] Could not restrict local storage access:', error)
        })

    await localStorageAccessLevelPromise
}

async function getRecoveryToken(): Promise<string | null> {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
        return null
    }

    await restrictLocalStorageToTrustedContexts()
    const result = await chrome.storage.local.get(config.storage.keys.refreshToken)
    return (result[config.storage.keys.refreshToken] as string | undefined) ?? null
}

async function setRecoveryToken(token: string): Promise<void> {
    await restrictLocalStorageToTrustedContexts()
    await chrome.storage.local.set({
        [config.storage.keys.refreshToken]: token,
    })
}

async function rehydrateSessionTokens(storedData?: StoredAuthData): Promise<SessionAuthTokens | null> {
    if (!storedData || storedData.tokenExpiry < Date.now()) {
        return null
    }

    const recoveryToken = await getRecoveryToken()
    if (!recoveryToken) {
        return null
    }

    const tokens: SessionAuthTokens = {
        accessToken: recoveryToken,
        refreshToken: recoveryToken,
        tokenExpiry: storedData.tokenExpiry,
    }

    await setSessionTokens(tokens)
    return tokens
}

async function getSessionTokens(): Promise<SessionAuthTokens | null> {
    if (typeof chrome === 'undefined' || !chrome.storage?.session) {
        return null
    }

    const result = await Promise.resolve(chrome.storage.session.get(AUTH_SESSION_KEY))
    return (result[AUTH_SESSION_KEY] as SessionAuthTokens | undefined) ?? null
}

async function setSessionTokens(tokens: SessionAuthTokens): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.storage?.session) {
        throw new Error('chrome.storage.session is not available')
    }

    await Promise.resolve(chrome.storage.session.set({ [AUTH_SESSION_KEY]: tokens }))
}

/**
 * Get current auth state from storage.
 */
export async function getAuthState(): Promise<AuthState> {
    try {
        await restrictLocalStorageToTrustedContexts()
        const result = await chrome.storage.local.get([
            config.storage.keys.authToken,
            config.storage.keys.lastCheck,
        ])

        const storedData = result[config.storage.keys.authToken] as StoredAuthData | undefined
        const sessionTokens = await getSessionTokens() ?? await rehydrateSessionTokens(storedData)
        const lastChecked = (result[config.storage.keys.lastCheck] as number) || storedData?.lastChecked || 0

        if (!storedData?.user || !sessionTokens?.accessToken) {
            return emptyAuthState()
        }

        const tokenExpiry = sessionTokens.tokenExpiry || storedData.tokenExpiry
        const isExpired = tokenExpiry < Date.now()
        const online = typeof navigator === 'undefined' ? true : navigator.onLine
        const offlineSince = online ? null : (storedData.lastChecked || Date.now())
        const isInGracePeriod = offlineSince
            ? (Date.now() - offlineSince) < config.auth.offlineGracePeriod
            : true
        const subscription = storedData.subscription || defaultFreeSubscription

        return {
            isLoggedIn: !isExpired || isInGracePeriod,
            user: storedData.user,
            subscription,
            isPro: subscription.plan !== 'free' && subscription.isActive,
            lastChecked,
            offlineSince,
        }
    } catch (error) {
        console.error('[BlueTab][AuthState] Failed to get auth state:', error)
        return emptyAuthState()
    }
}

/**
 * Save auth tokens and user data. Tokens are session-only.
 */
export async function saveAuthState(
    token: string,
    refreshToken: string,
    user: User,
    subscription: SubscriptionStatus,
    tokenExpiry: number
): Promise<boolean> {
    try {
        const now = Date.now()
        const storedData: StoredAuthData = {
            user,
            subscription,
            tokenExpiry,
            lastChecked: now,
            tokenStorage: 'session-with-local-recovery',
        }

        await setSessionTokens({
            accessToken: token,
            refreshToken,
            tokenExpiry,
        })
        await setRecoveryToken(refreshToken || token)

        await chrome.storage.local.set({
            [config.storage.keys.authToken]: storedData,
            [config.storage.keys.lastCheck]: now,
        })

        console.log('[BlueTab][AuthState] Auth metadata saved successfully')
        return true
    } catch (error) {
        console.error('[BlueTab][AuthState] Failed to save auth state:', error)
        return false
    }
}

/**
 * Get the session-only access token.
 */
export async function getAccessToken(): Promise<string | null> {
    try {
        const sessionTokens = await getSessionTokens()
        if (sessionTokens?.accessToken) {
            return sessionTokens.accessToken
        }

        await restrictLocalStorageToTrustedContexts()
        const result = await chrome.storage.local.get(config.storage.keys.authToken)
        const storedData = result[config.storage.keys.authToken] as StoredAuthData | undefined
        return (await rehydrateSessionTokens(storedData))?.accessToken ?? null
    } catch (error) {
        console.error('[BlueTab][AuthState] Failed to get access token:', error)
        return null
    }
}

/**
 * Get the session-only refresh token.
 */
export async function getRefreshToken(): Promise<string | null> {
    try {
        const sessionTokens = await getSessionTokens()
        if (sessionTokens?.refreshToken) {
            return sessionTokens.refreshToken
        }

        await restrictLocalStorageToTrustedContexts()
        const result = await chrome.storage.local.get(config.storage.keys.authToken)
        const storedData = result[config.storage.keys.authToken] as StoredAuthData | undefined
        return (await rehydrateSessionTokens(storedData))?.refreshToken ?? null
    } catch (error) {
        console.error('[BlueTab][AuthState] Failed to get refresh token:', error)
        return null
    }
}

/**
 * Update subscription status.
 */
export async function updateSubscription(subscription: SubscriptionStatus): Promise<boolean> {
    try {
        await restrictLocalStorageToTrustedContexts()
        const result = await chrome.storage.local.get(config.storage.keys.authToken)
        const storedData = result[config.storage.keys.authToken] as StoredAuthData | undefined

        if (!storedData) {
            return false
        }

        const next: StoredAuthData = {
            ...storedData,
            subscription,
            lastChecked: Date.now(),
            tokenStorage: 'session-with-local-recovery',
        }

        await chrome.storage.local.set({
            [config.storage.keys.authToken]: next,
            [config.storage.keys.lastCheck]: next.lastChecked,
        })

        return true
    } catch (error) {
        console.error('[BlueTab][AuthState] Failed to update subscription:', error)
        return false
    }
}

/**
 * Clear all auth data (logout).
 */
export async function clearAuthState(): Promise<void> {
    try {
        if (chrome.storage?.session) {
            await Promise.resolve(chrome.storage.session.remove(AUTH_SESSION_KEY))
        }
        await chrome.storage.local.remove([
            config.storage.keys.authToken,
            config.storage.keys.refreshToken,
            config.storage.keys.user,
            config.storage.keys.subscription,
            config.storage.keys.lastCheck,
            config.storage.keys.aiAllowanceSummary,
        ])
        console.log('[BlueTab][AuthState] Auth state cleared')
    } catch (error) {
        console.error('[BlueTab][AuthState] Failed to clear auth state:', error)
    }
}

/**
 * Check if token needs refresh (expires within 5 minutes).
 */
export async function needsTokenRefresh(): Promise<boolean> {
    try {
        await restrictLocalStorageToTrustedContexts()
        const [localResult, sessionTokens] = await Promise.all([
            chrome.storage.local.get(config.storage.keys.authToken),
            getSessionTokens(),
        ])
        const storedData = localResult[config.storage.keys.authToken] as StoredAuthData | undefined
        const tokens = sessionTokens ?? await rehydrateSessionTokens(storedData)

        if (!storedData || !tokens?.accessToken) {
            return false
        }

        const tokenExpiry = tokens.tokenExpiry || storedData.tokenExpiry
        const fiveMinutes = 5 * 60 * 1000
        return tokenExpiry - Date.now() < fiveMinutes
    } catch {
        return false
    }
}

/**
 * Update only the token expiry timestamp (after server-side refresh).
 */
export async function updateTokenExpiry(newExpiry: number): Promise<boolean> {
    try {
        await restrictLocalStorageToTrustedContexts()
        const result = await chrome.storage.local.get(config.storage.keys.authToken)
        const storedData = result[config.storage.keys.authToken] as StoredAuthData | undefined

        if (!storedData) {
            return false
        }

        const now = Date.now()
        const sessionTokens = await getSessionTokens()
        if (sessionTokens) {
            await setSessionTokens({ ...sessionTokens, tokenExpiry: newExpiry })
        }

        await chrome.storage.local.set({
            [config.storage.keys.authToken]: {
                ...storedData,
                tokenExpiry: newExpiry,
                lastChecked: now,
                tokenStorage: 'session-with-local-recovery',
            } satisfies StoredAuthData,
            [config.storage.keys.lastCheck]: now,
        })

        return true
    } catch (error) {
        console.error('[BlueTab][AuthState] Failed to update token expiry:', error)
        return false
    }
}

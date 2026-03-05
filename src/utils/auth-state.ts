/**
 * @module utils/auth-state
 *
 * WHY: Manage authentication state in chrome.storage.local.
 *      Tokens are encrypted using CryptoService for security.
 *
 * WHAT: Provides methods to save/load/clear auth state.
 *       Handles token encryption and session persistence.
 *
 * HOW: Uses chrome.storage.local with AES-GCM encryption for tokens.
 *      User and subscription data stored as plain objects.
 *
 * NOT: Does not handle API calls - use auth-service.ts for that.
 */

import { CryptoService } from './crypto-service'
import { config } from '../config/config'
import type { AuthState, StoredAuthData, User, SubscriptionStatus } from '../types/auth'

// Internal key for token encryption (derived from extension ID)
const getEncryptionKey = (): string => {
    // Use chrome.runtime.id as base for deterministic key
    const baseKey = chrome.runtime?.id || 'bluetab-local-dev'
    return `${baseKey}-auth-encryption-key`
}

/**
 * Get current auth state from storage
 */
export async function getAuthState(): Promise<AuthState> {
    try {
        const result = await chrome.storage.local.get([
            config.storage.keys.authToken,
            config.storage.keys.user,
            config.storage.keys.subscription,
            config.storage.keys.lastCheck,
        ])

        const storedData = result[config.storage.keys.authToken] as StoredAuthData | undefined
        const lastChecked = result[config.storage.keys.lastCheck] as number || 0

        if (!storedData || !storedData.user) {
            return {
                isLoggedIn: false,
                user: null,
                subscription: null,
                isPro: false,
                lastChecked: 0,
                offlineSince: null,
            }
        }

        // Check if token is expired
        const isExpired = storedData.tokenExpiry < Date.now()

        // Check offline grace period
        const offlineSince = navigator.onLine ? null : (storedData.lastChecked || Date.now())
        const isInGracePeriod = offlineSince
            ? (Date.now() - offlineSince) < config.auth.offlineGracePeriod
            : true

        const subscription = storedData.subscription || { isActive: false, plan: 'free' as const, productId: null, expiresAt: null, cancelAtPeriodEnd: false }

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
        return {
            isLoggedIn: false,
            user: null,
            subscription: null,
            isPro: false,
            lastChecked: 0,
            offlineSince: null,
        }
    }
}

/**
 * Save auth tokens and user data to storage (encrypted)
 */
export async function saveAuthState(
    token: string,
    refreshToken: string,
    user: User,
    subscription: SubscriptionStatus,
    tokenExpiry: number
): Promise<boolean> {
    try {
        const encryptionKey = getEncryptionKey()

        // Encrypt tokens
        const tokenEncrypted = await CryptoService.encryptWithPassword(token, encryptionKey)
        const refreshEncrypted = await CryptoService.encryptWithPassword(refreshToken, encryptionKey)

        const storedData: StoredAuthData = {
            encryptedToken: tokenEncrypted.encryptedData,
            encryptedRefreshToken: refreshEncrypted.encryptedData,
            tokenSalt: tokenEncrypted.salt,
            tokenIv: tokenEncrypted.iv,
            user,
            subscription,
            tokenExpiry,
            lastChecked: Date.now(),
        }

        await chrome.storage.local.set({
            [config.storage.keys.authToken]: storedData,
            [config.storage.keys.lastCheck]: Date.now(),
        })

        console.log('[BlueTab][AuthState] Auth state saved successfully')
        return true
    } catch (error) {
        console.error('[BlueTab][AuthState] Failed to save auth state:', error)
        return false
    }
}

/**
 * Get decrypted access token
 */
export async function getAccessToken(): Promise<string | null> {
    try {
        const result = await chrome.storage.local.get(config.storage.keys.authToken)
        const storedData = result[config.storage.keys.authToken] as StoredAuthData | undefined

        if (!storedData?.encryptedToken) {
            return null
        }

        const encryptionKey = getEncryptionKey()
        const decrypted = await CryptoService.decryptWithPassword(
            storedData.encryptedToken,
            encryptionKey,
            storedData.tokenSalt,
            storedData.tokenIv
        )

        if (!decrypted.success) {
            console.error('[BlueTab][AuthState] Failed to decrypt token:', decrypted.error)
            return null
        }

        return decrypted.data ?? null
    } catch (error) {
        console.error('[BlueTab][AuthState] Failed to get access token:', error)
        return null
    }
}

/**
 * Get decrypted refresh token
 */
export async function getRefreshToken(): Promise<string | null> {
    try {
        const result = await chrome.storage.local.get(config.storage.keys.authToken)
        const storedData = result[config.storage.keys.authToken] as StoredAuthData | undefined

        if (!storedData?.encryptedRefreshToken) {
            return null
        }

        const encryptionKey = getEncryptionKey()
        const decrypted = await CryptoService.decryptWithPassword(
            storedData.encryptedRefreshToken,
            encryptionKey,
            storedData.tokenSalt,
            storedData.tokenIv
        )

        if (!decrypted.success) {
            return null
        }

        return decrypted.data ?? null
    } catch (error) {
        console.error('[BlueTab][AuthState] Failed to get refresh token:', error)
        return null
    }
}

/**
 * Update subscription status
 */
export async function updateSubscription(subscription: SubscriptionStatus): Promise<boolean> {
    try {
        const result = await chrome.storage.local.get(config.storage.keys.authToken)
        const storedData = result[config.storage.keys.authToken] as StoredAuthData | undefined

        if (!storedData) {
            return false
        }

        storedData.subscription = subscription
        storedData.lastChecked = Date.now()

        await chrome.storage.local.set({
            [config.storage.keys.authToken]: storedData,
            [config.storage.keys.lastCheck]: Date.now(),
        })

        return true
    } catch (error) {
        console.error('[BlueTab][AuthState] Failed to update subscription:', error)
        return false
    }
}

/**
 * Clear all auth data (logout)
 */
export async function clearAuthState(): Promise<void> {
    try {
        await chrome.storage.local.remove([
            config.storage.keys.authToken,
            config.storage.keys.refreshToken,
            config.storage.keys.user,
            config.storage.keys.subscription,
            config.storage.keys.lastCheck,
        ])
        console.log('[BlueTab][AuthState] Auth state cleared')
    } catch (error) {
        console.error('[BlueTab][AuthState] Failed to clear auth state:', error)
    }
}

/**
 * Check if token needs refresh (expires within 5 minutes)
 */
export async function needsTokenRefresh(): Promise<boolean> {
    try {
        const result = await chrome.storage.local.get(config.storage.keys.authToken)
        const storedData = result[config.storage.keys.authToken] as StoredAuthData | undefined

        if (!storedData) {
            return false
        }

        const fiveMinutes = 5 * 60 * 1000
        return storedData.tokenExpiry - Date.now() < fiveMinutes
    } catch {
        return false
    }
}

/**
 * Update only the token expiry timestamp (after server-side refresh)
 */
export async function updateTokenExpiry(newExpiry: number): Promise<boolean> {
    try {
        const result = await chrome.storage.local.get(config.storage.keys.authToken)
        const storedData = result[config.storage.keys.authToken] as StoredAuthData | undefined

        if (!storedData) {
            return false
        }

        storedData.tokenExpiry = newExpiry
        storedData.lastChecked = Date.now()

        await chrome.storage.local.set({
            [config.storage.keys.authToken]: storedData,
        })

        return true
    } catch (error) {
        console.error('[BlueTab][AuthState] Failed to update token expiry:', error)
        return false
    }
}

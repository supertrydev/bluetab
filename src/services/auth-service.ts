/**
 * @module services/auth-service
 *
 * WHY: Communicate with Supertry API for authentication.
 *      Handles login, logout, token refresh, and subscription checks.
 *
 * WHAT: Provides AuthService class with static methods for:
 *       - Email/password login
 *       - Session management
 *       - Subscription status checks
 *       - Token refresh
 *       - Auto-sync setup on login
 *
 * HOW: Uses fetch API to call Supertry endpoints.
 *      Stores tokens encrypted via auth-state.ts.
 *      Triggers auto-sync setup after successful login.
 *
 * NOT: Does not handle UI - use auth components for that.
 */

import { config } from '../config/config'
import * as AuthState from '../utils/auth-state'
import type { AuthResult, SubscriptionStatus, User, AuthSession } from '../types/auth'

export class AuthService {
    private static loginAttempts = 0
    private static lockoutUntil = 0

    /**
     * Login with email and password
     */
    static async login(email: string, password: string): Promise<AuthResult> {
        // Check lockout
        if (Date.now() < this.lockoutUntil) {
            const remainingMinutes = Math.ceil((this.lockoutUntil - Date.now()) / 60000)
            return {
                success: false,
                error: `Too many login attempts. Try again in ${remainingMinutes} minutes.`,
                errorCode: 'RATE_LIMITED',
            }
        }

        try {
            const response = await fetch(`${config.supertry.baseUrl}${config.supertry.authEndpoint}/sign-in/email`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ email, password }),
            })

            if (!response.ok) {
                this.loginAttempts++

                if (this.loginAttempts >= config.auth.maxLoginAttempts) {
                    this.lockoutUntil = Date.now() + config.auth.lockoutDuration
                    this.loginAttempts = 0
                    return {
                        success: false,
                        error: 'Too many failed attempts. Please try again in 15 minutes.',
                        errorCode: 'RATE_LIMITED',
                    }
                }

                const errorData = await response.json().catch(() => ({}))

                if (response.status === 401) {
                    return {
                        success: false,
                        error: errorData.message || 'Invalid email or password',
                        errorCode: 'INVALID_CREDENTIALS',
                    }
                }

                if (response.status === 403 && errorData.code === 'EMAIL_NOT_VERIFIED') {
                    return {
                        success: false,
                        error: 'Please verify your email before logging in',
                        errorCode: 'EMAIL_NOT_VERIFIED',
                    }
                }

                return {
                    success: false,
                    error: errorData.message || 'Login failed',
                }
            }

            // Reset attempts on success
            this.loginAttempts = 0

            const data = await response.json()
            const session = data.session || data

            // Get user info
            const user: User = {
                id: session.user?.id || session.userId,
                email: session.user?.email || email,
                name: session.user?.name || null,
                image: session.user?.image || null,
                emailVerified: session.user?.emailVerified || false,
                createdAt: session.user?.createdAt || new Date().toISOString(),
            }

            // Check subscription
            const subscription = await this.checkSubscription(session.token)

            // Calculate token expiry (default 7 days if not provided)
            const tokenExpiry = session.expiresAt
                ? new Date(session.expiresAt).getTime()
                : Date.now() + (7 * 24 * 60 * 60 * 1000)

            // Save to storage
            const saved = await AuthState.saveAuthState(
                session.token,
                session.refreshToken || session.token,
                user,
                subscription,
                tokenExpiry
            )

            if (!saved) {
                return {
                    success: false,
                    error: 'Failed to save session',
                }
            }

            console.log('[BlueTab][Auth] Login successful for:', user.email)

            // Auto-setup sync for Pro users via service worker message (non-blocking).
            // Using sendMessage ensures the SW's own SyncEngine instance handles setup
            // and correctly resets authSuspended in the SW context.
            if (subscription.isActive) {
                chrome.runtime.sendMessage({ type: 'SYNC_AUTO_SETUP' }).catch(error => {
                    console.warn('[BlueTab][Auth] Failed to send SYNC_AUTO_SETUP to service worker:', error)
                })
            }

            return {
                success: true,
                session: {
                    user,
                    token: session.token,
                    expiresAt: tokenExpiry,
                },
            }
        } catch (error) {
            console.error('[BlueTab][Auth] Login error:', error)
            return {
                success: false,
                error: 'Network error. Please check your connection.',
                errorCode: 'NETWORK_ERROR',
            }
        }
    }

    /**
     * Logout and clear session
     */
    static async logout(): Promise<void> {
        try {
            const token = await AuthState.getAccessToken()

            if (token) {
                // Notify server (best effort)
                await fetch(`${config.supertry.baseUrl}${config.supertry.authEndpoint}/sign-out`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                    },
                }).catch(() => {
                    // Ignore server errors during logout
                })
            }
        } finally {
            // Clear sync session data via service worker message (same reason as autoSetup)
            try {
                await chrome.runtime.sendMessage({ type: 'SYNC_CLEAR_ON_LOGOUT' })
            } catch {
                console.warn('[BlueTab][Auth] Failed to send SYNC_CLEAR_ON_LOGOUT to service worker')
            }

            await AuthState.clearAuthState()
            console.log('[BlueTab][Auth] Logged out')
        }
    }

    /**
     * Get current session
     */
    static async getSession(): Promise<AuthSession | null> {
        const authState = await AuthState.getAuthState()

        if (!authState.isLoggedIn || !authState.user) {
            return null
        }

        const token = await AuthState.getAccessToken()
        if (!token) {
            return null
        }

        return {
            user: authState.user,
            token,
            expiresAt: authState.lastChecked + config.auth.sessionCheckInterval,
        }
    }

    /**
     * Check subscription status from Supertry
     */
    static async checkSubscription(token?: string): Promise<SubscriptionStatus> {
        const defaultFree: SubscriptionStatus = {
            isActive: false,
            plan: 'free',
            productId: null,
            expiresAt: null,
            cancelAtPeriodEnd: false,
        }

        try {
            const accessToken = token || await AuthState.getAccessToken()

            if (!accessToken) {
                return defaultFree
            }

            const response = await fetch(`${config.supertry.baseUrl}${config.supertry.subscriptionEndpoint}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                },
            })

            if (!response.ok) {
                return defaultFree
            }

            const data = await response.json()

            console.log('[BlueTab][Auth] Subscription API raw response:', JSON.stringify(data, null, 2))

            // Handle different response formats
            const subscription = data.subscription || data

            console.log('[BlueTab][Auth] Parsed subscription object:', JSON.stringify(subscription, null, 2))

            const isActive = subscription.status === 'active' || subscription.isActive || false

            const status: SubscriptionStatus = {
                isActive,
                plan: subscription.plan || (isActive || subscription.productId ? 'pro' : 'free'),
                productId: subscription.productId || null,
                expiresAt: subscription.periodEnd || subscription.expiresAt || null,
                cancelAtPeriodEnd: subscription.cancelAtPeriodEnd || false,
            }

            console.log('[BlueTab][Auth] Computed subscription status:', JSON.stringify(status, null, 2))

            // Update stored subscription
            await AuthState.updateSubscription(status)

            return status
        } catch (error) {
            console.error('[BlueTab][Auth] Subscription check failed:', error)
            return defaultFree
        }
    }

    /**
     * Force-refresh the token regardless of local expiry.
     * Use this when the server has already returned 401 (reactive refresh).
     * Distinguishes between a truly invalid session (401) and transient errors (5xx, network).
     */
    static async forceRefreshToken(): Promise<{ success: boolean; sessionInvalid: boolean }> {
        try {
            const token = await AuthState.getAccessToken()
            if (!token) {
                return { success: false, sessionInvalid: true }
            }

            const response = await fetch(`${config.supertry.baseUrl}${config.supertry.authEndpoint}/refresh`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                },
            })

            if (!response.ok) {
                if (response.status === 401) {
                    console.log('[BlueTab][Auth] Force refresh rejected (401), clearing session')
                    await AuthState.clearAuthState()
                    return { success: false, sessionInvalid: true }
                }
                console.warn(`[BlueTab][Auth] Force refresh failed with status ${response.status} (transient)`)
                return { success: false, sessionInvalid: false }
            }

            const data = await response.json()
            const newExpiry = data.expiresAt
                ? new Date(data.expiresAt).getTime()
                : Date.now() + (7 * 24 * 60 * 60 * 1000)

            await AuthState.updateTokenExpiry(newExpiry)
            console.log('[BlueTab][Auth] Token force-refreshed successfully')
            return { success: true, sessionInvalid: false }
        } catch (error) {
            console.error('[BlueTab][Auth] Force refresh network error (transient):', error)
            return { success: false, sessionInvalid: false }
        }
    }

    /**
     * Refresh token if needed.
     * Calls POST /api/auth/refresh to extend the session expiry on the server,
     * then updates the local token expiry to match.
     */
    static async refreshTokenIfNeeded(): Promise<boolean> {
        const needsRefresh = await AuthState.needsTokenRefresh()

        if (!needsRefresh) {
            return true
        }

        try {
            const token = await AuthState.getAccessToken()

            if (!token) {
                return false
            }

            const response = await fetch(`${config.supertry.baseUrl}${config.supertry.authEndpoint}/refresh`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                },
            })

            if (!response.ok) {
                if (response.status === 401) {
                    // Session truly expired or invalid — clear local state
                    console.log('[BlueTab][Auth] Token refresh rejected (401), clearing session')
                    await AuthState.clearAuthState()
                }
                return false
            }

            const data = await response.json()
            const newExpiry = data.expiresAt
                ? new Date(data.expiresAt).getTime()
                : Date.now() + (7 * 24 * 60 * 60 * 1000)

            await AuthState.updateTokenExpiry(newExpiry)

            console.log('[BlueTab][Auth] Token refreshed successfully')
            return true
        } catch (error) {
            console.error('[BlueTab][Auth] Token refresh error:', error)
            return false
        }
    }

    /**
     * Check if user is logged in
     */
    static async isLoggedIn(): Promise<boolean> {
        const authState = await AuthState.getAuthState()
        return authState.isLoggedIn
    }

    /**
     * Check if user has pro subscription
     */
    static async isPro(): Promise<boolean> {
        const authState = await AuthState.getAuthState()
        return authState.isPro
    }
}

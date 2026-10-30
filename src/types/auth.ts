/**
 * @module types/auth
 *
 * WHY: Type definitions for authentication and subscription.
 *
 * WHAT: Interfaces for User, Session, Subscription, and API responses.
 *
 * HOW: Used by auth-service.ts and auth-state.ts.
 */

export interface User {
    id: string
    email: string
    name: string | null
    image: string | null
    emailVerified: boolean
    createdAt: string
}

export interface AuthSession {
    user: User
    token: string
    expiresAt: number
}

export interface SubscriptionStatus {
    isActive: boolean
    plan: 'free' | 'pro' | 'team'
    productId: string | null
    expiresAt: string | null
    cancelAtPeriodEnd: boolean
}

export interface AuthResult {
    success: boolean
    session?: AuthSession
    error?: string
    errorCode?: 'INVALID_CREDENTIALS' | 'EMAIL_NOT_VERIFIED' | 'RATE_LIMITED' | 'NETWORK_ERROR'
}

export interface AuthState {
    isLoggedIn: boolean
    user: User | null
    subscription: SubscriptionStatus | null
    isPro: boolean
    lastChecked: number
    offlineSince: number | null
}

export interface StoredAuthData {
    user: User
    subscription: SubscriptionStatus
    tokenExpiry: number
    lastChecked: number
    tokenStorage: 'session' | 'session-with-local-recovery'
}

export interface SessionAuthTokens {
    accessToken: string
    refreshToken: string
    tokenExpiry: number
}

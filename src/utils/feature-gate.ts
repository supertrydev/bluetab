/**
 * @module utils/feature-gate
 *
 * WHY: Control access to premium features based on subscription.
 *      Provides upgrade prompts for free users.
 *
 * WHAT: Utility functions to check feature access and show upgrade UI.
 *
 * HOW: Checks auth state and subscription status.
 *      Free tier gets basic features, Pro gets everything.
 *
 * NOT: Does not handle payment - redirects to Supertry for that.
 */

import * as AuthState from './auth-state'
import { config, type PremiumFeature } from '../config/config'

export type { PremiumFeature } from '../config/config'

/**
 * Feature access result
 */
export interface FeatureAccessResult {
    allowed: boolean
    reason?: 'not_logged_in' | 'not_subscribed' | 'offline_expired'
}

/**
 * Check if a feature is premium
 */
export function isPremiumFeature(feature: string): feature is PremiumFeature {
    return (config.premium.features as readonly string[]).includes(feature)
}

/**
 * Check if user can access a feature
 */
export async function canAccessFeature(_feature: PremiumFeature): Promise<FeatureAccessResult> {
    const authState = await AuthState.getAuthState()

    // Check login status
    if (!authState.isLoggedIn) {
        return {
            allowed: false,
            reason: 'not_logged_in',
        }
    }

    // Check offline grace period
    if (authState.offlineSince) {
        const offlineDuration = Date.now() - authState.offlineSince
        if (offlineDuration > config.auth.offlineGracePeriod) {
            return {
                allowed: false,
                reason: 'offline_expired',
            }
        }
    }

    // Check subscription
    if (!authState.isPro) {
        return {
            allowed: false,
            reason: 'not_subscribed',
        }
    }

    return { allowed: true }
}

/**
 * Get upgrade URL for Supertry
 */
export function getUpgradeUrl(): string {
    return `${config.supertry.baseUrl}/dashboard?upgrade=bluetab-pro`
}

/**
 * Get login URL for Supertry
 */
export function getLoginUrl(): string {
    return `${config.supertry.baseUrl}/login?redirect=bluetab`
}

/**
 * Get user-friendly message for feature gate
 */
export function getFeatureGateMessage(result: FeatureAccessResult, featureName: string): string {
    if (result.allowed) {
        return ''
    }

    switch (result.reason) {
        case 'not_logged_in':
            return `Sign in to access ${featureName}`
        case 'not_subscribed':
            return `Upgrade to Pro to unlock ${featureName}`
        case 'offline_expired':
            return `Connect to internet to access ${featureName}`
        default:
            return `${featureName} is a premium feature`
    }
}

/**
 * Feature gate hook data for UI
 */
export interface FeatureGateUIData {
    feature: PremiumFeature
    featureName: string
    isAllowed: boolean
    reason?: FeatureAccessResult['reason']
    message: string
    actionLabel: string
    actionUrl: string
}

/**
 * Get UI data for feature gate
 */
export async function getFeatureGateUI(feature: PremiumFeature, featureName: string): Promise<FeatureGateUIData> {
    const result = await canAccessFeature(feature)

    return {
        feature,
        featureName,
        isAllowed: result.allowed,
        reason: result.reason,
        message: getFeatureGateMessage(result, featureName),
        actionLabel: result.reason === 'not_logged_in' ? 'Sign In' : 'Upgrade',
        actionUrl: result.reason === 'not_logged_in' ? getLoginUrl() : getUpgradeUrl(),
    }
}

/**
 * Feature gate wrapper - returns true if access allowed, false if blocked
 * Use this as a guard before premium feature execution
 */
export async function requireFeature(feature: PremiumFeature): Promise<boolean> {
    const result = await canAccessFeature(feature)
    return result.allowed
}

/**
 * Get all feature statuses
 */
export async function getAllFeatureStatuses(): Promise<Record<PremiumFeature, boolean>> {
    const authState = await AuthState.getAuthState()
    const isAllowed = authState.isLoggedIn && authState.isPro

    const statuses: Record<string, boolean> = {}
    for (const feature of config.premium.features) {
        statuses[feature] = isAllowed
    }

    return statuses as Record<PremiumFeature, boolean>
}

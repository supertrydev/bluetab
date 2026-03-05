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
    // Hardcoded for OSS Release: All premium features are disabled and marked as "Coming Soon"
    return {
        allowed: false,
        reason: 'not_subscribed',
    }
}

/**
 * Get upgrade URL for Supertry
 */
export function getUpgradeUrl(): string {
    return `https://github.com/supertrydev/bluetab` // Pointing to OSS repo for now
}

/**
 * Get login URL for Supertry
 */
export function getLoginUrl(): string {
    return `https://github.com/supertrydev/bluetab`
}

/**
 * Get user-friendly message for feature gate
 */
export function getFeatureGateMessage(result: FeatureAccessResult, featureName: string): string {
    if (result.allowed) {
        return ''
    }

    // Forced OSS state:
    return `${featureName} is coming soon in Cloud version!`
}

/**
 * Feature gate hook data for UI
 */
export interface FeatureGateUIData {
    feature: PremiumFeature
    featureName: string
    isAllowed: boolean
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
        message: getFeatureGateMessage(result, featureName),
        actionLabel: 'Coming Soon',
        actionUrl: 'https://github.com/supertrydev/bluetab',
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
    const statuses: Record<string, boolean> = {}
    for (const feature of config.premium.features) {
        statuses[feature] = false // Always false for OSS release
    }

    return statuses as Record<PremiumFeature, boolean>
}

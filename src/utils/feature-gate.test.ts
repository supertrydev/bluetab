/**
 * Behavioral tests for feature-gate.ts
 *
 * Tests: canAccessFeature, isPremiumFeature, requireFeature, getFeatureGateMessage
 * Focus: ai_commands premium feature gating across all auth states
 */

import {
  canAccessFeature,
  isPremiumFeature,
  requireFeature,
  getFeatureGateMessage,
} from './feature-gate';
import type { FeatureAccessResult } from './feature-gate';

// Mock auth-state module so tests control the returned auth state
jest.mock('./auth-state');
import * as AuthState from './auth-state';

const mockGetAuthState = AuthState.getAuthState as jest.MockedFunction<typeof AuthState.getAuthState>;

// Helper factories for common auth states
const NOT_LOGGED_IN = { isLoggedIn: false, isPro: false, offlineSince: null, user: null, subscription: null, lastChecked: 0 } as const;
const LOGGED_IN_FREE = { isLoggedIn: true, isPro: false, offlineSince: null, user: null, subscription: null, lastChecked: 0 } as const;
const LOGGED_IN_PRO  = { isLoggedIn: true, isPro: true,  offlineSince: null, user: null, subscription: null, lastChecked: 0 } as const;

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// isPremiumFeature
// ---------------------------------------------------------------------------

describe('isPremiumFeature()', () => {
  it('returns true for ai_commands', () => {
    expect(isPremiumFeature('ai_commands')).toBe(true);
  });

  it('returns true for other known premium features', () => {
    expect(isPremiumFeature('cloud_sync')).toBe(true);
    expect(isPremiumFeature('flow')).toBe(true);
  });

  it('returns false for a nonexistent feature', () => {
    expect(isPremiumFeature('nonexistent_feature')).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(isPremiumFeature('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// canAccessFeature('ai_commands')
// ---------------------------------------------------------------------------

describe('canAccessFeature("ai_commands")', () => {
  it('returns { allowed: false, reason: "not_logged_in" } when user is not logged in', async () => {
    mockGetAuthState.mockResolvedValue(NOT_LOGGED_IN as any);
    const result = await canAccessFeature('ai_commands');
    expect(result).toEqual({ allowed: false, reason: 'not_logged_in' });
  });

  it('returns { allowed: false, reason: "not_subscribed" } when user is logged in but not Pro', async () => {
    mockGetAuthState.mockResolvedValue(LOGGED_IN_FREE as any);
    const result = await canAccessFeature('ai_commands');
    expect(result).toEqual({ allowed: false, reason: 'not_subscribed' });
  });

  it('returns { allowed: true } when user is logged in and Pro', async () => {
    mockGetAuthState.mockResolvedValue(LOGGED_IN_PRO as any);
    const result = await canAccessFeature('ai_commands');
    expect(result).toEqual({ allowed: true });
  });
});

// ---------------------------------------------------------------------------
// requireFeature('ai_commands')
// ---------------------------------------------------------------------------

describe('requireFeature("ai_commands")', () => {
  it('returns false for a non-logged-in user', async () => {
    mockGetAuthState.mockResolvedValue(NOT_LOGGED_IN as any);
    const allowed = await requireFeature('ai_commands');
    expect(allowed).toBe(false);
  });

  it('returns false for a free (logged-in) user', async () => {
    mockGetAuthState.mockResolvedValue(LOGGED_IN_FREE as any);
    const allowed = await requireFeature('ai_commands');
    expect(allowed).toBe(false);
  });

  it('returns true for a Pro user', async () => {
    mockGetAuthState.mockResolvedValue(LOGGED_IN_PRO as any);
    const allowed = await requireFeature('ai_commands');
    expect(allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getFeatureGateMessage for ai_commands gate results
// ---------------------------------------------------------------------------

describe('getFeatureGateMessage() for AI Assistant', () => {
  it('returns upgrade text for not_subscribed result', () => {
    const result: FeatureAccessResult = { allowed: false, reason: 'not_subscribed' };
    const msg = getFeatureGateMessage(result, 'AI Assistant');
    expect(msg).toBe('Upgrade to Pro to unlock AI Assistant');
  });

  it('returns sign-in text for not_logged_in result', () => {
    const result: FeatureAccessResult = { allowed: false, reason: 'not_logged_in' };
    const msg = getFeatureGateMessage(result, 'AI Assistant');
    expect(msg).toBe('Sign in to access AI Assistant');
  });

  it('returns empty string when access is allowed', () => {
    const result: FeatureAccessResult = { allowed: true };
    const msg = getFeatureGateMessage(result, 'AI Assistant');
    expect(msg).toBe('');
  });

  it('returns connectivity text for offline_expired result', () => {
    const result: FeatureAccessResult = { allowed: false, reason: 'offline_expired' };
    const msg = getFeatureGateMessage(result, 'AI Assistant');
    expect(msg).toBe('Connect to internet to access AI Assistant');
  });
});

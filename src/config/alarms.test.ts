/**
 * Unit tests for AlarmRegistry
 *
 * Tests: exact string values, no duplicates, type safety
 */

import { ALARM_NAMES } from './alarms';

describe('ALARM_NAMES', () => {
  it('AUTH_REFRESH equals exact string "bluetab-auth-refresh"', () => {
    expect(ALARM_NAMES.AUTH_REFRESH).toBe('bluetab-auth-refresh');
  });

  it('SUBSCRIPTION_CHECK equals exact string "bluetab-subscription-check"', () => {
    expect(ALARM_NAMES.SUBSCRIPTION_CHECK).toBe('bluetab-subscription-check');
  });

  it('BLUET_BRIDGE_HEARTBEAT equals exact string "bluet-bridge-heartbeat"', () => {
    expect(ALARM_NAMES.BLUET_BRIDGE_HEARTBEAT).toBe('bluet-bridge-heartbeat');
  });

  it('SYNC_POLL equals exact string "bluetab-sync-poll"', () => {
    expect(ALARM_NAMES.SYNC_POLL).toBe('bluetab-sync-poll');
  });

  it('contains all 4 existing alarm strings', () => {
    const values = Object.values(ALARM_NAMES);
    expect(values).toContain('bluetab-auth-refresh');
    expect(values).toContain('bluetab-subscription-check');
    expect(values).toContain('bluet-bridge-heartbeat');
    expect(values).toContain('bluetab-sync-poll');
  });

  it('has no duplicate values', () => {
    const values = Object.values(ALARM_NAMES);
    const uniqueValues = new Set(values);
    expect(uniqueValues.size).toBe(values.length);
  });
});

/**
 * Unit tests for storage budget utilities
 *
 * Tests: STORAGE_BUDGETS constants, getStorageUsage() thresholds
 */

import { STORAGE_BUDGETS, getStorageUsage } from './storage-budget';

describe('STORAGE_BUDGETS', () => {
  it('TOTAL_QUOTA_BYTES equals 10MB (10485760)', () => {
    expect(STORAGE_BUDGETS.TOTAL_QUOTA_BYTES).toBe(10 * 1024 * 1024);
    expect(STORAGE_BUDGETS.TOTAL_QUOTA_BYTES).toBe(10485760);
  });

  it('has all expected budget keys', () => {
    expect(STORAGE_BUDGETS).toHaveProperty('CORE_GROUPS');
    expect(STORAGE_BUDGETS).toHaveProperty('ARCHIVES');
    expect(STORAGE_BUDGETS).toHaveProperty('SYNC_STATE');
    expect(STORAGE_BUDGETS).toHaveProperty('STATISTICS');
    expect(STORAGE_BUDGETS).toHaveProperty('RSS');
    expect(STORAGE_BUDGETS).toHaveProperty('BACKUPS');
    expect(STORAGE_BUDGETS).toHaveProperty('WARN_THRESHOLD');
    expect(STORAGE_BUDGETS).toHaveProperty('CRITICAL_THRESHOLD');
  });
});

describe('getStorageUsage()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns correct percentUsed from mocked getBytesInUse', async () => {
    const mockBytesUsed = 5 * 1024 * 1024; // 5MB = 50%
    (chrome.storage.local.getBytesInUse as jest.Mock).mockImplementation(
      (_key: null, callback: (bytes: number) => void) => callback(mockBytesUsed)
    );

    const result = await getStorageUsage();
    expect(result.used).toBe(mockBytesUsed);
    expect(result.total).toBe(STORAGE_BUDGETS.TOTAL_QUOTA_BYTES);
    expect(result.percentUsed).toBeCloseTo(0.5);
  });

  it('isWarning is true when percentUsed >= 0.80', async () => {
    const mockBytesUsed = 8.5 * 1024 * 1024; // 85%
    (chrome.storage.local.getBytesInUse as jest.Mock).mockImplementation(
      (_key: null, callback: (bytes: number) => void) => callback(mockBytesUsed)
    );

    const result = await getStorageUsage();
    expect(result.isWarning).toBe(true);
  });

  it('isWarning is false when percentUsed < 0.80', async () => {
    const mockBytesUsed = 7 * 1024 * 1024; // 70%
    (chrome.storage.local.getBytesInUse as jest.Mock).mockImplementation(
      (_key: null, callback: (bytes: number) => void) => callback(mockBytesUsed)
    );

    const result = await getStorageUsage();
    expect(result.isWarning).toBe(false);
  });

  it('isCritical is true when percentUsed >= 0.90', async () => {
    const mockBytesUsed = 9.5 * 1024 * 1024; // 95%
    (chrome.storage.local.getBytesInUse as jest.Mock).mockImplementation(
      (_key: null, callback: (bytes: number) => void) => callback(mockBytesUsed)
    );

    const result = await getStorageUsage();
    expect(result.isCritical).toBe(true);
  });

  it('isCritical is false when percentUsed < 0.90', async () => {
    const mockBytesUsed = 8 * 1024 * 1024; // ~76%
    (chrome.storage.local.getBytesInUse as jest.Mock).mockImplementation(
      (_key: null, callback: (bytes: number) => void) => callback(mockBytesUsed)
    );

    const result = await getStorageUsage();
    expect(result.isCritical).toBe(false);
  });

  it('both isWarning and isCritical true at 90%+', async () => {
    const mockBytesUsed = STORAGE_BUDGETS.TOTAL_QUOTA_BYTES * 0.9; // exactly 90%
    (chrome.storage.local.getBytesInUse as jest.Mock).mockImplementation(
      (_key: null, callback: (bytes: number) => void) => callback(mockBytesUsed)
    );

    const result = await getStorageUsage();
    expect(result.isWarning).toBe(true);
    expect(result.isCritical).toBe(true);
  });
});

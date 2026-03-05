/**
 * @module utils/storage-budget
 *
 * WHY:  10MB chrome.storage.local quota is shared across ALL features.
 *       Without allocation, a single feature (archives, statistics, backups)
 *       can exhaust the budget and break core tab saving.
 *
 * WHAT: Quota monitoring constants and current usage query.
 *       STORAGE_BUDGETS defines advisory per-domain byte limits.
 *       getStorageUsage() measures current utilization and returns threshold flags.
 *
 * HOW:  Uses chrome.storage.local.getBytesInUse(null) to measure total used bytes.
 *       Returns advisory flags (isWarning, isCritical) based on configured thresholds.
 *
 * NOT:  Does not enforce limits — callers decide what to do on warning/critical.
 *       Does not track per-domain usage — only total storage utilization.
 */

export const STORAGE_BUDGETS = {
  TOTAL_QUOTA_BYTES: 10 * 1024 * 1024,   // 10MB Chrome limit
  CORE_GROUPS: 4 * 1024 * 1024,           // 4MB — groups + projects + tags (non-negotiable)
  ARCHIVES: 3 * 1024 * 1024,              // 3MB — encrypted archives
  SYNC_STATE: 1 * 1024 * 1024,            // 1MB — delta queue, auth tokens, sync metadata
  STATISTICS: 512 * 1024,                 // 512KB — Phase 3 stats budget
  RSS: 1 * 1024 * 1024,                   // 1MB — Phase 4 RSS articles
  BACKUPS: 512 * 1024,                    // 512KB — Phase 2 session backups
  WARN_THRESHOLD: 0.80,                   // Warn at 80% total usage
  CRITICAL_THRESHOLD: 0.90,              // Critical at 90% total usage
} as const;

export interface StorageUsage {
  used: number;
  total: number;
  percentUsed: number;
  isWarning: boolean;
  isCritical: boolean;
}

/**
 * Query current chrome.storage.local usage and return advisory status.
 *
 * @returns Current storage utilization with warning/critical flags
 */
export function getStorageUsage(): Promise<StorageUsage> {
  return new Promise((resolve) => {
    chrome.storage.local.getBytesInUse(null, (bytesUsed) => {
      const percentUsed = bytesUsed / STORAGE_BUDGETS.TOTAL_QUOTA_BYTES;
      resolve({
        used: bytesUsed,
        total: STORAGE_BUDGETS.TOTAL_QUOTA_BYTES,
        percentUsed,
        isWarning: percentUsed >= STORAGE_BUDGETS.WARN_THRESHOLD,
        isCritical: percentUsed >= STORAGE_BUDGETS.CRITICAL_THRESHOLD,
      });
    });
  });
}

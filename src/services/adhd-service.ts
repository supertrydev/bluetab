/**
 * @module services/adhd-service
 *
 * WHY:  Phase 9 delivers a master ADHD Mode toggle plus four sub-features.
 *       All four downstream plans (09-02..09-05) need a single authority
 *       for reading/writing the settings object, applying the ADHD-02
 *       master-gate invariant ("sub is a no-op if master is OFF"), and
 *       notifying subscribers of cross-tab changes. One service owns it
 *       so those four plans don't each re-derive merge semantics.
 *
 * WHAT: Static ADHDService class with:
 *       - getSettings()      — returns ADHDSettings with missing sub-fields
 *                              populated from DEFAULT_ADHD_SETTINGS (deep merge)
 *       - updateSettings()   — accepts a DeepPartial patch; top-level fields
 *                              replaced, sub-object fields merged with current
 *                              values (not replaced wholesale)
 *       - isFeatureActive()  — gate used by downstream services before running
 *                              a sub-feature: returns `master && sub.enabled`
 *       - subscribe()        — wraps chrome.storage.local.onChanged and fires
 *                              only for adhd_settings key changes; returns
 *                              unsubscribe function
 *
 * HOW:  - Reads/writes chrome.storage.local via the existing Storage wrapper.
 *       - Deep-merge is one level deep (top-level + sub-objects). Arrays like
 *         whitelistDomains are REPLACED wholesale on patch, not merged — caller
 *         passes the full new array.
 *       - subscribe filters on the ADHD_SETTINGS_STORAGE_KEY literal; unrelated
 *         storage keys are never forwarded.
 *
 * NOT:  Does not validate settings with Zod — downstream plans may add a
 *         validator if wire-protocol schema checks become valuable.
 *       Does not mutate the simplify data-attribute on the document root —
 *         that is useSimplifyMode's job (wired into each entry point).
 *       Does not register itself as a syncable key — see delta-tracker.ts.
 */

import { Storage } from '@/utils/storage';
import {
  ADHD_SETTINGS_STORAGE_KEY,
  DEFAULT_ADHD_SETTINGS,
  type ADHDFeatureName,
  type ADHDSettings,
} from '@/types/adhd';

const LOG_PREFIX = '[BlueTab][ADHDService]';

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

/**
 * One-level deep merge: top-level fields replace, plain-object sub-fields merge.
 *
 * Scope is intentional — ADHDSettings only has one layer of nested objects;
 * going any deeper would pull in array semantics we don't want (arrays like
 * whitelistDomains must be replaced wholesale, not concatenated).
 */
function mergeSettings(current: ADHDSettings, patch: DeepPartial<ADHDSettings>): ADHDSettings {
  const result: ADHDSettings = { ...current };
  for (const key of Object.keys(patch) as Array<keyof ADHDSettings>) {
    const patchVal = patch[key];
    if (patchVal === undefined) continue;
    const currentVal = current[key];
    if (
      patchVal !== null &&
      typeof patchVal === 'object' &&
      !Array.isArray(patchVal) &&
      currentVal !== null &&
      typeof currentVal === 'object' &&
      !Array.isArray(currentVal)
    ) {
      (result[key] as object) = { ...(currentVal as object), ...(patchVal as object) };
    } else {
      (result[key] as unknown) = patchVal as unknown;
    }
  }
  return result;
}

export class ADHDService {
  /**
   * Read the current ADHDSettings from chrome.storage.local.
   *
   * Missing top-level and sub-object fields fall back to DEFAULT_ADHD_SETTINGS
   * so that code written for the full shape never needs null checks.
   */
  static async getSettings(): Promise<ADHDSettings> {
    const stored = await Storage.get<DeepPartial<ADHDSettings>>(ADHD_SETTINGS_STORAGE_KEY);
    if (!stored) return { ...DEFAULT_ADHD_SETTINGS };
    return mergeSettings(DEFAULT_ADHD_SETTINGS, stored);
  }

  /**
   * Apply a partial patch to the stored ADHDSettings.
   *
   * Sub-object patches are merged with the current sub-object (not replaced),
   * so callers can pass `{ autoSuspend: { enabled: true } }` without losing
   * the other AutoSuspendSettings fields.
   */
  static async updateSettings(patch: DeepPartial<ADHDSettings>): Promise<void> {
    const current = await this.getSettings();
    const next = mergeSettings(current, patch);
    await Storage.set(ADHD_SETTINGS_STORAGE_KEY, next);
    console.log(`${LOG_PREFIX} Updated settings:`, Object.keys(patch).join(', '));
  }

  /**
   * Returns TRUE only when BOTH the master toggle AND the sub-feature toggle
   * are enabled. Downstream services must gate on this — reading
   * `settings[name].enabled` directly would skip the master invariant.
   *
   * Contract: this is the ADHD-02 enforcement point.
   */
  static async isFeatureActive(name: ADHDFeatureName): Promise<boolean> {
    const settings = await this.getSettings();
    if (!settings.masterEnabled) return false;
    return settings[name].enabled;
  }

  /**
   * Subscribe to ADHD settings changes. The listener receives only the new
   * value for `adhd_settings`; other storage keys are never forwarded.
   *
   * Returns an unsubscribe function that removes the wrapper from
   * chrome.storage.local.onChanged.
   */
  static subscribe(listener: (next: ADHDSettings) => void): () => void {
    const wrapper = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ): void => {
      if (areaName !== 'local') return;
      const change = changes[ADHD_SETTINGS_STORAGE_KEY];
      if (!change) return;
      // newValue can be undefined if the key was removed; treat as defaults.
      const next = change.newValue
        ? mergeSettings(DEFAULT_ADHD_SETTINGS, change.newValue as DeepPartial<ADHDSettings>)
        : { ...DEFAULT_ADHD_SETTINGS };
      try {
        listener(next);
      } catch (err) {
        console.error(`${LOG_PREFIX} subscriber threw:`, err);
      }
    };
    chrome.storage.onChanged.addListener(wrapper);
    return () => chrome.storage.onChanged.removeListener(wrapper);
  }
}

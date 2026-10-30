/**
 * @module services/visible-tab-limit-service
 *
 * WHY:  Phase 12 ADHD-10/11/12 — users with ADHD benefit from having a
 *       bounded number of visible tabs at all times. A cluttered tab bar
 *       impairs working memory. This service enforces that bound by moving
 *       overflow tabs into collapsed Chrome tab groups named "Hidden" (for
 *       ungrouped tabs) or "H:<parentGroupName>" (for grouped tabs).
 *
 *       SAFETY invariant: this service NEVER calls chrome.tabs.remove,
 *       chrome.tabs.update with a chrome-extension:// URL, chrome.tabs.move,
 *       chrome.tabs.create, chrome.tabs.highlight, or chrome.tabs.discard.
 *       The only tab-strip mutations allowed are:
 *         chrome.tabs.group / chrome.tabs.ungroup
 *         chrome.tabGroups.update / chrome.tabGroups.query / chrome.tabGroups.get
 *       The ADHD-12 contract test (safety-contracts.adhd12.test.ts) enforces
 *       this mechanically on every commit.
 *
 * WHAT: Static VisibleTabLimitService class with:
 *       - reconcile(windowId?)     — full sweep: moves overflow unpinned tabs
 *                                    into H:* collapsed groups; safe no-op when
 *                                    disabled. Called on onStartup (RESEARCH #3).
 *       - onTabActivated(tabId, windowId) — non-displacing activation handler:
 *                                    if activated tab is in H:* AND room exists
 *                                    below limit, move it out and re-collapse H:*.
 *                                    If at limit, do nothing (Chrome auto-expands;
 *                                    accepted per RESEARCH #4).
 *       - onTabManualMoved(tabId, windowId) — displacing manual-drag handler:
 *                                    when user drags a tab out of H:* into its
 *                                    parent group and that push over limit, evict
 *                                    oldest-focused tab(s) back into H:*.
 *       - scheduleReconcile(windowId) — 250ms debounced reconcile trigger; used
 *                                    by service-worker event listeners for tab
 *                                    create/remove/update events.
 *       - getOrCreateShadowGroup(title, windowId, firstTabId, color) — encapsulates
 *                                    the RESEARCH #5 reuse-first query: query for
 *                                    matching-titled collapsed group, reuse if
 *                                    found, create+collapse if not.
 *       - clampLimit(n)            — clamps a raw limit value to [5, 30].
 *
 * HOW:  Reads settings via ADHDService.getSettings().
 *       Sorts unpinned tabs by lastAccessed descending; top N stay visible.
 *       Groups overflow by their parent Chrome group; creates/reuses H:* groups.
 *       Color choice: 'grey' for H:* groups (neutral-quieted semantics — the
 *       H:* group is a holding area, not a user-owned category; grey signals
 *       "not active" without competing with the parent group's color).
 *       See RESEARCH #5 for why grey is preferred over matching parent color.
 *
 * NOT:  SAFETY-01: NEVER call chrome.tabs.remove, chrome.tabs.update with a
 *       chrome-extension:// URL, or any navigation-away pattern. This is
 *       architectural and verified by safety-contracts.adhd12.test.ts.
 *
 *       Does not render UI — see Plan 12-05 ADHDSettings slider.
 *       Does not register its own listeners — see service-worker.ts (Task 3).
 *       Does not persist H:* group IDs — Chrome's native group persistence
 *       is unreliable across restarts (RESEARCH #3); reconcile rebuilds as needed.
 */

import { ADHDService } from '@/services/adhd-service';
import { Storage } from '@/utils/storage';

// ---------------------------------------------------------------------------
// Type augmentation
// ---------------------------------------------------------------------------

/**
 * chrome.tabs.Tab has a `lastAccessed` property in Chrome's actual runtime
 * (documented in Chrome Developers docs as "tabs.Tab.lastAccessed") but it
 * is absent from some @types/chrome versions. Cast tabs through this interface
 * to access it safely.
 */
interface TabWithLastAccessed extends chrome.tabs.Tab {
  lastAccessed?: number;
}

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/** Title used for shadow groups containing ungrouped overflow tabs. */
export const HIDDEN_GROUP_TITLE = 'Hidden';

/** Prefix for shadow groups paired with a user tab group (e.g., 'H:Work'). */
export const HIDDEN_GROUP_PREFIX = 'H:';

/** Chrome tab groups with this title or starting with this prefix are Bluetab-managed. */
export const isHiddenGroupTitle = (title: string | undefined): boolean => {
  if (!title) return false;
  return title === HIDDEN_GROUP_TITLE || title.startsWith(HIDDEN_GROUP_PREFIX);
};

/** ungrouped tab groupId value in Chrome extension APIs. */
const UNGROUPED_ID = -1 as const;

// ---------------------------------------------------------------------------
// VTL-2: Tab metadata storage
// Storage key for per-tab original-group metadata.
// Persisted across restarts so graduated tabs can return to their home group.
// ---------------------------------------------------------------------------

/** Shape of per-tab metadata stored by VTL. */
export interface VtlTabMeta {
  /** The original group this tab belonged to before demotion, or null if ungrouped. */
  originalGroup: { title: string; color: chrome.tabGroups.ColorEnum } | null;
}

/** chrome.storage.local key for VTL tab metadata map (Record<tabId, VtlTabMeta>). */
export const VTL_TAB_METADATA_KEY = 'vtl_tab_metadata' as const;

/**
 * Read the full VTL tab metadata map from storage.
 */
async function readTabMetadata(): Promise<Record<number, VtlTabMeta>> {
  const result = await Storage.get<Record<number, VtlTabMeta>>(VTL_TAB_METADATA_KEY);
  return result ?? {};
}

/**
 * Write a single tab's VTL metadata entry.
 */
async function writeTabMeta(tabId: number, meta: VtlTabMeta): Promise<void> {
  const existing = await readTabMetadata();
  existing[tabId] = meta;
  await Storage.set(VTL_TAB_METADATA_KEY, existing);
}

/**
 * Delete the VTL metadata entry for a tab (called when tab graduates or is removed).
 */
async function deleteTabMeta(tabId: number): Promise<void> {
  const existing = await readTabMetadata();
  delete existing[tabId];
  await Storage.set(VTL_TAB_METADATA_KEY, existing);
}

// ---------------------------------------------------------------------------
// Module-level debounce state
// ---------------------------------------------------------------------------

/** Per-window debounce timers for scheduleReconcile. */
const reconcileTimers = new Map<number, ReturnType<typeof setTimeout>>();

// ---------------------------------------------------------------------------
// F1: User-expanded H:* group tracking
//
// When Chrome fires tabGroups.onUpdated with collapsed:false for an H:* group
// that WE did NOT programmatically expand, the user manually expanded the header.
// Reconcile must skip re-collapsing these groups until focus moves away.
// ---------------------------------------------------------------------------

/**
 * Group IDs of H:* groups the user has manually expanded.
 * Reconcile skips these; focus-away clears them (and re-collapses).
 */
const userExpandedGroups = new Set<number>();

/**
 * Called by service-worker's tabGroups.onUpdated listener when an H:* group's
 * collapsed state flips to false WITHOUT being caused by our own API calls.
 * Marks the group as user-expanded so reconcile does not fight Chrome's UI.
 *
 * @param groupId The group that was expanded by the user.
 */
export function onHiddenGroupUserExpanded(groupId: number): void {
  userExpandedGroups.add(groupId);
}

// ---------------------------------------------------------------------------
// VisibleTabLimitService
// ---------------------------------------------------------------------------

export class VisibleTabLimitService {
  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Clamp a raw limit value to the valid slider range [5, 30].
   * Called by ADHDService.updateSettings when user changes the limit slider.
   */
  static clampLimit(n: number): number {
    return Math.max(5, Math.min(30, Math.round(n)));
  }

  /**
   * Full reconcile: evaluate all tabs in the window against the configured
   * limit and move overflow tabs into H:* collapsed groups.
   *
   * Called on:
   *   - chrome.runtime.onStartup (RESEARCH #3 — H:* groups don't survive restarts)
   *   - chrome.runtime.onInstalled (extension update path)
   *   - User changes the limit value in ADHD Settings
   *   - scheduleReconcile (debounced) on tab create/remove/update events
   *
   * Safe no-op when adhd_settings.visibleTabLimit.enabled === false.
   */
  static async reconcile(windowId?: number): Promise<void> {
    const settings = await ADHDService.getSettings();
    if (!settings.masterEnabled || !settings.visibleTabLimit?.enabled) return;

    const { limit } = settings.visibleTabLimit;
    const effectiveWindowId = windowId ?? chrome.windows?.WINDOW_ID_CURRENT ?? -2;

    // Query unpinned tabs only. Pinned tabs are NEVER counted against the limit
    // and are NEVER moved into H:* groups — this is a structural invariant.
    // We don't need to query pinned tabs at all; they are always implicitly safe.
    const unpinnedTabs = await chrome.tabs.query({ windowId: effectiveWindowId, pinned: false });

    // Sort unpinned by lastAccessed descending (most recently focused first).
    const sorted = (unpinnedTabs as TabWithLastAccessed[]).sort(
      (a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0),
    );

    // Top `limit` unpinned tabs stay visible; the rest are overflow.
    // Re-collapse any existing H:* groups whose tabs are all non-active
    // (Chrome auto-expands on focus; we re-collapse when focus leaves).
    await VisibleTabLimitService._recollapseIdleHiddenGroups(effectiveWindowId, sorted);

    // Separate visible vs overflow.
    const visibleTabs = sorted.slice(0, limit);
    const overflowTabs = sorted.slice(limit);

    if (overflowTabs.length === 0) return; // Already within limit.

    // Group overflow tabs by their parent Chrome group ID.
    const overflowByParent = new Map<number, chrome.tabs.Tab[]>();
    for (const tab of overflowTabs) {
      const parentId = tab.groupId ?? UNGROUPED_ID;
      // Skip tabs already in an H:* group (they're already hidden).
      const existingGroupId = tab.groupId ?? UNGROUPED_ID;
      if (existingGroupId !== UNGROUPED_ID) {
        const groupTitle = await VisibleTabLimitService._getGroupTitle(existingGroupId);
        if (isHiddenGroupTitle(groupTitle)) continue; // Already in shadow group.
      }

      if (!overflowByParent.has(parentId)) {
        overflowByParent.set(parentId, []);
      }
      overflowByParent.get(parentId)!.push(tab);
    }

    // For each parent group's overflow batch, move into the corresponding H:* group.
    for (const [parentGroupId, tabs] of overflowByParent.entries()) {
      if (tabs.length === 0) continue;

      // Determine shadow group title.
      let shadowTitle: string;
      let parentGroupInfo: { title: string; color: chrome.tabGroups.ColorEnum } | null = null;
      if (parentGroupId === UNGROUPED_ID) {
        shadowTitle = HIDDEN_GROUP_TITLE;
        parentGroupInfo = null;
      } else {
        try {
          const group = await chrome.tabGroups.get(parentGroupId);
          if (group?.title) {
            parentGroupInfo = { title: group.title, color: group.color };
            shadowTitle = `${HIDDEN_GROUP_PREFIX}${group.title}`;
          } else {
            shadowTitle = HIDDEN_GROUP_TITLE;
            parentGroupInfo = null;
          }
        } catch {
          shadowTitle = HIDDEN_GROUP_TITLE;
          parentGroupInfo = null;
        }
      }

      const tabIds = tabs.map((t) => t.id!).filter(Boolean);
      if (tabIds.length === 0) continue;

      // VTL-2: Persist originalGroup metadata for each demoted tab.
      for (const tabId of tabIds) {
        await writeTabMeta(tabId, { originalGroup: parentGroupInfo });
      }

      // Get or create the shadow group; pass the first tab ID for group creation.
      const shadowGroupId = await VisibleTabLimitService.getOrCreateShadowGroup(
        shadowTitle,
        effectiveWindowId,
        tabIds[0],
        'grey' as chrome.tabGroups.ColorEnum,
      );

      // Move remaining overflow tabs into the shadow group.
      const remaining = tabIds.slice(1);
      if (remaining.length > 0) {
        await chrome.tabs.group({ tabIds: remaining, groupId: shadowGroupId });
      }
    }

    void visibleTabs; // suppress unused-var; used conceptually above

    // K-fix: Order managed groups after all demotions are applied.
    // Hidden → leftmost; H:<name> → adjacent-left of parent.
    await VisibleTabLimitService._orderManagedGroups(effectiveWindowId);
  }

  /**
   * Called by service-worker's chrome.tabs.onActivated listener.
   *
   * Activation is NON-DISPLACING (CONTEXT.md §Visible Tab Limit):
   *  - If activated tab is in an H:* group AND the non-H:* visible count is
   *    below the limit: move it out of H:* back to its original group (or
   *    ungrouped if no original parent is recoverable).
   *  - If at limit: do nothing. Chrome auto-expands the H:* group (RESEARCH #4);
   *    Bluetab accepts this and re-collapses when a different tab gains focus.
   */
  static async onTabActivated(tabId: number, windowId: number): Promise<void> {
    const settings = await ADHDService.getSettings();
    if (!settings.masterEnabled || !settings.visibleTabLimit?.enabled) return;

    const { limit } = settings.visibleTabLimit;

    let tab: chrome.tabs.Tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      return; // Tab no longer exists.
    }

    // F1: When focus lands on a tab, collapse any user-expanded H:* groups whose
    // active tab is now OUTSIDE those groups. This is the only authorized collapse
    // path for user-expanded groups (reconcile skips them).
    const newTabGroupId = tab.groupId ?? UNGROUPED_ID;
    if (userExpandedGroups.size > 0) {
      for (const expandedGid of Array.from(userExpandedGroups)) {
        // If the newly-active tab is NOT inside this expanded group → collapse and clear.
        if (newTabGroupId !== expandedGid) {
          userExpandedGroups.delete(expandedGid);
          try {
            const tabsInGroup = await chrome.tabs.query({ windowId, groupId: expandedGid });
            if (tabsInGroup.length > 0) {
              await chrome.tabGroups.update(expandedGid, { collapsed: true });
            }
          } catch {
            // Group may have been removed.
          }
        }
      }
    }

    // Re-collapse any H:* group that no longer has an active tab (the previously
    // active H:* group auto-expanded; now focus moved away, re-collapse it).
    await VisibleTabLimitService._recollapseIdleHiddenGroups(windowId, []);

    const tabGroupId = newTabGroupId;
    if (tabGroupId === UNGROUPED_ID) return; // Not in any group.

    const groupTitle = await VisibleTabLimitService._getGroupTitle(tabGroupId);
    if (!isHiddenGroupTitle(groupTitle)) return; // Not in an H:* group.

    // Count current non-pinned, non-H:* visible tabs.
    const allUnpinned = await chrome.tabs.query({ windowId, pinned: false });
    const visibleCount = await VisibleTabLimitService._countVisible(allUnpinned);

    if (visibleCount >= limit) {
      // At limit: do nothing. Chrome auto-expands, Bluetab accepts it.
      return;
    }

    // Below limit: move activated tab out of H:* back to its original parent.
    // VTL-2: Use persisted originalGroup metadata to find the target group.
    const tabMetadata = await readTabMetadata();
    const meta = tabMetadata[tabId] ?? null;

    let targetGroupId: number = UNGROUPED_ID;

    if (meta?.originalGroup) {
      // Try to find existing group by title + color match.
      const candidates = await chrome.tabGroups.query({ windowId });
      const match = candidates.find(
        (g) =>
          g.title === meta.originalGroup!.title &&
          g.color === meta.originalGroup!.color &&
          !isHiddenGroupTitle(g.title),
      );
      if (match) {
        targetGroupId = match.id;
      } else {
        // Original group is gone — recreate it.
        // We need to first move the tab there, then set the group title/color.
        const newGroupId = await chrome.tabs.group({
          tabIds: [tabId],
          createProperties: { windowId },
        });
        await chrome.tabGroups.update(newGroupId, {
          title: meta.originalGroup.title,
          color: meta.originalGroup.color,
          collapsed: false,
        });
        // VTL-2: Clean up metadata after graduation.
        await deleteTabMeta(tabId);
        // Re-collapse the H:* group.
        if (tabGroupId !== UNGROUPED_ID) {
          const updatedHidden = await chrome.tabs.query({ windowId, groupId: tabGroupId });
          if (updatedHidden.length > 0) {
            await chrome.tabGroups.update(tabGroupId, { collapsed: true });
          }
        }
        return;
      }
    } else if (!meta) {
      // No metadata — fall back to stripping the H: prefix from the group title.
      const originalGroupTitle =
        groupTitle === HIDDEN_GROUP_TITLE
          ? null
          : groupTitle!.slice(HIDDEN_GROUP_PREFIX.length);
      if (originalGroupTitle) {
        const parentGroups = await chrome.tabGroups.query({ title: originalGroupTitle, windowId });
        const realParent = parentGroups.find((g) => !isHiddenGroupTitle(g.title));
        if (realParent) targetGroupId = realParent.id;
      }
    }
    // meta exists but originalGroup is null → tab was ungrouped originally → leave ungrouped

    if (targetGroupId !== UNGROUPED_ID) {
      // VTL-3: Move to END of destination group.
      await chrome.tabs.group({ tabIds: [tabId], groupId: targetGroupId });
      // Move tab to end of that group.
      const groupTabs = await chrome.tabs.query({ windowId, groupId: targetGroupId });
      if (groupTabs.length > 0) {
        const lastIndex = Math.max(...groupTabs.map((t) => t.index));
        await chrome.tabs.move(tabId, { index: lastIndex });
      }
    } else {
      await chrome.tabs.ungroup([tabId]);
      // VTL-3: Move ungrouped graduated tab to end of window.
      await chrome.tabs.move(tabId, { index: -1 });
    }

    // VTL-2: Clean up metadata after graduation.
    await deleteTabMeta(tabId);

    // Re-collapse the H:* group (it may have auto-expanded on focus).
    // VTL-1: Only collapse if the active tab is NOT still inside this group.
    if (tabGroupId !== UNGROUPED_ID) {
      const updatedHidden = await chrome.tabs.query({ windowId, groupId: tabGroupId });
      if (updatedHidden.length > 0) {
        await chrome.tabGroups.update(tabGroupId, { collapsed: true });
      }
      // If no tabs remain in the shadow group, Chrome removes it natively.
    }
  }

  /**
   * Handle a manual user-drag of a tab out of an H:* group.
   * Called by service-worker's chrome.tabs.onUpdated listener when
   * changeInfo.groupId has changed.
   *
   * Manual moves are DISPLACING (CONTEXT.md §Manual-move rule): if the
   * destination (parent) group now exceeds the limit, evict the oldest-focused
   * tab(s) from that group into H:* until the count returns to the limit.
   */
  static async onTabManualMoved(tabId: number, windowId: number): Promise<void> {
    const settings = await ADHDService.getSettings();
    if (!settings.masterEnabled || !settings.visibleTabLimit?.enabled) return;

    const { limit } = settings.visibleTabLimit;

    let tab: chrome.tabs.Tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      return;
    }

    const newGroupId = tab.groupId ?? UNGROUPED_ID;
    if (newGroupId === UNGROUPED_ID) {
      // Tab moved to ungrouped — run a general reconcile.
      await VisibleTabLimitService.reconcile(windowId);
      return;
    }

    // Check if the destination is an H:* group — if so, user manually moved INTO
    // shadow; no eviction needed.
    const newGroupTitle = await VisibleTabLimitService._getGroupTitle(newGroupId);
    if (isHiddenGroupTitle(newGroupTitle)) return;

    // Get all non-pinned tabs in the destination group.
    const groupTabs = await chrome.tabs.query({ windowId, groupId: newGroupId, pinned: false });

    if (groupTabs.length <= limit) return; // Still within limit; no eviction needed.

    // Find the oldest-focused tab(s) in the group (excluding the just-moved tab).
    const candidates = (groupTabs as TabWithLastAccessed[])
      .filter((t) => t.id !== tabId)
      .sort((a, b) => (a.lastAccessed ?? 0) - (b.lastAccessed ?? 0)); // oldest first

    const overflowCount = groupTabs.length - limit;
    const toEvict = candidates.slice(0, overflowCount);
    if (toEvict.length === 0) return;

    // Determine the H:* shadow group for this parent group.
    let destGroup: chrome.tabGroups.TabGroup | null = null;
    try {
      destGroup = await chrome.tabGroups.get(newGroupId);
    } catch {
      // ignore
    }
    const shadowTitle = `${HIDDEN_GROUP_PREFIX}${newGroupTitle ?? ''}`;
    const evictTabIds = toEvict.map((t) => t.id!).filter(Boolean);
    if (evictTabIds.length === 0) return;

    // VTL-2: Persist originalGroup metadata for each evicted tab.
    const originalGroupMeta = destGroup
      ? { title: destGroup.title ?? '', color: destGroup.color }
      : null;
    for (const evictTabId of evictTabIds) {
      await writeTabMeta(evictTabId, { originalGroup: originalGroupMeta });
    }

    const shadowGroupId = await VisibleTabLimitService.getOrCreateShadowGroup(
      shadowTitle,
      windowId,
      evictTabIds[0],
      'grey' as chrome.tabGroups.ColorEnum,
    );

    const remaining = evictTabIds.slice(1);
    if (remaining.length > 0) {
      await chrome.tabs.group({ tabIds: remaining, groupId: shadowGroupId });
    }
  }

  /**
   * 250ms-debounced reconcile for use in tab create/remove/update listeners.
   * Prevents reconcile floods when many tabs change in rapid succession.
   */
  static scheduleReconcile(windowId: number): void {
    const existing = reconcileTimers.get(windowId);
    if (existing !== undefined) clearTimeout(existing);

    const timer = setTimeout(() => {
      reconcileTimers.delete(windowId);
      VisibleTabLimitService.reconcile(windowId).catch((err) => {
        console.warn('[BlueTab][VTL] scheduleReconcile error:', err);
      });
    }, 250);

    reconcileTimers.set(windowId, timer);
  }

  /**
   * Query for an existing shadow group by exact title in a window.
   * RESEARCH #5: reuse the first matching collapsed group if present;
   * create a new one (collapsed, with Bluetab-owned color) if not.
   *
   * NOTE: The caller is responsible for moving ONLY the firstTabId into the
   * group during creation. Additional tabs are moved by the caller after this
   * method returns.
   *
   * Color choice: 'grey' — neutral-quieted semantics. Grey signals that the
   * H:* group is a managed holding area, not a user category. Using the parent
   * group's color would visually duplicate it and confuse ownership. Grey reads
   * as "quieted" — consistent with the ADHD design principle of reducing noise.
   */
  static async getOrCreateShadowGroup(
    title: string,
    windowId: number,
    firstTabId: number,
    color: chrome.tabGroups.ColorEnum,
  ): Promise<number> {
    // RESEARCH #5: Query for existing matching-titled groups.
    const existing = await chrome.tabGroups.query({ title, windowId });

    // Reuse the first collapsed matching group that Bluetab manages.
    const reusable = existing.find((g) => g.collapsed === true);
    if (reusable) {
      // Move the first tab into the existing group.
      await chrome.tabs.group({ tabIds: [firstTabId], groupId: reusable.id });
      return reusable.id;
    }

    // Create a new group with the first tab.
    const groupId = await chrome.tabs.group({
      tabIds: [firstTabId],
      createProperties: { windowId },
    });

    // Set the shadow group's visual identity.
    await chrome.tabGroups.update(groupId, {
      title,
      collapsed: true,
      color,
    });

    return groupId;
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  /**
   * Get the title of a Chrome tab group, returning undefined if the group
   * does not exist or the API call fails.
   */
  private static async _getGroupTitle(groupId: number): Promise<string | undefined> {
    if (groupId === UNGROUPED_ID) return undefined;
    try {
      const group = await chrome.tabGroups.get(groupId);
      return group?.title ?? undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Count the number of non-pinned, non-H:* visible tabs in the given list.
   * Tabs that are already in an H:* group are NOT counted as visible.
   */
  private static async _countVisible(unpinnedTabs: chrome.tabs.Tab[]): Promise<number> {
    let count = 0;
    for (const tab of unpinnedTabs) {
      const gid = tab.groupId ?? UNGROUPED_ID;
      if (gid === UNGROUPED_ID) {
        count++;
        continue;
      }
      const title = await VisibleTabLimitService._getGroupTitle(gid);
      if (!isHiddenGroupTitle(title)) count++;
    }
    return count;
  }

  /**
   * Order Bluetab-managed groups in the tab strip (K-fix):
   *
   * Rule 1: `Hidden` group → always leftmost (index 0).
   *   chrome.tabGroups.move(hiddenGroupId, { index: 0 })
   *
   * Rule 2: `H:<name>` groups → immediately LEFT of their parent group `<name>`.
   *   Find parent by querying non-H:* groups with matching title.
   *   Move H:<name> to parentFirstTabIndex (the group slots in before the parent).
   *   If no parent found: H:<name> stays in its current position.
   *
   * Rule 3: `Hidden` is always leftmost regardless of H:<name> ordering.
   *
   * Non-critical: errors are swallowed. Ordering is cosmetic — VTL correctness
   * does not depend on group position.
   */
  static async _orderManagedGroups(windowId: number): Promise<void> {
    try {
      const allGroups = await chrome.tabGroups.query({ windowId });

      // Partition into Hidden, H:<name>, and parent groups
      const hiddenGroups = allGroups.filter((g) => g.title === HIDDEN_GROUP_TITLE);
      const hNameGroups = allGroups.filter(
        (g) => g.title !== HIDDEN_GROUP_TITLE && g.title?.startsWith(HIDDEN_GROUP_PREFIX),
      );

      // Rule 1: Move `Hidden` group(s) to leftmost position (index 0).
      for (const hiddenGroup of hiddenGroups) {
        try {
          await chrome.tabGroups.move(hiddenGroup.id, { index: 0 });
        } catch {
          // Group may have been dissolved; skip.
        }
      }

      // Rule 2: Move each `H:<name>` group immediately left of its parent.
      for (const hGroup of hNameGroups) {
        const parentName = hGroup.title!.slice(HIDDEN_GROUP_PREFIX.length);
        if (!parentName) continue;

        // Find parent group: same title as parentName, not an H:* group.
        const parentCandidates = allGroups.filter(
          (g) => g.title === parentName && !isHiddenGroupTitle(g.title),
        );
        if (parentCandidates.length === 0) continue; // Parent absent; leave H:* in place.

        const parent = parentCandidates[0];

        // Get the parent group's first tab index.
        try {
          const parentTabs = await chrome.tabs.query({ windowId, groupId: parent.id });
          if (parentTabs.length === 0) continue;
          const parentFirstIndex = Math.min(...parentTabs.map((t) => t.index));
          // Slot H:<name> immediately before the parent (at the parent's first tab index).
          await chrome.tabGroups.move(hGroup.id, { index: parentFirstIndex });
        } catch {
          // Skip if parent or tabs no longer exist.
        }
      }
    } catch {
      // Non-critical; swallow errors.
    }
  }

  /**
   * Re-collapse any H:* groups in the window that no longer have an active tab.
   * Called at the start of reconcile and onTabActivated to restore the
   * "collapsed when not focused" invariant after Chrome auto-expands (RESEARCH #4).
   *
   * VTL-1 fix: NEVER collapse an H:* group whose active tab is currently focused.
   * The user is browsing inside that group — collapsing while they are inside it
   * would cause the Chrome native expand to fight our collapse on every click.
   * Collapse happens via the focus-change path (onTabActivated when a non-H:* tab
   * gains focus) instead.
   *
   * @param windowId The window to scan.
   * @param _hint    Unused hint list (reserved for future optimizations).
   */
  private static async _recollapseIdleHiddenGroups(
    windowId: number,
    _hint: chrome.tabs.Tab[],
  ): Promise<void> {
    try {
      // Find all H:* groups in the window.
      const allGroups = await chrome.tabGroups.query({ windowId });
      const allHiddenGroupIds = new Set<number>(
        allGroups.filter((g) => isHiddenGroupTitle(g.title)).map((g) => g.id),
      );

      if (allHiddenGroupIds.size === 0) return;

      // VTL-1: Find the currently active tab's group. If the user's active tab is
      // inside an H:* group, do NOT collapse that group — the user is browsing there.
      const activeTabs = await chrome.tabs.query({ windowId, active: true });
      const activeGroupIds = new Set(activeTabs.map((t) => t.groupId ?? UNGROUPED_ID));

      // Collapse only H:* groups that do NOT contain the currently active tab
      // AND were NOT manually expanded by the user (F1 fix).
      for (const gid of allHiddenGroupIds) {
        if (activeGroupIds.has(gid)) {
          // VTL-1: Skip — user is actively inside this H:* group right now.
          continue;
        }
        if (userExpandedGroups.has(gid)) {
          // F1: Skip — user manually expanded this group header; do not fight Chrome.
          // The group will be re-collapsed via onTabActivated when focus moves away.
          continue;
        }
        try {
          await chrome.tabGroups.update(gid, { collapsed: true });
        } catch {
          // Group may have been removed by Chrome natively (empty group).
        }
      }
    } catch {
      // Non-critical; swallow errors to keep reconcile resilient.
    }
  }
}

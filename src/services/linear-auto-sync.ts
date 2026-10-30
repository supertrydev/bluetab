/**
 * @module services/linear-auto-sync
 *
 * WHY: Auto-sync Bluetab group/tab changes to Linear in real-time
 *      like Notion mirroring - when tabs are added, removed, updated,
 *      automatically sync to Linear issues.
 *
 * WHAT: Monitors storage changes and triggers Linear sync operations.
 */

import { dispatchVerb } from './integration-service';
import { listConnectedAccounts } from './integration-token-storage';
import { LinearSyncStorage } from './linear-sync-storage';
import { GroupMemoryStorageService } from '../utils/group-memory-storage';
import type { TabGroup } from '../types/models';

interface ChangeEvent {
  type: 'group_added' | 'group_removed' | 'group_updated' | 'tab_added' | 'tab_removed' | 'tab_updated';
  groupId: string;
  data?: any;
}

export class LinearAutoSyncService {
  private static isInitialized = false;

  static async initialize(): Promise<void> {
    if (this.isInitialized) return;

    console.log('[LinearAutoSync] Initializing auto-sync service...');

    // Fix sync groups that were stored with empty accountId or stuck in error
    await LinearSyncStorage.repairSyncData(async () => {
      const accounts = await listConnectedAccounts();
      return accounts.find(a => a.integrationId === 'linear')?.accountId ?? null;
    });

    this.isInitialized = true;
    console.log('[LinearAutoSync] Auto-sync service initialized');
  }

  static async handleGroupsChanged(oldGroups: TabGroup[], newGroups: TabGroup[]): Promise<void> {
    console.log(`[LinearAutoSync] Groups changed: ${oldGroups.length} → ${newGroups.length}`);

    const events = this.detectChanges(oldGroups, newGroups);
    console.log(`[LinearAutoSync] Detected ${events.length} events:`, events.map(e => `${e.type}:${e.groupId}`));

    for (const event of events) {
      await this.handleChangeEvent(event);
    }
  }

  private static detectChanges(oldGroups: TabGroup[], newGroups: TabGroup[]): ChangeEvent[] {
    const events: ChangeEvent[] = [];
    const oldGroupMap = new Map(oldGroups.map(g => [g.id, g]));
    const newGroupMap = new Map(newGroups.map(g => [g.id, g]));

    // Detect removed groups
    for (const oldGroup of oldGroups) {
      if (!newGroupMap.has(oldGroup.id)) {
        events.push({
          type: 'group_removed',
          groupId: oldGroup.id
        });
      }
    }

    // Detect added and updated groups
    for (const newGroup of newGroups) {
      const oldGroup = oldGroupMap.get(newGroup.id);

      if (!oldGroup) {
        // New group
        events.push({
          type: 'group_added',
          groupId: newGroup.id,
          data: newGroup
        });
      } else {
        // Check for tab changes
        const tabEvents = this.detectTabChanges(oldGroup, newGroup);
        events.push(...tabEvents);

        // Check for group property changes
        if (
          oldGroup.name !== newGroup.name ||
          oldGroup.color !== newGroup.color ||
          JSON.stringify(oldGroup.tags) !== JSON.stringify(newGroup.tags)
        ) {
          events.push({
            type: 'group_updated',
            groupId: newGroup.id,
            data: newGroup
          });
        }
      }
    }

    return events;
  }

  private static detectTabChanges(oldGroup: TabGroup, newGroup: TabGroup): ChangeEvent[] {
    const events: ChangeEvent[] = [];
    const oldTabMap = new Map(oldGroup.tabs.map(t => [t.id, t]));
    const newTabMap = new Map(newGroup.tabs.map(t => [t.id, t]));

    // Detect removed tabs
    for (const oldTab of oldGroup.tabs) {
      if (!newTabMap.has(oldTab.id)) {
        events.push({
          type: 'tab_removed',
          groupId: newGroup.id,
          data: { tabId: oldTab.id }
        });
      }
    }

    // Detect added and updated tabs
    for (const newTab of newGroup.tabs) {
      const oldTab = oldTabMap.get(newTab.id);

      if (!oldTab) {
        // New tab
        events.push({
          type: 'tab_added',
          groupId: newGroup.id,
          data: { tabData: newTab }
        });
      } else if (
        oldTab.title !== newTab.title ||
        oldTab.url !== newTab.url
      ) {
        // Updated tab
        events.push({
          type: 'tab_updated',
          groupId: newGroup.id,
          data: { tabId: newTab.id, tabData: newTab }
        });
      }
    }

    return events;
  }

  private static async handleChangeEvent(event: ChangeEvent): Promise<void> {
    try {
      // Check if this group is being synced to Linear
      const isSyncing = await LinearSyncStorage.isGroupSyncing(event.groupId);
      if (!isSyncing && event.type !== 'group_added') {
        console.log(`[LinearAutoSync] Skipping ${event.type} for group ${event.groupId} — not syncing`);
        return;
      }

      // Get Linear account for this group
      const syncGroups = await LinearSyncStorage.getAllSyncGroups();
      const syncGroup = syncGroups.find(g => g.groupId === event.groupId);

      if (!syncGroup && event.type !== 'group_added') {
        console.log(`[LinearAutoSync] Skipping ${event.type} for group ${event.groupId} — no sync config`);
        return;
      }

      let accountId = syncGroup?.accountId || '';
      if (!accountId) {
        const accounts = await listConnectedAccounts();
        accountId = accounts.find(a => a.integrationId === 'linear')?.accountId ?? '';
      }
      const teamId = syncGroup?.teamId || '';

      console.log(`[LinearAutoSync] Handling ${event.type} for group ${event.groupId}, accountId=${accountId}, teamId=${teamId}`);

      let result;
      switch (event.type) {
        case 'group_removed':
          // Check if group is in memory (tab click removes from UI but keeps in memory)
          const memory = await GroupMemoryStorageService.getMemory();
          const isInMemory = !!memory.groups[event.groupId];

          if (isInMemory) {
            // Group is in memory, don't delete issues - just sync current state
            console.log(`[LinearAutoSync] Group ${event.groupId} moved to memory, syncing instead of deleting`);
            result = await dispatchVerb('linear', 'sync_group_changes_to_linear', {
              groupId: event.groupId,
              action: 'sync_all'
            }, accountId);
          } else {
            // Group permanently deleted - delete issues
            result = await dispatchVerb('linear', 'sync_group_changes_to_linear', {
              groupId: event.groupId,
              action: 'delete'
            }, accountId);
            console.log(`[LinearAutoSync] Permanently deleted group ${event.groupId}, deleted issues`);
          }
          console.log(`[LinearAutoSync] group_removed result:`, result);
          break;

        case 'tab_added':
          result = await dispatchVerb('linear', 'sync_group_changes_to_linear', {
            groupId: event.groupId,
            action: 'add_tab',
            tabData: event.data.tabData,
            teamId
          }, accountId);
          console.log(`[LinearAutoSync] tab_added result:`, result);
          break;

        case 'tab_removed': {
          const tabMemory = await GroupMemoryStorageService.getMemory();
          if (tabMemory.groups[event.groupId]) {
            console.log(`[LinearAutoSync] Skipping tab_removed for ${event.groupId} — group is in memory`);
            break;
          }
          result = await dispatchVerb('linear', 'sync_group_changes_to_linear', {
            groupId: event.groupId,
            action: 'remove_tab',
            tabId: event.data.tabId
          }, accountId);
          console.log(`[LinearAutoSync] tab_removed result:`, result);
          break;
        }

        case 'tab_updated':
          result = await dispatchVerb('linear', 'sync_group_changes_to_linear', {
            groupId: event.groupId,
            action: 'update_tab',
            tabId: event.data.tabId,
            tabData: event.data.tabData
          }, accountId);
          console.log(`[LinearAutoSync] tab_updated result:`, result);
          break;

        case 'group_updated':
          const groupIssues = await LinearSyncStorage.getGroupIssues(event.groupId);
          for (const issue of groupIssues) {
            result = await dispatchVerb('linear', 'update_issue', {
              issueId: issue.issueId,
              title: `${event.data.name} - ${issue.tabTitle}`,
              description: `Group: ${event.data.name}\nTab: ${issue.tabTitle}\nURL: ${issue.tabUrl}`
            }, accountId);
            console.log(`[LinearAutoSync] group_updated issue result:`, result);
          }
          break;

        default:
          console.log(`[LinearAutoSync] Unhandled event type: ${event.type}`);
      }

    } catch (error) {
      console.error(`[LinearAutoSync] Error handling ${event.type}:`, error);
      if (event.groupId) {
        await LinearSyncStorage.updateSyncStatus(
          event.groupId,
          'error',
          error instanceof Error ? error.message : 'Unknown error'
        );
      }
    }
  }

  static async start(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }
  }

  static async stop(): Promise<void> {
    this.isInitialized = false;
    console.log('[LinearAutoSync] Auto-sync service stopped');
  }

  // Manual sync trigger
  static async syncGroup(groupId: string, action: string, data?: any): Promise<void> {
    const event: ChangeEvent = {
      type: action as any,
      groupId,
      data
    };
    await this.handleChangeEvent(event);
  }
}

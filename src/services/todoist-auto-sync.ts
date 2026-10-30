import { dispatchVerb } from './integration-service';
import { listConnectedAccounts } from './integration-token-storage';
import { TodoistSyncStorage } from './todoist-sync-storage';
import { GroupMemoryStorageService } from '../utils/group-memory-storage';
import type { TabGroup } from '../types/models';

interface ChangeEvent {
  type: 'group_removed' | 'group_updated' | 'tab_added' | 'tab_removed' | 'tab_updated';
  groupId: string;
  data?: any;
}

export class TodoistAutoSyncService {
  private static isInitialized = false;

  static async initialize(): Promise<void> {
    if (this.isInitialized) return;
    this.isInitialized = true;
    console.log('[TodoistAutoSync] Auto-sync service initialized');
  }

  static async handleGroupsChanged(oldGroups: TabGroup[], newGroups: TabGroup[]): Promise<void> {
    console.log(`[TodoistAutoSync] handleGroupsChanged called: ${oldGroups.length} → ${newGroups.length}`);
    const events = this.detectChanges(oldGroups, newGroups);
    if (events.length === 0) {
      console.log('[TodoistAutoSync] No events detected');
      return;
    }
    console.log(`[TodoistAutoSync] Detected ${events.length} events:`, events.map(e => `${e.type}:${e.groupId}`));
    for (const event of events) {
      await this.handleChangeEvent(event);
    }
  }

  private static detectChanges(oldGroups: TabGroup[], newGroups: TabGroup[]): ChangeEvent[] {
    const events: ChangeEvent[] = [];
    const oldMap = new Map(oldGroups.map(g => [g.id, g]));
    const newMap = new Map(newGroups.map(g => [g.id, g]));

    for (const oldGroup of oldGroups) {
      if (!newMap.has(oldGroup.id)) {
        events.push({ type: 'group_removed', groupId: oldGroup.id });
      }
    }

    for (const newGroup of newGroups) {
      const oldGroup = oldMap.get(newGroup.id);
      if (!oldGroup) continue;

      const oldTabMap = new Map(oldGroup.tabs.map(t => [t.id, t]));
      const newTabMap = new Map(newGroup.tabs.map(t => [t.id, t]));

      for (const oldTab of oldGroup.tabs) {
        if (!newTabMap.has(oldTab.id)) {
          events.push({ type: 'tab_removed', groupId: newGroup.id, data: { tabId: oldTab.id } });
        }
      }
      for (const newTab of newGroup.tabs) {
        const oldTab = oldTabMap.get(newTab.id);
        if (!oldTab) {
          events.push({ type: 'tab_added', groupId: newGroup.id, data: { tabData: newTab } });
        } else if (oldTab.title !== newTab.title || oldTab.url !== newTab.url) {
          events.push({ type: 'tab_updated', groupId: newGroup.id, data: { tabId: newTab.id, tabData: newTab } });
        }
      }

      if (oldGroup.name !== newGroup.name) {
        events.push({ type: 'group_updated', groupId: newGroup.id, data: newGroup });
      }
    }

    return events;
  }

  private static async handleChangeEvent(event: ChangeEvent): Promise<void> {
    try {
      const isSyncing = await TodoistSyncStorage.isGroupSyncing(event.groupId);
      if (!isSyncing) {
        console.log(`[TodoistAutoSync] Skipping ${event.type} for group ${event.groupId} — not syncing`);
        return;
      }

      const syncGroups = await TodoistSyncStorage.getAllSyncGroups();
      const syncGroup = syncGroups.find(g => g.groupId === event.groupId);
      if (!syncGroup) {
        console.log(`[TodoistAutoSync] No sync config for group ${event.groupId}`);
        return;
      }

      let accountId = syncGroup.accountId;
      if (!accountId) {
        const accounts = await listConnectedAccounts();
        accountId = accounts.find(a => a.integrationId === 'todoist')?.accountId ?? '';
      }
      const projectId = syncGroup.projectId;

      console.log(`[TodoistAutoSync] Dispatching ${event.type} for group ${event.groupId}, accountId=${accountId}, projectId=${projectId}`);

      let result;
      switch (event.type) {
        case 'group_removed':
          // Check if group is in memory (tab click removes from UI but keeps in memory)
          const memory = await GroupMemoryStorageService.getMemory();
          const isInMemory = !!memory.groups[event.groupId];

          if (isInMemory) {
            // Group is in memory, don't delete tasks - just sync current state
            console.log(`[TodoistAutoSync] Group ${event.groupId} moved to memory, syncing instead of deleting`);
            result = await dispatchVerb('todoist', 'sync_group_changes_to_todoist', {
              groupId: event.groupId,
              action: 'sync_all',
            }, accountId);
          } else {
            // Group permanently deleted - delete tasks
            result = await dispatchVerb('todoist', 'sync_group_changes_to_todoist', {
              groupId: event.groupId,
              action: 'delete',
            }, accountId);
            console.log(`[TodoistAutoSync] Permanently deleted group ${event.groupId}, deleted tasks`);
          }
          console.log(`[TodoistAutoSync] group_removed result:`, result);
          break;

        case 'tab_added':
          result = await dispatchVerb('todoist', 'sync_group_changes_to_todoist', {
            groupId: event.groupId,
            action: 'add_tab',
            tabData: event.data.tabData,
            projectId,
          }, accountId);
          break;

        case 'tab_removed': {
          const tabMemory = await GroupMemoryStorageService.getMemory();
          if (tabMemory.groups[event.groupId]) {
            console.log(`[TodoistAutoSync] Skipping tab_removed for ${event.groupId} — group is in memory`);
            break;
          }
          result = await dispatchVerb('todoist', 'sync_group_changes_to_todoist', {
            groupId: event.groupId,
            action: 'remove_tab',
            tabId: event.data.tabId,
          }, accountId);
          break;
        }

        case 'tab_updated':
          result = await dispatchVerb('todoist', 'sync_group_changes_to_todoist', {
            groupId: event.groupId,
            action: 'update_tab',
            tabId: event.data.tabId,
            tabData: event.data.tabData,
          }, accountId);
          break;

        case 'group_updated': {
          const groupTasks = await TodoistSyncStorage.getGroupTasks(event.groupId);
          for (const task of groupTasks) {
            await dispatchVerb('todoist', 'sync_group_changes_to_todoist', {
              groupId: event.groupId,
              action: 'update_tab',
              tabId: task.tabId,
              tabData: { id: task.tabId, title: task.tabTitle, url: task.tabUrl },
              groupName: event.data.name,
            }, accountId);
          }
          break;
        }
      }
      console.log(`[TodoistAutoSync] ${event.type} result:`, result);
    } catch (error) {
      console.error(`[TodoistAutoSync] Error handling ${event.type}:`, error);
      await TodoistSyncStorage.updateSyncStatus(
        event.groupId,
        'error',
        error instanceof Error ? error.message : 'Unknown error',
      );
    }
  }

  static async start(): Promise<void> {
    if (!this.isInitialized) await this.initialize();
  }
}

/**
 * @module services/discord-auto-sync
 *
 * WHY: Auto-sync Bluetab group/tab changes to Discord in real-time.
 *      When tabs are added, removed, or updated, the mirrored Discord
 *      webhook message is edited via PATCH. When the group is permanently
 *      deleted, the message is deleted.
 *
 * WHAT: Mirrors SlackAutoSyncService — watches for group changes and
 *       triggers sync_group_mirroring / stop_group_mirroring verbs.
 *
 * HOW: Initialize once on app startup. Call handleGroupsChanged whenever
 *      groups state changes (tab add/remove/update, group rename, etc.)
 */

import type { TabGroup } from '../types/models';
import { Storage } from '../utils/storage';
import { GroupMemoryStorageService } from '../utils/group-memory-storage';
import { dispatchVerb } from './integration-service';
import type { IntegrationId } from './integrations/registry';

interface DiscordMirrorState {
  webhookUrl: string;
  messageId: string;
  accountId: string;
}

function mirrorKey(groupId: string): string {
  return `discord_mirror:${groupId}`;
}

interface ChangeEvent {
  type: 'group_added' | 'group_removed' | 'group_updated' | 'tab_added' | 'tab_removed' | 'tab_updated';
  groupId: string;
  data?: unknown;
}

export class DiscordAutoSyncService {
  private static isInitialized = false;

  static async initialize(): Promise<void> {
    if (this.isInitialized) return;
    this.isInitialized = true;
    console.log('[DiscordAutoSync] Auto-sync service initialized');
  }

  static async handleGroupsChanged(oldGroups: TabGroup[], newGroups: TabGroup[]): Promise<void> {
    const events = this.detectChanges(oldGroups, newGroups);
    if (events.length === 0) return;

    for (const event of events) {
      await this.handleChangeEvent(event);
    }
  }

  private static detectChanges(oldGroups: TabGroup[], newGroups: TabGroup[]): ChangeEvent[] {
    const events: ChangeEvent[] = [];
    const oldMap = new Map(oldGroups.map(g => [g.id, g]));
    const newMap = new Map(newGroups.map(g => [g.id, g]));

    for (const [id, oldGroup] of oldMap) {
      if (!newMap.has(id)) {
        events.push({ type: 'group_removed', groupId: id, data: oldGroup });
      }
    }

    for (const [id, newGroup] of newMap) {
      const oldGroup = oldMap.get(id);
      if (!oldGroup) {
        events.push({ type: 'group_added', groupId: id, data: newGroup });
      } else {
        const oldTabs = new Map(oldGroup.tabs.map(t => [t.id, t]));
        const newTabs = new Map(newGroup.tabs.map(t => [t.id, t]));

        for (const [tabId, oldTab] of oldTabs) {
          if (!newTabs.has(tabId)) {
            events.push({ type: 'tab_removed', groupId: id, data: { tabId, tabData: oldTab } });
          }
        }

        for (const [tabId, newTab] of newTabs) {
          const oldTab = oldTabs.get(tabId);
          if (!oldTab) {
            events.push({ type: 'tab_added', groupId: id, data: { tabId, tabData: newTab } });
          } else if (oldTab.title !== newTab.title || oldTab.url !== newTab.url) {
            events.push({ type: 'tab_updated', groupId: id, data: { tabId, tabData: newTab } });
          }
        }

        const oldNote = oldGroup.notes?.trim() ?? '';
        const newNote = newGroup.notes?.trim() ?? '';
        if (oldGroup.name !== newGroup.name || oldNote !== newNote) {
          events.push({
            type: 'group_updated',
            groupId: id,
            data: { name: newGroup.name, notes: newGroup.notes },
          });
        }
      }
    }

    return events;
  }

  private static async handleChangeEvent(event: ChangeEvent): Promise<void> {
    try {
      const state = await Storage.get<DiscordMirrorState>(mirrorKey(event.groupId));
      if (!state) return;

      const accountId = state.accountId;

      switch (event.type) {
        case 'group_removed': {
          const memory = await GroupMemoryStorageService.getMemory();
          const isInMemory = !!memory.groups[event.groupId];

          if (isInMemory) {
            console.log(`[DiscordAutoSync] Group ${event.groupId} moved to memory, syncing instead of stopping`);
            await dispatchVerb('discord' as IntegrationId, 'sync_group_mirroring', {
              groupId: event.groupId,
            }, accountId);
          } else {
            await dispatchVerb('discord' as IntegrationId, 'stop_group_mirroring', {
              groupId: event.groupId,
            }, accountId);
            console.log(`[DiscordAutoSync] Stopped mirroring permanently deleted group ${event.groupId}`);
          }
          break;
        }

        case 'tab_added':
        case 'tab_removed':
        case 'tab_updated':
        case 'group_updated': {
          const result = await dispatchVerb('discord' as IntegrationId, 'sync_group_mirroring', {
            groupId: event.groupId,
          }, accountId);
          if (result.success) {
            console.log(`[DiscordAutoSync] Synced ${event.type} for group ${event.groupId}`);
          } else {
            console.error(`[DiscordAutoSync] Failed to sync ${event.type}:`, result.error);
          }
          break;
        }

        default:
          console.log(`[DiscordAutoSync] Unhandled event type: ${event.type}`);
      }
    } catch (error) {
      console.error(`[DiscordAutoSync] Error handling ${event.type}:`, error);
    }
  }

  static async stop(): Promise<void> {
    this.isInitialized = false;
    console.log('[DiscordAutoSync] Auto-sync service stopped');
  }
}

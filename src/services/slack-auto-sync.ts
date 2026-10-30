/**
 * @module services/slack-auto-sync
 *
 * WHY: Auto-sync Bluetab group/tab changes to Slack in real-time
 *      When tabs are added, removed, or updated, the mirrored Slack
 *      message is updated via chat.update. When group is deleted,
 *      the Slack message is deleted via chat.delete.
 *
 * WHAT: Watches for group changes and triggers sync_group_mirroring verb.
 *
 * HOW: Initialize once on app startup. Call handleGroupsChanged whenever
 *      groups state changes (tab add/remove/update, group rename, etc.)
 */

import type { TabGroup } from '../types/models';
import { Storage } from '../utils/storage';
import { GroupMemoryStorageService } from '../utils/group-memory-storage';
import { dispatchVerb } from './integration-service';
import type { IntegrationId } from './integrations/registry';

interface SlackMirrorState {
  channel: string;
  ts: string;
  accountId: string;
}

function mirrorKey(groupId: string): string {
  return `slack_mirror:${groupId}`;
}

export class SlackAutoSyncService {
  private static isInitialized = false;

  static async initialize(): Promise<void> {
    if (this.isInitialized) return;
    this.isInitialized = true;
    console.log('[SlackAutoSync] Auto-sync service initialized');
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

    // Detect removed groups
    for (const [id, oldGroup] of oldMap) {
      if (!newMap.has(id)) {
        events.push({ type: 'group_removed', groupId: id, data: oldGroup });
      }
    }

    // Detect added or updated groups
    for (const [id, newGroup] of newMap) {
      const oldGroup = oldMap.get(id);
      if (!oldGroup) {
        // New group - check if it should be mirrored (only if already has mirror state)
        events.push({ type: 'group_added', groupId: id, data: newGroup });
      } else {
        // Check for tab changes
        const oldTabs = new Map(oldGroup.tabs.map(t => [t.id, t]));
        const newTabs = new Map(newGroup.tabs.map(t => [t.id, t]));

        // Check for removed tabs
        for (const [tabId, oldTab] of oldTabs) {
          if (!newTabs.has(tabId)) {
            events.push({ type: 'tab_removed', groupId: id, data: { tabId, tabData: oldTab } });
          }
        }

        // Check for added or updated tabs
        for (const [tabId, newTab] of newTabs) {
          const oldTab = oldTabs.get(tabId);
          if (!oldTab) {
            events.push({ type: 'tab_added', groupId: id, data: { tabId, tabData: newTab } });
          } else if (
            oldTab.title !== newTab.title ||
            oldTab.url !== newTab.url
          ) {
            events.push({ type: 'tab_updated', groupId: id, data: { tabId, tabData: newTab } });
          }
        }

        // Check for rendered group metadata updates. Empty/whitespace-only notes
        // render identically and must not cause a provider operation.
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
      // Check if this group is being mirrored to Slack
      const state = await Storage.get<SlackMirrorState>(mirrorKey(event.groupId));
      if (!state) {
        // Not mirroring this group
        return;
      }

      const accountId = state.accountId;

      switch (event.type) {
        case 'group_removed':
          // Check if group is in memory (tab click removes from UI but keeps in memory)
          const memory = await GroupMemoryStorageService.getMemory();
          const isInMemory = !!memory.groups[event.groupId];

          if (isInMemory) {
            // Group is in memory, don't stop mirroring - just sync the updated state
            console.log(`[SlackAutoSync] Group ${event.groupId} moved to memory, syncing instead of stopping`);
            await dispatchVerb('slack' as IntegrationId, 'sync_group_mirroring', {
              groupId: event.groupId,
            }, accountId);
          } else {
            // Group permanently deleted - stop mirroring
            await dispatchVerb('slack' as IntegrationId, 'stop_group_mirroring', {
              groupId: event.groupId,
            }, accountId);
            console.log(`[SlackAutoSync] Stopped mirroring permanently deleted group ${event.groupId}`);
          }
          break;

        case 'tab_added':
        case 'tab_removed':
        case 'tab_updated':
        case 'group_updated':
          // Update the mirrored message to reflect changes
          const result = await dispatchVerb('slack' as IntegrationId, 'sync_group_mirroring', {
            groupId: event.groupId,
          }, accountId);
          if (result.success) {
            console.log(`[SlackAutoSync] Synced ${event.type} for group ${event.groupId}`);
          } else {
            console.error(`[SlackAutoSync] Failed to sync ${event.type}:`, result.error);
          }
          break;

        default:
          console.log(`[SlackAutoSync] Unhandled event type: ${event.type}`);
      }
    } catch (error) {
      console.error(`[SlackAutoSync] Error handling ${event.type}:`, error);
    }
  }

  static async stop(): Promise<void> {
    this.isInitialized = false;
    console.log('[SlackAutoSync] Auto-sync service stopped');
  }
}

interface ChangeEvent {
  type: 'group_added' | 'group_removed' | 'group_updated' | 'tab_added' | 'tab_removed' | 'tab_updated';
  groupId: string;
  data?: any;
}

/**
 * @module services/linear-sync-storage
 *
 * WHY: Track which Bluetab groups/tabs are synced to which Linear issues
 *      for real-time sync like Notion mirroring.
 *
 * WHAT: Stores mapping between:
 *   - Bluetab group/tab IDs → Linear issue IDs
 *   - Sync status (active, paused, error)
 *   - Last sync timestamps
 */

import { Storage } from '../utils/storage';

export interface LinearIssueMapping {
  tabId: string;
  issueId: string;
  groupId: string;
  groupName: string;
  tabTitle: string;
  tabUrl: string;
  teamId: string;
  accountId: string;
  createdAt: number;
  lastSyncAt: number;
  syncStatus: 'active' | 'paused' | 'error' | 'deleted';
  errorMessage?: string;
}

export interface LinearSyncGroup {
  groupId: string;
  groupName: string;
  teamId: string;
  accountId: string;
  isAutoSync: boolean;
  createdAt: number;
  lastSyncAt: number;
  syncStatus: 'active' | 'paused' | 'error';
  issueCount: number;
}

interface LinearSyncData {
  groups: Record<string, LinearSyncGroup>;
  issues: Record<string, LinearIssueMapping>;
  groupToIssues: Record<string, string[]>; // groupId → issueId[]
}

const SYNC_STORAGE_KEY = 'linear_sync_data';

export class LinearSyncStorage {
  static async getData(): Promise<LinearSyncData> {
    const data = await Storage.get<LinearSyncData>(SYNC_STORAGE_KEY);
    return data || {
      groups: {},
      issues: {},
      groupToIssues: {}
    };
  }

  static async saveData(data: LinearSyncData): Promise<void> {
    await Storage.set(SYNC_STORAGE_KEY, data);
  }

  // Group tracking
  static async startGroupSync(
    groupId: string,
    groupName: string,
    teamId: string,
    accountId: string
  ): Promise<void> {
    const data = await this.getData();

    data.groups[groupId] = {
      groupId,
      groupName,
      teamId,
      accountId,
      isAutoSync: true,
      createdAt: Date.now(),
      lastSyncAt: Date.now(),
      syncStatus: 'active',
      issueCount: 0
    };

    if (!data.groupToIssues[groupId]) {
      data.groupToIssues[groupId] = [];
    }

    await this.saveData(data);
    console.log(`[LinearSync] Started sync for group: ${groupName}`);
  }

  static async stopGroupSync(groupId: string): Promise<void> {
    const data = await this.getData();

    if (data.groups[groupId]) {
      data.groups[groupId].isAutoSync = false;
      data.groups[groupId].syncStatus = 'paused';
      console.log(`[LinearSync] Stopped sync for group: ${groupId}`);
    }

    await this.saveData(data);
  }

  static async isGroupSyncing(groupId: string): Promise<boolean> {
    const data = await this.getData();
    const group = data.groups[groupId];
    return !!group?.isAutoSync;
  }

  // Issue mapping
  static async addIssueMapping(mapping: Omit<LinearIssueMapping, 'createdAt' | 'lastSyncAt' | 'syncStatus'>): Promise<void> {
    const data = await this.getData();

    const fullMapping: LinearIssueMapping = {
      ...mapping,
      createdAt: Date.now(),
      lastSyncAt: Date.now(),
      syncStatus: 'active'
    };

    data.issues[mapping.tabId] = fullMapping;

    if (!data.groupToIssues[mapping.groupId]) {
      data.groupToIssues[mapping.groupId] = [];
    }
    if (!data.groupToIssues[mapping.groupId].includes(mapping.issueId)) {
      data.groupToIssues[mapping.groupId].push(mapping.issueId);
    }

    // Update group issue count
    if (data.groups[mapping.groupId]) {
      data.groups[mapping.groupId].issueCount = data.groupToIssues[mapping.groupId].length;
    }

    await this.saveData(data);
    console.log(`[LinearSync] Added mapping: tab ${mapping.tabId} → issue ${mapping.issueId}`);
  }

  static async removeIssueMapping(tabId: string): Promise<void> {
    const data = await this.getData();
    const mapping = data.issues[tabId];

    if (mapping) {
      // Remove from group issues list
      const groupIssues = data.groupToIssues[mapping.groupId];
      if (groupIssues) {
        const index = groupIssues.indexOf(mapping.issueId);
        if (index > -1) {
          groupIssues.splice(index, 1);
        }
      }

      // Update group issue count
      if (data.groups[mapping.groupId]) {
        data.groups[mapping.groupId].issueCount = groupIssues?.length || 0;
      }

      delete data.issues[tabId];
      console.log(`[LinearSync] Removed mapping: tab ${tabId} → issue ${mapping.issueId}`);
    }

    await this.saveData(data);
  }

  static async getIssueMapping(tabId: string): Promise<LinearIssueMapping | null> {
    const data = await this.getData();
    return data.issues[tabId] || null;
  }

  static async getGroupIssues(groupId: string): Promise<LinearIssueMapping[]> {
    const data = await this.getData();
    const issueIds = data.groupToIssues[groupId] || [];
    return issueIds
      .map(issueId => Object.values(data.issues).find(issue => issue.issueId === issueId))
      .filter(issue => issue) as LinearIssueMapping[];
  }

  static async getAllSyncGroups(): Promise<LinearSyncGroup[]> {
    const data = await this.getData();
    return Object.values(data.groups);
  }

  static async updateSyncStatus(
    groupId: string,
    status: 'active' | 'paused' | 'error',
    errorMessage?: string
  ): Promise<void> {
    const data = await this.getData();

    if (data.groups[groupId]) {
      data.groups[groupId].syncStatus = status;
      data.groups[groupId].lastSyncAt = Date.now();

      if (status === 'error' && errorMessage) {
        // Update all issues in group with error
        const groupIssues = await this.getGroupIssues(groupId);
        groupIssues.forEach(issue => {
          if (data.issues[issue.tabId]) {
            data.issues[issue.tabId].syncStatus = 'error';
            data.issues[issue.tabId].errorMessage = errorMessage;
          }
        });
      }
    }

    await this.saveData(data);
  }

  // Cleanup
  static async cleanupDeletedGroups(activeGroupIds: string[]): Promise<void> {
    const data = await this.getData();
    const activeGroupSet = new Set(activeGroupIds);

    // Remove groups that no longer exist
    Object.keys(data.groups).forEach(groupId => {
      if (!activeGroupSet.has(groupId)) {
        delete data.groups[groupId];
        delete data.groupToIssues[groupId];

        // Remove related issue mappings
        Object.keys(data.issues).forEach(tabId => {
          if (data.issues[tabId].groupId === groupId) {
            delete data.issues[tabId];
          }
        });

        console.log(`[LinearSync] Cleaned up deleted group: ${groupId}`);
      }
    });

    await this.saveData(data);
  }

  static async repairSyncData(resolveAccountId: () => Promise<string | null>): Promise<void> {
    const data = await this.getData();
    let changed = false;

    const needsAccountId = Object.values(data.groups).some(g => !g.accountId);
    const needsStatusReset = Object.values(data.groups).some(g => g.isAutoSync && g.syncStatus === 'error');

    if (!needsAccountId && !needsStatusReset) return;

    const accountId = needsAccountId ? await resolveAccountId() : null;

    for (const group of Object.values(data.groups)) {
      if (!group.accountId && accountId) {
        data.groups[group.groupId].accountId = accountId;
        changed = true;
        console.log(`[LinearSync] Backfilled accountId for group: ${group.groupName}`);
      }
      if (group.isAutoSync && group.syncStatus === 'error') {
        data.groups[group.groupId].syncStatus = 'active';
        changed = true;
        console.log(`[LinearSync] Reset error status for group: ${group.groupName}`);
      }
    }

    if (accountId) {
      for (const issue of Object.values(data.issues)) {
        if (!issue.accountId) {
          issue.accountId = accountId;
          changed = true;
        }
      }
    }

    if (changed) await this.saveData(data);
  }
}
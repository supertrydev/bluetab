import { Storage } from '../utils/storage';

export interface TodoistTaskMapping {
  tabId: string;
  taskId: string;
  groupId: string;
  groupName: string;
  tabTitle: string;
  tabUrl: string;
  projectId: string;
  accountId: string;
  createdAt: number;
  lastSyncAt: number;
  syncStatus: 'active' | 'paused' | 'error' | 'deleted';
  errorMessage?: string;
}

export interface TodoistSyncGroup {
  groupId: string;
  groupName: string;
  projectId: string;
  accountId: string;
  isAutoSync: boolean;
  createdAt: number;
  lastSyncAt: number;
  syncStatus: 'active' | 'paused' | 'error';
  taskCount: number;
}

interface TodoistSyncData {
  groups: Record<string, TodoistSyncGroup>;
  tasks: Record<string, TodoistTaskMapping>; // tabId → mapping
  groupToTasks: Record<string, string[]>;    // groupId → taskId[]
}

const SYNC_STORAGE_KEY = 'todoist_sync_data';

export class TodoistSyncStorage {
  static async getData(): Promise<TodoistSyncData> {
    const data = await Storage.get<TodoistSyncData>(SYNC_STORAGE_KEY);
    return data || { groups: {}, tasks: {}, groupToTasks: {} };
  }

  static async saveData(data: TodoistSyncData): Promise<void> {
    await Storage.set(SYNC_STORAGE_KEY, data);
  }

  static async startGroupSync(
    groupId: string,
    groupName: string,
    projectId: string,
    accountId: string
  ): Promise<void> {
    const data = await this.getData();
    data.groups[groupId] = {
      groupId,
      groupName,
      projectId,
      accountId,
      isAutoSync: true,
      createdAt: Date.now(),
      lastSyncAt: Date.now(),
      syncStatus: 'active',
      taskCount: 0,
    };
    if (!data.groupToTasks[groupId]) {
      data.groupToTasks[groupId] = [];
    }
    await this.saveData(data);
    console.log(`[TodoistSync] Started sync for group: ${groupName}`);
  }

  static async stopGroupSync(groupId: string): Promise<void> {
    const data = await this.getData();
    if (data.groups[groupId]) {
      data.groups[groupId].isAutoSync = false;
      data.groups[groupId].syncStatus = 'paused';
    }
    await this.saveData(data);
  }

  static async isGroupSyncing(groupId: string): Promise<boolean> {
    const data = await this.getData();
    return !!data.groups[groupId]?.isAutoSync;
  }

  static async addTaskMapping(mapping: Omit<TodoistTaskMapping, 'createdAt' | 'lastSyncAt' | 'syncStatus'>): Promise<void> {
    const data = await this.getData();
    data.tasks[mapping.tabId] = {
      ...mapping,
      createdAt: Date.now(),
      lastSyncAt: Date.now(),
      syncStatus: 'active',
    };
    if (!data.groupToTasks[mapping.groupId]) {
      data.groupToTasks[mapping.groupId] = [];
    }
    if (!data.groupToTasks[mapping.groupId].includes(mapping.taskId)) {
      data.groupToTasks[mapping.groupId].push(mapping.taskId);
    }
    if (data.groups[mapping.groupId]) {
      data.groups[mapping.groupId].taskCount = data.groupToTasks[mapping.groupId].length;
    }
    await this.saveData(data);
  }

  static async removeTaskMapping(tabId: string): Promise<void> {
    const data = await this.getData();
    const mapping = data.tasks[tabId];
    if (mapping) {
      const groupTasks = data.groupToTasks[mapping.groupId];
      if (groupTasks) {
        const idx = groupTasks.indexOf(mapping.taskId);
        if (idx > -1) groupTasks.splice(idx, 1);
      }
      if (data.groups[mapping.groupId]) {
        data.groups[mapping.groupId].taskCount = groupTasks?.length || 0;
      }
      delete data.tasks[tabId];
    }
    await this.saveData(data);
  }

  static async getTaskMapping(tabId: string): Promise<TodoistTaskMapping | null> {
    const data = await this.getData();
    return data.tasks[tabId] || null;
  }

  static async getGroupTasks(groupId: string): Promise<TodoistTaskMapping[]> {
    const data = await this.getData();
    const taskIds = data.groupToTasks[groupId] || [];
    return taskIds
      .map(taskId => Object.values(data.tasks).find(t => t.taskId === taskId))
      .filter((t): t is TodoistTaskMapping => !!t);
  }

  static async getAllSyncGroups(): Promise<TodoistSyncGroup[]> {
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
        const groupTasks = await this.getGroupTasks(groupId);
        groupTasks.forEach(task => {
          if (data.tasks[task.tabId]) {
            data.tasks[task.tabId].syncStatus = 'error';
            data.tasks[task.tabId].errorMessage = errorMessage;
          }
        });
      }
    }
    await this.saveData(data);
  }

  static async cleanupDeletedGroups(activeGroupIds: string[]): Promise<void> {
    const data = await this.getData();
    const activeSet = new Set(activeGroupIds);
    for (const groupId of Object.keys(data.groups)) {
      if (!activeSet.has(groupId)) {
        delete data.groups[groupId];
        delete data.groupToTasks[groupId];
        for (const tabId of Object.keys(data.tasks)) {
          if (data.tasks[tabId].groupId === groupId) {
            delete data.tasks[tabId];
          }
        }
        console.log(`[TodoistSync] Cleaned up deleted group: ${groupId}`);
      }
    }
    await this.saveData(data);
  }
}

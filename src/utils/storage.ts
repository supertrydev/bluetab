import { PinSettings, TabGroup, Settings, Project } from '../types/models';
import { getDefaultSettings } from './sorting';

export class Storage {
    private static locks = new Map<string, Promise<void>>();

    private static async withCallback<T>(operation: (resolve: (value: T) => void, reject: (reason?: any) => void) => void): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            try {
                operation(resolve, reject);
            } catch (error) {
                reject(error);
            }
        });
    }

    static async get<T>(key: string): Promise<T | null> {
        try {
            const result = await this.withCallback<Record<string, T | undefined>>((resolve, reject) => {
                try {
                    chrome.storage.local.get(key, (items) => {
                        const runtimeError = chrome.runtime?.lastError;
                        if (runtimeError) {
                            reject(new Error(runtimeError.message));
                            return;
                        }
                        resolve(items);
                    });
                } catch (error) {
                    reject(error);
                }
            });

            if (result && Object.prototype.hasOwnProperty.call(result, key)) {
                return result[key] ?? null;
            }
            return null;
        } catch (error) {
            console.error('Storage get error:', error);
            return null;
        }
    }

    static async set(key: string, value: any): Promise<void> {
        try {
            await this.withCallback<void>((resolve, reject) => {
                try {
                    chrome.storage.local.set({ [key]: value }, () => {
                        const runtimeError = chrome.runtime?.lastError;
                        if (runtimeError) {
                            reject(new Error(runtimeError.message));
                            return;
                        }
                        resolve();
                    });
                } catch (error) {
                    reject(error);
                }
            });
        } catch (error) {
            console.error('Storage set error:', error);
            throw new Error('Failed to save data. Storage might be full.');
        }
    }

    static async remove(key: string): Promise<void> {
        try {
            await this.withCallback<void>((resolve, reject) => {
                try {
                    chrome.storage.local.remove(key, () => {
                        const runtimeError = chrome.runtime?.lastError;
                        if (runtimeError) {
                            reject(new Error(runtimeError.message));
                            return;
                        }
                        resolve();
                    });
                } catch (error) {
                    reject(error);
                }
            });
        } catch (error) {
            console.error('Storage remove error:', error);
            throw new Error('Failed to remove data.');
        }
    }

    static async merge(key: string, updates: Record<string, any>): Promise<void> {
        try {
            await this.atomicUpdate<Record<string, any>>(key, (current) => ({
                ...(current || {}),
                ...updates
            }), {});
        } catch (error) {
            console.error('Storage merge error:', error);
            throw new Error('Failed to update data.');
        }
    }

    static async atomicUpdate<T>(
        key: string,
        updater: (current: T | null) => T | Promise<T>,
        fallback: T | null = null
    ): Promise<T> {
        const previous = this.locks.get(key) || Promise.resolve();
        let release!: () => void;
        const currentLock = new Promise<void>((resolve) => {
            release = resolve;
        });
        const nextChain = previous.then(() => currentLock);
        this.locks.set(key, nextChain);

        await previous;
        try {
            const current = await this.get<T>(key);
            const next = await updater(current ?? fallback);
            await this.set(key, next);
            return next;
        } finally {
            release();
            if (this.locks.get(key) === nextChain) {
                this.locks.delete(key);
            }
        }
    }

    // Pin-specific storage operations
    static async getPinSettings(): Promise<PinSettings> {
        const settings = await this.get<PinSettings>('pinSettings');
        return settings || { pinnedGroups: {} };
    }

    static async setPinStatus(groupId: string, isPinned: boolean): Promise<void> {
        await this.atomicUpdate<PinSettings>('pinSettings', (current) => {
            const settings = current || { pinnedGroups: {} };
            if (isPinned) {
                settings.pinnedGroups[groupId] = {
                    isPinned: true,
                    pinnedAt: Date.now()
                };
            } else {
                delete settings.pinnedGroups[groupId];
            }
            return settings;
        }, { pinnedGroups: {} });
    }

    static async migrateExistingGroups(groups: TabGroup[]): Promise<TabGroup[]> {
        const pinSettings = await this.getPinSettings();
        return groups.map(group => ({
            ...group,
            isPinned: pinSettings.pinnedGroups[group.id]?.isPinned || false,
            pinnedAt: pinSettings.pinnedGroups[group.id]?.pinnedAt
        }));
    }

    // Settings operations
    static async getSettings(): Promise<Settings> {
        const settings = await this.get<Settings>('settings');
        return settings || getDefaultSettings();
    }

    static async setSettings(settings: Settings): Promise<void> {
        await this.set('settings', settings);
    }

    // Project operations
    static async getProjects(): Promise<Project[]> {
        const projects = await this.get<Project[]>('projects');
        return projects || [];
    }

    static async setProjects(projects: Project[]): Promise<void> {
        await this.set('projects', projects);
    }

    static async addProject(project: Project): Promise<void> {
        await this.atomicUpdate<Project[]>('projects', (projects) => [...(projects || []), project], []);
    }

    static async updateProject(projectId: string, updates: Partial<Project>): Promise<void> {
        await this.atomicUpdate<Project[]>('projects', (projects) => (projects || []).map(p =>
            p.id === projectId ? { ...p, ...updates, modified: Date.now() } : p
        ), []);
    }

    static async deleteProject(projectId: string): Promise<void> {
        await this.atomicUpdate<Project[]>('projects', (projects) => (projects || []).filter(p => p.id !== projectId), []);

        // Clear projectId from all groups that belonged to this project
        await this.atomicUpdate<TabGroup[]>('groups', (groups) => (groups || []).map(g =>
            g.projectId === projectId ? { ...g, projectId: undefined, modified: Date.now() } : g
        ), []);
    }

    static async assignGroupToProject(groupId: string, projectId: string | undefined): Promise<void> {
        await this.atomicUpdate<TabGroup[]>('groups', (groups) => (groups || []).map(g =>
            g.id === groupId ? { ...g, projectId, modified: Date.now() } : g
        ), []);
    }

    static async assignGroupsToProject(groupIds: string[], projectId: string | undefined): Promise<void> {
        const groupIdSet = new Set(groupIds);
        await this.atomicUpdate<TabGroup[]>('groups', (groups) => (groups || []).map(g =>
            groupIdSet.has(g.id) ? { ...g, projectId, modified: Date.now() } : g
        ), []);
    }
}

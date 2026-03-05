/**
 * Restoration Service
 * ===================
 * WHY:  Users need to restore archived tabs without overwhelming Chrome APIs.
 * WHAT: Rate-limited tab creation, batch progress tracking, duplicate detection.
 * HOW:  50ms delays between tab.create calls, progress callbacks, URL normalization.
 * NOT:  Does not handle encryption (see ArchiveService), does not manage storage.
 */

import { TabGroup, TabItem } from '../types/models';
import { ArchivedGroup } from '../types/archive';
import { ArchiveService, ArchiveRestoreOptions } from './archive-service';
import { ArchiveStorageService } from '../utils/archive-storage';
import { ArchiveErrorHandler } from '../utils/archive-error-handler';

export interface RestoreConfiguration {
  strategy: 'newWindow' | 'currentWindow' | 'merge' | 'preview';
  windowId?: number;
  preservePosition?: boolean;
  activateFirstTab?: boolean;
  skipDuplicates?: boolean;
  maxTabsPerWindow?: number;
}

export interface RestorePreview {
  archiveId: string;
  groupName: string;
  tabCount: number;
  tabPreviews: {
    title: string;
    url: string;
    favicon?: string;
    isDuplicate?: boolean;
  }[];
  estimatedTime: number; // seconds
  warnings: string[];
  requiresPassword: boolean;
}

export interface RestoreProgress {
  archiveId: string;
  totalTabs: number;
  restoredTabs: number;
  failedTabs: number;
  currentTab?: string;
  status: 'preparing' | 'restoring' | 'completed' | 'failed' | 'cancelled';
  errors: string[];
}

export interface BatchRestoreResult {
  successful: {
    archiveId: string;
    groupId: string;
    tabsRestored: number;
  }[];
  failed: {
    archiveId: string;
    error: string;
  }[];
  totalArchives: number;
  totalTabsRestored: number;
}

export class RestorationService {
  private static activeRestores = new Map<string, RestoreProgress>();
  private static readonly MAX_TABS_PER_WINDOW = 100;
  private static readonly RESTORATION_DELAY_MS = 50; // Delay between tab creation

  /**
   * Generate a preview of what will be restored
   */
  static async getRestorePreview(archiveId: string, password?: string): Promise<RestorePreview | null> {
    const context = { operation: 'getRestorePreview', archiveId };

    try {
      const archive = await ArchiveStorageService.getArchive(archiveId);
      if (!archive) {
        ArchiveErrorHandler.handleError(
          new Error('Archive not found'),
          context,
          'RestorationService'
        );
        return null;
      }

      let groupData: TabGroup;
      const warnings: string[] = [];

      // Handle password-protected archives
      if (archive.protection.passwordProtected) {
        if (!password) {
          return {
            archiveId,
            groupName: 'Protected Archive',
            tabCount: 0,
            tabPreviews: [],
            estimatedTime: 0,
            warnings: ['Password required to preview this archive'],
            requiresPassword: true
          };
        }

        const restoreResult = await ArchiveService.restoreArchive({
          archiveId,
          password,
          removeAfterRestore: false
        });

        if (!restoreResult.success) {
          return null;
        }

        groupData = restoreResult.restoredGroup!;
      } else {
        groupData = archive.originalGroup as TabGroup;
      }

      // Check for potential duplicates with current tabs
      const duplicateChecks = await this.checkForDuplicateTabs(groupData.tabs);

      // Generate tab previews
      const tabPreviews = groupData.tabs.map(tab => ({
        title: tab.title,
        url: tab.url,
        favicon: tab.favicon,
        isDuplicate: duplicateChecks.some(dup => dup.tabId === tab.id)
      }));

      // Add warnings
      if (groupData.tabs.length > this.MAX_TABS_PER_WINDOW) {
        warnings.push(`Large group (${groupData.tabs.length} tabs) may take time to restore`);
      }

      const duplicateCount = tabPreviews.filter(t => t.isDuplicate).length;
      if (duplicateCount > 0) {
        warnings.push(`${duplicateCount} tabs may be duplicates of currently open tabs`);
      }

      // Estimate restoration time (rough calculation)
      const estimatedTime = Math.ceil(groupData.tabs.length * 0.1); // ~0.1 seconds per tab

      return {
        archiveId,
        groupName: groupData.name,
        tabCount: groupData.tabs.length,
        tabPreviews,
        estimatedTime,
        warnings,
        requiresPassword: false
      };

    } catch (error) {
      ArchiveErrorHandler.handleError(
        error instanceof Error ? error : new Error(String(error)),
        context,
        'RestorationService'
      );
      return null;
    }
  }

  /**
   * Restore an archive with progress tracking
   */
  static async restoreWithProgress(
    archiveId: string,
    config: RestoreConfiguration,
    password?: string,
    onProgress?: (progress: RestoreProgress) => void
  ): Promise<{ success: boolean; groupId?: string; error?: string }> {
    const context = { operation: 'restoreWithProgress', archiveId };

    // Initialize progress tracking
    const progress: RestoreProgress = {
      archiveId,
      totalTabs: 0,
      restoredTabs: 0,
      failedTabs: 0,
      status: 'preparing',
      errors: []
    };

    this.activeRestores.set(archiveId, progress);

    try {
      // First restore the archive data
      const restoreResult = await ArchiveService.restoreArchive({
        archiveId,
        password,
        removeAfterRestore: false
      });

      if (!restoreResult.success) {
        progress.status = 'failed';
        progress.errors.push(restoreResult.error || 'Restoration failed');
        onProgress?.(progress);
        return { success: false, error: restoreResult.error };
      }

      const group = restoreResult.restoredGroup!;
      progress.totalTabs = group.tabs.length;
      progress.status = 'restoring';
      onProgress?.(progress);

      // Handle different restoration strategies
      let windowId: number;

      switch (config.strategy) {
        case 'newWindow':
          windowId = await this.createNewWindow();
          break;
        case 'currentWindow':
          windowId = config.windowId || await this.getCurrentWindowId();
          break;
        case 'merge':
          windowId = config.windowId || await this.getCurrentWindowId();
          break;
        case 'preview':
          // Preview mode - don't actually restore tabs
          progress.status = 'completed';
          onProgress?.(progress);
          return { success: true, groupId: group.id };
        default:
          windowId = await this.getCurrentWindowId();
      }

      // Filter out duplicates if requested
      let tabsToRestore = group.tabs;
      if (config.skipDuplicates) {
        const duplicates = await this.checkForDuplicateTabs(group.tabs);
        tabsToRestore = group.tabs.filter(tab =>
          !duplicates.some(dup => dup.tabId === tab.id)
        );
      }

      // Restore tabs with progress tracking
      await this.restoreTabsInBatches(
        tabsToRestore,
        windowId,
        config,
        progress,
        onProgress
      );

      // Update group metadata
      const restoredGroup: TabGroup = {
        ...group,
        modified: Date.now(),
        lastAccessed: Date.now(),
        accessCount: (group.accessCount || 0) + 1
      };

      progress.status = 'completed';
      onProgress?.(progress);

      // Clean up progress tracking
      this.activeRestores.delete(archiveId);

      return { success: true, groupId: restoredGroup.id };

    } catch (error) {
      progress.status = 'failed';
      progress.errors.push(error instanceof Error ? error.message : String(error));
      onProgress?.(progress);

      const archiveError = ArchiveErrorHandler.handleError(
        error instanceof Error ? error : new Error(String(error)),
        context,
        'RestorationService'
      );

      // Clean up progress tracking
      this.activeRestores.delete(archiveId);

      return {
        success: false,
        error: archiveError.userMessage || archiveError.message
      };
    }
  }

  /**
   * Restore multiple archives in sequence
   */
  static async batchRestore(
    archiveIds: string[],
    config: RestoreConfiguration,
    passwords?: Map<string, string>,
    onProgress?: (archiveId: string, progress: RestoreProgress) => void
  ): Promise<BatchRestoreResult> {
    const result: BatchRestoreResult = {
      successful: [],
      failed: [],
      totalArchives: archiveIds.length,
      totalTabsRestored: 0
    };

    for (const archiveId of archiveIds) {
      try {
        const password = passwords?.get(archiveId);
        const restoreResult = await this.restoreWithProgress(
          archiveId,
          config,
          password,
          (progress) => onProgress?.(archiveId, progress)
        );

        if (restoreResult.success) {
          // Get tab count for statistics
          const preview = await this.getRestorePreview(archiveId, password);
          const tabCount = preview?.tabCount || 0;

          result.successful.push({
            archiveId,
            groupId: restoreResult.groupId!,
            tabsRestored: tabCount
          });

          result.totalTabsRestored += tabCount;
        } else {
          result.failed.push({
            archiveId,
            error: restoreResult.error || 'Unknown error'
          });
        }
      } catch (error) {
        result.failed.push({
          archiveId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return result;
  }

  /**
   * Cancel an active restoration
   */
  static cancelRestore(archiveId: string): boolean {
    const progress = this.activeRestores.get(archiveId);
    if (progress && progress.status === 'restoring') {
      progress.status = 'cancelled';
      this.activeRestores.delete(archiveId);
      return true;
    }
    return false;
  }

  /**
   * Get current progress for an active restoration
   */
  static getRestoreProgress(archiveId: string): RestoreProgress | null {
    return this.activeRestores.get(archiveId) || null;
  }

  /**
   * Get all active restorations
   */
  static getActiveRestorations(): RestoreProgress[] {
    return Array.from(this.activeRestores.values());
  }

  // Private helper methods

  private static async checkForDuplicateTabs(tabs: TabItem[]): Promise<{
    tabId: string;
    duplicateTabId: number;
    url: string;
  }[]> {
    try {
      // Get all currently open tabs
      const openTabs = await chrome.tabs.query({});
      const openUrls = new Set(openTabs.map(tab => tab.url));

      const duplicates: { tabId: string; duplicateTabId: number; url: string }[] = [];

      for (const tab of tabs) {
        if (openUrls.has(tab.url)) {
          const existingTab = openTabs.find(t => t.url === tab.url);
          if (existingTab) {
            duplicates.push({
              tabId: tab.id,
              duplicateTabId: existingTab.id!,
              url: tab.url
            });
          }
        }
      }

      return duplicates;
    } catch (error) {
      console.error('Failed to check for duplicate tabs:', error);
      return [];
    }
  }

  private static async createNewWindow(): Promise<number> {
    try {
      const window = await chrome.windows.create({
        focused: true,
        type: 'normal'
      });
      return window.id!;
    } catch (error) {
      throw new Error(`Failed to create new window: ${error.message}`);
    }
  }

  private static async getCurrentWindowId(): Promise<number> {
    try {
      const window = await chrome.windows.getCurrent();
      return window.id!;
    } catch (error) {
      throw new Error(`Failed to get current window: ${error.message}`);
    }
  }

  private static async restoreTabsInBatches(
    tabs: TabItem[],
    windowId: number,
    config: RestoreConfiguration,
    progress: RestoreProgress,
    onProgress?: (progress: RestoreProgress) => void
  ): Promise<void> {
    const maxTabs = config.maxTabsPerWindow || this.MAX_TABS_PER_WINDOW;
    const batchSize = Math.min(5, tabs.length); // Restore 5 tabs at a time

    for (let i = 0; i < tabs.length && progress.status !== 'cancelled'; i += batchSize) {
      const batch = tabs.slice(i, Math.min(i + batchSize, tabs.length));

      // Process batch in parallel
      const batchPromises = batch.map(async (tab, batchIndex) => {
        const globalIndex = i + batchIndex;

        try {
          progress.currentTab = tab.title;
          onProgress?.(progress);

          // Check if we've exceeded the tab limit for this window
          if (globalIndex >= maxTabs) {
            progress.failedTabs++;
            progress.errors.push(`Skipped ${tab.title} - exceeded max tabs per window`);
            return;
          }

          // Create the tab
          const createdTab = await chrome.tabs.create({
            windowId,
            url: tab.url,
            active: globalIndex === 0 && config.activateFirstTab,
            pinned: tab.pinned || false
          });

          if (createdTab) {
            progress.restoredTabs++;
          } else {
            progress.failedTabs++;
            progress.errors.push(`Failed to create tab: ${tab.title}`);
          }

          onProgress?.(progress);

          // Small delay to prevent overwhelming the browser
          await new Promise(resolve => setTimeout(resolve, this.RESTORATION_DELAY_MS));

        } catch (error) {
          progress.failedTabs++;
          progress.errors.push(`Failed to restore ${tab.title}: ${error.message}`);
          onProgress?.(progress);
        }
      });

      // Wait for current batch to complete
      await Promise.allSettled(batchPromises);

      // Brief pause between batches
      if (i + batchSize < tabs.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    progress.currentTab = undefined;
  }
}
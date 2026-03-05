import { TabGroup } from '../types/models';
import { ArchiveService, ArchiveCreationOptions } from '../services/archive-service';
import { ArchiveStorageService } from './archive-storage';

export interface ArchiveSuggestion {
  groupId: string;
  reason: 'inactive' | 'old' | 'large' | 'duplicate';
  score: number; // 0-100, higher means more recommended for archiving
  details: string;
  daysInactive?: number;
  tabCount?: number;
  lastAccessed?: Date;
}

export interface GroupArchiveStatus {
  groupId: string;
  isArchived: boolean;
  archiveDate?: Date;
  isPasswordProtected?: boolean;
}

export class ArchiveIntegration {
  private static readonly INACTIVE_THRESHOLD_DAYS = 30;
  private static readonly OLD_THRESHOLD_DAYS = 90;
  private static readonly LARGE_GROUP_THRESHOLD = 50;

  /**
   * Get archive suggestions for current groups
   */
  static async getArchiveSuggestions(groups: TabGroup[]): Promise<ArchiveSuggestion[]> {
    try {
      const suggestions: ArchiveSuggestion[] = [];
      const now = Date.now();
      const existingArchives = await ArchiveStorageService.getArchives();
      const archivedGroupIds = new Set(Object.keys(existingArchives.archives));

      for (const group of groups) {
        // Skip already archived groups
        if (archivedGroupIds.has(group.id)) {
          continue;
        }

        const suggestion = this.analyzeGroupForArchiving(group, now);
        if (suggestion) {
          suggestions.push(suggestion);
        }
      }

      // Sort by score (highest first)
      return suggestions.sort((a, b) => b.score - a.score);
    } catch (error) {
      console.error('Failed to get archive suggestions:', error);
      return [];
    }
  }

  /**
   * Check if groups are good candidates for automatic archiving
   */
  static async getAutoArchiveCandidates(
    groups: TabGroup[],
    minScore: number = 70
  ): Promise<ArchiveSuggestion[]> {
    const suggestions = await this.getArchiveSuggestions(groups);
    return suggestions.filter(s => s.score >= minScore);
  }

  /**
   * Get the archive status for multiple groups
   */
  static async getGroupArchiveStatuses(groupIds: string[]): Promise<GroupArchiveStatus[]> {
    try {
      const archives = await ArchiveStorageService.getArchives();

      return groupIds.map(groupId => {
        const archive = archives.archives[groupId];
        return {
          groupId,
          isArchived: !!archive,
          archiveDate: archive ? new Date(archive.metadata.archivedDate) : undefined,
          isPasswordProtected: archive?.protection.passwordProtected
        };
      });
    } catch (error) {
      console.error('Failed to get archive statuses:', error);
      return groupIds.map(groupId => ({ groupId, isArchived: false }));
    }
  }

  /**
   * Quick archive operation for suggested groups
   */
  static async quickArchiveGroup(
    group: TabGroup,
    reason?: string,
    password?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const options: ArchiveCreationOptions = {
        groupId: group.id,
        reason: reason || 'Manual archive',
        password,
        createBackup: true
      };

      const result = await ArchiveService.createArchive(group, options);
      return {
        success: result.success,
        error: result.error
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to archive group: ${error.message}`
      };
    }
  }

  /**
   * Bulk archive multiple groups
   */
  static async bulkArchiveGroups(
    groups: TabGroup[],
    options?: {
      reason?: string;
      password?: string;
      skipValidation?: boolean;
    }
  ): Promise<{
    successful: string[];
    failed: { groupId: string; error: string }[];
    totalProcessed: number;
  }> {
    const successful: string[] = [];
    const failed: { groupId: string; error: string }[] = [];

    for (const group of groups) {
      try {
        const archiveOptions: ArchiveCreationOptions = {
          groupId: group.id,
          reason: options?.reason || 'Bulk archive',
          password: options?.password,
          createBackup: false // Skip backups for bulk operations
        };

        const result = await ArchiveService.createArchive(group, archiveOptions);

        if (result.success) {
          successful.push(group.id);
        } else {
          failed.push({
            groupId: group.id,
            error: result.error || 'Unknown error'
          });
        }
      } catch (error) {
        failed.push({
          groupId: group.id,
          error: error.message || 'Failed to process group'
        });
      }
    }

    return {
      successful,
      failed,
      totalProcessed: groups.length
    };
  }

  /**
   * Clean up archives based on age and usage
   */
  static async cleanupOldArchives(
    maxAgeMonths: number = 12,
    minAccessCount: number = 0
  ): Promise<{
    cleaned: string[];
    retained: string[];
    totalSize: number;
  }> {
    try {
      const archives = await ArchiveStorageService.getArchives();
      const cutoffDate = Date.now() - (maxAgeMonths * 30 * 24 * 60 * 60 * 1000);
      const cleaned: string[] = [];
      const retained: string[] = [];

      for (const [archiveId, archive] of Object.entries(archives.archives)) {
        const shouldClean = archive.metadata.archivedDate < cutoffDate &&
                           archive.metadata.accessCount <= minAccessCount;

        if (shouldClean) {
          const result = await ArchiveStorageService.removeArchive(archiveId);
          if (result.success) {
            cleaned.push(archiveId);
          } else {
            retained.push(archiveId);
          }
        } else {
          retained.push(archiveId);
        }
      }

      const stats = await ArchiveStorageService.getStorageStats();

      return {
        cleaned,
        retained,
        totalSize: stats.totalSizeBytes
      };
    } catch (error) {
      console.error('Failed to cleanup old archives:', error);
      return {
        cleaned: [],
        retained: [],
        totalSize: 0
      };
    }
  }

  /**
   * Get recommendations for archive management
   */
  static async getArchiveRecommendations(): Promise<{
    suggestions: string[];
    warnings: string[];
    storageInfo: {
      usage: number;
      available: number;
      needsCleanup: boolean;
    };
  }> {
    try {
      const suggestions: string[] = [];
      const warnings: string[] = [];
      const stats = await ArchiveStorageService.getStorageStats();

      // Storage recommendations
      if (stats.quotaUsagePercent > 80) {
        warnings.push('Archive storage is over 80% full');
        suggestions.push('Clean up old or unused archives');
      } else if (stats.quotaUsagePercent > 60) {
        suggestions.push('Consider cleaning up old archives soon');
      }

      // Archive management recommendations
      if (stats.totalArchives > 100) {
        suggestions.push('You have many archives - consider organizing them');
      }

      if (stats.totalArchives === 0) {
        suggestions.push('Start archiving inactive groups to save space');
      }

      // Check for old archives
      const archives = await ArchiveStorageService.getArchives();
      const oldArchives = Object.values(archives.archives)
        .filter(a => Date.now() - a.metadata.archivedDate > 6 * 30 * 24 * 60 * 60 * 1000) // 6 months
        .length;

      if (oldArchives > 10) {
        suggestions.push(`You have ${oldArchives} archives older than 6 months`);
      }

      return {
        suggestions,
        warnings,
        storageInfo: {
          usage: stats.quotaUsagePercent,
          available: 100 - stats.quotaUsagePercent,
          needsCleanup: stats.quotaUsagePercent > 80
        }
      };
    } catch (error) {
      console.error('Failed to get archive recommendations:', error);
      return {
        suggestions: ['Unable to analyze archives at this time'],
        warnings: [],
        storageInfo: {
          usage: 0,
          available: 100,
          needsCleanup: false
        }
      };
    }
  }

  // Private helper methods

  private static analyzeGroupForArchiving(group: TabGroup, currentTime: number): ArchiveSuggestion | null {
    let score = 0;
    let reason: ArchiveSuggestion['reason'] = 'inactive';
    let details = '';

    const lastAccessed = group.lastAccessed || group.modified;
    const daysSinceAccess = Math.floor((currentTime - lastAccessed) / (1000 * 60 * 60 * 24));
    const daysSinceCreation = Math.floor((currentTime - group.created) / (1000 * 60 * 60 * 24));

    // Analyze inactivity
    if (daysSinceAccess > this.INACTIVE_THRESHOLD_DAYS) {
      score += 30;
      reason = 'inactive';
      details = `Inactive for ${daysSinceAccess} days`;

      if (daysSinceAccess > this.OLD_THRESHOLD_DAYS) {
        score += 20;
        reason = 'old';
        details = `Very old group (${daysSinceAccess} days inactive)`;
      }
    }

    // Analyze size
    if (group.tabs.length > this.LARGE_GROUP_THRESHOLD) {
      score += 25;
      if (reason === 'inactive') {
        reason = 'large';
        details = `Large inactive group (${group.tabs.length} tabs)`;
      }
    }

    // Low access count penalty
    const accessCount = group.accessCount || 0;
    if (accessCount === 0 && daysSinceCreation > 7) {
      score += 15;
      details += accessCount === 0 ? ' (never accessed)' : '';
    }

    // Boost score for very inactive groups
    if (daysSinceAccess > this.OLD_THRESHOLD_DAYS * 2) {
      score += 30;
    }

    // Only suggest groups with reasonable scores
    if (score < 25) {
      return null;
    }

    return {
      groupId: group.id,
      reason,
      score: Math.min(score, 100),
      details,
      daysInactive: daysSinceAccess,
      tabCount: group.tabs.length,
      lastAccessed: new Date(lastAccessed)
    };
  }
}
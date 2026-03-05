import { ArchivedGroup, ArchiveStorage, ArchiveOperationResult, ArchiveFilters, ArchiveSearchIndex } from '../types/archive';
import { TabGroup } from '../types/models';
import { Storage } from './storage';
import { ArchiveValidator } from './archive-validator';
import { ArchiveErrorHandler } from './archive-error-handler';
import { CryptoService } from './crypto-service';

export class ArchiveStorageService {
  private static readonly ARCHIVES_KEY = 'archivedGroups';
  private static readonly SEARCH_INDEX_KEY = 'archiveSearchIndex';
  private static readonly QUOTA_WARNING_THRESHOLD = 0.8; // 80% of quota
  private static readonly MAX_STORAGE_BYTES = 5 * 1024 * 1024; // 5MB Chrome limit

  /**
   * Get all archived groups
   */
  static async getArchives(): Promise<ArchiveStorage> {
    try {
      const archives = await Storage.get<ArchiveStorage>(this.ARCHIVES_KEY);
      if (!archives) {
        return this.createEmptyArchiveStorage();
      }
      return archives;
    } catch (error) {
      console.error('Failed to get archives:', error);
      return this.createEmptyArchiveStorage();
    }
  }

  /**
   * Get a specific archived group by ID
   */
  static async getArchive(archiveId: string): Promise<ArchivedGroup | null> {
    const context = { operation: 'getArchive', archiveId };

    try {
      if (!archiveId || typeof archiveId !== 'string') {
        ArchiveErrorHandler.handleError(
          new Error('Invalid archive ID provided'),
          context,
          'ArchiveStorageService'
        );
        return null;
      }

      const archives = await this.getArchives();
      const archive = archives.archives[archiveId];

      if (!archive) {
        ArchiveErrorHandler.handleError(
          new Error('Archive not found'),
          context,
          'ArchiveStorageService'
        );
        return null;
      }

      // Validate archive integrity when retrieved
      const validation = await ArchiveValidator.validateArchivedGroup(archive);
      if (!validation.isValid && validation.severity === 'critical') {
        ArchiveErrorHandler.handleError(
          new Error('Archive data is corrupted'),
          context,
          'ArchiveStorageService'
        );
        return null;
      }

      // SECURITY: Verify checksum if present to detect tampering/corruption
      if (archive.checksum) {
        try {
          const checksumData = ArchiveValidator.generateChecksumData(archive);
          const calculatedChecksum = await CryptoService.generateChecksum(checksumData);
          if (calculatedChecksum !== archive.checksum) {
            ArchiveErrorHandler.handleError(
              new Error('Archive checksum mismatch - data may be corrupted or tampered'),
              { ...context, operation: 'checksum_verification' },
              'ArchiveStorageService'
            );
            // Log but don't block - archive may still be usable
            console.warn('[BlueTab][Security] Checksum mismatch for archive:', archiveId);
          }
        } catch (checksumError) {
          console.warn('[BlueTab] Checksum verification failed:', checksumError);
        }
      }

      // Update access metadata
      await this.updateAccessMetadata(archiveId);

      return archive;
    } catch (error) {
      ArchiveErrorHandler.handleError(
        error instanceof Error ? error : new Error(String(error)),
        context,
        'ArchiveStorageService'
      );
      return null;
    }
  }

  /**
   * Store an archived group
   */
  static async storeArchive(
    archive: ArchivedGroup,
    options: { overwrite?: boolean } = {}
  ): Promise<ArchiveOperationResult> {
    const context = { operation: 'storeArchive', archiveId: archive.id };
    const overwrite = options.overwrite === true;

    try {
      // Validate archive before storing
      const validation = await ArchiveValidator.validateArchivedGroup(archive);
      if (!validation.isValid) {
        const errorDetails = validation.errors.map(e => e.message).join('; ');
        const archiveError = ArchiveErrorHandler.handleError(
          new Error(`Archive validation failed: ${errorDetails}`),
          context,
          'ArchiveStorageService'
        );
        return {
          success: false,
          error: archiveError.userMessage || archiveError.message
        };
      }

      // Sanitize archive data
      const sanitizedArchive = ArchiveValidator.sanitizeArchiveData(archive);

      // Generate checksum for the sanitized data using the consistent method
      if (!sanitizedArchive.checksum) {
        const checksumData = ArchiveValidator.generateChecksumData(sanitizedArchive);
        sanitizedArchive.checksum = await CryptoService.generateChecksum(checksumData);
      }

      const archives = await this.getArchives();
      const existingArchive = archives.archives[sanitizedArchive.id];

      // Check storage quota before proceeding
      const quotaCheck = await this.checkStorageQuota(archives, sanitizedArchive, existingArchive);
      if (!quotaCheck.success) {
        return quotaCheck;
      }

      // Check if archive already exists
      if (existingArchive && !overwrite) {
        const archiveError = ArchiveErrorHandler.handleError(
          new Error('Archive already exists'),
          context,
          'ArchiveStorageService'
        );
        return {
          success: false,
          error: archiveError.userMessage || archiveError.message
        };
      }

      // Add the new archive
      archives.archives[sanitizedArchive.id] = sanitizedArchive;

      // Update metadata
      archives.metadata.totalArchives = Object.keys(archives.archives).length;
      archives.metadata.totalSizeBytes = await this.calculateTotalSize(archives);

      // Store updated archives
      await Storage.set(this.ARCHIVES_KEY, archives);

      // Update search index
      await this.updateSearchIndex(sanitizedArchive);

      return {
        success: true,
        archiveId: sanitizedArchive.id,
        affectedGroups: [sanitizedArchive.id]
      };
    } catch (error) {
      const archiveError = ArchiveErrorHandler.handleError(
        error instanceof Error ? error : new Error(String(error)),
        context,
        'ArchiveStorageService'
      );
      return {
        success: false,
        error: archiveError.userMessage || archiveError.message
      };
    }
  }

  /**
   * Remove an archived group
   */
  static async removeArchive(archiveId: string): Promise<ArchiveOperationResult> {
    try {
      const archives = await this.getArchives();

      if (!archives.archives[archiveId]) {
        return {
          success: false,
          error: 'Archive not found'
        };
      }

      // Remove the archive
      delete archives.archives[archiveId];

      // Update metadata
      archives.metadata.totalArchives = Object.keys(archives.archives).length;
      archives.metadata.totalSizeBytes = await this.calculateTotalSize(archives);

      // Store updated archives
      await Storage.set(this.ARCHIVES_KEY, archives);

      // Remove from search index
      await this.removeFromSearchIndex(archiveId);

      return {
        success: true,
        archiveId,
        affectedGroups: [archiveId]
      };
    } catch (error) {
      console.error('Failed to remove archive:', error);
      return {
        success: false,
        error: `Failed to remove archive: ${error.message}`
      };
    }
  }

  /**
   * Search archives with filters
   */
  static async searchArchives(filters: ArchiveFilters): Promise<ArchivedGroup[]> {
    try {
      const archives = await this.getArchives();
      let results = Object.values(archives.archives);

      // Apply date range filter
      if (filters.dateRange) {
        results = results.filter(archive =>
          archive.metadata.archivedDate >= filters.dateRange!.start &&
          archive.metadata.archivedDate <= filters.dateRange!.end
        );
      }

      // Apply protection status filter
      if (filters.protectionStatus && filters.protectionStatus !== 'all') {
        const isProtected = filters.protectionStatus === 'protected';
        results = results.filter(archive =>
          archive.protection.passwordProtected === isProtected
        );
      }

      // Apply search query filter
      if (filters.searchQuery) {
        const query = filters.searchQuery.toLowerCase();
        const searchIndex = await this.getSearchIndex();
        const matchingIds = searchIndex
          .filter(index =>
            index.groupName.toLowerCase().includes(query) ||
            index.tabTitles.some(title => title.toLowerCase().includes(query)) ||
            index.tabUrls.some(url => url.toLowerCase().includes(query)) ||
            index.tags.some(tag => tag.toLowerCase().includes(query))
          )
          .map(index => index.archiveId);

        results = results.filter(archive => matchingIds.includes(archive.id));
      }

      // Apply sorting
      results.sort((a, b) => {
        let comparison = 0;

        switch (filters.sortBy) {
          case 'date':
            comparison = a.metadata.archivedDate - b.metadata.archivedDate;
            break;
          case 'name':
            // Extract group name for sorting (handle encrypted content)
            const nameA = typeof a.originalGroup === 'string' ? 'Protected Archive' : a.originalGroup.name;
            const nameB = typeof b.originalGroup === 'string' ? 'Protected Archive' : b.originalGroup.name;
            comparison = nameA.localeCompare(nameB);
            break;
          case 'size':
            const sizeA = JSON.stringify(a).length;
            const sizeB = JSON.stringify(b).length;
            comparison = sizeA - sizeB;
            break;
          case 'accessCount':
            comparison = a.metadata.accessCount - b.metadata.accessCount;
            break;
        }

        return filters.sortOrder === 'desc' ? -comparison : comparison;
      });

      return results;
    } catch (error) {
      console.error('Failed to search archives:', error);
      return [];
    }
  }

  /**
   * Update access metadata for an archive
   */
  static async updateAccessMetadata(archiveId: string): Promise<void> {
    try {
      const archives = await this.getArchives();
      const archive = archives.archives[archiveId];

      if (archive) {
        archive.metadata.accessCount++;
        archive.metadata.lastAccessed = Date.now();
        await Storage.set(this.ARCHIVES_KEY, archives);
      }
    } catch (error) {
      console.error('Failed to update access metadata:', error);
    }
  }

  /**
   * Get storage usage statistics
   */
  static async getStorageStats(): Promise<{
    totalArchives: number;
    totalSizeBytes: number;
    quotaUsagePercent: number;
    nearQuotaLimit: boolean;
  }> {
    try {
      const archives = await this.getArchives();
      const quotaUsagePercent = (archives.metadata.totalSizeBytes / this.MAX_STORAGE_BYTES) * 100;

      return {
        totalArchives: archives.metadata.totalArchives,
        totalSizeBytes: archives.metadata.totalSizeBytes,
        quotaUsagePercent,
        nearQuotaLimit: quotaUsagePercent > this.QUOTA_WARNING_THRESHOLD * 100
      };
    } catch (error) {
      console.error('Failed to get storage stats:', error);
      return {
        totalArchives: 0,
        totalSizeBytes: 0,
        quotaUsagePercent: 0,
        nearQuotaLimit: false
      };
    }
  }

  /**
   * Clean up orphaned archives and optimize storage
   */
  static async cleanupStorage(): Promise<{
    cleaned: number;
    spaceFreedBytes: number;
  }> {
    try {
      const archives = await this.getArchives();
      const beforeSize = archives.metadata.totalSizeBytes;
      let cleaned = 0;

      // Remove archives with invalid data
      for (const [archiveId, archive] of Object.entries(archives.archives)) {
        if (!archive.id || !archive.originalGroup || !archive.metadata) {
          delete archives.archives[archiveId];
          cleaned++;
        }
      }

      // Update metadata
      archives.metadata.totalArchives = Object.keys(archives.archives).length;
      archives.metadata.totalSizeBytes = await this.calculateTotalSize(archives);
      archives.metadata.lastCleanup = Date.now();

      await Storage.set(this.ARCHIVES_KEY, archives);

      // Rebuild search index
      await this.rebuildSearchIndex();

      return {
        cleaned,
        spaceFreedBytes: beforeSize - archives.metadata.totalSizeBytes
      };
    } catch (error) {
      console.error('Failed to cleanup storage:', error);
      return { cleaned: 0, spaceFreedBytes: 0 };
    }
  }

  /**
   * Clear all unprotected archives permanently (keeps password-protected ones)
   */
  static async clearAllArchives(): Promise<boolean> {
    try {
      const currentArchives = await this.getArchives();

      // Filter to keep only password-protected archives
      const protectedArchives: Record<string, ArchivedGroup> = {};
      for (const [id, archive] of Object.entries(currentArchives.archives)) {
        if (archive.protection?.passwordProtected) {
          protectedArchives[id] = archive;
        }
      }

      // Create new storage with only protected archives
      const newStorage: ArchiveStorage = {
        archives: protectedArchives,
        metadata: {
          totalArchives: Object.keys(protectedArchives).length,
          totalSizeBytes: await this.calculateTotalSize({ archives: protectedArchives, metadata: currentArchives.metadata }),
          version: currentArchives.metadata.version
        }
      };

      await Storage.set(this.ARCHIVES_KEY, newStorage);

      // Rebuild search index for remaining archives
      await this.rebuildSearchIndex();

      return true;
    } catch (error) {
      console.error('Failed to clear archives:', error);
      return false;
    }
  }

  // Private helper methods

  private static createEmptyArchiveStorage(): ArchiveStorage {
    return {
      archives: {},
      metadata: {
        totalArchives: 0,
        totalSizeBytes: 0,
        version: '1.0.0'
      }
    };
  }

  private static async calculateTotalSize(archives: ArchiveStorage): Promise<number> {
    try {
      const jsonString = JSON.stringify(archives);
      return new Blob([jsonString]).size;
    } catch (error) {
      console.error('Failed to calculate total size:', error);
      return 0;
    }
  }

  private static async checkStorageQuota(
    archives: ArchiveStorage,
    newArchive: ArchivedGroup,
    existingArchive?: ArchivedGroup
  ): Promise<ArchiveOperationResult> {
    try {
      const newArchiveSize = new Blob([JSON.stringify(newArchive)]).size;
      const existingArchiveSize = existingArchive
        ? new Blob([JSON.stringify(existingArchive)]).size
        : 0;

      const totalSizeAfter = archives.metadata.totalSizeBytes - existingArchiveSize + newArchiveSize;

      if (totalSizeAfter > this.MAX_STORAGE_BYTES) {
        return {
          success: false,
          error: 'Storage quota exceeded. Please cleanup old archives before adding new ones.'
        };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Failed to check storage quota: ${error.message}`
      };
    }
  }

  private static async getSearchIndex(): Promise<ArchiveSearchIndex[]> {
    try {
      return await Storage.get<ArchiveSearchIndex[]>(this.SEARCH_INDEX_KEY) || [];
    } catch (error) {
      console.error('Failed to get search index:', error);
      return [];
    }
  }

  private static async updateSearchIndex(archive: ArchivedGroup): Promise<void> {
    try {
      const searchIndex = await this.getSearchIndex();

      // Remove existing entry if it exists
      const existingIndex = searchIndex.findIndex(index => index.archiveId === archive.id);
      if (existingIndex !== -1) {
        searchIndex.splice(existingIndex, 1);
      }

      // Add new entry (only for unprotected archives or extract limited data)
      if (!archive.protection.passwordProtected && typeof archive.originalGroup !== 'string') {
        const group = archive.originalGroup as TabGroup;
        const indexEntry: ArchiveSearchIndex = {
          archiveId: archive.id,
          groupName: group.name,
          archivedDate: archive.metadata.archivedDate,
          tabTitles: group.tabs.map(tab => tab.title),
          tabUrls: group.tabs.map(tab => tab.url),
          tags: group.tags || [],
          isProtected: false
        };
        searchIndex.push(indexEntry);
      } else {
        // For protected archives, only store basic metadata
        const indexEntry: ArchiveSearchIndex = {
          archiveId: archive.id,
          groupName: 'Protected Archive',
          archivedDate: archive.metadata.archivedDate,
          tabTitles: [],
          tabUrls: [],
          tags: [],
          isProtected: true
        };
        searchIndex.push(indexEntry);
      }

      await Storage.set(this.SEARCH_INDEX_KEY, searchIndex);
    } catch (error) {
      console.error('Failed to update search index:', error);
    }
  }

  private static async removeFromSearchIndex(archiveId: string): Promise<void> {
    try {
      const searchIndex = await this.getSearchIndex();
      const filteredIndex = searchIndex.filter(index => index.archiveId !== archiveId);
      await Storage.set(this.SEARCH_INDEX_KEY, filteredIndex);
    } catch (error) {
      console.error('Failed to remove from search index:', error);
    }
  }

  private static async rebuildSearchIndex(): Promise<void> {
    try {
      const archives = await this.getArchives();
      await Storage.set(this.SEARCH_INDEX_KEY, []);

      for (const archive of Object.values(archives.archives)) {
        await this.updateSearchIndex(archive);
      }
    } catch (error) {
      console.error('Failed to rebuild search index:', error);
    }
  }
}

import { ArchiveStorage, ArchivedGroup } from '../types/archive';
import { TabGroup } from '../types/models';
import { Storage } from './storage';
import { ArchiveStorageService } from './archive-storage';

export interface MigrationResult {
  success: boolean;
  migrated: number;
  skipped: number;
  errors: string[];
}

export interface ArchiveValidation {
  isValid: boolean;
  version: string;
  issues: string[];
  requiresMigration: boolean;
}

export class ArchiveMigrationService {
  private static readonly CURRENT_VERSION = '1.0.0';
  private static readonly LEGACY_KEYS = ['archives', 'archivedTabs'];

  /**
   * Initialize archive storage namespace if it doesn't exist
   */
  static async initializeArchiveStorage(): Promise<MigrationResult> {
    try {
      const result: MigrationResult = {
        success: true,
        migrated: 0,
        skipped: 0,
        errors: []
      };

      // Check if archive storage already exists
      const existingArchives = await Storage.get('archivedGroups');

      if (!existingArchives) {
        // Create empty archive storage
        const emptyStorage: ArchiveStorage = {
          archives: {},
          metadata: {
            totalArchives: 0,
            totalSizeBytes: 0,
            version: this.CURRENT_VERSION
          }
        };

        await Storage.set('archivedGroups', emptyStorage);
        console.log('Archive storage initialized');
      } else {
        // Validate existing storage
        const validation = await this.validateArchiveStorage(existingArchives);

        if (validation.requiresMigration) {
          const migrationResult = await this.migrateArchiveStorage(existingArchives);
          result.migrated = migrationResult.migrated;
          result.errors = migrationResult.errors;
        } else {
          result.skipped = 1;
        }
      }

      // Clean up legacy keys
      await this.cleanupLegacyData();

      return result;
    } catch (error) {
      return {
        success: false,
        migrated: 0,
        skipped: 0,
        errors: [`Failed to initialize archive storage: ${error.message}`]
      };
    }
  }

  /**
   * Validate archive storage structure and data integrity
   */
  static async validateArchiveStorage(storage: any): Promise<ArchiveValidation> {
    const issues: string[] = [];
    let requiresMigration = false;

    try {
      // Check if it's a valid ArchiveStorage object
      if (!storage || typeof storage !== 'object') {
        issues.push('Invalid storage object');
        return {
          isValid: false,
          version: 'unknown',
          issues,
          requiresMigration: true
        };
      }

      // Check for required top-level properties
      if (!storage.archives || typeof storage.archives !== 'object') {
        issues.push('Missing or invalid archives collection');
        requiresMigration = true;
      }

      if (!storage.metadata || typeof storage.metadata !== 'object') {
        issues.push('Missing or invalid metadata');
        requiresMigration = true;
      }

      // Check version
      const version = storage.metadata?.version || '0.0.0';
      if (version !== this.CURRENT_VERSION) {
        issues.push(`Version mismatch: ${version} vs ${this.CURRENT_VERSION}`);
        requiresMigration = true;
      }

      // Validate individual archives
      if (storage.archives) {
        for (const [archiveId, archive] of Object.entries(storage.archives)) {
          const archiveIssues = this.validateArchiveData(archiveId, archive as any);
          if (archiveIssues.length > 0) {
            issues.push(...archiveIssues);
            requiresMigration = true;
          }
        }
      }

      // Validate metadata consistency
      if (storage.metadata && storage.archives) {
        const actualCount = Object.keys(storage.archives).length;
        if (storage.metadata.totalArchives !== actualCount) {
          issues.push(`Archive count mismatch: metadata says ${storage.metadata.totalArchives}, actual: ${actualCount}`);
          requiresMigration = true;
        }
      }

      return {
        isValid: issues.length === 0,
        version,
        issues,
        requiresMigration
      };
    } catch (error) {
      return {
        isValid: false,
        version: 'unknown',
        issues: [`Validation error: ${error.message}`],
        requiresMigration: true
      };
    }
  }

  /**
   * Migrate archive storage to current version
   */
  static async migrateArchiveStorage(oldStorage: any): Promise<MigrationResult> {
    const result: MigrationResult = {
      success: true,
      migrated: 0,
      skipped: 0,
      errors: []
    };

    try {
      console.log('Starting archive storage migration...');

      // Create backup before migration
      await this.createBackup(oldStorage);

      // Initialize new storage structure
      const newStorage: ArchiveStorage = {
        archives: {},
        metadata: {
          totalArchives: 0,
          totalSizeBytes: 0,
          version: this.CURRENT_VERSION
        }
      };

      // Migrate archives
      if (oldStorage.archives && typeof oldStorage.archives === 'object') {
        for (const [archiveId, oldArchive] of Object.entries(oldStorage.archives)) {
          try {
            const migratedArchive = this.migrateArchiveData(archiveId, oldArchive as any);
            if (migratedArchive) {
              newStorage.archives[archiveId] = migratedArchive;
              result.migrated++;
            } else {
              result.skipped++;
            }
          } catch (error) {
            result.errors.push(`Failed to migrate archive ${archiveId}: ${error.message}`);
          }
        }
      }

      // Update metadata
      newStorage.metadata.totalArchives = Object.keys(newStorage.archives).length;
      newStorage.metadata.totalSizeBytes = this.calculateStorageSize(newStorage);

      // Save migrated storage
      await Storage.set('archivedGroups', newStorage);

      console.log(`Migration completed: ${result.migrated} migrated, ${result.skipped} skipped, ${result.errors.length} errors`);
      return result;
    } catch (error) {
      result.success = false;
      result.errors.push(`Migration failed: ${error.message}`);
      return result;
    }
  }

  /**
   * Check storage health and recommend cleanup actions
   */
  static async checkStorageHealth(): Promise<{
    healthy: boolean;
    totalSize: number;
    corruptedArchives: string[];
    orphanedData: string[];
    recommendations: string[];
  }> {
    try {
      const archives = await ArchiveStorageService.getArchives();
      const corruptedArchives: string[] = [];
      const orphanedData: string[] = [];
      const recommendations: string[] = [];

      // Check each archive for corruption
      for (const [archiveId, archive] of Object.entries(archives.archives)) {
        const validation = this.validateArchiveData(archiveId, archive);
        if (validation.length > 0) {
          corruptedArchives.push(archiveId);
        }
      }

      // Check for orphaned search index entries
      const searchIndex = await Storage.get('archiveSearchIndex') || [];
      for (const indexEntry of searchIndex) {
        if (!archives.archives[indexEntry.archiveId]) {
          orphanedData.push(`Search index entry: ${indexEntry.archiveId}`);
        }
      }

      // Generate recommendations
      if (corruptedArchives.length > 0) {
        recommendations.push(`Remove ${corruptedArchives.length} corrupted archive(s)`);
      }

      if (orphanedData.length > 0) {
        recommendations.push(`Clean up ${orphanedData.length} orphaned data entries`);
      }

      const stats = await ArchiveStorageService.getStorageStats();
      if (stats.nearQuotaLimit) {
        recommendations.push('Archive storage is near quota limit - consider cleanup');
      }

      if (archives.metadata.totalArchives > 100) {
        recommendations.push('Consider archiving old archives to reduce storage usage');
      }

      return {
        healthy: corruptedArchives.length === 0 && orphanedData.length === 0,
        totalSize: stats.totalSizeBytes,
        corruptedArchives,
        orphanedData,
        recommendations
      };
    } catch (error) {
      return {
        healthy: false,
        totalSize: 0,
        corruptedArchives: [],
        orphanedData: [],
        recommendations: [`Health check failed: ${error.message}`]
      };
    }
  }

  /**
   * Clean up corrupted data and optimize storage
   */
  static async repairStorage(): Promise<MigrationResult> {
    const result: MigrationResult = {
      success: true,
      migrated: 0,
      skipped: 0,
      errors: []
    };

    try {
      const health = await this.checkStorageHealth();

      if (health.healthy) {
        result.skipped = 1;
        return result;
      }

      // Create backup before repair
      const archives = await ArchiveStorageService.getArchives();
      await this.createBackup(archives);

      // Remove corrupted archives
      for (const corruptedId of health.corruptedArchives) {
        try {
          await ArchiveStorageService.removeArchive(corruptedId);
          result.migrated++;
        } catch (error) {
          result.errors.push(`Failed to remove corrupted archive ${corruptedId}: ${error.message}`);
        }
      }

      // Clean up orphaned data
      if (health.orphanedData.length > 0) {
        await this.cleanupOrphanedData();
      }

      // Rebuild search index
      await this.rebuildSearchIndex();

      return result;
    } catch (error) {
      result.success = false;
      result.errors.push(`Storage repair failed: ${error.message}`);
      return result;
    }
  }

  // Private helper methods

  private static validateArchiveData(archiveId: string, archive: any): string[] {
    const issues: string[] = [];

    if (!archive || typeof archive !== 'object') {
      issues.push(`Invalid archive object for ${archiveId}`);
      return issues;
    }

    // Required fields
    const requiredFields = ['id', 'originalGroup', 'metadata', 'protection'];
    for (const field of requiredFields) {
      if (!archive[field]) {
        issues.push(`Missing ${field} in archive ${archiveId}`);
      }
    }

    // Validate metadata structure
    if (archive.metadata && typeof archive.metadata === 'object') {
      if (typeof archive.metadata.archivedDate !== 'number') {
        issues.push(`Invalid archivedDate in archive ${archiveId}`);
      }
      if (typeof archive.metadata.accessCount !== 'number') {
        issues.push(`Invalid accessCount in archive ${archiveId}`);
      }
    }

    // Validate protection structure
    if (archive.protection && typeof archive.protection === 'object') {
      if (typeof archive.protection.passwordProtected !== 'boolean') {
        issues.push(`Invalid passwordProtected flag in archive ${archiveId}`);
      }
    }

    return issues;
  }

  private static migrateArchiveData(archiveId: string, oldArchive: any): ArchivedGroup | null {
    try {
      // If already in current format, return as-is
      if (oldArchive.version === this.CURRENT_VERSION) {
        return oldArchive as ArchivedGroup;
      }

      // Migrate to current format
      const migratedArchive: ArchivedGroup = {
        id: oldArchive.id || archiveId,
        originalGroup: oldArchive.originalGroup || oldArchive.group,
        metadata: {
          archivedDate: oldArchive.metadata?.archivedDate || oldArchive.archivedDate || Date.now(),
          archiveReason: oldArchive.metadata?.archiveReason,
          accessCount: oldArchive.metadata?.accessCount || 0,
          lastAccessed: oldArchive.metadata?.lastAccessed,
          restoredCount: oldArchive.metadata?.restoredCount || 0,
          lastRestored: oldArchive.metadata?.lastRestored
        },
        protection: {
          passwordProtected: oldArchive.protection?.passwordProtected || oldArchive.passwordProtected || false,
          passwordHash: oldArchive.protection?.passwordHash || oldArchive.passwordHash,
          passwordSalt: oldArchive.protection?.passwordSalt || oldArchive.passwordSalt,
          passwordHint: oldArchive.protection?.passwordHint || oldArchive.passwordHint,
          encryptionIv: oldArchive.protection?.encryptionIv || oldArchive.encryptionIv,
          keyDerivationParams: oldArchive.protection?.keyDerivationParams || {
            iterations: 100000,
            algorithm: 'PBKDF2'
          }
        },
        version: this.CURRENT_VERSION,
        checksum: oldArchive.checksum
      };

      return migratedArchive;
    } catch (error) {
      console.error(`Failed to migrate archive ${archiveId}:`, error);
      return null;
    }
  }

  private static async createBackup(data: any): Promise<void> {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupKey = `archive_backup_${timestamp}`;
      await Storage.set(backupKey, data);
      console.log(`Backup created: ${backupKey}`);
    } catch (error) {
      console.warn('Failed to create backup:', error);
    }
  }

  private static calculateStorageSize(storage: ArchiveStorage): number {
    try {
      return new Blob([JSON.stringify(storage)]).size;
    } catch (error) {
      return 0;
    }
  }

  private static async cleanupLegacyData(): Promise<void> {
    try {
      for (const legacyKey of this.LEGACY_KEYS) {
        const legacyData = await Storage.get(legacyKey);
        if (legacyData) {
          await Storage.remove(legacyKey);
          console.log(`Removed legacy key: ${legacyKey}`);
        }
      }
    } catch (error) {
      console.warn('Failed to cleanup legacy data:', error);
    }
  }

  private static async cleanupOrphanedData(): Promise<void> {
    try {
      // Clean up orphaned search index entries
      const archives = await ArchiveStorageService.getArchives();
      const searchIndex = await Storage.get('archiveSearchIndex') || [];

      const validEntries = searchIndex.filter((entry: any) =>
        archives.archives[entry.archiveId]
      );

      await Storage.set('archiveSearchIndex', validEntries);
      console.log('Orphaned search index entries cleaned up');
    } catch (error) {
      console.warn('Failed to cleanup orphaned data:', error);
    }
  }

  private static async rebuildSearchIndex(): Promise<void> {
    try {
      // Clear existing index
      await Storage.set('archiveSearchIndex', []);

      // Rebuild from current archives
      const archives = await ArchiveStorageService.getArchives();
      for (const archive of Object.values(archives.archives)) {
        // This will be implemented by the archive storage service
        // await ArchiveStorageService.updateSearchIndex(archive);
      }

      console.log('Search index rebuilt');
    } catch (error) {
      console.warn('Failed to rebuild search index:', error);
    }
  }
}
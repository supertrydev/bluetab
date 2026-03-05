import { ArchivedGroup, PasswordProtection, ArchiveMetadata } from '../types/archive';
import { TabGroup, TabItem } from '../types/models';
import { CryptoService } from './crypto-service';

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface ValidationError {
  code: string;
  message: string;
  field?: string;
  severity: 'error' | 'warning';
}

export interface ValidationWarning {
  code: string;
  message: string;
  field?: string;
  recommendation?: string;
}

export interface ArchiveIntegrityCheck {
  checksumValid: boolean;
  structureValid: boolean;
  dataConsistent: boolean;
  encryptionValid?: boolean;
}

export class ArchiveValidator {
  private static readonly CURRENT_VERSION = '1.0.0';
  private static readonly MAX_ARCHIVE_SIZE = 1024 * 1024; // 1MB per archive
  private static readonly MAX_TAB_COUNT = 500;
  private static readonly MAX_GROUP_NAME_LENGTH = 500;
  private static readonly MAX_TAB_TITLE_LENGTH = 300;

  /**
   * Validate a complete archived group
   */
  static async validateArchivedGroup(archive: ArchivedGroup): Promise<ValidationResult> {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    try {
      // Basic structure validation
      this.validateBasicStructure(archive, errors);

      // Metadata validation
      this.validateMetadata(archive.metadata, errors, warnings);

      // Protection validation
      await this.validateProtection(archive.protection, errors, warnings);

      // Version validation
      this.validateVersion(archive.version, errors, warnings);

      // Data integrity validation
      if (archive.checksum) {
        await this.validateChecksum(archive, errors);
      } else {
        warnings.push({
          code: 'MISSING_CHECKSUM',
          message: 'Archive missing data integrity checksum',
          recommendation: 'Regenerate checksum for data integrity verification'
        });
      }

      // Content validation (if not encrypted)
      if (!archive.protection.passwordProtected && typeof archive.originalGroup !== 'string') {
        this.validateTabGroup(archive.originalGroup as TabGroup, errors, warnings);
      }

      // Size validation
      await this.validateArchiveSize(archive, errors, warnings);

      const severity = this.calculateSeverity(errors, warnings);

      return {
        isValid: errors.length === 0,
        errors,
        warnings,
        severity
      };
    } catch (error) {
      return {
        isValid: false,
        errors: [{
          code: 'VALIDATION_FAILED',
          message: `Archive validation failed: ${error.message}`,
          severity: 'error'
        }],
        warnings,
        severity: 'critical'
      };
    }
  }

  /**
   * Validate tab group structure and content
   */
  static validateTabGroup(group: TabGroup): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    try {
      // Required fields
      if (!group.id || typeof group.id !== 'string') {
        errors.push({
          code: 'INVALID_GROUP_ID',
          message: 'Group ID is required and must be a string',
          field: 'id',
          severity: 'error'
        });
      }

      if (!group.name || typeof group.name !== 'string') {
        errors.push({
          code: 'INVALID_GROUP_NAME',
          message: 'Group name is required and must be a string',
          field: 'name',
          severity: 'error'
        });
      } else if (group.name.length > this.MAX_GROUP_NAME_LENGTH) {
        errors.push({
          code: 'GROUP_NAME_TOO_LONG',
          message: `Group name exceeds maximum length of ${this.MAX_GROUP_NAME_LENGTH} characters`,
          field: 'name',
          severity: 'error'
        });
      }

      // Tabs validation
      if (!Array.isArray(group.tabs)) {
        errors.push({
          code: 'INVALID_TABS_ARRAY',
          message: 'Tabs must be an array',
          field: 'tabs',
          severity: 'error'
        });
      } else {
        if (group.tabs.length === 0) {
          warnings.push({
            code: 'EMPTY_TAB_GROUP',
            message: 'Tab group contains no tabs',
            field: 'tabs',
            recommendation: 'Consider removing empty groups'
          });
        } else if (group.tabs.length > this.MAX_TAB_COUNT) {
          errors.push({
            code: 'TOO_MANY_TABS',
            message: `Group contains ${group.tabs.length} tabs, exceeds maximum of ${this.MAX_TAB_COUNT}`,
            field: 'tabs',
            severity: 'error'
          });
        }

        // Validate individual tabs
        group.tabs.forEach((tab, index) => {
          const tabErrors = this.validateTabItem(tab, index);
          errors.push(...tabErrors);
        });
      }

      // Timestamp validation
      if (typeof group.created !== 'number' || group.created <= 0) {
        errors.push({
          code: 'INVALID_CREATED_TIMESTAMP',
          message: 'Created timestamp must be a positive number',
          field: 'created',
          severity: 'error'
        });
      }

      if (typeof group.modified !== 'number' || group.modified <= 0) {
        errors.push({
          code: 'INVALID_MODIFIED_TIMESTAMP',
          message: 'Modified timestamp must be a positive number',
          field: 'modified',
          severity: 'error'
        });
      }

      if (group.created > group.modified) {
        warnings.push({
          code: 'INCONSISTENT_TIMESTAMPS',
          message: 'Created timestamp is after modified timestamp',
          recommendation: 'Check timestamp consistency'
        });
      }

      // Optional field validation
      if (group.tags && !Array.isArray(group.tags)) {
        errors.push({
          code: 'INVALID_TAGS_ARRAY',
          message: 'Tags must be an array if provided',
          field: 'tags',
          severity: 'error'
        });
      }

      const severity = this.calculateSeverity(errors, warnings);

      return {
        isValid: errors.length === 0,
        errors,
        warnings,
        severity
      };
    } catch (error) {
      return {
        isValid: false,
        errors: [{
          code: 'TAB_GROUP_VALIDATION_FAILED',
          message: `Tab group validation failed: ${error.message}`,
          severity: 'error'
        }],
        warnings,
        severity: 'critical'
      };
    }
  }

  /**
   * Perform comprehensive archive integrity check
   */
  static async performIntegrityCheck(archive: ArchivedGroup): Promise<ArchiveIntegrityCheck> {
    try {
      const result: ArchiveIntegrityCheck = {
        checksumValid: false,
        structureValid: false,
        dataConsistent: false,
        encryptionValid: undefined
      };

      // Checksum validation using consistent method
      if (archive.checksum) {
        const checksumData = this.generateChecksumData(archive);
        const currentChecksum = await CryptoService.generateChecksum(checksumData);
        result.checksumValid = currentChecksum === archive.checksum;
      }

      // Structure validation
      const validation = await this.validateArchivedGroup(archive);
      result.structureValid = validation.isValid;

      // Data consistency check
      result.dataConsistent = this.checkDataConsistency(archive);

      // Encryption validation (if applicable)
      if (archive.protection.passwordProtected) {
        result.encryptionValid = this.validateEncryptionStructure(archive.protection);
      }

      return result;
    } catch (error) {
      console.error('Integrity check failed:', error);
      return {
        checksumValid: false,
        structureValid: false,
        dataConsistent: false,
        encryptionValid: false
      };
    }
  }

  /**
   * Quick validation for critical errors only
   */
  static async quickValidate(archive: ArchivedGroup): Promise<boolean> {
    try {
      // Check basic structure
      if (!archive || !archive.id || !archive.originalGroup || !archive.metadata || !archive.protection) {
        return false;
      }

      // Check for corruption indicators
      if (archive.checksum) {
        const integrity = await this.performIntegrityCheck(archive);
        if (!integrity.checksumValid) {
          return false;
        }
      }

      // Check timestamps for obvious corruption
      if (archive.metadata.archivedDate > Date.now() + 86400000) { // More than 1 day in future
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Sanitize archive data before storage
   */
  static sanitizeArchiveData(archive: ArchivedGroup): ArchivedGroup {
    try {
      const sanitized = { ...archive };

      // Sanitize metadata
      sanitized.metadata = {
        ...archive.metadata,
        archivedDate: Math.max(0, archive.metadata.archivedDate),
        accessCount: Math.max(0, archive.metadata.accessCount || 0),
        restoredCount: Math.max(0, archive.metadata.restoredCount || 0)
      };

      // Sanitize archive reason if provided
      if (sanitized.metadata.archiveReason) {
        sanitized.metadata.archiveReason = sanitized.metadata.archiveReason.trim().substring(0, 500);
      }

      // Sanitize protection data
      sanitized.protection = {
        ...archive.protection,
        passwordProtected: Boolean(archive.protection.passwordProtected)
      };

      // If password hint exists, limit its length
      if (sanitized.protection.passwordHint) {
        const maxHintLength = 200;
        if (sanitized.protection.passwordHint.length > maxHintLength) {
          sanitized.protection.passwordHint = sanitized.protection.passwordHint.substring(0, maxHintLength);
        }
      }

      // Sanitize tab group data (if not encrypted)
      if (!archive.protection.passwordProtected && typeof archive.originalGroup !== 'string') {
        sanitized.originalGroup = this.sanitizeTabGroup(archive.originalGroup as TabGroup);
      }

      return sanitized;
    } catch (error) {
      console.error('Archive sanitization failed:', error);
      return archive; // Return original if sanitization fails
    }
  }

  // Private helper methods

  private static validateBasicStructure(archive: ArchivedGroup, errors: ValidationError[]): void {
    if (!archive.id || typeof archive.id !== 'string') {
      errors.push({
        code: 'INVALID_ARCHIVE_ID',
        message: 'Archive ID is required and must be a string',
        field: 'id',
        severity: 'error'
      });
    }

    if (!archive.originalGroup) {
      errors.push({
        code: 'MISSING_ORIGINAL_GROUP',
        message: 'Original group data is required',
        field: 'originalGroup',
        severity: 'error'
      });
    }

    if (!archive.metadata || typeof archive.metadata !== 'object') {
      errors.push({
        code: 'INVALID_METADATA',
        message: 'Archive metadata is required and must be an object',
        field: 'metadata',
        severity: 'error'
      });
    }

    if (!archive.protection || typeof archive.protection !== 'object') {
      errors.push({
        code: 'INVALID_PROTECTION',
        message: 'Archive protection settings are required',
        field: 'protection',
        severity: 'error'
      });
    }
  }

  private static validateMetadata(metadata: ArchiveMetadata, errors: ValidationError[], warnings: ValidationWarning[]): void {
    if (typeof metadata.archivedDate !== 'number' || metadata.archivedDate <= 0) {
      errors.push({
        code: 'INVALID_ARCHIVED_DATE',
        message: 'Archived date must be a positive timestamp',
        field: 'metadata.archivedDate',
        severity: 'error'
      });
    }

    if (metadata.archivedDate > Date.now()) {
      warnings.push({
        code: 'FUTURE_ARCHIVED_DATE',
        message: 'Archived date is in the future',
        field: 'metadata.archivedDate',
        recommendation: 'Verify timestamp accuracy'
      });
    }

    if (typeof metadata.accessCount !== 'number' || metadata.accessCount < 0) {
      errors.push({
        code: 'INVALID_ACCESS_COUNT',
        message: 'Access count must be a non-negative number',
        field: 'metadata.accessCount',
        severity: 'error'
      });
    }

    if (metadata.lastAccessed && (typeof metadata.lastAccessed !== 'number' || metadata.lastAccessed <= 0)) {
      errors.push({
        code: 'INVALID_LAST_ACCESSED',
        message: 'Last accessed timestamp must be a positive number',
        field: 'metadata.lastAccessed',
        severity: 'error'
      });
    }
  }

  private static async validateProtection(protection: PasswordProtection, errors: ValidationError[], warnings: ValidationWarning[]): Promise<void> {
    if (typeof protection.passwordProtected !== 'boolean') {
      errors.push({
        code: 'INVALID_PASSWORD_PROTECTED_FLAG',
        message: 'Password protected flag must be a boolean',
        field: 'protection.passwordProtected',
        severity: 'error'
      });
    }

    if (protection.passwordProtected) {
      if (!protection.passwordHash || typeof protection.passwordHash !== 'string') {
        errors.push({
          code: 'MISSING_PASSWORD_HASH',
          message: 'Password hash is required for protected archives',
          field: 'protection.passwordHash',
          severity: 'error'
        });
      }

      if (!protection.passwordSalt || typeof protection.passwordSalt !== 'string') {
        errors.push({
          code: 'MISSING_PASSWORD_SALT',
          message: 'Password salt is required for protected archives',
          field: 'protection.passwordSalt',
          severity: 'error'
        });
      }

      if (!protection.encryptionSalt || typeof protection.encryptionSalt !== 'string') {
        if (protection.passwordSalt && typeof protection.passwordSalt === 'string') {
          warnings.push({
            code: 'MISSING_ENCRYPTION_SALT',
            message: 'Encryption salt missing; falling back to password salt. Consider re-saving the archive to update security metadata.',
            field: 'protection.encryptionSalt',
            recommendation: 'Re-save archive to regenerate encryption salt'
          });
        } else {
          errors.push({
            code: 'MISSING_ENCRYPTION_SALT',
            message: 'Encryption salt is required for protected archives',
            field: 'protection.encryptionSalt',
            severity: 'error'
          });
        }
      }

      if (!protection.encryptionIv || typeof protection.encryptionIv !== 'string') {
        errors.push({
          code: 'MISSING_ENCRYPTION_IV',
          message: 'Encryption IV is required for protected archives',
          field: 'protection.encryptionIv',
          severity: 'error'
        });
      }

      if (protection.keyDerivationParams) {
        if (protection.keyDerivationParams.iterations < 50000) {
          warnings.push({
            code: 'LOW_ITERATION_COUNT',
            message: 'Key derivation iteration count is below recommended minimum',
            field: 'protection.keyDerivationParams.iterations',
            recommendation: 'Use at least 100,000 iterations for better security'
          });
        }
      }
    }
  }

  private static validateVersion(version: string, errors: ValidationError[], warnings: ValidationWarning[]): void {
    if (!version || typeof version !== 'string') {
      errors.push({
        code: 'INVALID_VERSION',
        message: 'Version is required and must be a string',
        field: 'version',
        severity: 'error'
      });
    } else if (version !== this.CURRENT_VERSION) {
      warnings.push({
        code: 'VERSION_MISMATCH',
        message: `Archive version ${version} differs from current version ${this.CURRENT_VERSION}`,
        field: 'version',
        recommendation: 'Consider migrating to current version'
      });
    }
  }

  /**
   * Generate checksum data string for an archive (used by both generation and validation)
   */
  static generateChecksumData(archive: ArchivedGroup): string {
    if (archive.protection.passwordProtected) {
      // For encrypted archives, the checksum should be based on the encrypted data
      return typeof archive.originalGroup === 'string'
        ? archive.originalGroup
        : JSON.stringify(archive.originalGroup);
    } else {
      // For unencrypted archives, ensure consistent JSON serialization with sorted keys
      return JSON.stringify(archive.originalGroup, Object.keys(archive.originalGroup as object).sort());
    }
  }

  private static async validateChecksum(archive: ArchivedGroup, errors: ValidationError[]): Promise<void> {
    try {
      // Generate checksum data using the consistent method
      const checksumData = this.generateChecksumData(archive);
      const currentChecksum = await CryptoService.generateChecksum(checksumData);

      if (currentChecksum !== archive.checksum) {
        console.warn('Checksum validation failed:', {
          expected: archive.checksum,
          actual: currentChecksum,
          dataLength: checksumData.length,
          isPasswordProtected: archive.protection.passwordProtected
        });

        errors.push({
          code: 'CHECKSUM_MISMATCH',
          message: 'Archive checksum does not match current data',
          field: 'checksum',
          severity: 'error'
        });
      }
    } catch (error) {
      console.error('Checksum validation error:', error);
      errors.push({
        code: 'CHECKSUM_VALIDATION_FAILED',
        message: `Failed to validate checksum: ${error.message}`,
        field: 'checksum',
        severity: 'error'
      });
    }
  }

  private static validateTabItem(tab: TabItem, index: number): ValidationError[] {
    const errors: ValidationError[] = [];

    if (!tab.id || typeof tab.id !== 'string') {
      errors.push({
        code: 'INVALID_TAB_ID',
        message: `Tab ${index}: ID is required and must be a string`,
        field: `tabs[${index}].id`,
        severity: 'error'
      });
    }

    if (!tab.url || typeof tab.url !== 'string') {
      errors.push({
        code: 'INVALID_TAB_URL',
        message: `Tab ${index}: URL is required and must be a string`,
        field: `tabs[${index}].url`,
        severity: 'error'
      });
    } else {
      try {
        new URL(tab.url);
      } catch {
        errors.push({
          code: 'MALFORMED_TAB_URL',
          message: `Tab ${index}: URL is malformed`,
          field: `tabs[${index}].url`,
          severity: 'error'
        });
      }
    }

    if (!tab.title || typeof tab.title !== 'string') {
      errors.push({
        code: 'INVALID_TAB_TITLE',
        message: `Tab ${index}: Title is required and must be a string`,
        field: `tabs[${index}].title`,
        severity: 'error'
      });
    } else if (tab.title.length > this.MAX_TAB_TITLE_LENGTH) {
      errors.push({
        code: 'TAB_TITLE_TOO_LONG',
        message: `Tab ${index}: Title exceeds maximum length`,
        field: `tabs[${index}].title`,
        severity: 'error'
      });
    }

    // Timestamp is optional - don't fail validation if missing
    // Many tabs may not have a timestamp set

    return errors;
  }

  private static async validateArchiveSize(archive: ArchivedGroup, errors: ValidationError[], warnings: ValidationWarning[]): Promise<void> {
    try {
      const archiveSize = new Blob([JSON.stringify(archive)]).size;

      if (archiveSize > this.MAX_ARCHIVE_SIZE) {
        errors.push({
          code: 'ARCHIVE_TOO_LARGE',
          message: `Archive size ${archiveSize} bytes exceeds maximum of ${this.MAX_ARCHIVE_SIZE} bytes`,
          severity: 'error'
        });
      } else if (archiveSize > this.MAX_ARCHIVE_SIZE * 0.8) {
        warnings.push({
          code: 'ARCHIVE_SIZE_WARNING',
          message: `Archive size ${archiveSize} bytes is approaching maximum limit`,
          recommendation: 'Consider reducing archive content or splitting into multiple archives'
        });
      }
    } catch (error) {
      errors.push({
        code: 'SIZE_VALIDATION_FAILED',
        message: `Failed to validate archive size: ${error.message}`,
        severity: 'error'
      });
    }
  }

  private static checkDataConsistency(archive: ArchivedGroup): boolean {
    try {
      // Check if archive ID matches metadata references
      if (archive.protection.passwordProtected) {
        return typeof archive.originalGroup === 'string';
      } else {
        const group = archive.originalGroup as TabGroup;
        return group && typeof group === 'object' && group.id === archive.id;
      }
    } catch {
      return false;
    }
  }

  private static validateEncryptionStructure(protection: PasswordProtection): boolean {
    return Boolean(
      protection.passwordHash &&
      protection.passwordSalt &&
      (protection.encryptionSalt || protection.passwordSalt) &&
      protection.encryptionIv &&
      protection.keyDerivationParams &&
      typeof protection.keyDerivationParams.iterations === 'number' &&
      protection.keyDerivationParams.iterations > 0
    );
  }

  private static sanitizeTabGroup(group: TabGroup): TabGroup {
    return {
      ...group,
      name: group.name.trim().substring(0, this.MAX_GROUP_NAME_LENGTH),
      tabs: group.tabs.map(tab => ({
        ...tab,
        title: tab.title.trim().substring(0, this.MAX_TAB_TITLE_LENGTH),
        url: tab.url.trim()
      })).filter(tab => tab.url && tab.title),
      tags: Array.isArray(group.tags) ? group.tags.filter(tag => typeof tag === 'string') : []
    };
  }

  private static calculateSeverity(errors: ValidationError[], warnings: ValidationWarning[]): 'low' | 'medium' | 'high' | 'critical' {
    if (errors.length === 0 && warnings.length === 0) return 'low';
    if (errors.length === 0 && warnings.length > 0) return 'low';
    if (errors.length === 1 && warnings.length <= 2) return 'medium';
    if (errors.length <= 3 || warnings.length > 5) return 'high';
    return 'critical';
  }
}

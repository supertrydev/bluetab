import { TabGroup } from './models';

/**
 * Archive-specific types for the archived groups feature
 */

export interface ArchiveMetadata {
  archivedDate: number;
  archiveReason?: string;
  accessCount: number;
  lastAccessed?: number;
  restoredCount: number;
  lastRestored?: number;
}

export interface PasswordProtection {
  passwordProtected: boolean;
  passwordHash?: string;
  passwordSalt?: string;
  encryptionSalt?: string;
  passwordHint?: string;
  encryptionIv?: string;
  keyDerivationParams?: {
    iterations: number;
    algorithm: string;
  };
}

export interface ArchivedGroup {
  id: string;
  originalGroup: TabGroup | string; // Encrypted if password protected
  metadata: ArchiveMetadata;
  protection: PasswordProtection;
  version: string; // For future migrations
  checksum?: string; // Data integrity verification
}

export interface ArchiveStorage {
  archives: { [archiveId: string]: ArchivedGroup };
  metadata: {
    totalArchives: number;
    totalSizeBytes: number;
    lastCleanup?: number;
    version: string;
  };
}

export interface ArchiveSearchIndex {
  archiveId: string;
  groupName: string;
  archivedDate: number;
  tabTitles: string[];
  tabUrls: string[];
  tags: string[];
  isProtected: boolean;
}

export interface ArchiveOperationResult {
  success: boolean;
  archiveId?: string;
  error?: string;
  affectedGroups?: string[];
}

export interface BulkArchiveOptions {
  useSharedPassword: boolean;
  password?: string;
  reason?: string;
  groupIds: string[];
}

export interface RestoreOptions {
  password?: string;
  handleConflicts: 'skip' | 'replace' | 'rename';
  restoreToActive: boolean;
}

export interface ArchiveFilters {
  dateRange?: {
    start: number;
    end: number;
  };
  protectionStatus?: 'all' | 'protected' | 'unprotected';
  searchQuery?: string;
  sortBy: 'date' | 'name' | 'size' | 'accessCount';
  sortOrder: 'asc' | 'desc';
}

export interface ArchiveAnalytics {
  totalArchives: number;
  protectedArchives: number;
  totalStorageUsed: number;
  averageArchiveSize: number;
  mostAccessedArchives: Array<{
    archiveId: string;
    groupName: string;
    accessCount: number;
  }>;
  archivesByMonth: Array<{
    month: string;
    count: number;
  }>;
  oldestArchive?: {
    archiveId: string;
    groupName: string;
    archivedDate: number;
  };
}

export type ArchiveValidationError =
  | 'INVALID_GROUP_ID'
  | 'GROUP_NOT_FOUND'
  | 'ARCHIVE_EXISTS'
  | 'INVALID_PASSWORD'
  | 'STORAGE_QUOTA_EXCEEDED'
  | 'ENCRYPTION_FAILED'
  | 'INVALID_ARCHIVE_DATA'
  | 'CHECKSUM_MISMATCH';

export interface ArchiveValidationResult {
  isValid: boolean;
  errors: ArchiveValidationError[];
  warnings: string[];
}

export interface ArchiveError {
  code: string;
  message: string;
  details?: any;
  timestamp: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  component: string;
  recoverable: boolean;
  userMessage?: string;
}

export interface ErrorContext {
  operation: string;
  archiveId?: string;
  userId?: string;
  metadata?: Record<string, any>;
}

export interface RecoveryAction {
  type: 'retry' | 'fallback' | 'cleanup' | 'manual';
  description: string;
  action: () => Promise<boolean>;
}

export class ArchiveErrorHandler {
  private static errorLog: ArchiveError[] = [];
  private static readonly MAX_ERROR_LOG_SIZE = 100;

  // Error codes for different types of archive operations
  static readonly ERROR_CODES = {
    // Storage errors
    STORAGE_QUOTA_EXCEEDED: 'STORAGE_QUOTA_EXCEEDED',
    STORAGE_PERMISSION_DENIED: 'STORAGE_PERMISSION_DENIED',
    STORAGE_CORRUPT: 'STORAGE_CORRUPT',
    STORAGE_UNAVAILABLE: 'STORAGE_UNAVAILABLE',

    // Encryption errors
    ENCRYPTION_FAILED: 'ENCRYPTION_FAILED',
    DECRYPTION_FAILED: 'DECRYPTION_FAILED',
    INVALID_PASSWORD: 'INVALID_PASSWORD',
    KEY_DERIVATION_FAILED: 'KEY_DERIVATION_FAILED',

    // Validation errors
    INVALID_ARCHIVE_DATA: 'INVALID_ARCHIVE_DATA',
    CHECKSUM_MISMATCH: 'CHECKSUM_MISMATCH',
    VERSION_INCOMPATIBLE: 'VERSION_INCOMPATIBLE',
    CORRUPTED_ARCHIVE: 'CORRUPTED_ARCHIVE',

    // Operation errors
    ARCHIVE_NOT_FOUND: 'ARCHIVE_NOT_FOUND',
    ARCHIVE_ALREADY_EXISTS: 'ARCHIVE_ALREADY_EXISTS',
    OPERATION_TIMEOUT: 'OPERATION_TIMEOUT',
    INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',

    // Migration errors
    MIGRATION_FAILED: 'MIGRATION_FAILED',
    BACKUP_FAILED: 'BACKUP_FAILED',
    ROLLBACK_FAILED: 'ROLLBACK_FAILED',

    // Network/API errors
    SYNC_FAILED: 'SYNC_FAILED',
    EXPORT_FAILED: 'EXPORT_FAILED',
    IMPORT_FAILED: 'IMPORT_FAILED',

    // Generic errors
    UNKNOWN_ERROR: 'UNKNOWN_ERROR',
    OPERATION_CANCELLED: 'OPERATION_CANCELLED'
  } as const;

  /**
   * Handle and log archive-related errors
   */
  static handleError(
    error: Error | ArchiveError,
    context: ErrorContext,
    component: string = 'unknown'
  ): ArchiveError {
    let archiveError: ArchiveError;

    if (this.isArchiveError(error)) {
      archiveError = error;
    } else {
      archiveError = this.createArchiveError(error, context, component);
    }

    // Log the error
    this.logError(archiveError);

    // Determine user-friendly message
    archiveError.userMessage = this.getUserFriendlyMessage(archiveError);

    // Notify error tracking (in production, this would send to error service)
    this.notifyErrorTracking(archiveError, context);

    return archiveError;
  }

  /**
   * Create recovery actions for specific error types
   */
  static createRecoveryActions(error: ArchiveError, context: ErrorContext): RecoveryAction[] {
    const actions: RecoveryAction[] = [];

    switch (error.code) {
      case this.ERROR_CODES.STORAGE_QUOTA_EXCEEDED:
        actions.push({
          type: 'cleanup',
          description: 'Clean up old archives to free space',
          action: async () => {
            try {
              const { ArchiveStorageService } = await import('./archive-storage');
              const result = await ArchiveStorageService.cleanupStorage();
              return result.cleaned > 0;
            } catch {
              return false;
            }
          }
        });
        break;

      case this.ERROR_CODES.INVALID_PASSWORD:
        actions.push({
          type: 'retry',
          description: 'Prompt user to re-enter password',
          action: async () => {
            // This would trigger a password prompt in the UI
            return true;
          }
        });
        break;

      case this.ERROR_CODES.CORRUPTED_ARCHIVE:
        actions.push({
          type: 'fallback',
          description: 'Attempt to restore from backup',
          action: async () => {
            try {
              // Attempt backup restoration logic
              return false; // Placeholder - would implement backup restoration
            } catch {
              return false;
            }
          }
        });
        break;

      case this.ERROR_CODES.MIGRATION_FAILED:
        actions.push({
          type: 'fallback',
          description: 'Rollback to previous version',
          action: async () => {
            try {
              const { ArchiveMigrationService } = await import('./archive-migration');
              // Would implement rollback logic
              return true;
            } catch {
              return false;
            }
          }
        });
        break;

      case this.ERROR_CODES.STORAGE_UNAVAILABLE:
        actions.push({
          type: 'retry',
          description: 'Retry operation after delay',
          action: async () => {
            await new Promise(resolve => setTimeout(resolve, 1000));
            return true;
          }
        });
        break;

      default:
        if (error.recoverable) {
          actions.push({
            type: 'retry',
            description: 'Retry the operation',
            action: async () => true
          });
        }
        break;
    }

    return actions;
  }

  /**
   * Execute recovery actions automatically where appropriate
   */
  static async attemptRecovery(error: ArchiveError, context: ErrorContext): Promise<boolean> {
    const recoveryActions = this.createRecoveryActions(error, context);

    for (const action of recoveryActions) {
      // Only auto-execute safe recovery actions
      if (action.type === 'retry' && error.severity === 'low') {
        try {
          const success = await action.action();
          if (success) {
            this.logRecoverySuccess(error, action);
            return true;
          }
        } catch (recoveryError) {
          this.logRecoveryFailure(error, action, recoveryError);
        }
      }
    }

    return false;
  }

  /**
   * Get error statistics for monitoring
   */
  static getErrorStatistics(): {
    totalErrors: number;
    errorsByCode: Record<string, number>;
    errorsBySeverity: Record<string, number>;
    recentErrors: ArchiveError[];
  } {
    const errorsByCode: Record<string, number> = {};
    const errorsBySeverity: Record<string, number> = {};

    this.errorLog.forEach(error => {
      errorsByCode[error.code] = (errorsByCode[error.code] || 0) + 1;
      errorsBySeverity[error.severity] = (errorsBySeverity[error.severity] || 0) + 1;
    });

    return {
      totalErrors: this.errorLog.length,
      errorsByCode,
      errorsBySeverity,
      recentErrors: this.errorLog.slice(-10) // Last 10 errors
    };
  }

  /**
   * Clear error log (useful for testing or maintenance)
   */
  static clearErrorLog(): void {
    this.errorLog = [];
  }

  /**
   * Export error log for debugging
   */
  static exportErrorLog(): string {
    return JSON.stringify(this.errorLog, null, 2);
  }

  // Private helper methods

  private static isArchiveError(error: any): error is ArchiveError {
    return error &&
      typeof error.code === 'string' &&
      typeof error.timestamp === 'number' &&
      typeof error.severity === 'string';
  }

  private static createArchiveError(
    error: Error,
    context: ErrorContext,
    component: string
  ): ArchiveError {
    const code = this.mapErrorToCode(error, context);
    const severity = this.determineSeverity(code, error);

    return {
      code,
      message: error.message || 'Unknown error occurred',
      details: {
        stack: error.stack,
        name: error.name,
        context
      },
      timestamp: Date.now(),
      severity,
      component,
      recoverable: this.isRecoverable(code, severity)
    };
  }

  private static mapErrorToCode(error: Error, context: ErrorContext): string {
    const message = error.message?.toLowerCase() || '';
    const operation = context.operation?.toLowerCase() || '';

    // Map common error patterns to codes
    if (message.includes('quota') || message.includes('storage full')) {
      return this.ERROR_CODES.STORAGE_QUOTA_EXCEEDED;
    }

    if (message.includes('permission') || message.includes('unauthorized')) {
      return this.ERROR_CODES.STORAGE_PERMISSION_DENIED;
    }

    if (message.includes('decrypt') || operation.includes('decrypt')) {
      return this.ERROR_CODES.DECRYPTION_FAILED;
    }

    if (message.includes('encrypt') || operation.includes('encrypt')) {
      return this.ERROR_CODES.ENCRYPTION_FAILED;
    }

    if (message.includes('incorrect password') || message.includes('wrong password') || message.includes('password is incorrect')) {
      return this.ERROR_CODES.INVALID_PASSWORD;
    }

    if (message.includes('timeout')) {
      return this.ERROR_CODES.OPERATION_TIMEOUT;
    }

    if (message.includes('not found') || operation.includes('get')) {
      return this.ERROR_CODES.ARCHIVE_NOT_FOUND;
    }

    if (message.includes('already exists')) {
      return this.ERROR_CODES.ARCHIVE_ALREADY_EXISTS;
    }

    if (operation.includes('migration')) {
      return this.ERROR_CODES.MIGRATION_FAILED;
    }

    if (operation.includes('validation')) {
      return this.ERROR_CODES.INVALID_ARCHIVE_DATA;
    }

    return this.ERROR_CODES.UNKNOWN_ERROR;
  }

  private static determineSeverity(code: string, error: Error): 'low' | 'medium' | 'high' | 'critical' {
    const criticalCodes = [
      this.ERROR_CODES.STORAGE_CORRUPT,
      this.ERROR_CODES.ROLLBACK_FAILED,
      this.ERROR_CODES.STORAGE_UNAVAILABLE
    ];

    const highCodes = [
      this.ERROR_CODES.MIGRATION_FAILED,
      this.ERROR_CODES.CORRUPTED_ARCHIVE,
      this.ERROR_CODES.ENCRYPTION_FAILED
    ];

    const mediumCodes = [
      this.ERROR_CODES.STORAGE_QUOTA_EXCEEDED,
      this.ERROR_CODES.INVALID_ARCHIVE_DATA,
      this.ERROR_CODES.DECRYPTION_FAILED
    ];

    if (criticalCodes.includes(code)) return 'critical';
    if (highCodes.includes(code)) return 'high';
    if (mediumCodes.includes(code)) return 'medium';
    return 'low';
  }

  private static isRecoverable(code: string, severity: 'low' | 'medium' | 'high' | 'critical'): boolean {
    const unrecoverableCodes = [
      this.ERROR_CODES.STORAGE_CORRUPT,
      this.ERROR_CODES.VERSION_INCOMPATIBLE,
      this.ERROR_CODES.INSUFFICIENT_PERMISSIONS
    ];

    if (unrecoverableCodes.includes(code)) return false;
    if (severity === 'critical') return false;
    return true;
  }

  private static getUserFriendlyMessage(error: ArchiveError): string {
    const userMessages: Record<string, string> = {
      [this.ERROR_CODES.STORAGE_QUOTA_EXCEEDED]: 'Storage is full. Please clean up old archives to continue.',
      [this.ERROR_CODES.INVALID_PASSWORD]: 'The password you entered is incorrect. Please try again.',
      [this.ERROR_CODES.ARCHIVE_NOT_FOUND]: 'The requested archive could not be found.',
      [this.ERROR_CODES.INVALID_ARCHIVE_DATA]: 'The archive data is invalid. Please check the group and try again.',
      [this.ERROR_CODES.CORRUPTED_ARCHIVE]: 'This archive appears to be corrupted and cannot be opened.',
      [this.ERROR_CODES.OPERATION_TIMEOUT]: 'The operation took too long and was cancelled. Please try again.',
      [this.ERROR_CODES.STORAGE_PERMISSION_DENIED]: 'Permission denied. Please check your browser settings.',
      [this.ERROR_CODES.ENCRYPTION_FAILED]: 'Failed to encrypt the archive. Please try again.',
      [this.ERROR_CODES.DECRYPTION_FAILED]: 'Failed to decrypt the archive. The data may be corrupted.',
      [this.ERROR_CODES.MIGRATION_FAILED]: 'Failed to upgrade archive format. Please contact support.',
      [this.ERROR_CODES.UNKNOWN_ERROR]: 'An unexpected error occurred. Please try again.'
    };

    return userMessages[error.code] || 'An error occurred while processing your request.';
  }

  private static logError(error: ArchiveError): void {
    // Add to in-memory log
    this.errorLog.push(error);

    // Maintain log size
    if (this.errorLog.length > this.MAX_ERROR_LOG_SIZE) {
      this.errorLog = this.errorLog.slice(-this.MAX_ERROR_LOG_SIZE);
    }

    // Console logging for development
    const logLevel = error.severity === 'critical' || error.severity === 'high' ? 'error' : 'warn';
    console[logLevel]('Archive Error:', {
      code: error.code,
      message: error.message,
      component: error.component,
      severity: error.severity,
      timestamp: new Date(error.timestamp).toISOString()
    });
  }

  private static notifyErrorTracking(error: ArchiveError, context: ErrorContext): void {
    // In production, this would send to an error tracking service
    // For now, we'll store it using chrome.storage.local for security
    // SECURITY: Using chrome.storage.local instead of localStorage to prevent XSS
    const errorReport = {
      error,
      context,
      userAgent: navigator.userAgent,
      timestamp: Date.now(),
      url: typeof window !== 'undefined' ? window.location.href : 'background'
    };

    // Use chrome.storage.local for secure storage (async, but fire-and-forget for tracking)
    chrome.storage.local.get(['archiveErrorReports'], (result) => {
      try {
        const existingReports = result.archiveErrorReports || [];
        existingReports.push(errorReport);

        // Keep only last 50 reports
        if (existingReports.length > 50) {
          existingReports.splice(0, existingReports.length - 50);
        }

        chrome.storage.local.set({ archiveErrorReports: existingReports });
      } catch (trackingError) {
        console.warn('Failed to track error:', trackingError);
      }
    });
  }

  private static logRecoverySuccess(error: ArchiveError, action: RecoveryAction): void {
    console.info('Recovery successful:', {
      originalError: error.code,
      recoveryAction: action.type,
      description: action.description
    });
  }

  private static logRecoveryFailure(error: ArchiveError, action: RecoveryAction, recoveryError: any): void {
    console.error('Recovery failed:', {
      originalError: error.code,
      recoveryAction: action.type,
      recoveryError: recoveryError.message,
      description: action.description
    });
  }
}
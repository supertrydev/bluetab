/**
 * Password Management Service
 * ===========================
 * WHY:  Encrypted archives need secure password handling with rate limiting.
 * WHAT: Password validation, attempt tracking, lockout enforcement, security audits.
 * HOW:  In-memory attempt tracking, PBKDF2 via CryptoService, policy-based validation.
 * NOT:  Does not store passwords (only derived keys), does not handle archive CRUD.
 */

import { PasswordManager, PasswordValidationResult, PasswordSetupResult } from '../utils/password-manager';
import { ArchiveStorageService } from '../utils/archive-storage';
import { CryptoService } from '../utils/crypto-service';
import { ArchiveErrorHandler } from '../utils/archive-error-handler';

export interface PasswordSecurityPolicy {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumbers: boolean;
  requireSpecialChars: boolean;
  maxAttempts: number;
  lockoutDurationMinutes: number;
}

export interface PasswordAttempt {
  archiveId: string;
  timestamp: number;
  success: boolean;
  ipAddress?: string;
}

export interface PasswordHintResult {
  hint?: string;
  error?: string;
  hintAvailable: boolean;
}

export interface PasswordChangeRequest {
  archiveId: string;
  currentPassword: string;
  newPassword: string;
  newHint?: string;
}

export interface SecurityAuditResult {
  archiveId: string;
  passwordScore: number;
  lastChanged?: Date;
  attemptHistory: PasswordAttempt[];
  recommendations: string[];
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

export class PasswordManagementService {
  private static readonly DEFAULT_POLICY: PasswordSecurityPolicy = {
    minLength: 12,
    requireUppercase: true,
    requireLowercase: true,
    requireNumbers: true,
    requireSpecialChars: true,
    maxAttempts: 3,
    lockoutDurationMinutes: 15
  };

  private static attemptHistory = new Map<string, PasswordAttempt[]>();
  private static lockouts = new Map<string, number>(); // archiveId -> unlock timestamp

  /**
   * Validate password against security policy
   */
  static validatePasswordWithPolicy(
    password: string,
    policy: PasswordSecurityPolicy = this.DEFAULT_POLICY
  ): PasswordValidationResult {
    const baseValidation = PasswordManager.validatePassword(password);
    const issues: string[] = [...baseValidation.issues];
    const suggestions: string[] = [...baseValidation.suggestions];

    // Apply custom policy rules
    if (password.length < policy.minLength) {
      issues.push(`Password must be at least ${policy.minLength} characters`);
      suggestions.push(`Use at least ${policy.minLength} characters`);
    }

    if (policy.requireUppercase && !/[A-Z]/.test(password)) {
      issues.push('Password must contain uppercase letters');
      suggestions.push('Add uppercase letters (A-Z)');
    }

    if (policy.requireLowercase && !/[a-z]/.test(password)) {
      issues.push('Password must contain lowercase letters');
      suggestions.push('Add lowercase letters (a-z)');
    }

    if (policy.requireNumbers && !/\d/.test(password)) {
      issues.push('Password must contain numbers');
      suggestions.push('Add numbers (0-9)');
    }

    if (policy.requireSpecialChars && !/[!@#$%^&*()_+\-=\[\]{};':\"\\|,.<>\/?]/.test(password)) {
      issues.push('Password must contain special characters');
      suggestions.push('Add special characters (!@#$%^&*)');
    }

    // Recalculate score based on policy compliance
    let score = baseValidation.score;
    const policyCompliant = issues.length === 0;
    if (!policyCompliant) {
      score = Math.max(0, score - 1);
    }

    return {
      isValid: policyCompliant && baseValidation.isValid,
      score,
      issues: Array.from(new Set(issues)),
      suggestions: Array.from(new Set(suggestions))
    };
  }

  /**
   * Attempt to unlock a protected archive with rate limiting
   */
  static async attemptUnlock(
    archiveId: string,
    password: string,
    policy: PasswordSecurityPolicy = this.DEFAULT_POLICY
  ): Promise<{
    success: boolean;
    data?: any;
    error?: string;
    attemptsRemaining?: number;
    lockoutUntil?: Date;
  }> {
    const context = { operation: 'attemptUnlock', archiveId };

    try {
      // Check if archive is currently locked out
      const lockoutUntil = this.lockouts.get(archiveId);
      if (lockoutUntil && Date.now() < lockoutUntil) {
        return {
          success: false,
          error: 'Archive is temporarily locked due to too many failed attempts',
          lockoutUntil: new Date(lockoutUntil)
        };
      }

      // Get archive
      const archive = await ArchiveStorageService.getArchive(archiveId);
      if (!archive) {
        const archiveError = ArchiveErrorHandler.handleError(
          new Error('Archive not found'),
          context,
          'PasswordManagementService'
        );
        return {
          success: false,
          error: archiveError.userMessage || archiveError.message
        };
      }

      if (!archive.protection.passwordProtected) {
        return {
          success: false,
          error: 'Archive is not password protected'
        };
      }

      // Attempt decryption
      const decryptResult = await PasswordManager.verifyPasswordAndDecrypt(
        archive.originalGroup as string,
        password,
        archive.protection
      );

      // Record attempt
      const attempt: PasswordAttempt = {
        archiveId,
        timestamp: Date.now(),
        success: decryptResult.success
      };

      this.recordPasswordAttempt(attempt);

      if (decryptResult.success) {
        // Clear any existing lockout
        this.lockouts.delete(archiveId);
        return {
          success: true,
          data: decryptResult.data
        };
      } else {
        // Handle failed attempt
        const attempts = this.getRecentAttempts(archiveId, policy.lockoutDurationMinutes);
        const failedAttempts = attempts.filter(a => !a.success).length;

        if (failedAttempts >= policy.maxAttempts) {
          // Lock out the archive
          const lockoutUntil = Date.now() + (policy.lockoutDurationMinutes * 60 * 1000);
          this.lockouts.set(archiveId, lockoutUntil);

          return {
            success: false,
            error: `Too many failed attempts. Archive locked for ${policy.lockoutDurationMinutes} minutes.`,
            lockoutUntil: new Date(lockoutUntil)
          };
        }

        return {
          success: false,
          error: 'Invalid password',
          attemptsRemaining: policy.maxAttempts - failedAttempts
        };
      }
    } catch (error) {
      const archiveError = ArchiveErrorHandler.handleError(
        error instanceof Error ? error : new Error(String(error)),
        context,
        'PasswordManagementService'
      );
      return {
        success: false,
        error: archiveError.userMessage || archiveError.message
      };
    }
  }

  /**
   * Get password hint for an archive
   */
  static async getPasswordHint(
    archiveId: string,
    password?: string
  ): Promise<PasswordHintResult> {
    const context = { operation: 'getPasswordHint', archiveId };

    try {
      const archive = await ArchiveStorageService.getArchive(archiveId);
      if (!archive) {
        return {
          hintAvailable: false,
          error: 'Archive not found'
        };
      }

      if (!archive.protection.passwordProtected) {
        return {
          hintAvailable: false,
          error: 'Archive is not password protected'
        };
      }

      if (!archive.protection.passwordHint) {
        return {
          hintAvailable: false,
          error: 'No hint available for this archive'
        };
      }

      // If password is provided, decrypt the hint
      if (password) {
        const hint = await PasswordManager.getPasswordHint(password, archive.protection);
        return {
          hintAvailable: true,
          hint: hint || 'Failed to decrypt hint'
        };
      }

      return {
        hintAvailable: true,
        hint: 'Hint is encrypted and requires the current password to view'
      };
    } catch (error) {
      ArchiveErrorHandler.handleError(
        error instanceof Error ? error : new Error(String(error)),
        context,
        'PasswordManagementService'
      );
      return {
        hintAvailable: false,
        error: 'Failed to retrieve hint'
      };
    }
  }

  /**
   * Change password for a protected archive
   */
  static async changePassword(
    request: PasswordChangeRequest,
    policy: PasswordSecurityPolicy = this.DEFAULT_POLICY
  ): Promise<{
    success: boolean;
    error?: string;
    validationWarnings?: string[];
  }> {
    const context = { operation: 'changePassword', archiveId: request.archiveId };

    try {
      // Validate new password
      const validation = this.validatePasswordWithPolicy(request.newPassword, policy);
      if (!validation.isValid) {
        return {
          success: false,
          error: `New password does not meet security requirements: ${validation.issues.join(', ')}`
        };
      }

      // Get archive
      const archive = await ArchiveStorageService.getArchive(request.archiveId);
      if (!archive) {
        return {
          success: false,
          error: 'Archive not found'
        };
      }

      if (!archive.protection.passwordProtected) {
        return {
          success: false,
          error: 'Archive is not password protected'
        };
      }

      // Verify current password
      const verifyResult = await PasswordManager.verifyPasswordAndDecrypt(
        archive.originalGroup as string,
        request.currentPassword,
        archive.protection
      );

      if (!verifyResult.success) {
        return {
          success: false,
          error: 'Current password is incorrect'
        };
      }

      // Change to new password
      const changeResult = await PasswordManager.changePassword(
        archive.originalGroup as string,
        request.currentPassword,
        request.newPassword,
        archive.protection,
        request.newHint
      );

      if (!changeResult.success || !changeResult.protection || !changeResult.encryptedData) {
        return {
          success: false,
          error: changeResult.error || 'Failed to change password'
        };
      }

      // Update archive with new protection settings
      const updatedArchive = {
        ...archive,
        protection: changeResult.protection,
        originalGroup: changeResult.encryptedData,
        metadata: {
          ...archive.metadata,
          lastPasswordChange: Date.now()
        }
      };

      try {
        updatedArchive.checksum = await CryptoService.generateChecksum(changeResult.encryptedData);
      } catch (checksumError) {
        return {
          success: false,
          error: `Failed to update archive checksum: ${checksumError instanceof Error ? checksumError.message : String(checksumError)}`
        };
      }

      const storeResult = await ArchiveStorageService.storeArchive(updatedArchive, { overwrite: true });
      if (!storeResult.success) {
        return {
          success: false,
          error: storeResult.error || 'Failed to save updated archive'
        };
      }

      return {
        success: true,
        validationWarnings: validation.suggestions.length > 0 ? validation.suggestions : undefined
      };

    } catch (error) {
      const archiveError = ArchiveErrorHandler.handleError(
        error instanceof Error ? error : new Error(String(error)),
        context,
        'PasswordManagementService'
      );
      return {
        success: false,
        error: archiveError.userMessage || archiveError.message
      };
    }
  }

  /**
   * Perform security audit on password-protected archives
   */
  static async performSecurityAudit(archiveId: string): Promise<SecurityAuditResult | null> {
    const context = { operation: 'performSecurityAudit', archiveId };

    try {
      const archive = await ArchiveStorageService.getArchive(archiveId);
      if (!archive || !archive.protection.passwordProtected) {
        return null;
      }

      const attempts = this.attemptHistory.get(archiveId) || [];
      const recommendations: string[] = [];
      let riskLevel: SecurityAuditResult['riskLevel'] = 'low';

      // Check password strength (we can't actually validate without the password)
      // This is a placeholder - in a real implementation, you might store password strength metrics
      let passwordScore = 3; // Default to medium strength

      // Check iteration count
      const iterations = archive.protection.keyDerivationParams?.iterations || 0;
      if (iterations < 100000) {
        recommendations.push('Consider updating password to use stronger key derivation');
        riskLevel = 'medium';
      }

      // Check failed attempt patterns
      const recentFailedAttempts = attempts.filter(a =>
        !a.success && Date.now() - a.timestamp < 24 * 60 * 60 * 1000 // Last 24 hours
      ).length;

      if (recentFailedAttempts > 10) {
        recommendations.push('High number of failed access attempts detected');
        riskLevel = 'high';
      }

      // Check age of password
      const lastChanged = archive.metadata.lastPasswordChange;
      if (lastChanged) {
        const ageMonths = (Date.now() - lastChanged) / (1000 * 60 * 60 * 24 * 30);
        if (ageMonths > 12) {
          recommendations.push('Password is over a year old - consider changing it');
          if (riskLevel === 'low') riskLevel = 'medium';
        }
      } else {
        recommendations.push('Password change date unknown - consider updating password');
      }

      // Check for security best practices
      if (!archive.protection.passwordHint) {
        recommendations.push('Consider adding a password hint for recovery');
      }

      return {
        archiveId,
        passwordScore,
        lastChanged: lastChanged ? new Date(lastChanged) : undefined,
        attemptHistory: attempts.slice(-20), // Last 20 attempts
        recommendations,
        riskLevel
      };

    } catch (error) {
      ArchiveErrorHandler.handleError(
        error instanceof Error ? error : new Error(String(error)),
        context,
        'PasswordManagementService'
      );
      return null;
    }
  }

  /**
   * Generate secure password suggestions
   */
  static generatePasswordSuggestions(
    count: number = 3,
    policy: PasswordSecurityPolicy = this.DEFAULT_POLICY
  ): string[] {
    const suggestions: string[] = [];

    for (let i = 0; i < count; i++) {
      let password = PasswordManager.generateSecurePassword(policy.minLength);

      // Ensure the generated password meets policy requirements
      let attempts = 0;
      while (!this.validatePasswordWithPolicy(password, policy).isValid && attempts < 10) {
        password = PasswordManager.generateSecurePassword(policy.minLength + attempts);
        attempts++;
      }

      suggestions.push(password);
    }

    return suggestions;
  }

  /**
   * Clear password attempt history and lockouts
   */
  static clearSecurityData(archiveId?: string): void {
    if (archiveId) {
      this.attemptHistory.delete(archiveId);
      this.lockouts.delete(archiveId);
    } else {
      this.attemptHistory.clear();
      this.lockouts.clear();
    }
  }

  /**
   * Get current lockout status for an archive
   */
  static getLockoutStatus(archiveId: string): {
    isLocked: boolean;
    unlockTime?: Date;
    attemptsRemaining?: number;
  } {
    const lockoutUntil = this.lockouts.get(archiveId);
    const isLocked = lockoutUntil ? Date.now() < lockoutUntil : false;

    if (isLocked) {
      return {
        isLocked: true,
        unlockTime: new Date(lockoutUntil!)
      };
    }

    const recentAttempts = this.getRecentAttempts(archiveId, this.DEFAULT_POLICY.lockoutDurationMinutes);
    const failedAttempts = recentAttempts.filter(a => !a.success).length;
    const attemptsRemaining = Math.max(0, this.DEFAULT_POLICY.maxAttempts - failedAttempts);

    return {
      isLocked: false,
      attemptsRemaining
    };
  }

  // Private helper methods

  private static recordPasswordAttempt(attempt: PasswordAttempt): void {
    const attempts = this.attemptHistory.get(attempt.archiveId) || [];
    attempts.push(attempt);

    // Keep only last 100 attempts per archive
    if (attempts.length > 100) {
      attempts.splice(0, attempts.length - 100);
    }

    this.attemptHistory.set(attempt.archiveId, attempts);
  }

  private static getRecentAttempts(archiveId: string, withinMinutes: number): PasswordAttempt[] {
    const attempts = this.attemptHistory.get(archiveId) || [];
    const cutoffTime = Date.now() - (withinMinutes * 60 * 1000);
    return attempts.filter(a => a.timestamp >= cutoffTime);
  }
}

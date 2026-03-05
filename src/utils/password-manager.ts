import { CryptoService, EncryptionResult, DecryptionResult } from './crypto-service';
import { TabGroup } from '../types/models';
import { PasswordProtection } from '../types/archive';

export interface PasswordValidationResult {
  isValid: boolean;
  score: number; // 0-4 (weak to very strong)
  issues: string[];
  suggestions: string[];
}

export interface PasswordSetupResult {
  success: boolean;
  protection?: PasswordProtection;
  encryptedData?: string;
  error?: string;
}

export interface PasswordVerificationResult {
  success: boolean;
  data?: any;
  error?: string;
}

export class PasswordManager {
  private static readonly MIN_PASSWORD_LENGTH = 8;
  private static readonly RECOMMENDED_LENGTH = 12;

  /**
   * Validate password strength and provide feedback
   */
  static validatePassword(password: string): PasswordValidationResult {
    const issues: string[] = [];
    const suggestions: string[] = [];
    let score = 0;

    const meetsMinLength = password.length >= this.MIN_PASSWORD_LENGTH;
    if (!meetsMinLength) {
      issues.push('Password is too short');
      suggestions.push(`Use at least ${this.MIN_PASSWORD_LENGTH} characters`);
    }

    if (password.length >= this.RECOMMENDED_LENGTH) {
      score += 1;
    }

    // Character variety checks
    const hasLowerCase = /[a-z]/.test(password);
    const hasUpperCase = /[A-Z]/.test(password);
    const hasNumbers = /\d/.test(password);
    const hasSpecialChars = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);

    if (!hasLowerCase) {
      suggestions.push('Add lowercase letters (a-z)');
    }

    if (!hasUpperCase) {
      suggestions.push('Add uppercase letters (A-Z)');
    }

    if (!hasNumbers) {
      suggestions.push('Add numbers (0-9)');
    }

    if (!hasSpecialChars) {
      suggestions.push('Add special characters (!@#$%^&*)');
    }

    // Calculate score based on character variety
    const charTypes = [hasLowerCase, hasUpperCase, hasNumbers, hasSpecialChars].filter(Boolean).length;
    score += charTypes;

    // Common patterns check
    const commonPatterns = [
      /123456/,
      /password/i,
      /qwerty/i,
      /(.)\1{3,}/, // Repeated characters
      /012345/
    ];

    for (const pattern of commonPatterns) {
      if (pattern.test(password)) {
        suggestions.push('Avoid common patterns and repeated characters');
        score = Math.max(0, score - 1);
        break;
      }
    }

    // Entropy bonus for longer passwords
    if (password.length >= 16) {
      score += 1;
    }

    score = Math.min(4, Math.max(score, 0));

    return {
      isValid: meetsMinLength,
      score,
      issues,
      suggestions
    };
  }

  /**
   * Set up password protection for archive data
   */
  static async setupPasswordProtection(
    data: TabGroup,
    password: string,
    hint?: string
  ): Promise<PasswordSetupResult> {
    try {
      // Validate password
      const validation = this.validatePassword(password);
      if (!validation.isValid) {
        return {
          success: false,
          error: `Weak password: ${validation.issues.join(', ')}`
        };
      }

      // Encrypt the data
      const encryptionResult = await CryptoService.encryptWithPassword(
        JSON.stringify(data),
        password,
        100000
      );

      // Hash the password for verification
      const passwordHash = await CryptoService.hashPassword(password);

      const protection: PasswordProtection = {
        passwordProtected: true,
        passwordHash: passwordHash.hash,
        passwordSalt: passwordHash.salt,
        passwordHint: hint && hint.trim() ? hint.trim() : undefined,
        encryptionIv: encryptionResult.iv,
        encryptionSalt: encryptionResult.salt,
        keyDerivationParams: {
          iterations: 100000,
          algorithm: 'PBKDF2'
        }
      };

      // Securely wipe password from memory
      CryptoService.secureWipe(password);

      return {
        success: true,
        protection,
        encryptedData: encryptionResult.encryptedData
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to setup password protection: ${error.message}`
      };
    }
  }

  /**
   * Verify password and decrypt data
   */
  static async verifyPasswordAndDecrypt(
    encryptedData: string,
    password: string,
    protection: PasswordProtection
  ): Promise<PasswordVerificationResult> {
    try {
      // First verify the password hash
      if (protection.passwordHash && protection.passwordSalt) {
        const isValidPassword = await CryptoService.verifyPassword(
          password,
          protection.passwordHash,
          protection.passwordSalt,
          protection.keyDerivationParams?.iterations || 100000
        );

        if (!isValidPassword) {
          return {
            success: false,
            error: 'Invalid password'
          };
        }
      }

      // Decrypt the data
      const decryptionResult = await CryptoService.decryptWithPassword(
        encryptedData,
        password,
        protection.encryptionSalt || protection.passwordSalt || '',
        protection.encryptionIv || '',
        protection.keyDerivationParams?.iterations || 100000
      );

      if (!decryptionResult.success) {
        return {
          success: false,
          error: decryptionResult.error
        };
      }

      try {
        const data = JSON.parse(decryptionResult.data!);
        return {
          success: true,
          data
        };
      } catch (parseError) {
        return {
          success: false,
          error: 'Invalid data format'
        };
      }
    } catch (error) {
      return {
        success: false,
        error: `Verification failed: ${error.message}`
      };
    } finally {
      // Securely wipe password from memory
      CryptoService.secureWipe(password);
    }
  }

  /**
   * Get decrypted password hint
   */
  static async getPasswordHint(
    password: string,
    protection: PasswordProtection
  ): Promise<string | null> {
    try {
      if (!protection.passwordHint) {
        return null;
      }

      const hintData = JSON.parse(protection.passwordHint);
      const decryptionResult = await CryptoService.decryptWithPassword(
        hintData.data,
        password,
        hintData.salt,
        hintData.iv,
        50000
      );

      return decryptionResult.success ? decryptionResult.data! : null;
    } catch (error) {
      console.error('Failed to decrypt hint:', error);
      return null;
    } finally {
      CryptoService.secureWipe(password);
    }
  }

  /**
   * Change password for existing protected data
   */
  static async changePassword(
    encryptedData: string,
    oldPassword: string,
    newPassword: string,
    oldProtection: PasswordProtection,
    newHint?: string
  ): Promise<PasswordSetupResult> {
    try {
      // First decrypt with old password
      const decryptResult = await this.verifyPasswordAndDecrypt(
        encryptedData,
        oldPassword,
        oldProtection
      );

      if (!decryptResult.success) {
        return {
          success: false,
          error: 'Invalid old password'
        };
      }

      // Re-encrypt with new password
      return await this.setupPasswordProtection(
        decryptResult.data,
        newPassword,
        newHint
      );
    } catch (error) {
      return {
        success: false,
        error: `Failed to change password: ${error.message}`
      };
    }
  }

  /**
   * Generate a secure random password
   */
  static generateSecurePassword(length: number = 16): string {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:,.<>?';
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);

    let password = '';
    for (let i = 0; i < length; i++) {
      password += charset[array[i] % charset.length];
    }

    return password;
  }

  /**
   * Get password strength description
   */
  static getPasswordStrengthDescription(score: number): {
    text: string;
    color: string;
    recommendation: string;
  } {
    switch (score) {
      case 0:
      case 1:
        return {
          text: 'Very Weak',
          color: '#ef4444',
          recommendation: 'Use a longer password with mixed characters'
        };
      case 2:
        return {
          text: 'Weak',
          color: '#f97316',
          recommendation: 'Add more character variety for better security'
        };
      case 3:
        return {
          text: 'Good',
          color: '#eab308',
          recommendation: 'Consider making it longer for extra security'
        };
      case 4:
        return {
          text: 'Very Strong',
          color: '#22c55e',
          recommendation: 'Excellent password strength!'
        };
      default:
        return {
          text: 'Unknown',
          color: '#6b7280',
          recommendation: 'Please enter a password'
        };
    }
  }

  /**
   * Check if password meets minimum requirements
   */
  static meetsMinimumRequirements(password: string): boolean {
    const validation = this.validatePassword(password);
    return validation.isValid;
  }
}

/**
 * Cryptographic service for secure password protection in archived groups
 * Uses Web Crypto API for all cryptographic operations
 */

export interface KeyDerivationParams {
  iterations: number;
  algorithm: string;
  saltLength: number;
}

export interface EncryptionResult {
  encryptedData: string;
  iv: string;
  salt: string;
}

export interface DecryptionResult {
  success: boolean;
  data?: string;
  error?: string;
}

export class CryptoService {
  private static readonly DEFAULT_ITERATIONS = 100000;
  private static readonly SALT_LENGTH = 16;
  private static readonly IV_LENGTH = 12;
  private static readonly TAG_LENGTH = 16;

  /**
   * Generate a cryptographically secure random salt
   */
  static generateSalt(length: number = this.SALT_LENGTH): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(length));
  }

  /**
   * Generate a cryptographically secure random IV
   */
  static generateIV(length: number = this.IV_LENGTH): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(length));
  }

  /**
   * Derive an encryption key from a password using PBKDF2
   */
  static async deriveKey(
    password: string,
    salt: Uint8Array,
    iterations: number = this.DEFAULT_ITERATIONS
  ): Promise<CryptoKey> {
    try {
      // Import the password as a raw key with proper Unicode handling
      const encoder = new TextEncoder();
      const passwordBuffer = encoder.encode(password);
      const passwordKey = await crypto.subtle.importKey(
        'raw',
        passwordBuffer,
        'PBKDF2',
        false,
        ['deriveKey']
      );

      // Derive the encryption key
      const derivedKey = await crypto.subtle.deriveKey(
        {
          name: 'PBKDF2',
          salt: salt,
          iterations: iterations,
          hash: 'SHA-256'
        },
        passwordKey,
        {
          name: 'AES-GCM',
          length: 256
        },
        false,
        ['encrypt', 'decrypt']
      );

      return derivedKey;
    } catch (error) {
      throw new Error(`Key derivation failed: ${error.message}`);
    }
  }

  /**
   * Encrypt data using AES-GCM with a password
   */
  static async encryptWithPassword(
    data: string,
    password: string,
    iterations: number = this.DEFAULT_ITERATIONS
  ): Promise<EncryptionResult> {
    try {
      // Generate random salt and IV
      const salt = this.generateSalt();
      const iv = this.generateIV();

      // Derive encryption key from password
      const key = await this.deriveKey(password, salt, iterations);

      // Encrypt the data
      const encodedData = new TextEncoder().encode(data);
      const encryptedBuffer = await crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv: iv,
          tagLength: this.TAG_LENGTH * 8 // Convert to bits
        },
        key,
        encodedData
      );

      // Convert to base64 for storage
      const encryptedData = this.arrayBufferToBase64(encryptedBuffer);
      const saltBase64 = this.arrayBufferToBase64(salt.buffer);
      const ivBase64 = this.arrayBufferToBase64(iv.buffer);

      return {
        encryptedData,
        salt: saltBase64,
        iv: ivBase64
      };
    } catch (error) {
      throw new Error(`Encryption failed: ${error.message}`);
    }
  }

  /**
   * Decrypt data using AES-GCM with a password
   */
  static async decryptWithPassword(
    encryptedData: string,
    password: string,
    salt: string,
    iv: string,
    iterations: number = this.DEFAULT_ITERATIONS
  ): Promise<DecryptionResult> {
    try {
      // Convert base64 back to arrays
      const saltArray = new Uint8Array(this.base64ToArrayBuffer(salt));
      const ivArray = new Uint8Array(this.base64ToArrayBuffer(iv));
      const encryptedBuffer = this.base64ToArrayBuffer(encryptedData);

      // Derive the same key from password
      const key = await this.deriveKey(password, saltArray, iterations);

      // Decrypt the data
      const decryptedBuffer = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: ivArray,
          tagLength: this.TAG_LENGTH * 8
        },
        key,
        encryptedBuffer
      );

      // Convert back to string
      const decryptedData = new TextDecoder().decode(decryptedBuffer);

      return {
        success: true,
        data: decryptedData
      };
    } catch (error) {
      return {
        success: false,
        error: `Decryption failed: ${error.message}`
      };
    }
  }

  /**
   * Hash a password for storage (not for encryption)
   */
  static async hashPassword(
    password: string,
    salt?: Uint8Array,
    iterations: number = this.DEFAULT_ITERATIONS
  ): Promise<{
    hash: string;
    salt: string;
    iterations: number;
  }> {
    try {
      const saltArray = salt || this.generateSalt();

      // Import password for hashing with proper Unicode handling
      const encoder = new TextEncoder();
      const passwordBuffer = encoder.encode(password);
      const passwordKey = await crypto.subtle.importKey(
        'raw',
        passwordBuffer,
        'PBKDF2',
        false,
        ['deriveBits']
      );

      // Derive bits for the hash
      const hashBits = await crypto.subtle.deriveBits(
        {
          name: 'PBKDF2',
          salt: saltArray,
          iterations: iterations,
          hash: 'SHA-256'
        },
        passwordKey,
        256 // 32 bytes
      );

      return {
        hash: this.arrayBufferToBase64(hashBits),
        salt: this.arrayBufferToBase64(saltArray.buffer),
        iterations
      };
    } catch (error) {
      throw new Error(`Password hashing failed: ${error.message}`);
    }
  }

  /**
   * Verify a password against a stored hash
   */
  static async verifyPassword(
    password: string,
    storedHash: string,
    storedSalt: string,
    iterations: number = this.DEFAULT_ITERATIONS
  ): Promise<boolean> {
    try {
      const saltArray = new Uint8Array(this.base64ToArrayBuffer(storedSalt));
      const { hash } = await this.hashPassword(password, saltArray, iterations);
      return hash === storedHash;
    } catch (error) {
      console.error('Password verification failed:', error);
      return false;
    }
  }

  /**
   * Generate a secure checksum for data integrity verification
   */
  static async generateChecksum(data: string): Promise<string> {
    try {
      const encoder = new TextEncoder();
      const dataBuffer = encoder.encode(data);
      const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
      return this.arrayBufferToBase64(hashBuffer);
    } catch (error) {
      throw new Error(`Checksum generation failed: ${error.message}`);
    }
  }

  /**
   * Verify data integrity using checksum
   */
  static async verifyChecksum(data: string, expectedChecksum: string): Promise<boolean> {
    try {
      const actualChecksum = await this.generateChecksum(data);
      return actualChecksum === expectedChecksum;
    } catch (error) {
      console.error('Checksum verification failed:', error);
      return false;
    }
  }

  /**
   * Secure memory cleanup (best effort)
   */
  static secureWipe(sensitiveData: any): void {
    if (typeof sensitiveData === 'string') {
      // Strings are immutable in JavaScript; rely on GC for cleanup
      return;
    } else if (sensitiveData instanceof Uint8Array) {
      // Clear typed array
      sensitiveData.fill(0);
    }
  }

  // Private utility methods

  private static arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private static base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }
}

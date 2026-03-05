/**
 * Unit tests for sync-crypto JSON.parse error handling (INFRA-04)
 *
 * WHY:  decryptDelta() and decryptSnapshot() call JSON.parse without try/catch.
 *       Corrupt or tampered encrypted data produces invalid JSON after decryption,
 *       which currently throws an unhandled SyntaxError and crashes sync entirely.
 *
 * WHAT: These stubs define the EXPECTED behavior after the fix is applied.
 *       They will be RED (failing) until Plan 01-03 wraps JSON.parse in try/catch
 *       and throws named errors (DELTA_PARSE_ERROR, SNAPSHOT_PARSE_ERROR).
 *
 * HOW:  Injects a cached sync key via deriveKeyFromUserId (mocked crypto) to bypass
 *       the "No sync key cached" guard, then mocks subtle.decrypt to return invalid
 *       JSON bytes so the JSON.parse path is hit with corrupt data.
 *
 * NOTE: Will pass after Plan 01-03 applies INFRA-04 fix
 */

import { decryptDelta, decryptSnapshot, deriveKeyFromUserId } from './sync-crypto';

// Helper: encode a string to ArrayBuffer (simulates decrypted bytes)
function encodeToBuffer(str: string): ArrayBuffer {
  return new TextEncoder().encode(str).buffer;
}

// Fake CryptoKey for testing (bypasses real key derivation)
const FAKE_CRYPTO_KEY = {
  type: 'secret',
  extractable: false,
  algorithm: { name: 'AES-GCM' },
  usages: ['encrypt', 'decrypt'],
} as unknown as CryptoKey;

describe('sync-crypto JSON.parse error handling (INFRA-04)', () => {
  beforeEach(async () => {
    jest.clearAllMocks();

    // Mock the entire WebCrypto subtle API
    (global as Record<string, unknown>).crypto = {
      subtle: {
        // deriveKey returns our fake key
        deriveKey: jest.fn().mockResolvedValue(FAKE_CRYPTO_KEY),
        // importKey for PBKDF2
        importKey: jest.fn().mockResolvedValue(FAKE_CRYPTO_KEY),
        // decrypt will be overridden per test
        decrypt: jest.fn(),
      },
    };

    // Mock chrome.storage.session for storeUserIdInSession
    (chrome.storage.session.set as jest.Mock).mockResolvedValue(undefined);
    (chrome.storage.session.get as jest.Mock).mockResolvedValue({});

    // Inject a cached key by calling deriveKeyFromUserId with mocked crypto
    // This populates the in-memory cachedKey so getCachedCryptoKey() succeeds
    await deriveKeyFromUserId('test-user-id', btoa('test-salt-16byte'));
  });

  afterEach(() => {
    // Restore global crypto
    delete (global as Record<string, unknown>).crypto;
  });

  // NOTE: Will pass after Plan 01-03 applies INFRA-04 fix
  it('decryptDelta() with invalid JSON input throws Error containing "DELTA_PARSE_ERROR"', async () => {
    // Arrange: mock subtle.decrypt to return non-JSON bytes after key is set
    (crypto.subtle.decrypt as jest.Mock).mockResolvedValue(
      encodeToBuffer('this is not valid json {{{')
    );

    const dummyBase64 = btoa('dummydata');
    const dummyIv = btoa('dummyiv12');

    // Act + Assert: should throw DELTA_PARSE_ERROR (not raw SyntaxError)
    await expect(
      decryptDelta(dummyBase64, dummyIv)
    ).rejects.toThrow('DELTA_PARSE_ERROR');
  });

  // NOTE: Will pass after Plan 01-03 applies INFRA-04 fix
  it('decryptSnapshot() with invalid JSON input throws Error containing "SNAPSHOT_PARSE_ERROR"', async () => {
    // Arrange: mock subtle.decrypt to return non-JSON bytes
    (crypto.subtle.decrypt as jest.Mock).mockResolvedValue(
      encodeToBuffer('not json at all <<<>>>')
    );

    const dummyBase64 = btoa('dummydata');
    const dummyIv = btoa('dummyiv12');

    // Act + Assert: should throw SNAPSHOT_PARSE_ERROR (not raw SyntaxError)
    await expect(
      decryptSnapshot(dummyBase64, dummyIv)
    ).rejects.toThrow('SNAPSHOT_PARSE_ERROR');
  });
});

/**
 * QuickShare — Zero-Trust E2EE Cryptography Module
 *
 * Implements AES-GCM 256-bit encryption using the native Web Crypto API.
 * No external dependencies — zero supply-chain attack surface.
 *
 * Key Design Decisions:
 * - Each chunk gets a unique random 12-byte IV (prepended to ciphertext)
 * - Keys are exported as Base64URL for safe embedding in URI fragments
 * - URI fragments (#) are NEVER sent to the server per HTTP spec
 *
 * @module crypto
 */

// ─────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────

/** AES-GCM algorithm identifier */
const ALGORITHM = 'AES-GCM' as const;

/** Key length in bits */
const KEY_LENGTH = 256;

/** Initialization Vector length in bytes (96 bits — recommended for AES-GCM) */
const IV_LENGTH = 12;

// ─────────────────────────────────────────────────
// Key Management
// ─────────────────────────────────────────────────

/**
 * Generate a cryptographically secure AES-GCM 256-bit key.
 *
 * Uses `window.crypto.subtle.generateKey` backed by the OS CSPRNG.
 * The key is extractable so it can be exported to Base64URL for sharing.
 */
export async function generateKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: ALGORITHM, length: KEY_LENGTH },
    true, // extractable — needed for export to URI fragment
    ['encrypt', 'decrypt']
  );
}

/**
 * Export a CryptoKey to a Base64URL-encoded string.
 *
 * Base64URL is used instead of standard Base64 because:
 * - No `+`, `/`, or `=` characters that break URL parsing
 * - Safe for URI fragment embedding without percent-encoding
 */
export async function exportKeyToBase64URL(key: CryptoKey): Promise<string> {
  const rawKey = await crypto.subtle.exportKey('raw', key);
  return arrayBufferToBase64URL(rawKey);
}

/**
 * Import a CryptoKey from a Base64URL-encoded string.
 *
 * Used by the receiver to reconstruct the decryption key
 * from `window.location.hash`.
 */
export async function importKeyFromBase64URL(base64url: string): Promise<CryptoKey> {
  const rawKey = base64URLToArrayBuffer(base64url);
  return crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: ALGORITHM, length: KEY_LENGTH },
    false, // not extractable on receiver side
    ['encrypt', 'decrypt']
  );
}

// ─────────────────────────────────────────────────
// Encryption / Decryption
// ─────────────────────────────────────────────────

/**
 * Encrypt a data chunk using AES-GCM.
 *
 * Output format: [IV (12 bytes)][Ciphertext + Auth Tag]
 *
 * A unique random IV is generated for EACH chunk. This is critical
 * because AES-GCM security completely breaks if an IV is reused
 * with the same key.
 *
 * @param key - AES-GCM CryptoKey
 * @param data - Raw plaintext chunk as ArrayBuffer
 * @returns Encrypted chunk with IV prepended
 */
export async function encryptChunk(
  key: CryptoKey,
  data: ArrayBuffer
): Promise<ArrayBuffer> {
  // Generate a unique IV for this chunk
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  // Encrypt with AES-GCM (includes authentication tag)
  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    data
  );

  // Prepend IV to ciphertext: [IV | Ciphertext+Tag]
  const result = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(ciphertext), IV_LENGTH);

  return result.buffer;
}

/**
 * Decrypt a data chunk using AES-GCM.
 *
 * Input format: [IV (12 bytes)][Ciphertext + Auth Tag]
 *
 * Extracts the IV from the first 12 bytes, then decrypts.
 * AES-GCM automatically verifies data integrity — if the data
 * was tampered with in transit, decryption will throw an error.
 *
 * @param key - AES-GCM CryptoKey
 * @param data - Encrypted chunk with IV prepended
 * @returns Decrypted plaintext chunk
 * @throws DOMException if data integrity check fails (tampering detected)
 */
export async function decryptChunk(
  key: CryptoKey,
  data: ArrayBuffer
): Promise<ArrayBuffer> {
  const dataView = new Uint8Array(data);

  // Extract IV from first 12 bytes
  const iv = dataView.slice(0, IV_LENGTH);

  // Extract ciphertext (everything after IV)
  const ciphertext = dataView.slice(IV_LENGTH);

  // Decrypt and authenticate
  return crypto.subtle.decrypt(
    { name: ALGORITHM, iv },
    key,
    ciphertext
  );
}

// ─────────────────────────────────────────────────
// Text Encryption Helpers
// ─────────────────────────────────────────────────

/**
 * Encrypt a text string. Convenience wrapper around encryptChunk.
 */
export async function encryptText(
  key: CryptoKey,
  text: string
): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  return encryptChunk(key, encoder.encode(text).buffer);
}

/**
 * Decrypt an encrypted buffer back to a text string.
 */
export async function decryptText(
  key: CryptoKey,
  data: ArrayBuffer
): Promise<string> {
  const decrypted = await decryptChunk(key, data);
  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
}

// ─────────────────────────────────────────────────
// URI Fragment Helpers
// ─────────────────────────────────────────────────

/**
 * Build a shareable URL with the room ID in the query string and encryption key embedded in the URI fragment.
 *
 * Example output: https://quickshare.app/?room=abc123#SGVsbG8gV29ybGQ
 *
 * The fragment (#...) is NEVER sent to the server per HTTP specification.
 * This ensures the server knows absolutely nothing about the key being used.
 *
 * @param baseUrl - Base URL of the application
 * @param roomId - Room identifier
 * @param key - AES-GCM encryption key
 */
export async function buildShareURL(
  baseUrl: string,
  roomId: string,
  key: CryptoKey
): Promise<string> {
  const keyString = await exportKeyToBase64URL(key);
  const cleanBase = baseUrl.replace(/\/+$/, '');
  return `${cleanBase}/?room=${roomId}#${keyString}`;
}

/**
 * Extract the encryption key from a URI fragment string.
 *
 * @param hashString - The key hash string (e.g., #SGVsbG8...)
 * @returns CryptoKey ready for decryption
 * @throws Error if key is invalid
 */
export async function extractKeyFromHash(hashString: string): Promise<CryptoKey> {
  const cleanHash = hashString.startsWith('#') ? hashString.slice(1) : hashString;
  return importKeyFromBase64URL(cleanHash);
}

// ─────────────────────────────────────────────────
// File Chunking Utilities
// ─────────────────────────────────────────────────

/** Default chunk size: 64KB */
export const DEFAULT_CHUNK_SIZE = 64 * 1024;

/**
 * Split a File/Blob into chunks for streaming encryption.
 *
 * Uses async generator to avoid loading the entire file into memory.
 * Each chunk is read sequentially from the File API.
 *
 * @param file - File or Blob to chunk
 * @param chunkSize - Size of each chunk in bytes (default 64KB)
 */
export async function* chunkFile(
  file: Blob,
  chunkSize: number = DEFAULT_CHUNK_SIZE
): AsyncGenerator<ArrayBuffer, void, unknown> {
  let offset = 0;

  while (offset < file.size) {
    const slice = file.slice(offset, offset + chunkSize);
    const buffer = await slice.arrayBuffer();
    yield buffer;
    offset += chunkSize;
  }
}

/**
 * Encrypt a file by streaming through chunks.
 *
 * Returns an array of encrypted chunks (each with its own IV).
 * For very large files, the caller should send chunks as they're
 * encrypted rather than collecting all into memory.
 *
 * @param key - AES-GCM encryption key
 * @param file - File/Blob to encrypt
 * @param chunkSize - Chunk size in bytes
 * @param onProgress - Optional progress callback (0.0 to 1.0)
 */
export async function encryptFile(
  key: CryptoKey,
  file: Blob,
  chunkSize: number = DEFAULT_CHUNK_SIZE,
  onProgress?: (progress: number) => void
): Promise<ArrayBuffer[]> {
  const encryptedChunks: ArrayBuffer[] = [];
  let processed = 0;

  for await (const chunk of chunkFile(file, chunkSize)) {
    const encrypted = await encryptChunk(key, chunk);
    encryptedChunks.push(encrypted);
    processed += chunk.byteLength;
    onProgress?.(Math.min(processed / file.size, 1.0));
  }

  return encryptedChunks;
}

// ─────────────────────────────────────────────────
// Base64URL Encoding/Decoding
// ─────────────────────────────────────────────────

/**
 * Convert ArrayBuffer to Base64URL string.
 * RFC 4648 §5 — URL-safe alphabet, no padding.
 */
function arrayBufferToBase64URL(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Convert Base64URL string to ArrayBuffer.
 * RFC 4648 §5 — handles missing padding.
 */
function base64URLToArrayBuffer(base64url: string): ArrayBuffer {
  // Restore standard Base64
  let base64 = base64url
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  // Re-add padding
  const pad = base64.length % 4;
  if (pad === 2) base64 += '==';
  else if (pad === 3) base64 += '=';

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

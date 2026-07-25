/**
 * crypto.js: the My Stack register's crypto core (PRD-REGISTER section 7).
 * Used only by js/my/store.js: no other module may import this file.
 *
 * PBKDF2-HMAC-SHA256, 600000 iterations, via WebCrypto deriveKey. AES-256-GCM
 * with a fresh 12-byte random IV per encryption, never reused. AAD binds the
 * literal string below. Envelope shape: { v, kdf, iter, salt, iv, ct }, all
 * byte fields base64. Unknown envelope versions are rejected with a clear
 * error, never a silent failure.
 *
 * Every function here is a pure function over bytes and a passphrase: no
 * storage, no DOM, no module-level key cache (that discipline belongs to
 * store.js, which is the only thing allowed to hold a derived key in
 * memory). This is what lets scripts/register-vectors.mjs import this exact
 * file under Node's WebCrypto (globalThis.crypto.subtle is the same API in
 * both places) and test the real implementation rather than a reimplementation.
 */

export const AAD_STRING = 'freestack-register-v1';
export const ITERATIONS = 600000;
export const ENVELOPE_VERSION = 1;
export const KDF_NAME = 'PBKDF2-SHA256';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const AAD_BYTES = textEncoder.encode(AAD_STRING);

/** Thrown by anything that parses an envelope with an unrecognised `v`. */
export class EnvelopeVersionError extends Error {
  constructor(v) {
    super(`This register file was made by a newer or unrecognised version (v${v}). Open it in an up to date My Stack, or ask for a fresh export.`);
    this.name = 'EnvelopeVersionError';
  }
}

/** Wrong passphrase, a tampered ciphertext and a mismatched AAD all fail the
    same way (AES-GCM's authentication tag check inside subtle.decrypt), so
    they are wrapped in one clear, non-specific error rather than leaking
    which check failed. */
export class DecryptError extends Error {
  constructor(cause) {
    super('Could not unlock: wrong passphrase, or this file is damaged.');
    this.name = 'DecryptError';
    this.cause = cause;
  }
}

export function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

export function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function base64ToBytes(str) {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function textToBytes(str) { return textEncoder.encode(str); }
export function bytesToText(bytes) { return textDecoder.decode(bytes); }

/** Derive a non-extractable AES-256-GCM key from a passphrase. Deliberately
    slow (600000 PBKDF2 rounds by default): callers show an "unlocking"
    state while this resolves rather than freezing the UI silently, since it
    can take a few hundred milliseconds on ordinary hardware. */
export async function deriveKey(passphrase, saltBytes, iterations = ITERATIONS) {
  const material = await crypto.subtle.importKey(
    'raw', textEncoder.encode(passphrase), 'PBKDF2', false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable: the raw key bytes can never leave this module
    ['encrypt', 'decrypt'],
  );
}

/** Low level primitives, parametrised on iv/aad so the test vectors script
    can exercise fixed values instead of the random ones production uses. */
export async function encryptBytes(key, ivBytes, aadBytes, plaintextBytes) {
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: ivBytes, additionalData: aadBytes }, key, plaintextBytes,
  );
  return new Uint8Array(ct);
}

export async function decryptBytes(key, ivBytes, aadBytes, ciphertextBytes) {
  try {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: ivBytes, additionalData: aadBytes }, key, ciphertextBytes,
    );
    return new Uint8Array(pt);
  } catch (cause) {
    throw new DecryptError(cause);
  }
}

/** Build a versioned envelope from plaintext bytes and a passphrase: a
    fresh random 16-byte salt and 12-byte IV every call, per section 7. */
export async function buildEnvelope(passphrase, plaintextBytes) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(passphrase, salt);
  const ct = await encryptBytes(key, iv, AAD_BYTES, plaintextBytes);
  return {
    v: ENVELOPE_VERSION,
    kdf: KDF_NAME,
    iter: ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ct: bytesToBase64(ct),
  };
}

/** Seal plaintext bytes with an already-derived key (store.js holds this in
    memory between unlock() and lock(), never the passphrase itself), a
    fresh random IV every call. saltBytes/iterations are the ones the key
    was originally derived with, carried so the envelope stays self
    describing without re-deriving the key from a passphrase on every save. */
export async function sealWithKey(key, saltBytes, iterations, plaintextBytes) {
  const iv = randomBytes(12);
  const ct = await encryptBytes(key, iv, AAD_BYTES, plaintextBytes);
  return {
    v: ENVELOPE_VERSION,
    kdf: KDF_NAME,
    iter: iterations,
    salt: bytesToBase64(saltBytes),
    iv: bytesToBase64(iv),
    ct: bytesToBase64(ct),
  };
}

/** Derive the key for an existing envelope. Callers (store.js) keep the
    returned key in memory only and discard it on lock(), per section 7. */
export async function deriveEnvelopeKey(envelope, passphrase) {
  if (!envelope || envelope.v !== ENVELOPE_VERSION) throw new EnvelopeVersionError(envelope && envelope.v);
  const salt = base64ToBytes(envelope.salt);
  return deriveKey(passphrase, salt, envelope.iter || ITERATIONS);
}

/** Decrypt an envelope to plaintext bytes with an already-derived key. */
export async function openEnvelopeWithKey(envelope, key) {
  const iv = base64ToBytes(envelope.iv);
  const ct = base64ToBytes(envelope.ct);
  return decryptBytes(key, iv, AAD_BYTES, ct);
}

/** Convenience wrapper: derive and decrypt in one call. */
export async function openEnvelope(envelope, passphrase) {
  const key = await deriveEnvelopeKey(envelope, passphrase);
  return openEnvelopeWithKey(envelope, key);
}

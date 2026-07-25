/**
 * store.js: the only module in the workspace allowed to touch persistence
 * (PRD-REGISTER section 6). Interface exactly: load(), save(data,
 * expectedRevision), exportBlob(), importBlob(fileOrBytes, passphrase?),
 * lock(), unlock(passphrase), status(). No other module may call
 * localStorage, indexedDB or any storage API; this is the seam a future
 * sync backend drops into (section 13), so nothing here leaks the storage
 * mechanics through the return shapes.
 *
 * Whole-document persistence: IndexedDB database 'freestack-my' is primary,
 * a localStorage mirror at 'freestack:v1:my' protects against a single
 * store's corruption (section 6). The document shape is section 4.3:
 * { schemaVersion, business, people, accounts, createdAt, updatedAt,
 * revision }. revision increments on every save and is the whole conflict
 * mechanism: save() refuses when the on-disk revision is newer than the
 * revision the caller last saw, throwing ConflictError rather than
 * silently overwriting another tab's work.
 *
 * Encryption (section 7) is opt-in. unlock(passphrase) is overloaded by
 * design, since the interface may not grow a seventh method: called against
 * an existing encrypted register it authenticates and holds the derived
 * key in memory; called when the register is not yet encrypted it derives
 * a brand new key from the passphrase and holds THAT, so the very next
 * save() seals the document instead of writing plaintext. lock() discards
 * whatever key is held, whether that key was ever actually written to disk
 * yet or not, which doubles as "cancel an in-progress opt-in".
 */
import {
  deriveKey, deriveEnvelopeKey, openEnvelopeWithKey, sealWithKey, randomBytes,
  bytesToText, textToBytes, ITERATIONS, EnvelopeVersionError, DecryptError,
} from './crypto.js';

const DB_NAME = 'freestack-my';
const DB_STORE = 'kv';
const DB_KEY = 'doc';
const LS_KEY = 'freestack:v1:my';
const LS_META_KEY = 'freestack:v1:my:meta';
const LOCK_NAME = 'freestack-my';
const BC_NAME = 'freestack-my';
const IDLE_MS = 15 * 60 * 1000;
const SCHEMA_VERSION = 1;
const MAGIC = 'freestack-register';

export class ConflictError extends Error {
  constructor(diskRevision, expectedRevision, diskUpdatedAt) {
    super('This register changed elsewhere since you last loaded it. Reload to see the newer version before saving again.');
    this.name = 'ConflictError';
    this.diskRevision = diskRevision;
    this.expectedRevision = expectedRevision;
    this.diskUpdatedAt = diskUpdatedAt;
  }
}
export class LockedError extends Error {
  constructor() {
    super('This register is locked. Unlock it with your passphrase first.');
    this.name = 'LockedError';
  }
}
export class StorageUnavailableError extends Error {
  constructor() {
    super('This browser is not letting this page store anything, so nothing can be saved here.');
    this.name = 'StorageUnavailableError';
  }
}
export class SchemaVersionError extends Error {
  constructor(v) {
    super(`This register was made by a newer version of My Stack (schema ${v}). Open it there, or ask for a fresh export.`);
    this.name = 'SchemaVersionError';
  }
}
export class ImportFormatError extends Error {
  constructor(msg) {
    super(msg || 'This is not a My Stack register file.');
    this.name = 'ImportFormatError';
  }
}

/* --- in-memory key state (never persisted) --------------------------------- */
let cryptoKey = null;
let keySalt = null;
let keyIter = ITERATIONS;
let explicitlyLocked = false; // set by lock(), cleared by a successful unlock()
let idleTimer = null;

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  if (!cryptoKey) return;
  idleTimer = setTimeout(() => { lock(); }, IDLE_MS);
}
if (typeof document !== 'undefined') {
  for (const evt of ['pointerdown', 'keydown', 'scroll']) {
    document.addEventListener(evt, resetIdleTimer, { passive: true });
  }
}

/* --- raw disk access: IndexedDB primary, localStorage mirror --------------- */
function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('no indexeddb')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(DB_STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet() {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).get(DB_KEY);
      req.onsuccess = () => resolve(req.result === undefined ? null : req.result);
      req.onerror = () => reject(req.error);
    });
  } catch { return undefined; } // undefined: IDB itself unavailable, distinct from "empty"
}
async function idbSet(value) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put(value, DB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return true;
  } catch { return false; }
}
function lsGet(key = LS_KEY) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? null : JSON.parse(raw);
  } catch { return undefined; }
}
function lsSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

/** Read the raw stored record (a plain document object or an envelope
    object), or null if nothing has ever been saved. Falls back to the
    localStorage mirror when IndexedDB is unavailable or has lost its copy,
    which is the entire point of keeping a second copy (section 6). */
async function readRaw() {
  const idbVal = await idbGet();
  if (idbVal !== undefined && idbVal !== null) return idbVal;
  const lsVal = lsGet();
  if (lsVal !== undefined && lsVal !== null) return lsVal;
  return null;
}
async function writeRaw(value) {
  const idbOk = await idbSet(value);
  const lsOk = lsSet(LS_KEY, value);
  if (!idbOk && !lsOk) throw new StorageUnavailableError();
  return { idbOk, lsOk };
}
function isEnvelope(raw) {
  return !!raw && typeof raw === 'object' && raw.v !== undefined && raw.ct !== undefined;
}

/* --- write-read-verify sentinel (section 3, first-run gate) ---------------- */
export function sentinelCheck() {
  const key = '__freestack_my_sentinel__';
  const value = String(Date.now());
  try {
    localStorage.setItem(key, value);
    const readBack = localStorage.getItem(key);
    localStorage.removeItem(key);
    return readBack === value;
  } catch {
    return false;
  }
}

/* --- Web Locks, with a revision-check-only fallback ------------------------ */
async function withLock(fn) {
  if (typeof navigator !== 'undefined' && navigator.locks && navigator.locks.request) {
    return navigator.locks.request(LOCK_NAME, fn);
  }
  return fn(); // no Web Locks: save() below still refuses on a stale revision
}

/* --- BroadcastChannel: announce writes, the workspace decides what to do --- */
const channel = (typeof BroadcastChannel !== 'undefined') ? new BroadcastChannel(BC_NAME) : null;
function announceWrite(revision, updatedAt) {
  channel?.postMessage({ type: 'write', revision, at: updatedAt });
}

/* --- decrypt a raw record to a plaintext document object ------------------- */
async function decryptRaw(raw) {
  if (!cryptoKey) throw new LockedError();
  const bytes = await openEnvelopeWithKey(raw, cryptoKey);
  return JSON.parse(bytesToText(bytes));
}
function checkSchema(doc) {
  if (doc && doc.schemaVersion !== SCHEMA_VERSION) throw new SchemaVersionError(doc.schemaVersion);
  return doc;
}

/** load(): the current working document, decrypted if needed and possible.
    Returns null on a genuinely empty, first-run store. Throws LockedError
    if the on-disk record is an envelope and no key is currently held. */
export async function load() {
  if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {}); // best effort, status() reports the real result
  }
  const raw = await readRaw();
  if (raw === null) return null;
  if (isEnvelope(raw)) return checkSchema(await decryptRaw(raw));
  return checkSchema(raw);
}

/** save(): compare-and-swap against the on-disk revision, encrypt if a key
    is currently held (whether that is an established passphrase or one
    just chosen via unlock(), see the module comment above), mirror to both
    stores, and tell other tabs a write happened. */
export async function save(data, expectedRevision) {
  return withLock(async () => {
    const raw = await readRaw();
    if (isEnvelope(raw) && !cryptoKey) throw new LockedError();
    const diskDoc = raw === null ? null : (isEnvelope(raw) ? await decryptRaw(raw) : raw);
    const diskRevision = diskDoc ? (diskDoc.revision || 0) : 0;
    const expected = Number.isInteger(expectedRevision) ? expectedRevision : 0;
    if (diskDoc && diskRevision > expected) {
      throw new ConflictError(diskRevision, expected, diskDoc.updatedAt);
    }

    const now = new Date().toISOString();
    const nextDoc = {
      schemaVersion: SCHEMA_VERSION,
      business: data.business || '',
      people: Array.isArray(data.people) ? data.people : [],
      accounts: Array.isArray(data.accounts) ? data.accounts : [],
      createdAt: diskDoc?.createdAt || data.createdAt || now,
      updatedAt: now,
      revision: diskRevision + 1,
    };

    const plaintextBytes = textToBytes(JSON.stringify(nextDoc));
    const toWrite = cryptoKey
      ? await sealWithKey(cryptoKey, keySalt, keyIter, plaintextBytes)
      : nextDoc;
    await writeRaw(toWrite);
    announceWrite(nextDoc.revision, nextDoc.updatedAt);
    resetIdleTimer();
    return nextDoc;
  });
}

/** exportBlob(): serialise whatever is currently on disk (the store's
    source of truth, per the compare-and-swap design) into the section 8
    export format: a magic header plus either the plain document or the
    envelope, never a bare custom shape mail clients or Files would choke
    on. Records lastExportAt for the backup-age indicator. */
export async function exportBlob() {
  const raw = await readRaw();
  if (raw === null) throw new Error('Nothing to export yet.');
  const payload = isEnvelope(raw)
    ? { magic: MAGIC, format: 'encrypted', ...raw }
    : { magic: MAGIC, format: 'plain', ...raw };
  const json = JSON.stringify(payload, null, 2);
  const at = new Date().toISOString();
  lsSet(LS_META_KEY, { ...(lsGet(LS_META_KEY) || {}), lastExportAt: at });
  return { blob: new Blob([json], { type: 'application/json' }), exportedAt: at };
}

/** importBlob(): parse and, if needed, decrypt a .fsr.json file's bytes.
    Does NOT touch the working copy; the caller previews the result
    (business name, account count, last updated) per section 8 and commits
    it with save() only after the reader confirms. Also how setup's
    verified-export step self-tests: export, then importBlob the very bytes
    just produced, and compare. */
export async function importBlob(fileOrBytes, passphrase) {
  const text = await readAsText(fileOrBytes);
  let payload;
  try { payload = JSON.parse(text); } catch { throw new ImportFormatError('This file is not readable JSON.'); }
  if (!payload || payload.magic !== MAGIC) {
    throw new ImportFormatError('This is not a My Stack register file.');
  }
  if (payload.format === 'encrypted' || payload.v !== undefined) {
    if (!passphrase) throw new ImportFormatError('This register file is encrypted: a passphrase is needed to open it.');
    const { magic, format, ...envelope } = payload;
    let key;
    try {
      key = await deriveEnvelopeKey(envelope, passphrase);
    } catch (cause) {
      if (cause instanceof EnvelopeVersionError) throw cause;
      throw new DecryptError(cause);
    }
    const bytes = await openEnvelopeWithKey(envelope, key);
    const document = checkSchema(JSON.parse(bytesToText(bytes)));
    return { document, encrypted: true, meta: summarise(document) };
  }
  const { magic, format, ...document } = payload;
  checkSchema(document);
  return { document, encrypted: false, meta: summarise(document) };
}
function summarise(doc) {
  return { business: doc.business || '', accountCount: (doc.accounts || []).length, updatedAt: doc.updatedAt };
}
async function readAsText(fileOrBytes) {
  if (typeof fileOrBytes === 'string') return fileOrBytes;
  if (fileOrBytes instanceof Blob) return fileOrBytes.text();
  if (fileOrBytes instanceof ArrayBuffer) return bytesToText(new Uint8Array(fileOrBytes));
  if (ArrayBuffer.isView(fileOrBytes)) return bytesToText(fileOrBytes);
  throw new ImportFormatError('Unrecognised file input.');
}

/** lock(): discard the in-memory key. Meaningful whether that key was ever
    written to disk yet (a normal lock) or is still only a pending opt-in
    from unlock() that has not been saved (cancels the opt-in). */
export function lock() {
  cryptoKey = null;
  keySalt = null;
  explicitlyLocked = true;
  if (idleTimer) clearTimeout(idleTimer);
}

/** unlock(passphrase): see the module comment for the two behaviours this
    covers. Shows an "unlocking" state is the caller's job, since deriveKey
    is the slow step (600000 PBKDF2 rounds) and the caller controls the UI;
    this function simply awaits it. */
export async function unlock(passphrase) {
  const raw = await readRaw();
  if (isEnvelope(raw)) {
    const key = await deriveEnvelopeKey(raw, passphrase); // throws EnvelopeVersionError on unknown v
    await openEnvelopeWithKey(raw, key); // throws DecryptError on a wrong passphrase, verified before we trust it
    cryptoKey = key;
    keySalt = base64SaltOf(raw);
    keyIter = raw.iter;
    explicitlyLocked = false;
    resetIdleTimer();
    return { alreadyEncrypted: true };
  }
  // Not yet encrypted: this call is "choose a passphrase", not "authenticate".
  const salt = randomBytes(16);
  cryptoKey = await deriveKey(passphrase, salt);
  keySalt = salt;
  keyIter = ITERATIONS;
  explicitlyLocked = false;
  resetIdleTimer();
  return { alreadyEncrypted: false };
}
function base64SaltOf(envelope) {
  // Kept as bytes for sealWithKey's next call; envelope.salt is base64 text.
  const bin = atob(envelope.salt);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** status(): honest, mechanism-free snapshot for the UI. persisted and
    storageOk both come from live checks, never assumed, per section 3's
    ban on overstating what browser storage can promise. */
export async function status() {
  const raw = await readRaw();
  const diskIsEnvelope = isEnvelope(raw);
  let persisted = false;
  try {
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persisted) {
      persisted = await navigator.storage.persisted();
    }
  } catch { /* persisted stays false, honestly */ }
  let revision = raw ? (diskIsEnvelope ? undefined : raw.revision || 0) : 0;
  if (diskIsEnvelope && cryptoKey) {
    try { revision = (await decryptRaw(raw)).revision || 0; } catch { /* leave undefined, treat as locked below */ }
  }
  const pendingEncryption = !!cryptoKey && !diskIsEnvelope; // passphrase chosen, not yet saved
  const meta = lsGet(LS_META_KEY) || {};
  return {
    persisted,
    storageOk: sentinelCheck(),
    locked: diskIsEnvelope && !cryptoKey,
    encrypted: diskIsEnvelope || pendingEncryption,
    revision,
    lastExportAt: meta.lastExportAt || null,
  };
}

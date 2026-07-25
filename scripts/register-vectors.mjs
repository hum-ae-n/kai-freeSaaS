#!/usr/bin/env node
/**
 * register-vectors.mjs: CI gate for the My Stack crypto core (PRD-REGISTER
 * section 7). Zero dependency Node script, WebCrypto only. Imports the real
 * js/my/crypto.js (browser and Node 22 expose the same globalThis.crypto.
 * subtle API), so this exercises the actual implementation, not a
 * reimplementation of it that could quietly drift from the shipped code.
 *
 * The three vectors below have a fixed passphrase, salt, IV and plaintext.
 * AES-GCM encryption is deterministic for a fixed key/iv/aad/plaintext, so
 * the ciphertext each produces was computed once with this same code and is
 * now FROZEN as a constant: a future accidental change to the KDF, cipher,
 * IV handling or AAD string will change the ciphertext and fail this file,
 * which is the point of a test vector.
 *
 * Run: node scripts/register-vectors.mjs
 */
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import {
  deriveKey, encryptBytes, decryptBytes, bytesToBase64, base64ToBytes,
  textToBytes, bytesToText, buildEnvelope, openEnvelope, openEnvelopeWithKey,
  deriveEnvelopeKey, sealWithKey, randomBytes, EnvelopeVersionError, DecryptError,
  AAD_STRING, ITERATIONS, ENVELOPE_VERSION, KDF_NAME,
} from '../js/my/crypto.js';

const AAD_BYTES = textToBytes(AAD_STRING);

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

/* Frozen known-answer vectors. Do not regenerate these casually: if the
   ciphertext genuinely needs to change (a deliberate crypto parameter
   change), recompute deliberately and record why in BUILD-PLAN's changelog. */
const VECTORS = [
  {
    name: 'vector-1-short',
    passphrase: 'correct horse battery staple',
    saltHex: '000102030405060708090a0b0c0d0e0f',
    ivHex: '000102030405060708090a0b',
    plaintext: 'hello register',
    ct: 'ZqPk7R6UTumLQPQ32c9RGaC9IWwQuFulNLecGJ+5',
  },
  {
    name: 'vector-2-json',
    passphrase: 'kaipability-my-stack-test',
    saltHex: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
    ivHex: 'f0e1d2c3b4a5968778695a4b',
    plaintext: JSON.stringify({ schemaVersion: 1, business: 'Acme Ltd', accounts: [] }),
    ct: '3uLZSdGsaHT2sp84Z/e8VdgfJhQvzOjAdNR9FqaQ+Ti770pV5cdJaExH9g2+lG475+6iREzgq3hN6oW0PAom3JKazsh0sz4=',
  },
  {
    name: 'vector-3-empty',
    passphrase: 'p',
    saltHex: '000000000000000000000000000000ff',
    ivHex: '0000000000000000000000ff',
    plaintext: '',
    ct: 'tAFh2qrUS84LAgZZ3ZWodA==',
  },
];

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `: ${detail}` : ""}`);
  if (!ok) failures++;
}
async function throws(fn) {
  try { await fn(); return false; } catch { return true; }
}

/* --- constant sanity: the parameters this file's whole promise rests on --- */
check('AAD string is the literal from section 7', AAD_STRING === 'freestack-register-v1');
check('iterations is 600000', ITERATIONS === 600000);
check('envelope version is 1', ENVELOPE_VERSION === 1);
check('kdf label is PBKDF2-SHA256', KDF_NAME === 'PBKDF2-SHA256');

/* --- round trip against frozen ciphertext ---------------------------------- */
for (const v of VECTORS) {
  const salt = hexToBytes(v.saltHex);
  const iv = hexToBytes(v.ivHex);
  check(`${v.name}: salt is 16 bytes`, salt.length === 16);
  check(`${v.name}: iv is 12 bytes`, iv.length === 12);

  const key = await deriveKey(v.passphrase, salt);
  const ct = await encryptBytes(key, iv, AAD_BYTES, textToBytes(v.plaintext));
  const gotCt = bytesToBase64(ct);
  check(`${v.name}: ciphertext matches frozen vector`, gotCt === v.ct, gotCt === v.ct ? '' : `got ${gotCt}`);

  const pt = await decryptBytes(key, iv, AAD_BYTES, base64ToBytes(v.ct));
  check(`${v.name}: decrypts back to original plaintext`, bytesToText(pt) === v.plaintext);
}

/* --- tamper, AAD and passphrase failures ------------------------------------ */
{
  const v = VECTORS[0];
  const salt = hexToBytes(v.saltHex);
  const iv = hexToBytes(v.ivHex);
  const key = await deriveKey(v.passphrase, salt);
  const ctBytes = base64ToBytes(v.ct);

  const tampered = new Uint8Array(ctBytes);
  tampered[0] ^= 0xff; // flip a bit
  check('tampered ciphertext throws on decrypt',
    await throws(() => decryptBytes(key, iv, AAD_BYTES, tampered)));

  check('wrong AAD throws on decrypt',
    await throws(() => decryptBytes(key, iv, textToBytes('freestack-register-v2'), ctBytes)));

  const wrongKey = await deriveKey('a different passphrase entirely', salt);
  check('wrong passphrase throws on decrypt',
    await throws(() => decryptBytes(wrongKey, iv, AAD_BYTES, ctBytes)));

  check('decrypt failures raise DecryptError, not a raw DOMException',
    await (async () => {
      try { await decryptBytes(key, iv, AAD_BYTES, tampered); return false; }
      catch (e) { return e instanceof DecryptError; }
    })());
}

/* --- envelope round trip (buildEnvelope / openEnvelope) --------------------- */
{
  const plaintext = 'envelope round trip check';
  const passphrase = 'envelope-vector-passphrase';
  const envelope = await buildEnvelope(passphrase, textToBytes(plaintext));
  check('envelope shape: v, kdf, iter, salt, iv, ct all present',
    envelope.v === 1 && envelope.kdf === KDF_NAME && envelope.iter === ITERATIONS
    && typeof envelope.salt === 'string' && typeof envelope.iv === 'string' && typeof envelope.ct === 'string');
  check('envelope salt decodes to 16 bytes', base64ToBytes(envelope.salt).length === 16);
  check('envelope iv decodes to 12 bytes', base64ToBytes(envelope.iv).length === 12);

  const opened = await openEnvelope(envelope, passphrase);
  check('openEnvelope round trips correct passphrase', bytesToText(opened) === plaintext);

  check('openEnvelope rejects wrong passphrase',
    await throws(() => openEnvelope(envelope, 'not the right passphrase')));

  const key = await deriveEnvelopeKey(envelope, passphrase);
  const opened2 = await openEnvelopeWithKey(envelope, key);
  check('openEnvelopeWithKey round trips a pre-derived key', bytesToText(opened2) === plaintext);
}

/* --- fresh IV/salt every call: two envelopes for the same input never match - */
{
  const a = await buildEnvelope('same passphrase', textToBytes('same plaintext'));
  const b = await buildEnvelope('same passphrase', textToBytes('same plaintext'));
  check('buildEnvelope never reuses salt across calls', a.salt !== b.salt);
  check('buildEnvelope never reuses IV across calls', a.iv !== b.iv);
  check('buildEnvelope never produces identical ciphertext for identical input', a.ct !== b.ct);
}

/* --- sealWithKey (store.js's save path: reuse a held key, not a passphrase) - */
{
  const salt = randomBytes(16);
  const key = await deriveKey('held-key-passphrase', salt);
  const sealed = await sealWithKey(key, salt, ITERATIONS, textToBytes('sealed with a held key'));
  check('sealWithKey produces a well formed envelope',
    sealed.v === 1 && sealed.salt === bytesToBase64(salt));
  const opened = await openEnvelopeWithKey(sealed, key);
  check('sealWithKey round trips with the same key', bytesToText(opened) === 'sealed with a held key');
  const sealedAgain = await sealWithKey(key, salt, ITERATIONS, textToBytes('sealed with a held key'));
  check('sealWithKey uses a fresh IV each call even with the same key', sealed.iv !== sealedAgain.iv);
}

/* --- unknown envelope version is rejected, not silently accepted ----------- */
{
  const envelope = await buildEnvelope('whatever', textToBytes('x'));
  const futureEnvelope = { ...envelope, v: 2 };
  let caught = null;
  try { await openEnvelope(futureEnvelope, 'whatever'); }
  catch (e) { caught = e; }
  check('unknown envelope version rejected', caught instanceof EnvelopeVersionError, caught ? caught.message : 'did not throw');

  let caughtMissing = null;
  try { await openEnvelope({ ...envelope, v: undefined }, 'whatever'); }
  catch (e) { caughtMissing = e; }
  check('missing envelope version rejected', caughtMissing instanceof EnvelopeVersionError);
}

console.log(failures ? `\n${failures} FAILURES` : '\nALL PASS');
process.exit(failures ? 1 : 0);

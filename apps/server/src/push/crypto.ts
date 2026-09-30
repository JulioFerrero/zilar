import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  type CipherGCM,
  type DecipherGCM,
} from 'node:crypto';

// Envelope encryption for the Web Push subscription keys at rest, using only
// Node's built-in `crypto`. Same versioned-envelope shape as the provider-key
// cipher (`connections/crypto.ts`), but a separate HKDF info string so a blob
// sealed for one purpose can never be opened as the other.
//
// A stored blob is `v1:<salt>:<iv>:<ciphertext>:<tag>`, each part base64url.
// AES-256-GCM authenticates everything together: tampering, or decrypting
// with the wrong `PUSH_STORAGE_KEY`, fails loudly instead of returning
// garbage.

const VERSION = 'v1';
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;

const VERSIONED_PARTS = 5;

// Every failure to open a stored push key is this type. Its message is fixed:
// it never carries the storage key, the blob or the plaintext.
export class PushDecryptionError extends Error {
  constructor() {
    super('The stored push subscription could not be decrypted');
    this.name = 'PushDecryptionError';
  }
}

export interface PushCipher {
  encrypt(plaintext: string): string;
  decrypt(envelope: string): string;
}

function deriveKey(masterKey: string, salt: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', masterKey, salt, 'galena/push-storage/v1', 32));
}

function encryptOnce(masterKey: string, plaintext: string): string {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const cipher: CipherGCM = createCipheriv('aes-256-gcm', deriveKey(masterKey, salt), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, salt, iv, ciphertext, tag].map((part) => part.toString('base64url')).join(':');
}

function decryptOnce(masterKey: string, envelope: string): string {
  const parts = envelope.split(':');
  if (parts.length !== VERSIONED_PARTS || parts[0] !== VERSION) {
    throw new PushDecryptionError();
  }

  let salt: Buffer;
  let iv: Buffer;
  let ciphertext: Buffer;
  let tag: Buffer;
  try {
    salt = Buffer.from(parts[1] ?? '', 'base64url');
    iv = Buffer.from(parts[2] ?? '', 'base64url');
    ciphertext = Buffer.from(parts[3] ?? '', 'base64url');
    tag = Buffer.from(parts[4] ?? '', 'base64url');
  } catch {
    throw new PushDecryptionError();
  }

  if (
    salt.length !== SALT_BYTES ||
    iv.length !== IV_BYTES ||
    tag.length !== TAG_BYTES ||
    ciphertext.length === 0
  ) {
    throw new PushDecryptionError();
  }

  const decipher: DecipherGCM = createDecipheriv('aes-256-gcm', deriveKey(masterKey, salt), iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new PushDecryptionError();
  }
}

// Builds the cipher from `PUSH_STORAGE_KEY`. The key is validated by the
// config schema (at least 32 characters) before it reaches here.
export function createPushCipher(masterKey: string): PushCipher {
  return {
    encrypt: (plaintext) => encryptOnce(masterKey, plaintext),
    decrypt: (envelope) => decryptOnce(masterKey, envelope),
  };
}

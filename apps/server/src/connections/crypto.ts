import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  type CipherGCM,
  type DecipherGCM,
} from 'node:crypto';

// Envelope encryption for provider keys, using only Node's built-in `crypto`.
//
// A stored key is a versioned string:
//
//   v1:<salt>:<iv>:<ciphertext>:<tag>
//
// where each part is base64url. The master key never leaves the server and is
// derived into a per-blob AES-256-GCM key with HKDF and a random salt, so a
// later scheme change can bump the version without rewriting old rows.
//
// AES-256-GCM authenticates ciphertext, IV and tag together: any tampering with
// any one of them, or decrypting with the wrong master key, fails loudly here
// instead of returning garbage.

const VERSION = 'v1';
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;

const VERSIONED_PARTS = 5;

// Every failure to open a stored key is this type. Its message is fixed: it
// never carries the master key, the blob or the plaintext.
export class DecryptionError extends Error {
  constructor() {
    super('The stored key could not be decrypted');
    this.name = 'DecryptionError';
  }
}

export interface KeyCipher {
  encrypt(plaintext: string): string;
  decrypt(envelope: string): string;
}

function deriveKey(masterKey: string, salt: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', masterKey, salt, 'zilar/provider-key/v1', 32));
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
    throw new DecryptionError();
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
    throw new DecryptionError();
  }

  if (
    salt.length !== SALT_BYTES ||
    iv.length !== IV_BYTES ||
    tag.length !== TAG_BYTES ||
    ciphertext.length === 0
  ) {
    throw new DecryptionError();
  }

  const decipher: DecipherGCM = createDecipheriv('aes-256-gcm', deriveKey(masterKey, salt), iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new DecryptionError();
  }
}

// Builds the cipher from the environment's master key. The key is validated by
// the config schema (ZILAR_KEY_ENCRYPTION_KEY, at least 32 characters) before
// it reaches here.
export function createKeyCipher(masterKey: string): KeyCipher {
  return {
    encrypt: (plaintext) => encryptOnce(masterKey, plaintext),
    decrypt: (envelope) => decryptOnce(masterKey, envelope),
  };
}

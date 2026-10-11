// Shared versioned AES-256-GCM envelope encryption. It is the single copy of
// the derive/encrypt/decrypt trio that the push, provider-key and instance
// settings ciphers used to repeat; each caller passes its own HKDF label and
// its own error class so a blob sealed for one purpose can never be opened as
// another.
//
// A stored blob is `v1:<salt>:<iv>:<ciphertext>:<tag>`, each part base64url.
// AES-256-GCM authenticates everything together: tampering, or decrypting with
// the wrong master key, fails loudly instead of returning garbage.
// effect-plain: synchronous AES-GCM decrypt; failure is the caller's typed error
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  type CipherGCM,
  type DecipherGCM,
} from 'node:crypto';

const VERSION = 'v1';
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;

const VERSIONED_PARTS = 5;

export interface Envelope {
  encrypt(masterKey: string, plaintext: string): string;
  decrypt(masterKey: string, envelope: string): string;
}

// `label` is mixed into the derived key with HKDF; `fail` is called on every
// failure to open a blob, so each caller keeps its own typed error.
export function makeEnvelope(label: string, fail: () => Error): Envelope {
  function deriveKey(masterKey: string, salt: Buffer): Buffer {
    return Buffer.from(hkdfSync('sha256', masterKey, salt, label, 32));
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
      throw fail();
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
      throw fail();
    }

    if (
      salt.length !== SALT_BYTES ||
      iv.length !== IV_BYTES ||
      tag.length !== TAG_BYTES ||
      ciphertext.length === 0
    ) {
      throw fail();
    }

    const decipher: DecipherGCM = createDecipheriv('aes-256-gcm', deriveKey(masterKey, salt), iv);
    decipher.setAuthTag(tag);
    try {
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch {
      throw fail();
    }
  }

  return { encrypt: encryptOnce, decrypt: decryptOnce };
}

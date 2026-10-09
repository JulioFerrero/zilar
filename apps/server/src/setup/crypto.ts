// First-run setup encryption (T-0161). The stored Resend key is sealed
// with AES-256-GCM and a random nonce per value, using only Node's
// built-in `crypto`. The key comes from `ZILAR_KEY_ENCRYPTION_KEY` when
// set, otherwise derived with HKDF-SHA256 from `BETTER_AUTH_SECRET`
// (label `zilar-instance-settings`). A stored value is a versioned string:
//
//   v1:<salt>:<iv>:<ciphertext>:<tag>
//
// where each part is base64url.
//
// AES-256-GCM authenticates ciphertext, IV and tag together: any
// tampering, or decrypting with the wrong master key, fails loudly here
// instead of returning garbage.
// effect-plain: synchronous AES-GCM decrypt; failure is a typed SettingsDecryptionError

import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  type CipherGCM,
  type DecipherGCM,
} from 'node:crypto';

export const INSTANCE_SETTINGS_KDF_LABEL = 'zilar-instance-settings';

const VERSION = 'v1';
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;

const VERSIONED_PARTS = 5;

// Every failure to open a stored value is this type. Its message is
// fixed: it never carries the master key, the blob or the plaintext.
export class SettingsDecryptionError extends Error {
  constructor() {
    super('The stored setting could not be decrypted');
    this.name = 'SettingsDecryptionError';
  }
}

export interface SettingsCipher {
  encrypt(plaintext: string): string;
  decrypt(envelope: string): string;
}

function deriveKey(masterKey: string, salt: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', masterKey, salt, INSTANCE_SETTINGS_KDF_LABEL, 32));
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
    throw new SettingsDecryptionError();
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
    throw new SettingsDecryptionError();
  }

  if (
    salt.length !== SALT_BYTES ||
    iv.length !== IV_BYTES ||
    tag.length !== TAG_BYTES ||
    ciphertext.length === 0
  ) {
    throw new SettingsDecryptionError();
  }

  const decipher: DecipherGCM = createDecipheriv('aes-256-gcm', deriveKey(masterKey, salt), iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new SettingsDecryptionError();
  }
}

// Builds the cipher for instance settings. The envelope-encryption key
// comes from `ZILAR_KEY_ENCRYPTION_KEY` when set, otherwise the auth
// secret (both validated by the config schema before they reach here).
export function createSettingsCipher(masterKey: string): SettingsCipher {
  return {
    encrypt: (plaintext) => encryptOnce(masterKey, plaintext),
    decrypt: (envelope) => decryptOnce(masterKey, envelope),
  };
}

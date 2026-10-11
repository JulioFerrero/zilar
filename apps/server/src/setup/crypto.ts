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

import { makeEnvelope } from '../effect/crypto-envelope';

export const INSTANCE_SETTINGS_KDF_LABEL = 'zilar-instance-settings';

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

const envelope = makeEnvelope(INSTANCE_SETTINGS_KDF_LABEL, () => new SettingsDecryptionError());

// Builds the cipher for instance settings. The envelope-encryption key
// comes from `ZILAR_KEY_ENCRYPTION_KEY` when set, otherwise the auth
// secret (both validated by the config schema before they reach here).
export function createSettingsCipher(masterKey: string): SettingsCipher {
  return {
    encrypt: (plaintext) => envelope.encrypt(masterKey, plaintext),
    decrypt: (blob) => envelope.decrypt(masterKey, blob),
  };
}

// effect-plain: synchronous AES-GCM decrypt; failure is a typed SettingsDecryptionError
// AES-256-GCM with a random nonce per value; a stored value is
// `v1:<salt>:<iv>:<ciphertext>:<tag>`, base64url. Any tamper or wrong key fails loudly.

import { makeEnvelope } from '../effect/crypto-envelope';

export const INSTANCE_SETTINGS_KDF_LABEL = 'zilar-instance-settings';

// The message is fixed: it never carries the master key, the blob or the plaintext.
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

// The key comes from `ZILAR_KEY_ENCRYPTION_KEY` when set, otherwise the auth secret (both
// validated by the config schema before they reach here).
export function createSettingsCipher(masterKey: string): SettingsCipher {
  return {
    encrypt: (plaintext) => envelope.encrypt(masterKey, plaintext),
    decrypt: (blob) => envelope.decrypt(masterKey, blob),
  };
}

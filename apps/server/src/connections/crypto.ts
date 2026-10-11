// effect-plain: synchronous AES-GCM decrypt; failure is a typed DecryptionError
import { makeEnvelope } from '../effect/crypto-envelope';
import { PROVIDER_KEY_KDF_LABEL } from '../kdf-labels';

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

const envelope = makeEnvelope(PROVIDER_KEY_KDF_LABEL, () => new DecryptionError());

// Builds the cipher from the environment's master key. The key is validated by
// the config schema (ZILAR_KEY_ENCRYPTION_KEY, at least 32 characters) before
// it reaches here.
export function createKeyCipher(masterKey: string): KeyCipher {
  return {
    encrypt: (plaintext) => envelope.encrypt(masterKey, plaintext),
    decrypt: (blob) => envelope.decrypt(masterKey, blob),
  };
}

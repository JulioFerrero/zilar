// effect-plain: synchronous AES-GCM decrypt; failure is a typed DecryptionError
import { makeEnvelope } from '../effect/crypto-envelope';
import { PROVIDER_KEY_KDF_LABEL } from '../kdf-labels';

// A stored key is `v1:<salt>:<iv>:<ciphertext>:<tag>` (base64url). Each blob gets
// an AES-256-GCM key derived from the server-only master key with HKDF and a
// random salt. GCM authenticates ciphertext, IV and tag together, so tampering
// or a wrong master key fails here instead of returning garbage.

// The message is fixed: it never carries the master key, the blob or the plaintext.
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

export function createKeyCipher(masterKey: string): KeyCipher {
  return {
    encrypt: (plaintext) => envelope.encrypt(masterKey, plaintext),
    decrypt: (blob) => envelope.decrypt(masterKey, blob),
  };
}

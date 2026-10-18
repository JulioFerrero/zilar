// effect-plain: synchronous AES-GCM decrypt; failure is a typed PushDecryptionError
import { makeEnvelope } from '../effect/crypto-envelope';
import { PUSH_STORAGE_KDF_LABEL } from '../kdf-labels';

// Envelope encryption for the Web Push subscription keys at rest, using
// Node's `crypto`. Same versioned envelope as the provider-key cipher, but a
// separate HKDF info string, so a blob sealed for one purpose can never be
// opened as the other. A blob is `v1:<salt>:<iv>:<ciphertext>:<tag>` in
// base64url; AES-256-GCM authenticates it all, so tampering or the wrong
// `PUSH_STORAGE_KEY` fails loudly instead of returning garbage.

// Every failure to open a stored push key is this type; its message is
// fixed and never carries the storage key, the blob or the plaintext.
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

const envelope = makeEnvelope(PUSH_STORAGE_KDF_LABEL, () => new PushDecryptionError());

export function createPushCipher(masterKey: string): PushCipher {
  return {
    encrypt: (plaintext) => envelope.encrypt(masterKey, plaintext),
    decrypt: (blob) => envelope.decrypt(masterKey, blob),
  };
}

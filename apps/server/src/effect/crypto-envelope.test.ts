// The shared envelope (T-1107). It is the one copy of the derive/encrypt/
// decrypt trio, so these tests pin what each caller relies on: a round trip,
// isolation between labels (each failure is the opener's own error class) and
// the exact on-disk format of blobs written before the refactor.

import { describe, expect, it } from 'vitest';
import { createKeyCipher, DecryptionError } from '../connections/crypto';
import { createPushCipher, PushDecryptionError } from '../push/crypto';
import { createSettingsCipher, SettingsDecryptionError } from '../setup/crypto';
import { makeEnvelope } from './crypto-envelope';

const MASTER_KEY = 'test-master-key-0000000000000000000000';

class FirstLabelError extends Error {}
class SecondLabelError extends Error {}

describe('crypto envelope', () => {
  it('round-trips a value', () => {
    const envelope = makeEnvelope('zilar/test/label', () => new FirstLabelError());
    const plaintext = 'a secret value';
    expect(envelope.decrypt(MASTER_KEY, envelope.encrypt(MASTER_KEY, plaintext))).toBe(plaintext);
  });

  it('refuses a blob sealed with another label, throwing the opener error class', () => {
    const sealer = makeEnvelope('zilar/test/label-a', () => new FirstLabelError());
    const opener = makeEnvelope('zilar/test/label-b', () => new SecondLabelError());
    const sealed = sealer.encrypt(MASTER_KEY, 'a secret value');
    expect(() => opener.decrypt(MASTER_KEY, sealed)).toThrow(SecondLabelError);
  });

  it('keeps the three real ciphers isolated by their labels', () => {
    const sealedForProvider = createKeyCipher(MASTER_KEY).encrypt('sk-secret-value');
    const sealedForPush = createPushCipher(MASTER_KEY).encrypt('push-subscription-key');
    expect(() => createPushCipher(MASTER_KEY).decrypt(sealedForProvider)).toThrow(
      PushDecryptionError,
    );
    expect(() => createSettingsCipher(MASTER_KEY).decrypt(sealedForProvider)).toThrow(
      SettingsDecryptionError,
    );
    expect(() => createKeyCipher(MASTER_KEY).decrypt(sealedForPush)).toThrow(DecryptionError);
  });
});

describe('stored-envelope compatibility', () => {
  // Generated once with the pre-dedup `createKeyCipher` code (provider-key
  // label, fixed 16-byte salt and 12-byte iv) before the refactor. The new
  // shared envelope must decrypt it unchanged, so stored provider keys stay
  // readable.
  const LEGACY_MASTER_KEY = 'legacy-test-master-key-0000000000';
  const LEGACY_PLAINTEXT = 'sk-legacy-provider-key-abc123';
  const LEGACY_ENVELOPE =
    'v1:BwcHBwcHBwcHBwcHBwcHBw:CQkJCQkJCQkJCQkJ:paKadqdCcnp2iW5u_R_wIReRl2D3y2p32HpaEgk:2GvqtmDnLMmW_mes7Gb5RA';

  it('decrypts a blob produced by the old createKeyCipher', () => {
    expect(createKeyCipher(LEGACY_MASTER_KEY).decrypt(LEGACY_ENVELOPE)).toBe(LEGACY_PLAINTEXT);
  });

  it('still rejects that blob under the wrong label', () => {
    expect(() => createSettingsCipher(LEGACY_MASTER_KEY).decrypt(LEGACY_ENVELOPE)).toThrow(
      SettingsDecryptionError,
    );
  });
});

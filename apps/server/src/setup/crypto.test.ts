// Instance settings encryption (T-0161): round-trips, random nonces,
// wrong-key and tamper failures, and the key-source rule. Uses a
// throwaway sentinel value, never a real key.

import { describe, expect, it } from 'vitest';
import { loadServerConfig } from '../config';
import { TEST_SECRET } from '../test-support';
import { createSettingsCipher, SettingsDecryptionError } from './crypto';
import { settingsCipherFor } from './settings';

const SENTINEL = 're_ZILAR_CRYPTO_SENTINEL_5c4b3a2d1e0f';

const baseEnv = {
  DATABASE_URL: 'postgres://user:hunter2@127.0.0.1:5432/zilar',
  BETTER_AUTH_SECRET: TEST_SECRET,
  EJABBERD_ADMIN_JID: 'admin@zilar.localhost',
  EJABBERD_ADMIN_PASSWORD: 'admin-password',
  ZILAR_XMPP_JWT_SECRET: 'x'.repeat(40),
};

describe('settings cipher', () => {
  it('round-trips a value', () => {
    const cipher = createSettingsCipher('a'.repeat(32));
    expect(cipher.decrypt(cipher.encrypt(SENTINEL))).toBe(SENTINEL);
  });

  it('uses a random nonce per value', () => {
    const cipher = createSettingsCipher('a'.repeat(32));
    expect(cipher.encrypt(SENTINEL)).not.toBe(cipher.encrypt(SENTINEL));
  });

  it('never stores the value in clear text', () => {
    const cipher = createSettingsCipher('a'.repeat(32));
    expect(cipher.encrypt(SENTINEL)).not.toContain(SENTINEL);
  });

  it('fails loudly with the wrong key', () => {
    const sealed = createSettingsCipher('a'.repeat(32)).encrypt(SENTINEL);
    expect(() => createSettingsCipher('b'.repeat(32)).decrypt(sealed)).toThrow(
      SettingsDecryptionError,
    );
  });

  it('fails loudly on tampering', () => {
    const cipher = createSettingsCipher('a'.repeat(32));
    const sealed = cipher.encrypt(SENTINEL);
    const parts = sealed.split(':');
    const tampered = [...parts.slice(0, 3), `${parts[3]}A`, parts[4]].join(':');
    expect(() => cipher.decrypt(tampered)).toThrow(SettingsDecryptionError);
  });

  it('fails loudly on malformed envelopes', () => {
    const cipher = createSettingsCipher('a'.repeat(32));
    for (const bad of ['not-an-envelope', 'v1:a:b', 'v2:a:b:c:d']) {
      expect(() => cipher.decrypt(bad)).toThrow(SettingsDecryptionError);
    }
  });
});

describe('settingsCipherFor', () => {
  it('prefers ZILAR_KEY_ENCRYPTION_KEY and falls back to the auth secret', () => {
    const explicit = loadServerConfig({ ...baseEnv, ZILAR_KEY_ENCRYPTION_KEY: 'c'.repeat(32) });
    const fallback = loadServerConfig(baseEnv);
    const fromExplicit = settingsCipherFor(explicit);
    const fromFallback = settingsCipherFor(fallback);
    expect(fromExplicit.decrypt(fromExplicit.encrypt(SENTINEL))).toBe(SENTINEL);
    expect(fromFallback.decrypt(fromFallback.encrypt(SENTINEL))).toBe(SENTINEL);
    // Different master keys: envelopes do not cross-decrypt.
    expect(() => fromFallback.decrypt(fromExplicit.encrypt(SENTINEL))).toThrow(
      SettingsDecryptionError,
    );
  });
});

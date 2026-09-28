import { describe, expect, it } from 'vitest';
import { createKeyCipher, DecryptionError } from './crypto';

const MASTER_KEY = 'test-master-key-0000000000000000000000';
const OTHER_KEY = 'other-master-key-0000000000000000000000';

function tamper(envelope: string, part: number): string {
  const parts = envelope.split(':');
  const encoded = parts[part];
  if (encoded === undefined) {
    throw new Error(`part ${part} missing`);
  }
  const bytes = Buffer.from(encoded, 'base64url');
  const first = bytes[0] ?? 0;
  bytes[0] = first ^ 0xff;
  parts[part] = bytes.toString('base64url');
  return parts.join(':');
}

describe('connections crypto', () => {
  const cipher = createKeyCipher(MASTER_KEY);

  it('round-trips a key', () => {
    const plaintext = 'sk-abcdef1234567890';
    expect(cipher.decrypt(cipher.encrypt(plaintext))).toBe(plaintext);
  });

  it('produces a different envelope each time for the same plaintext', () => {
    const plaintext = 'sk-abcdef1234567890';
    expect(cipher.encrypt(plaintext)).not.toBe(cipher.encrypt(plaintext));
  });

  it('never stores the plaintext in the envelope', () => {
    const plaintext = 'sk-secret-value-123456';
    const envelope = cipher.encrypt(plaintext);
    expect(envelope).not.toContain('secret');
    expect(envelope).not.toContain(plaintext);
  });

  it('fails loudly when the ciphertext is tampered with', () => {
    const envelope = cipher.encrypt('sk-abcdef1234567890');
    expect(() => cipher.decrypt(tamper(envelope, 3))).toThrow(DecryptionError);
  });

  it('fails loudly when the iv is tampered with', () => {
    const envelope = cipher.encrypt('sk-abcdef1234567890');
    expect(() => cipher.decrypt(tamper(envelope, 2))).toThrow(DecryptionError);
  });

  it('fails loudly when the auth tag is tampered with', () => {
    const envelope = cipher.encrypt('sk-abcdef1234567890');
    expect(() => cipher.decrypt(tamper(envelope, 4))).toThrow(DecryptionError);
  });

  it('fails with the wrong master key', () => {
    const envelope = cipher.encrypt('sk-abcdef1234567890');
    expect(() => createKeyCipher(OTHER_KEY).decrypt(envelope)).toThrow(DecryptionError);
  });

  it('rejects a malformed envelope', () => {
    expect(() => cipher.decrypt('v1:not-a-valid-envelope')).toThrow(DecryptionError);
    expect(() => cipher.decrypt('v2:')).toThrow(DecryptionError);
  });
});

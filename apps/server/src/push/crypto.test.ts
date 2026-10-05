import { describe, expect, it } from 'vitest';
import { createPushCipher, PushDecryptionError } from './crypto';

describe('push storage cipher', () => {
  it('round-trips a sealed key', () => {
    const cipher = createPushCipher('test-storage-key-00000000000000000000');
    const sealed = cipher.encrypt('p256dh-key-material');
    expect(sealed).not.toContain('p256dh-key-material');
    expect(cipher.decrypt(sealed)).toBe('p256dh-key-material');
  });

  it('seals the same plaintext differently each time', () => {
    const cipher = createPushCipher('test-storage-key-00000000000000000000');
    expect(cipher.encrypt('same')).not.toBe(cipher.encrypt('same'));
  });

  it('fails loudly with the wrong storage key', () => {
    const sealed = createPushCipher('test-storage-key-00000000000000000000').encrypt('secret');
    expect(() => createPushCipher('another-storage-key-0000000000000000').decrypt(sealed)).toThrow(
      PushDecryptionError,
    );
  });

  it('fails loudly on tampered and malformed blobs', () => {
    const cipher = createPushCipher('test-storage-key-00000000000000000000');
    const sealed = cipher.encrypt('secret');
    const parts = sealed.split(':');
    const tampered = [
      ...parts.slice(0, 3),
      Buffer.from('tampered').toString('base64url'),
      parts[4],
    ];
    expect(() => cipher.decrypt(tampered.join(':'))).toThrow(PushDecryptionError);
    expect(() => cipher.decrypt('not-an-envelope')).toThrow(PushDecryptionError);
    expect(() => cipher.decrypt('v1:bad:envelope')).toThrow(PushDecryptionError);
  });

  it('never carries the key or plaintext in the error', () => {
    const cipher = createPushCipher('test-storage-key-00000000000000000000');
    try {
      cipher.decrypt('v1:bad:envelope');
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain('test-storage-key');
      expect((error as Error).message).not.toContain('bad');
    }
  });
});

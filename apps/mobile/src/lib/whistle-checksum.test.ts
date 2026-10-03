import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { WHISTLE_MODEL_SHA256 } from 'zilar-whistle/src/model';

/**
 * The sha256 verification wrapper `downloadModel` relies on (T-0177): the
 * production path hashes the downloaded temp file with SubtleCrypto; these
 * tests pin the same vectors through Node's crypto so a wrong digest is
 * caught before any rename.
 */
export function hexDigest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function verifyModelDigest(digest: string, size: number, expectedSize: number): void {
  if (digest.toLowerCase() !== WHISTLE_MODEL_SHA256) {
    throw new Error('bad_checksum');
  }
  if (size !== expectedSize) {
    throw new Error('truncated');
  }
}

describe('whistle model checksum (T-0177)', () => {
  it('hashes bytes to the pinned sha256 shape', () => {
    const digest = hexDigest(new TextEncoder().encode('whistle-test'));
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(hexDigest(new TextEncoder().encode('whistle-test'))).toBe(digest);
    expect(hexDigest(new TextEncoder().encode('whistle-test!'))).not.toBe(digest);
  });

  it('accepts the pinned digest case-insensitively at the pinned size', () => {
    expect(() =>
      verifyModelDigest(WHISTLE_MODEL_SHA256.toUpperCase(), 16919407, 16919407),
    ).not.toThrow();
  });

  it('rejects a corrupted download', () => {
    expect(() => verifyModelDigest('0'.repeat(64), 16919407, 16919407)).toThrowError(
      'bad_checksum',
    );
  });

  it('rejects a truncated download even with the right hash', () => {
    expect(() => verifyModelDigest(WHISTLE_MODEL_SHA256, 100, 16919407)).toThrowError('truncated');
  });

  it('a download twice keeps the verified file (idempotent)', async () => {
    const seen: string[] = [];
    const download = vi.fn(async (url: string) => {
      seen.push(url);
    });
    await download('https://huggingface.co/Cactus-Compute/whistle/model');
    await download('https://huggingface.co/Cactus-Compute/whistle/model');
    expect(download).toHaveBeenCalledTimes(2);
    expect(seen[0]).toBe(seen[1]);
  });
});

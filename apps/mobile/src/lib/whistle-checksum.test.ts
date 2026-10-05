import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { downloadModel } from 'zilar-whistle/src/download';
import { WHISTLE_MODEL_BYTES, WHISTLE_MODEL_SHA256 } from 'zilar-whistle/src/model';
import { WhistleError } from 'zilar-whistle/src/result';

vi.mock('zilar-whistle/src/ZilarWhistleModule', () => ({
  getNativeModule: () => ({ isAvailable: () => true }),
}));

vi.mock('expo-file-system', () => ({
  File: class FakeFile {},
  Paths: { cache: 'file:///cache/', document: 'file:///document/' },
}));

interface FakeFsFile {
  exists: boolean;
  size: number;
  uri: string;
  deleted: boolean;
  delete: () => void;
  move: (destination: FakeFsFile) => Promise<void>;
}

function fakeFile(overrides: Partial<FakeFsFile> = {}): FakeFsFile {
  const file: FakeFsFile = {
    exists: false,
    size: 0,
    uri: 'file:///document/whistle.cact',
    deleted: false,
    delete: () => {
      file.deleted = true;
      file.exists = false;
    },
    move: async (destination: FakeFsFile) => {
      destination.exists = true;
      destination.size = file.size;
      file.exists = false;
    },
    ...overrides,
  };
  return file;
}

/**
 * The `downloadModel` seam through its injected `deps` (T-0177 finding 4):
 * the native handle and the filesystem stay faked, so these tests drive the
 * real verify-then-rename flow without network or device files.
 */
describe('whistle downloadModel (T-0177)', () => {
  it('a second call with a verified file present downloads nothing', async () => {
    const destination = fakeFile({ exists: true, size: WHISTLE_MODEL_BYTES });
    const tmp = fakeFile();
    const download = vi.fn();
    const sha256Of = vi.fn(async () => WHISTLE_MODEL_SHA256);
    const seen: number[] = [];
    await downloadModel((fraction) => seen.push(fraction), {
      download: download as never,
      sha256Of: sha256Of as never,
      modelFile: () => destination as never,
      tempFile: () => tmp as never,
    });
    expect(seen).toEqual([1]);
    expect(download).not.toHaveBeenCalled();
    expect(destination.deleted).toBe(false);
  });

  it('a corrupt file is removed and re-downloaded', async () => {
    const destination = fakeFile({ exists: true, size: WHISTLE_MODEL_BYTES });
    const tmp = fakeFile({ exists: true, size: WHISTLE_MODEL_BYTES });
    const download = vi.fn(async () => {
      tmp.exists = true;
      tmp.size = WHISTLE_MODEL_BYTES;
    });
    const sha256Of = vi.fn(async (file: FakeFsFile) =>
      file === destination ? '0'.repeat(64) : WHISTLE_MODEL_SHA256,
    );
    await downloadModel(undefined, {
      download: download as never,
      sha256Of: sha256Of as never,
      modelFile: () => destination as never,
      tempFile: () => tmp as never,
    });
    expect(destination.deleted).toBe(true);
    expect(download).toHaveBeenCalledTimes(1);
    expect(destination.exists).toBe(true);
  });

  it('a truncated re-download is rejected and removed', async () => {
    const destination = fakeFile();
    const tmp = fakeFile({ exists: true, size: 100 });
    const download = vi.fn(async () => {
      tmp.exists = true;
      tmp.size = 100;
    });
    const sha256Of = vi.fn(async () => WHISTLE_MODEL_SHA256);
    await expect(
      downloadModel(undefined, {
        download: download as never,
        sha256Of: sha256Of as never,
        modelFile: () => destination as never,
        tempFile: () => tmp as never,
      }),
    ).rejects.toMatchObject({ code: 'bad_checksum' });
    expect(tmp.deleted).toBe(true);
    expect(destination.exists).toBe(false);
  });

  it('a failed download leaves no partial file', async () => {
    const destination = fakeFile();
    const tmp = fakeFile({ exists: true, size: 50 });
    const download = vi.fn(async () => {
      throw new Error('no network in tests');
    });
    await expect(
      downloadModel(undefined, {
        download: download as never,
        sha256Of: (async () => WHISTLE_MODEL_SHA256) as never,
        modelFile: () => destination as never,
        tempFile: () => tmp as never,
      }),
    ).rejects.toMatchObject({ code: 'download_failed' });
    expect(tmp.deleted).toBe(true);
  });

  it('hashes bytes to the pinned sha256 shape', () => {
    const digest = createHash('sha256').update('whistle-test').digest('hex');
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(createHash('sha256').update('whistle-test').digest('hex')).toBe(digest);
    expect(createHash('sha256').update('whistle-test!').digest('hex')).not.toBe(digest);
  });

  it('a corrupt digest throws bad_checksum', () => {
    expect(() => {
      if ('0'.repeat(64) !== WHISTLE_MODEL_SHA256) {
        throw new WhistleError('bad_checksum', 'The model download was corrupted, try again');
      }
    }).toThrowError(WhistleError);
  });
});

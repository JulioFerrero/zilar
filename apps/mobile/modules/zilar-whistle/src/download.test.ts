import { beforeEach, describe, expect, it, vi } from 'vitest';

import { downloadModel, loadModel, modelFile, modelStatus, sha256OfFile } from './download';
import { WHISTLE_MODEL_BYTES, WHISTLE_MODEL_SHA256, WHISTLE_MODEL_URL } from './model';
import { WhistleError } from './result';
import { getNativeModule } from './ZilarWhistleModule';

// A fake app file system: a map from file uri to its size. `File` keeps the
// shape download.ts uses (uri, exists, size, delete, move).
const disk = vi.hoisted(() => new Map<string, number>());

vi.mock('expo-file-system', () => {
  class FakeFile {
    readonly uri: string;

    constructor(...parts: string[]) {
      this.uri = parts.join('');
    }

    get exists(): boolean {
      return disk.has(this.uri);
    }

    get size(): number | null {
      return disk.get(this.uri) ?? null;
    }

    delete(): void {
      disk.delete(this.uri);
    }

    async move(destination: FakeFile): Promise<void> {
      disk.set(destination.uri, disk.get(this.uri) ?? 0);
      disk.delete(this.uri);
    }
  }
  return {
    File: FakeFile,
    Paths: { cache: 'file:///cache/', document: 'file:///document/' },
  };
});

vi.mock('./ZilarWhistleModule', () => ({
  getNativeModule: vi.fn(),
}));

const MODEL = 'file:///document/whistle.cact';
const TEMP = 'file:///cache/whistle.cact.part';
const WRONG_DIGEST = '0'.repeat(64);

function nativeStub(overrides: Record<string, unknown> = {}) {
  const stub = {
    isAvailable: vi.fn(() => true),
    modelStatus: vi.fn(() => 'missing'),
    loadModel: vi.fn(async () => 'ready'),
    sha256File: vi.fn(async (_path: string) => WHISTLE_MODEL_SHA256),
    ...overrides,
  };
  vi.mocked(getNativeModule).mockReturnValue(stub as unknown as ReturnType<typeof getNativeModule>);
  return stub;
}

function noNativeModule() {
  vi.mocked(getNativeModule).mockReturnValue(null);
}

describe('whistle download module', () => {
  beforeEach(() => {
    disk.clear();
    vi.clearAllMocks();
  });

  describe('modelFile', () => {
    it('is whistle.cact in the app documents folder', () => {
      expect(modelFile().uri).toBe(MODEL);
    });
  });

  describe('modelStatus', () => {
    it('is missing without a native module', async () => {
      noNativeModule();
      await expect(modelStatus()).resolves.toBe('missing');
    });

    it('is ready when the engine already has the model', async () => {
      const native = nativeStub({ modelStatus: vi.fn(() => 'ready') });
      await expect(modelStatus()).resolves.toBe('ready');
      expect(native.loadModel).not.toHaveBeenCalled();
    });

    it('loads the verified file that is on the phone and reports ready', async () => {
      disk.set(MODEL, WHISTLE_MODEL_BYTES);
      let loaded = false;
      const native = nativeStub({
        modelStatus: vi.fn(() => (loaded ? 'ready' : 'missing')),
        loadModel: vi.fn(async () => {
          loaded = true;
          return 'ready';
        }),
      });
      await expect(modelStatus()).resolves.toBe('ready');
      expect(native.loadModel).toHaveBeenCalledWith(MODEL);
    });

    it('is missing, and loads nothing, when the file is absent or short', async () => {
      const native = nativeStub();
      await expect(modelStatus()).resolves.toBe('missing');
      disk.set(MODEL, WHISTLE_MODEL_BYTES - 1);
      await expect(modelStatus()).resolves.toBe('missing');
      expect(native.loadModel).not.toHaveBeenCalled();
    });

    it('is missing when the engine cannot load the file', async () => {
      disk.set(MODEL, WHISTLE_MODEL_BYTES);
      nativeStub({
        loadModel: vi.fn(async () => {
          throw new Error('bad weights');
        }),
      });
      await expect(modelStatus()).resolves.toBe('missing');
    });
  });

  describe('downloadModel', () => {
    it('rejects as unavailable without a native module', async () => {
      noNativeModule();
      await expect(downloadModel()).rejects.toMatchObject({ code: 'unavailable' });
    });

    it('reports 1 and downloads nothing when the verified file is already there', async () => {
      disk.set(MODEL, WHISTLE_MODEL_BYTES);
      nativeStub();
      const download = vi.fn();
      const seen: number[] = [];
      await downloadModel((fraction) => seen.push(fraction), {
        download: download as never,
      });
      expect(seen).toEqual([1]);
      expect(download).not.toHaveBeenCalled();
      expect(disk.get(MODEL)).toBe(WHISTLE_MODEL_BYTES);
    });

    it('downloads to a temp file, checks it, and moves it into place', async () => {
      const native = nativeStub({
        sha256File: vi.fn(async () => WHISTLE_MODEL_SHA256),
      });
      const download = vi.fn(async (_url: string, tmp: { uri: string }) => {
        disk.set(tmp.uri, WHISTLE_MODEL_BYTES);
      });
      const seen: number[] = [];
      await downloadModel((fraction) => seen.push(fraction), {
        download: download as never,
        sha256Of: (file) => native.sha256File(file.uri),
      });
      expect(download).toHaveBeenCalledWith(
        WHISTLE_MODEL_URL,
        expect.objectContaining({ uri: TEMP }),
        expect.objectContaining({ idempotent: true }),
      );
      expect(disk.get(MODEL)).toBe(WHISTLE_MODEL_BYTES);
      expect(disk.has(TEMP)).toBe(false);
      expect(seen.at(-1)).toBe(1);
    });

    it('reports download progress as a fraction, clamped to 0..1', async () => {
      nativeStub();
      const download = vi.fn(
        async (
          _url: string,
          tmp: { uri: string },
          options: { onProgress?: (p: { bytesWritten: number; totalBytes: number }) => void },
        ) => {
          options.onProgress?.({ bytesWritten: 50, totalBytes: 100 });
          options.onProgress?.({ bytesWritten: 200, totalBytes: 100 });
          disk.set(tmp.uri, WHISTLE_MODEL_BYTES);
        },
      );
      const seen: number[] = [];
      await downloadModel((fraction) => seen.push(fraction), {
        download: download as never,
        sha256Of: async () => WHISTLE_MODEL_SHA256,
      });
      expect(seen).toEqual([0.5, 1, 1]);
    });

    it('replaces a corrupt model file with a fresh download', async () => {
      disk.set(MODEL, WHISTLE_MODEL_BYTES);
      nativeStub();
      const download = vi.fn(async (_url: string, tmp: { uri: string }) => {
        disk.set(tmp.uri, WHISTLE_MODEL_BYTES);
      });
      await downloadModel(undefined, {
        download: download as never,
        sha256Of: async (file) => (file.uri === MODEL ? WRONG_DIGEST : WHISTLE_MODEL_SHA256),
      });
      expect(download).toHaveBeenCalledTimes(1);
      expect(disk.get(MODEL)).toBe(WHISTLE_MODEL_BYTES);
    });

    it('rejects a checksum mismatch as bad_checksum and removes the temp file', async () => {
      nativeStub();
      const download = vi.fn(async (_url: string, tmp: { uri: string }) => {
        disk.set(tmp.uri, WHISTLE_MODEL_BYTES);
      });
      await expect(
        downloadModel(undefined, {
          download: download as never,
          sha256Of: async () => WRONG_DIGEST,
        }),
      ).rejects.toMatchObject({
        code: 'bad_checksum',
        message: 'The model download was corrupted, try again',
      });
      expect(disk.has(TEMP)).toBe(false);
      expect(disk.has(MODEL)).toBe(false);
    });

    it('rejects a truncated download as bad_checksum and removes the temp file', async () => {
      nativeStub();
      const download = vi.fn(async (_url: string, tmp: { uri: string }) => {
        disk.set(tmp.uri, 100);
      });
      await expect(
        downloadModel(undefined, {
          download: download as never,
          sha256Of: async () => WHISTLE_MODEL_SHA256,
        }),
      ).rejects.toMatchObject({
        code: 'bad_checksum',
        message: 'The model download was truncated, try again',
      });
      expect(disk.has(TEMP)).toBe(false);
      expect(disk.has(MODEL)).toBe(false);
    });

    it('maps a failed download to download_failed and removes the partial file', async () => {
      nativeStub();
      const download = vi.fn(async (_url: string, tmp: { uri: string }) => {
        disk.set(tmp.uri, 50);
        throw new Error('network down');
      });
      await expect(
        downloadModel(undefined, {
          download: download as never,
          sha256Of: async () => WHISTLE_MODEL_SHA256,
        }),
      ).rejects.toMatchObject({
        code: 'download_failed',
        message: 'Could not download the Whistle model',
      });
      expect(disk.has(TEMP)).toBe(false);
    });

    it('keeps a WhistleError thrown by the download as it is', async () => {
      nativeStub();
      const download = vi.fn(async () => {
        throw new WhistleError('unavailable', 'offline engine');
      });
      await expect(
        downloadModel(undefined, {
          download: download as never,
          sha256Of: async () => WHISTLE_MODEL_SHA256,
        }),
      ).rejects.toMatchObject({ code: 'unavailable', message: 'offline engine' });
    });
  });

  describe('loadModel', () => {
    it('rejects as unavailable without a native module', async () => {
      noNativeModule();
      await expect(loadModel()).rejects.toMatchObject({ code: 'unavailable' });
    });

    it('asks for the download first when there is no verified file', async () => {
      const native = nativeStub();
      await expect(loadModel()).rejects.toMatchObject({
        code: 'model_missing',
        message: 'Download the Whistle model first',
      });
      expect(native.loadModel).not.toHaveBeenCalled();
    });

    it('loads the verified file into the engine', async () => {
      disk.set(MODEL, WHISTLE_MODEL_BYTES);
      const native = nativeStub();
      await expect(loadModel()).resolves.toBeUndefined();
      expect(native.loadModel).toHaveBeenCalledWith(MODEL);
    });

    it('maps a native load failure to its code and message', async () => {
      disk.set(MODEL, WHISTLE_MODEL_BYTES);
      nativeStub({
        loadModel: vi.fn(async () => {
          throw { code: 'load_failed', message: 'bad header' };
        }),
      });
      await expect(loadModel()).rejects.toMatchObject({
        code: 'load_failed',
        message: 'bad header',
      });
    });

    it('turns an unknown native failure into the fixed transcription message', async () => {
      disk.set(MODEL, WHISTLE_MODEL_BYTES);
      nativeStub({
        loadModel: vi.fn(async () => {
          throw new Error('raw native text');
        }),
      });
      await expect(loadModel()).rejects.toMatchObject({
        code: 'transcribe_failed',
        message: 'The transcription failed',
      });
    });
  });

  describe('sha256OfFile', () => {
    it('rejects as unavailable without a native module', async () => {
      noNativeModule();
      const error = await sha256OfFile({ uri: MODEL } as never).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(WhistleError);
      expect(error).toMatchObject({ code: 'unavailable' });
    });

    it('hashes the file natively by its uri', async () => {
      const native = nativeStub();
      await expect(sha256OfFile({ uri: MODEL } as never)).resolves.toBe(WHISTLE_MODEL_SHA256);
      expect(native.sha256File).toHaveBeenCalledWith(MODEL);
    });
  });
});

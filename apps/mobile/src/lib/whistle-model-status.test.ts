import { describe, expect, it, vi } from 'vitest';

import { modelStatus } from 'zilar-whistle/src/download';
import { WHISTLE_MODEL_BYTES } from 'zilar-whistle/src/model';

vi.mock('zilar-whistle/src/ZilarWhistleModule', () => ({
  getNativeModule: () => null,
}));

vi.mock('expo-file-system', () => ({
  File: class FakeFile {},
  Paths: { cache: 'file:///cache/', document: 'file:///document/' },
}));

type Native = NonNullable<Parameters<typeof modelStatus>[0]>['native'];

function fakeNative(loadedAtStart: boolean, loadFails = false) {
  let loaded = loadedAtStart;
  const loadModel = vi.fn(async () => {
    if (loadFails) {
      throw new Error('load failed');
    }
    loaded = true;
    return 'ready';
  });
  const native = {
    isAvailable: () => true,
    modelStatus: () => (loaded ? 'ready' : 'missing'),
    loadModel,
  } as unknown as Native;
  return { native, loadModel };
}

const onDisk = (size: number) =>
  ({ exists: true, size, uri: 'file:///document/whistle.cact' }) as never;
const absent = () => ({ exists: false, size: 0, uri: 'file:///document/whistle.cact' }) as never;

// Device report 2026-10-04: after every app restart the model file was still
// on the phone, but the engine had forgotten it, so the app asked to download
// the 17 MB model again.
describe('modelStatus after an app restart', () => {
  it('loads the verified file that is already on the phone and reports ready', async () => {
    const { native, loadModel } = fakeNative(false);
    const status = await modelStatus({ native, modelFile: () => onDisk(WHISTLE_MODEL_BYTES) });
    expect(status).toBe('ready');
    expect(loadModel).toHaveBeenCalledTimes(1);
    expect(loadModel).toHaveBeenCalledWith('file:///document/whistle.cact');
  });

  it('does not load again when the engine already has the model', async () => {
    const { native, loadModel } = fakeNative(true);
    const status = await modelStatus({ native, modelFile: () => onDisk(WHISTLE_MODEL_BYTES) });
    expect(status).toBe('ready');
    expect(loadModel).not.toHaveBeenCalled();
  });

  it('is missing, and loads nothing, when there is no file', async () => {
    const { native, loadModel } = fakeNative(false);
    expect(await modelStatus({ native, modelFile: absent })).toBe('missing');
    expect(loadModel).not.toHaveBeenCalled();
  });

  it('is missing, and loads nothing, when the file is shorter than the pinned size', async () => {
    const { native, loadModel } = fakeNative(false);
    const status = await modelStatus({ native, modelFile: () => onDisk(WHISTLE_MODEL_BYTES - 1) });
    expect(status).toBe('missing');
    expect(loadModel).not.toHaveBeenCalled();
  });

  it('is missing when the engine cannot load the file', async () => {
    const { native } = fakeNative(false, true);
    const status = await modelStatus({ native, modelFile: () => onDisk(WHISTLE_MODEL_BYTES) });
    expect(status).toBe('missing');
  });

  it('is missing without a native module', async () => {
    expect(await modelStatus({ native: null })).toBe('missing');
  });
});

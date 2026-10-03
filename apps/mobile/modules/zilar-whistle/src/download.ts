import { File, Paths } from 'expo-file-system';

import {
  WHISTLE_MODEL_BYTES,
  WHISTLE_MODEL_FILENAME,
  WHISTLE_MODEL_SHA256,
  WHISTLE_MODEL_URL,
} from './model';
import { WhistleError, whistleErrorFor } from './result';
import { getNativeModule } from './ZilarWhistleModule';

export type WhistleModelStatus = 'missing' | 'ready';

/** Where the pinned model lives once downloaded (app files dir, kept). */
export function modelFile(): File {
  return new File(Paths.document, WHISTLE_MODEL_FILENAME);
}

function tempFile(): File {
  return new File(Paths.cache, `${WHISTLE_MODEL_FILENAME}.part`);
}

/**
 * The model status the app shows. `ready` means the verified model file is on
 * the phone at its full pinned size and the native engine has it loaded.
 *
 * The engine forgets the model every time the app starts, but the file stays.
 * So when the file is there and the engine has not loaded it yet, this loads
 * it (a second or less) and reports `ready`: nobody is asked to download a
 * model that is already on the phone. The file only ever reaches its final
 * name after its sha256 verified (see `downloadModel`), so its size is enough
 * to trust it here. A missing, short or unloadable file is `missing`.
 */
export async function modelStatus(deps?: {
  native?: ReturnType<typeof getNativeModule>;
  modelFile?: () => File;
}): Promise<WhistleModelStatus> {
  const native = deps?.native === undefined ? getNativeModule() : deps.native;
  if (native === null || !native.isAvailable()) {
    return 'missing';
  }
  try {
    if (native.modelStatus() === 'ready') {
      return 'ready';
    }
    const file = (deps?.modelFile ?? modelFile)();
    if (!file.exists || file.size !== WHISTLE_MODEL_BYTES) {
      return 'missing';
    }
    await native.loadModel(file.uri);
    return native.modelStatus() === 'ready' ? 'ready' : 'missing';
  } catch {
    return 'missing';
  }
}

/**
 * Downloads `whistle.cact` from the pinned URL into the app's files dir.
 * Writes to a temp name and renames only after the sha256 verifies, so a
 * corrupted or truncated download is rejected and removed — never left as a
 * partial file. Safe to call twice: a verified file resolves at once.
 */
export async function downloadModel(
  onProgress?: (fraction: number) => void,
  deps?: {
    download?: typeof File.downloadFileAsync;
    sha256Of?: (file: File) => Promise<string>;
    modelFile?: () => File;
    tempFile?: () => File;
  },
): Promise<void> {
  const native = getNativeModule();
  if (native === null || !native.isAvailable()) {
    throw new WhistleError('unavailable', 'On-device transcription needs Android arm64');
  }
  const destination = deps?.modelFile?.() ?? modelFile();
  if (destination.exists && destination.size === WHISTLE_MODEL_BYTES) {
    const digest = await (deps?.sha256Of ?? sha256OfFile)(destination);
    if (digest.toLowerCase() === WHISTLE_MODEL_SHA256) {
      onProgress?.(1);
      return;
    }
    destination.delete();
  }
  const download = deps?.download ?? File.downloadFileAsync;
  const tmp = deps?.tempFile?.() ?? tempFile();
  if (tmp.exists) {
    tmp.delete();
  }
  try {
    await download(WHISTLE_MODEL_URL, tmp, {
      idempotent: true,
      onProgress:
        onProgress === undefined
          ? undefined
          : (progress) => {
              const total = progress.totalBytes > 0 ? progress.totalBytes : WHISTLE_MODEL_BYTES;
              onProgress(Math.min(1, Math.max(0, progress.bytesWritten / total)));
            },
    });
  } catch (error) {
    if (tmp.exists) {
      tmp.delete();
    }
    throw error instanceof WhistleError
      ? error
      : new WhistleError('download_failed', 'Could not download the Whistle model');
  }
  const digest = await (deps?.sha256Of ?? sha256OfFile)(tmp);
  if (digest.toLowerCase() !== WHISTLE_MODEL_SHA256) {
    tmp.delete();
    throw new WhistleError('bad_checksum', 'The model download was corrupted, try again');
  }
  if (tmp.size !== WHISTLE_MODEL_BYTES) {
    tmp.delete();
    throw new WhistleError('bad_checksum', 'The model download was truncated, try again');
  }
  await tmp.move(destination, { overwrite: true });
  onProgress?.(1);
}

/** Loads the verified model file into the engine (serialised natively). */
export async function loadModel(): Promise<void> {
  const native = getNativeModule();
  if (native === null || !native.isAvailable()) {
    throw new WhistleError('unavailable', 'On-device transcription needs Android arm64');
  }
  const file = modelFile();
  if (!file.exists || file.size !== WHISTLE_MODEL_BYTES) {
    throw new WhistleError('model_missing', 'Download the Whistle model first');
  }
  try {
    await native.loadModel(file.uri);
  } catch (error) {
    throw whistleErrorFor(error);
  }
}

/**
 * The sha256 hex of a file, streamed natively (Hermes has no
 * `crypto.subtle`, and this never holds the whole model in memory).
 */
export async function sha256OfFile(file: File): Promise<string> {
  const native = getNativeModule();
  if (native === null) {
    throw new WhistleError('unavailable', 'On-device transcription is unavailable');
  }
  return native.sha256File(file.uri);
}

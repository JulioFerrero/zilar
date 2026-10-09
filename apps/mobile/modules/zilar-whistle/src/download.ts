import { Data, Effect } from 'effect';
import { File, Paths } from 'expo-file-system';

import {
  WHISTLE_MODEL_BYTES,
  WHISTLE_MODEL_FILENAME,
  WHISTLE_MODEL_SHA256,
  WHISTLE_MODEL_URL,
} from './model';
import { WhistleError, whistleErrorFor } from './result';
import { getNativeModule, type ZilarWhistleNativeModule } from './ZilarWhistleModule';

export type WhistleModelStatus = 'missing' | 'ready';

/** Where the pinned model lives once downloaded (app files dir, kept). */
export function modelFile(): File {
  return new File(Paths.document, WHISTLE_MODEL_FILENAME);
}

function tempFile(): File {
  return new File(Paths.cache, `${WHISTLE_MODEL_FILENAME}.part`);
}

/** A step of the status check that threw or rejected: the check reports `missing`. */
class ModelStatusUnreadable extends Data.TaggedError('ModelStatusUnreadable') {}

const unreadable = (): ModelStatusUnreadable => new ModelStatusUnreadable();

const readStep = <A>(step: () => A) => Effect.try({ try: step, catch: unreadable });

const readPromise = <A>(step: () => PromiseLike<A>) =>
  Effect.tryPromise({ try: step, catch: unreadable });

/**
 * The status once the engine has been asked: the file on disk is loaded when
 * the engine has forgotten it, then the engine is asked again.
 */
const engineStatus = (native: ZilarWhistleNativeModule, fileOf: () => File) =>
  Effect.gen(function* () {
    if ((yield* readStep(() => native.modelStatus())) === 'ready') {
      return 'ready' as const;
    }
    const file = yield* readStep(fileOf);
    const onDisk = yield* readStep(() => file.exists && file.size === WHISTLE_MODEL_BYTES);
    if (!onDisk) {
      return 'missing' as const;
    }
    yield* readPromise(() => native.loadModel(file.uri));
    const loaded = yield* readStep(() => native.modelStatus());
    return loaded === 'ready' ? ('ready' as const) : ('missing' as const);
  });

const modelStatusEffect = (deps?: Parameters<typeof modelStatus>[0]) =>
  Effect.gen(function* () {
    const native = deps?.native === undefined ? getNativeModule() : deps.native;
    if (native === null || !native.isAvailable()) {
      return 'missing' as const;
    }
    return yield* engineStatus(native, deps?.modelFile ?? modelFile).pipe(
      Effect.orElseSucceed(() => 'missing' as const),
    );
  });

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
export function modelStatus(deps?: {
  native?: ReturnType<typeof getNativeModule>;
  modelFile?: () => File;
}): Promise<WhistleModelStatus> {
  return Effect.runPromise(modelStatusEffect(deps));
}

/** The sha256 of the file: the injected seam when a test gives one, else the native hash. */
const digestOf = (
  deps: NonNullable<Parameters<typeof downloadModel>[1]> | undefined,
  file: File,
): Effect.Effect<string, WhistleError> => {
  const sha256Of = deps?.sha256Of;
  return sha256Of === undefined ? sha256OfFileEffect(file) : Effect.promise(() => sha256Of(file));
};

const fetchToTemp = (
  download: typeof File.downloadFileAsync,
  tmp: File,
  onProgress: ((fraction: number) => void) | undefined,
) =>
  Effect.tryPromise({
    try: () =>
      download(WHISTLE_MODEL_URL, tmp, {
        idempotent: true,
        onProgress:
          onProgress === undefined
            ? undefined
            : (progress) => {
                const total = progress.totalBytes > 0 ? progress.totalBytes : WHISTLE_MODEL_BYTES;
                onProgress(Math.min(1, Math.max(0, progress.bytesWritten / total)));
              },
      }),
    catch: (error) =>
      error instanceof WhistleError
        ? error
        : new WhistleError('download_failed', 'Could not download the Whistle model'),
  });

const downloadModelEffect = (
  onProgress?: (fraction: number) => void,
  deps?: Parameters<typeof downloadModel>[1],
) =>
  Effect.gen(function* () {
    const native = getNativeModule();
    if (native === null || !native.isAvailable()) {
      return yield* Effect.fail(
        new WhistleError('unavailable', 'On-device transcription needs Android arm64'),
      );
    }
    const destination = deps?.modelFile?.() ?? modelFile();
    if (destination.exists && destination.size === WHISTLE_MODEL_BYTES) {
      const digest = yield* digestOf(deps, destination);
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
    yield* fetchToTemp(download, tmp, onProgress).pipe(
      Effect.tapError(() =>
        Effect.sync(() => {
          if (tmp.exists) {
            tmp.delete();
          }
        }),
      ),
    );
    const digest = yield* digestOf(deps, tmp);
    if (digest.toLowerCase() !== WHISTLE_MODEL_SHA256) {
      tmp.delete();
      return yield* Effect.fail(
        new WhistleError('bad_checksum', 'The model download was corrupted, try again'),
      );
    }
    if (tmp.size !== WHISTLE_MODEL_BYTES) {
      tmp.delete();
      return yield* Effect.fail(
        new WhistleError('bad_checksum', 'The model download was truncated, try again'),
      );
    }
    yield* Effect.promise(() => tmp.move(destination, { overwrite: true }));
    onProgress?.(1);
  });

/**
 * Downloads `whistle.cact` from the pinned URL into the app's files dir.
 * Writes to a temp name and renames only after the sha256 verifies, so a
 * corrupted or truncated download is rejected and removed — never left as a
 * partial file. Safe to call twice: a verified file resolves at once.
 */
export function downloadModel(
  onProgress?: (fraction: number) => void,
  deps?: {
    download?: typeof File.downloadFileAsync;
    sha256Of?: (file: File) => Promise<string>;
    modelFile?: () => File;
    tempFile?: () => File;
  },
): Promise<void> {
  return Effect.runPromise(downloadModelEffect(onProgress, deps));
}

const loadModelEffect = Effect.gen(function* () {
  const native = getNativeModule();
  if (native === null || !native.isAvailable()) {
    return yield* Effect.fail(
      new WhistleError('unavailable', 'On-device transcription needs Android arm64'),
    );
  }
  const file = modelFile();
  if (!file.exists || file.size !== WHISTLE_MODEL_BYTES) {
    return yield* Effect.fail(
      new WhistleError('model_missing', 'Download the Whistle model first'),
    );
  }
  yield* Effect.tryPromise({
    try: () => native.loadModel(file.uri),
    catch: (error) => whistleErrorFor(error),
  });
});

/** Loads the verified model file into the engine (serialised natively). */
export function loadModel(): Promise<void> {
  return Effect.runPromise(loadModelEffect);
}

const sha256OfFileEffect = (file: File): Effect.Effect<string, WhistleError> =>
  Effect.gen(function* () {
    const native = getNativeModule();
    if (native === null) {
      return yield* Effect.fail(
        new WhistleError('unavailable', 'On-device transcription is unavailable'),
      );
    }
    return yield* Effect.promise(() => native.sha256File(file.uri));
  });

/**
 * The sha256 hex of a file, streamed natively (Hermes has no
 * `crypto.subtle`, and this never holds the whole model in memory).
 */
export function sha256OfFile(file: File): Promise<string> {
  return Effect.runPromise(sha256OfFileEffect(file));
}

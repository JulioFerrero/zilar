/**
 * An injected seam over the `zilar-whistle` Expo module, so the screen and its tests never touch the native handle.
 */
import { Effect } from 'effect';

import type { WhistleTranscript } from './whistle-port-types';

export type WhistleStatus = 'missing' | 'ready';

export interface WhistlePort {
  isAvailable: () => boolean;
  modelStatus: () => Promise<WhistleStatus>;
  downloadModel: (onProgress?: (fraction: number) => void) => Promise<void>;
  loadModel: () => Promise<void>;
  transcribe: (
    fileUri: string,
    options?: { language?: string | undefined; audioMs?: number | undefined },
  ) => Promise<WhistleTranscript>;
}

export class WhistlePortError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'WhistlePortError';
    this.code = code;
  }
}

/**
 * A missing injected function answers `absent`; a rejection of the real one reaches the caller unchanged.
 */
function injectedCall<A>(
  call: (() => Promise<A>) | undefined,
  absent: Effect.Effect<A, WhistlePortError>,
): Effect.Effect<A, WhistlePortError> {
  return call === undefined ? absent : Effect.promise(() => call());
}

function readAvailability(read: () => boolean): boolean {
  return Effect.runSync(Effect.try(read).pipe(Effect.orElseSucceed(() => false)));
}

export function createWhistlePort(deps?: {
  isAvailable?: (() => boolean) | undefined;
  modelStatus?: (() => Promise<WhistleStatus>) | undefined;
  downloadModel?: ((onProgress?: (fraction: number) => void) => Promise<void>) | undefined;
  loadModel?: (() => Promise<void>) | undefined;
  transcribe?:
    | ((
        fileUri: string,
        options?: { language?: string | undefined; audioMs?: number | undefined },
      ) => Promise<WhistleTranscript>)
    | undefined;
}): WhistlePort {
  if (deps !== undefined) {
    const injected = deps;
    return {
      isAvailable: () => readAvailability(() => injected.isAvailable?.() ?? false),
      modelStatus: () =>
        Effect.runPromise(
          injectedCall(injected.modelStatus?.bind(injected), Effect.succeed('missing')),
        ),
      downloadModel: (onProgress) =>
        Effect.runPromise(
          injectedCall(injected.downloadModel?.bind(injected, onProgress), Effect.void),
        ),
      loadModel: () =>
        Effect.runPromise(injectedCall(injected.loadModel?.bind(injected), Effect.void)),
      transcribe: (fileUri, options) =>
        Effect.runPromise(
          injectedCall(
            injected.transcribe?.bind(injected, fileUri, options),
            Effect.fail(
              new WhistlePortError('unavailable', 'On-device transcription is unavailable'),
            ),
          ),
        ),
    };
  }
  return {
    // `getNativeModule` returns null off Android and `isAvailable` only reads the ABI list.
    isAvailable: () => readAvailability(checkNativeAvailable),
    modelStatus: () => withModule((module) => module.modelStatus()),
    downloadModel: (onProgress) => withModule((module) => module.downloadModel(onProgress)),
    loadModel: () => withModule((module) => module.loadModel()),
    transcribe: (fileUri, options) => withModule((module) => module.transcribe(fileUri, options)),
  };
}

/**
 * The bare `require` below runs only when this function runs, so Vitest (which injects the fake through `deps`) never loads native code.
 */
function checkNativeAvailable(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getNativeModule } = require('zilar-whistle/src/ZilarWhistleModule') as {
    getNativeModule: () => { isAvailable: () => boolean } | null;
  };
  return getNativeModule()?.isAvailable() ?? false;
}

/**
 * Android only: the dynamic import runs only when a method is called, and the static type import is erased.
 */
type WhistleModule = {
  modelStatus: () => Promise<WhistleStatus>;
  downloadModel: (onProgress?: (fraction: number) => void) => Promise<void>;
  loadModel: () => Promise<void>;
  transcribe: (
    fileUri: string,
    options?: { language?: string | undefined },
  ) => Promise<WhistleTranscript>;
  isAvailable: () => boolean;
};

let cached: Promise<WhistleModule> | undefined;

function lazyModuleAsync(): Promise<WhistleModule> {
  cached ??= import('zilar-whistle') as Promise<WhistleModule>;
  return cached;
}

function withModule<A>(use: (module: WhistleModule) => Promise<A>): Promise<A> {
  return Effect.runPromise(
    Effect.promise(lazyModuleAsync).pipe(
      Effect.flatMap((module) => Effect.promise(() => use(module))),
    ),
  );
}

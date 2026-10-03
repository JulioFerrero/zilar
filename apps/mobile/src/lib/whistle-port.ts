/**
 * The on-device transcription port the dev screen drives (T-0177): a thin,
 * injected seam over the `zilar-whistle` local Expo module, so the screen
 * and its tests never touch the native handle directly.
 */
import type { WhistleTranscript } from './whistle-port-types';

export type WhistleStatus = 'missing' | 'ready';

export interface WhistlePort {
  isAvailable: () => boolean;
  modelStatus: () => Promise<WhistleStatus>;
  downloadModel: (onProgress?: (fraction: number) => void) => Promise<void>;
  loadModel: () => Promise<void>;
  transcribe: (
    fileUri: string,
    options?: { language?: string | undefined },
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

/** Builds the real port from the module's functions (test seam). */
export function createWhistlePort(deps?: {
  isAvailable?: (() => boolean) | undefined;
  modelStatus?: (() => Promise<WhistleStatus>) | undefined;
  downloadModel?: ((onProgress?: (fraction: number) => void) => Promise<void>) | undefined;
  loadModel?: (() => Promise<void>) | undefined;
  transcribe?:
    | ((fileUri: string, options?: { language?: string | undefined }) => Promise<WhistleTranscript>)
    | undefined;
}): WhistlePort {
  if (deps !== undefined) {
    const injected = deps;
    return {
      isAvailable: () => {
        try {
          return injected.isAvailable?.() ?? false;
        } catch {
          return false;
        }
      },
      modelStatus: () => injected.modelStatus?.() ?? Promise.resolve('missing' as WhistleStatus),
      downloadModel: (onProgress) => injected.downloadModel?.(onProgress) ?? Promise.resolve(),
      loadModel: () => injected.loadModel?.() ?? Promise.resolve(),
      transcribe: (fileUri, options) =>
        injected.transcribe?.(fileUri, options) ??
        Promise.reject(
          new WhistlePortError('unavailable', 'On-device transcription is unavailable'),
        ),
    };
  }
  return {
    // No synchronous native check exists that is safe off-device: the real
    // port reports through `modelStatus`/`transcribe` rejecting with
    // `unavailable` on iOS, non-arm64 or unlinked builds.
    isAvailable: () => false,
    modelStatus: async () => (await lazyModuleAsync()).modelStatus(),
    downloadModel: (onProgress) =>
      lazyModuleAsync().then((module) => module.downloadModel(onProgress)),
    loadModel: () => lazyModuleAsync().then((module) => module.loadModel()),
    transcribe: (fileUri, options) =>
      lazyModuleAsync().then((module) => module.transcribe(fileUri, options)),
  };
}

/**
 * The native module is Android-only and must never load under Vitest or on
 * iOS: the dynamic import below runs only when a method is actually called,
 * and the static type import is erased at compile time.
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

/**
 * The save-photo seam (T-1256): downloads the photo the viewer is showing to
 * the cache with `expo-file-system`, asks for write-only gallery permission and
 * stores it with `MediaLibrary.saveToLibraryAsync`, then deletes the cache
 * file. The URL and the bearer come from the `MediaSource` the viewer already
 * resolved, so a save fetches exactly the bytes on screen and never another
 * host.
 */

import { parseUrl } from '@zilar/chat-core';
import { Effect } from 'effect';
import { File, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library/legacy';

import type { MediaSource } from './media-source';

export const SAVED_MESSAGE = 'Saved to gallery';
export const SAVE_FAILED_MESSAGE = 'Could not save the photo.';

export type SaveResult = { status: 'saved' } | { status: 'error'; message: string };

/** The one failure the viewer shows: a fixed sentence, never platform text. */
const FAILED: SaveResult = { status: 'error', message: SAVE_FAILED_MESSAGE };

/** A unique cache name with a usable extension, taken from the loaded URL. */
function cacheFileName(uri: string): string {
  const path = parseUrl(uri)?.pathname ?? '';
  const extension = /\.[A-Za-z0-9]{1,5}$/.exec(path)?.[0] ?? '.jpg';
  return `zilar-photo-${Date.now()}${extension}`;
}

/** Deletes the temporary cache file; an already-missing file is not an error. */
function deleteQuietly(file: File): void {
  try {
    file.delete();
  } catch {
    // The file is already gone or the cache was cleared: nothing to do.
  }
}

const saveEffect = (source: MediaSource): Effect.Effect<SaveResult> =>
  Effect.gen(function* () {
    const granted = yield* Effect.tryPromise({
      try: () => MediaLibrary.requestPermissionsAsync(true),
      catch: () => undefined,
    }).pipe(
      Effect.map((response) => response.granted),
      Effect.orElseSucceed(() => false),
    );
    if (!granted) {
      return FAILED;
    }
    const destination = yield* Effect.try({
      try: () => new File(Paths.cache, cacheFileName(source.uri)),
      catch: () => undefined,
    }).pipe(Effect.orElseSucceed(() => undefined));
    if (destination === undefined) {
      return FAILED;
    }
    const file = yield* Effect.tryPromise({
      try: () =>
        File.downloadFileAsync(source.uri, destination, {
          idempotent: true,
          ...(source.headers === undefined ? {} : { headers: source.headers }),
        }),
      catch: () => undefined,
    }).pipe(Effect.orElseSucceed(() => undefined));
    if (file === undefined) {
      return FAILED;
    }
    const saved = yield* Effect.tryPromise({
      try: () => MediaLibrary.saveToLibraryAsync(file.uri).then(() => true),
      catch: () => false,
    }).pipe(Effect.orElseSucceed(() => false));
    yield* Effect.sync(() => deleteQuietly(file));
    return saved ? { status: 'saved' as const } : FAILED;
  });

/**
 * Downloads the photo to the cache, saves it to the phone's gallery and deletes
 * the cache file, reporting the outcome to `onResult`. Every failure collapses
 * to the one fixed sentence, so the viewer never shows raw platform text.
 */
export function savePhoto(source: MediaSource, onResult: (result: SaveResult) => void): void {
  void Effect.runPromise(saveEffect(source)).then(onResult);
}

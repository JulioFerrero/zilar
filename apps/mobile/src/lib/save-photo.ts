/**
 * The URL and bearer come from the `MediaSource` already resolved, so a save fetches exactly the bytes on screen and never another host.
 */

import { parseUrl } from '@zilar/chat-core';
import { Effect } from 'effect';
import { File, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library/legacy';

import type { MediaSource } from './media-source';

export const SAVED_MESSAGE = 'Saved to gallery';
export const SAVE_FAILED_MESSAGE = 'Could not save the photo.';

export type SaveResult = { status: 'saved' } | { status: 'error'; message: string };

const FAILED: SaveResult = { status: 'error', message: SAVE_FAILED_MESSAGE };

export function cacheFileName(uri: string): string {
  const path = parseUrl(uri)?.pathname ?? '';
  const extension = /\.[A-Za-z0-9]{1,5}$/.exec(path)?.[0] ?? '.jpg';
  return `zilar-photo-${Date.now()}${extension}`;
}

export function deleteQuietly(file: File): void {
  try {
    file.delete();
  } catch {
    // The file is already gone or the cache was cleared: nothing to do.
  }
}

export function downloadToCache(source: MediaSource): Effect.Effect<File | undefined> {
  return Effect.gen(function* () {
    const destination = yield* Effect.try({
      try: () => new File(Paths.cache, cacheFileName(source.uri)),
      catch: () => undefined,
    }).pipe(Effect.orElseSucceed(() => undefined));
    if (destination === undefined) {
      return undefined;
    }
    return yield* Effect.tryPromise({
      try: () =>
        File.downloadFileAsync(source.uri, destination, {
          idempotent: true,
          ...(source.headers === undefined ? {} : { headers: source.headers }),
        }),
      catch: () => undefined,
    }).pipe(Effect.orElseSucceed(() => undefined));
  });
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
    const file = yield* downloadToCache(source);
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
 * Every failure collapses to the one fixed sentence, so the viewer never shows raw platform text.
 */
export function savePhoto(source: MediaSource, onResult: (result: SaveResult) => void): void {
  void Effect.runPromise(saveEffect(source)).then(onResult);
}

/**
 * The URL and bearer come from the `MediaSource` already resolved, so a share sends exactly the bytes on screen and never another host.
 */

import { Effect } from 'effect';
import * as Sharing from 'expo-sharing';

import type { MediaSource } from './media-source';
import { deleteQuietly, downloadToCache } from './save-photo';

export const SHARE_FAILED_MESSAGE = 'Could not share the photo.';

export type ShareResult = { status: 'shared' } | { status: 'error'; message: string };

const FAILED: ShareResult = { status: 'error', message: SHARE_FAILED_MESSAGE };

/** The share sheet needs a MIME type; the server takes JPEG, PNG, WebP and GIF. */
const MIME_TYPES: Readonly<Record<string, string>> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

function mimeTypeFor(uri: string): string {
  const match = /\.[A-Za-z0-9]{1,5}$/.exec(uri);
  return (match === null ? undefined : MIME_TYPES[match[0].toLowerCase()]) ?? 'image/jpeg';
}

const shareEffect = (source: MediaSource): Effect.Effect<ShareResult> =>
  Effect.gen(function* () {
    const available = yield* Effect.tryPromise({
      try: () => Sharing.isAvailableAsync(),
      catch: () => false,
    }).pipe(Effect.orElseSucceed(() => false));
    if (!available) {
      return FAILED;
    }
    const file = yield* downloadToCache(source);
    if (file === undefined) {
      return FAILED;
    }
    // A dismissed sheet still resolves, so any resolution counts as shared.
    const shared = yield* Effect.tryPromise({
      try: () =>
        Sharing.shareAsync(file.uri, { mimeType: mimeTypeFor(source.uri) }).then(() => true),
      catch: () => false,
    }).pipe(Effect.orElseSucceed(() => false));
    yield* Effect.sync(() => deleteQuietly(file));
    return shared ? { status: 'shared' as const } : FAILED;
  });

/**
 * Every failure collapses to the one fixed sentence, so the viewer never shows raw platform text.
 */
export function sharePhoto(source: MediaSource, onResult: (result: ShareResult) => void): void {
  void Effect.runPromise(shareEffect(source)).then(onResult);
}

/**
 * The `useLinkPreviewImage` hook (T-1253): resolves a link preview's image
 * server path (`/api/link-preview/image/<key>`, T-1252) through `API_URL` and
 * attaches the session bearer, the way `useMediaSource` does for attachments.
 * Only that one prefix is ever loaded — any other `image` value gives no source,
 * so a hostile path cannot reach another origin or receive the session token.
 * The token read is async (secure storage), so the source is undefined until it
 * resolves; a broken image simply stays hidden.
 */

import { Effect, Fiber } from 'effect';
import { useEffect, useState } from 'react';

import { API_URL } from './auth';
import { getSessionToken } from './session-token';

/** The only image the card may load: our own link-preview image route. */
const LINK_PREVIEW_IMAGE_PREFIX = '/api/link-preview/image/';

/** An `expo-image` source with the session bearer for that one route. */
export type LinkPreviewImageSource = { uri: string; headers: Record<string, string> };

export function useLinkPreviewImage(path: string | undefined): LinkPreviewImageSource | undefined {
  const allowed = path !== undefined && path.startsWith(LINK_PREVIEW_IMAGE_PREFIX);
  const [headers, setHeaders] = useState<Record<string, string> | undefined>(undefined);
  useEffect(() => {
    if (!allowed) {
      return;
    }
    // A cleanup interrupts the read, so a late token never reaches a stale source.
    const fiber = Effect.runFork(
      Effect.tryPromise(() => getSessionToken()).pipe(
        Effect.match({
          onSuccess: (token) => {
            setHeaders(token === undefined ? undefined : { authorization: `Bearer ${token}` });
          },
          onFailure: () => {},
        }),
      ),
    );
    return () => {
      Effect.runSync(Fiber.interrupt(fiber));
    };
  }, [allowed, path]);
  if (!allowed || headers === undefined) {
    return undefined;
  }
  return { uri: `${API_URL}${path}`, headers };
}

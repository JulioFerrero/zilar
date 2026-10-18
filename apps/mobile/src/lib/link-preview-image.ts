/**
 * Only the `/api/link-preview/image/<key>` prefix ever loads, so a hostile path cannot reach another origin or receive the session token.
 */

import { Effect, Fiber } from 'effect';
import { useEffect, useState } from 'react';

import { API_URL } from './auth';
import { getSessionToken } from './session-token';

const LINK_PREVIEW_IMAGE_PREFIX = '/api/link-preview/image/';

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

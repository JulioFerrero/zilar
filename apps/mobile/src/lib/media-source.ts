/**
 * The bearer rides only when the result is our own API origin, the only host `GET /api/files` needs it on; a non-API source resolves immediately.
 */

import { Effect, Fiber } from 'effect';
import { useEffect, useState } from 'react';

import { isApiOriginUrl, mediaUrl } from './attachment-common';
import { getSessionToken } from './session-token';

export type MediaSource = { uri: string; headers?: Record<string, string> };

export function useMediaSource(
  chatId: string,
  url: string,
  enabled: boolean,
): MediaSource | undefined {
  const target = mediaUrl(chatId, url);
  const needsToken = isApiOriginUrl(target);
  const [headers, setHeaders] = useState<Record<string, string> | undefined>(undefined);
  useEffect(() => {
    if (!enabled || !needsToken) {
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
  }, [enabled, needsToken, target]);
  if (!enabled) {
    return undefined;
  }
  if (!needsToken) {
    return { uri: target };
  }
  return headers === undefined ? undefined : { uri: target, headers };
}

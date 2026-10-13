import { Effect, Fiber } from 'effect';
import { useCallback, useEffect, useState } from 'react';
import { mediaSrc } from './attachments';

/**
 * The backoff between `/api/files` load attempts (T-1337). A just-sent upload
 * is served before the server has indexed it, so the first requests answer
 * 404; the bubble retries four times at about 1 s, 2 s, 4 s and 8 s.
 */
export const MEDIA_RETRY_DELAYS_MS: readonly number[] = [1000, 2000, 4000, 8000];

/**
 * A local preview URL the bubble can keep showing until the remote bytes
 * arrive: the outgoing upload's `blob:` object URL, or a `data:` image.
 */
export function isLocalPreviewUrl(url: string): boolean {
  return url.startsWith('blob:') || url.startsWith('data:');
}

interface RetryState {
  /** The message URL this state belongs to. */
  url: string;
  /** The cache-busting counter of the current attempt. */
  nonce: number;
  /** True once the current source loaded. */
  loaded: boolean;
  /** True once every attempt is spent. */
  failed: boolean;
  /** Load attempts left before giving up. */
  remaining: number;
  /** The backoff to wait before the next attempt, when one is scheduled. */
  pending: number | undefined;
  /** The captured local preview, kept across the upload's URL swap. */
  preview: string | undefined;
}

function initialState(url: string, preview: string | undefined): RetryState {
  return {
    url,
    nonce: 0,
    loaded: false,
    failed: false,
    remaining: MEDIA_RETRY_DELAYS_MS.length,
    pending: undefined,
    preview: isLocalPreviewUrl(url) ? url : preview,
  };
}

/** The state for `url`: an entry from another URL restarts the attempts but
 * keeps the captured local preview. */
function atUrl(state: RetryState, url: string): RetryState {
  return state.url === url ? state : initialState(url, state.preview);
}

export interface MediaRetry {
  /** The image source for this attempt (the proxied URL carries the retry counter). */
  src: string;
  /** The outgoing preview to keep showing until the remote image loads, if any. */
  preview: string | undefined;
  /** True once the remote loaded. */
  loaded: boolean;
  /** True once every attempt failed and no preview is left to show. */
  unavailable: boolean;
  onLoad: () => void;
  onError: () => void;
  /** Restarts the attempts (the Retry button on the tile). */
  retry: () => void;
}

/**
 * The web image-load state machine (T-1337). It keys `src` on the message URL,
 * retries an `/api/files` 404 with backoff through a cache-busting counter, and
 * keeps a captured local preview on screen until the remote image has loaded,
 * so a just-sent photo never sticks on "Image unavailable".
 */
export function useMediaRetry(chatId: string, url: string): MediaRetry {
  const source = mediaSrc(chatId, url);
  // Only a same-origin upload routes through `/api/files` (a `blob:` or a
  // peer's URL is loaded directly), and only that fetch may be retried.
  const retryable = source !== url;
  const [state, setState] = useState<RetryState>(() => initialState(url, undefined));
  // A URL change resets the attempts but keeps the preview: derive it during
  // render so the first paint after the swap is already correct.
  const active = atUrl(state, url);

  // A pending retry fires after its backoff, as an Effect fiber; a URL change
  // or unmount interrupts it. The state update runs in the fiber's callback,
  // never synchronously in the effect.
  useEffect(() => {
    if (active.pending === undefined) {
      return;
    }
    const fiber = Effect.runFork(
      Effect.sleep(active.pending).pipe(
        Effect.andThen(
          Effect.sync(() =>
            setState((previous) => {
              const base = atUrl(previous, url);
              return { ...base, nonce: base.nonce + 1, pending: undefined };
            }),
          ),
        ),
      ),
    );
    return () => {
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [active.pending, url]);

  const onLoad = useCallback(() => {
    setState((previous) => {
      const base = atUrl(previous, url);
      return {
        ...base,
        loaded: true,
        failed: false,
        pending: undefined,
        // Only the remote bytes end the preview: the local `blob:` preview's
        // own load must not drop it before the upload's URL arrives.
        preview: isLocalPreviewUrl(url) ? base.preview : undefined,
      };
    });
  }, [url]);

  const onError = useCallback(() => {
    setState((previous) => {
      const base = atUrl(previous, url);
      // One load can report more than one error; only the first schedules.
      if (base.pending !== undefined) {
        return base;
      }
      if (!retryable || base.remaining <= 0) {
        return { ...base, failed: true };
      }
      const index = MEDIA_RETRY_DELAYS_MS.length - base.remaining;
      const delay = MEDIA_RETRY_DELAYS_MS[index] ?? MEDIA_RETRY_DELAYS_MS.at(-1) ?? 1000;
      return { ...base, remaining: base.remaining - 1, pending: delay };
    });
  }, [url, retryable]);

  const retry = useCallback(() => {
    setState((previous) => {
      const base = atUrl(previous, url);
      return {
        ...base,
        remaining: MEDIA_RETRY_DELAYS_MS.length,
        failed: false,
        pending: undefined,
        nonce: base.nonce + 1,
      };
    });
  }, [url]);

  return {
    src: retryable && active.nonce > 0 ? `${source}&retry=${active.nonce}` : source,
    preview: active.preview,
    loaded: active.loaded,
    unavailable: active.failed && active.preview === undefined,
    onLoad,
    onError,
    retry,
  };
}

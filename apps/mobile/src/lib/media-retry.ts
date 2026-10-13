import { Effect, Fiber } from 'effect';
import { useCallback, useEffect, useState } from 'react';

/**
 * The backoff between remote image load attempts (T-1337), the native twin of
 * `apps/web/src/lib/media-retry.ts`. A just-sent upload is served before the
 * server has indexed it, so the first requests answer 404; the bubble retries
 * four times at about 1 s, 2 s, 4 s and 8 s while its local `file://` preview
 * stays on screen.
 */
export const MEDIA_RETRY_DELAYS_MS: readonly number[] = [1000, 2000, 4000, 8000];

/** Appends a cache-busting counter so a retried source is not served from cache. */
export function withMediaRetry(url: string, retry: number): string {
  if (retry <= 0 || url === '') {
    return url;
  }
  return `${url}${url.includes('?') ? '&' : '?'}retry=${retry}`;
}

interface RetryState {
  /** The remote URL this state belongs to. */
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
  /** The captured `file://` preview, kept across the upload's URL swap. */
  preview: string | undefined;
}

function initialState(url: string, localUri: string | undefined): RetryState {
  return {
    url,
    nonce: 0,
    loaded: false,
    failed: false,
    remaining: MEDIA_RETRY_DELAYS_MS.length,
    pending: undefined,
    preview: localUri === undefined || localUri === '' ? undefined : localUri,
  };
}

/** The state for `url`: an entry from another URL restarts the attempts but
 * keeps the captured local preview. */
function atUrl(state: RetryState, url: string, localUri: string | undefined): RetryState {
  return state.url === url ? state : initialState(url, localUri);
}

export interface MobileMediaRetry {
  /** The local preview to keep on screen until the remote image loads, if any. */
  localUri: string | undefined;
  /** The cache-busting counter to apply to the remote source. */
  retry: number;
  /** True once the remote loaded. */
  loaded: boolean;
  /** True once every attempt failed (with no preview left to show). */
  failed: boolean;
  onLoad: () => void;
  onError: () => void;
  /** Restarts the attempts (the Retry control). */
  restart: () => void;
}

/**
 * The native image-load state machine (T-1337): keeps the last `file://`
 * preview until the remote bytes load, retries a failed fetch with backoff
 * through a cache-busting counter, and reports a final failure so the bubble
 * can show its load-failed row with a Retry.
 */
export function useMediaRetry(url: string, localUri: string | undefined): MobileMediaRetry {
  const [state, setState] = useState<RetryState>(() => initialState(url, localUri));
  // A URL change resets the attempts but keeps the preview: derive it during
  // render so the first paint after the swap is already correct.
  const active = atUrl(state, url, localUri);

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
              const base = atUrl(previous, url, localUri);
              return { ...base, nonce: base.nonce + 1, pending: undefined };
            }),
          ),
        ),
      ),
    );
    return () => {
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [active.pending, url, localUri]);

  const onLoad = useCallback(() => {
    setState((previous) => ({
      ...atUrl(previous, url, localUri),
      loaded: true,
      failed: false,
      pending: undefined,
      preview: undefined,
    }));
  }, [url, localUri]);

  const onError = useCallback(() => {
    setState((previous) => {
      const base = atUrl(previous, url, localUri);
      // One load can report more than one error; only the first schedules.
      if (base.pending !== undefined) {
        return base;
      }
      if (base.remaining <= 0) {
        return { ...base, failed: true };
      }
      const index = MEDIA_RETRY_DELAYS_MS.length - base.remaining;
      const delay = MEDIA_RETRY_DELAYS_MS[index] ?? MEDIA_RETRY_DELAYS_MS.at(-1) ?? 1000;
      return { ...base, remaining: base.remaining - 1, pending: delay };
    });
  }, [url, localUri]);

  const restart = useCallback(() => {
    setState((previous) => {
      const base = atUrl(previous, url, localUri);
      return {
        ...base,
        remaining: MEDIA_RETRY_DELAYS_MS.length,
        failed: false,
        pending: undefined,
        nonce: base.nonce + 1,
      };
    });
  }, [url, localUri]);

  return {
    localUri: active.loaded ? undefined : active.preview,
    retry: active.nonce,
    loaded: active.loaded,
    failed: active.failed,
    onLoad,
    onError,
    restart,
  };
}

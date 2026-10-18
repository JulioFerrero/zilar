import { withMediaRetry } from '@zilar/chat-core';
import { Effect, Fiber } from 'effect';
import { useCallback, useEffect, useState } from 'react';

/**
 * The backoff between media load attempts: a just-sent upload is served before the
 * server has indexed it, so the first requests answer 404. Four attempts at about 1 s,
 * 2 s, 4 s and 8 s.
 */
export const MEDIA_RETRY_DELAYS_MS: readonly number[] = [1000, 2000, 4000, 8000];

/**
 * A local preview URL to keep showing until the remote bytes arrive: the upload's `blob:`
 * URL, a `data:` image, or an explicit native `file://` preview.
 */
export function isLocalPreviewUrl(url: string): boolean {
  return url.startsWith('blob:') || url.startsWith('data:');
}

export interface MediaRetryState {
  url: string;
  nonce: number;
  loaded: boolean;
  failed: boolean;
  remaining: number;
  pending: number | undefined;
  preview: string | undefined;
}

export function initialMediaRetryState(url: string, preview: string | undefined): MediaRetryState {
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

export function mediaRetryAtUrl(state: MediaRetryState, url: string): MediaRetryState {
  return state.url === url ? state : initialMediaRetryState(url, state.preview);
}

export function mediaRetryAdvance(state: MediaRetryState, url: string): MediaRetryState {
  const base = mediaRetryAtUrl(state, url);
  return { ...base, nonce: base.nonce + 1, pending: undefined };
}

export function mediaRetryOnLoad(state: MediaRetryState, url: string): MediaRetryState {
  const base = mediaRetryAtUrl(state, url);
  return {
    ...base,
    loaded: true,
    failed: false,
    pending: undefined,
    // Only the remote bytes end the preview: the local preview's own load must not
    // drop it before the upload's URL arrives.
    preview: isLocalPreviewUrl(url) ? base.preview : undefined,
  };
}

export function mediaRetryOnError(
  state: MediaRetryState,
  url: string,
  retryable: boolean,
): MediaRetryState {
  const base = mediaRetryAtUrl(state, url);
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
}

export function mediaRetryRestart(state: MediaRetryState, url: string): MediaRetryState {
  const base = mediaRetryAtUrl(state, url);
  return {
    ...base,
    remaining: MEDIA_RETRY_DELAYS_MS.length,
    failed: false,
    pending: undefined,
    nonce: base.nonce + 1,
  };
}

export function isMediaRetryUnavailable(state: MediaRetryState): boolean {
  return state.failed && state.preview === undefined;
}

export interface MediaRetryOptions {
  url: string;
  preview?: string | undefined;
  /** Whether a failed load is retried; a direct (peer) URL is not. */
  retryable?: boolean;
}

export interface MediaRetryResult {
  src: string;
  preview: string | undefined;
  loaded: boolean;
  unavailable: boolean;
  attempt: number;
  onLoad: () => void;
  onError: () => void;
  retry: () => void;
}

/**
 * The shared image-load state machine: it keys `src` on the message URL, retries a
 * failed fetch with backoff through a cache-busting counter, and keeps a captured local
 * preview until the remote image loads, so a just-sent photo never sticks on "Image
 * unavailable". The web and mobile hooks are thin adapters.
 */
export function useMediaRetry({
  url,
  preview,
  retryable = true,
}: MediaRetryOptions): MediaRetryResult {
  const [state, setState] = useState<MediaRetryState>(() => initialMediaRetryState(url, preview));
  // A URL change resets the attempts but keeps the preview: derive it during render so
  // the first paint after the swap is already correct.
  const active = mediaRetryAtUrl(state, url);

  // A pending retry fires after its backoff, as an Effect fiber; a URL change or unmount
  // interrupts it. The state update runs in the fiber's callback, never synchronously in
  // the effect.
  useEffect(() => {
    if (active.pending === undefined) {
      return;
    }
    const fiber = Effect.runFork(
      Effect.sleep(active.pending).pipe(
        Effect.andThen(Effect.sync(() => setState((previous) => mediaRetryAdvance(previous, url)))),
      ),
    );
    return () => {
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [active.pending, url]);

  const onLoad = useCallback(() => {
    setState((previous) => mediaRetryOnLoad(previous, url));
  }, [url]);

  const onError = useCallback(() => {
    setState((previous) => mediaRetryOnError(previous, url, retryable));
  }, [url, retryable]);

  const retry = useCallback(() => {
    setState((previous) => mediaRetryRestart(previous, url));
  }, [url]);

  return {
    src: retryable ? withMediaRetry(url, active.nonce) : url,
    preview: active.preview,
    loaded: active.loaded,
    unavailable: isMediaRetryUnavailable(active),
    attempt: active.nonce,
    onLoad,
    onError,
    retry,
  };
}

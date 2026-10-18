import { withMediaRetry } from '@zilar/chat-core';
import { Effect, Fiber } from 'effect';
import { useCallback, useEffect, useState } from 'react';

/**
 * The backoff between media load attempts (T-1337). A just-sent upload is
 * served before the server has indexed it, so the first requests answer 404;
 * the bubble retries four times at about 1 s, 2 s, 4 s and 8 s.
 */
export const MEDIA_RETRY_DELAYS_MS: readonly number[] = [1000, 2000, 4000, 8000];

/**
 * A local preview URL the bubble can keep showing until the remote bytes
 * arrive: the outgoing upload's `blob:` object URL, or a `data:` image. A
 * native `file://` preview is passed in explicitly, so it is captured too.
 */
export function isLocalPreviewUrl(url: string): boolean {
  return url.startsWith('blob:') || url.startsWith('data:');
}

/** The pure state behind `useMediaRetry`, kept apart so it is testable. */
export interface MediaRetryState {
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

/** The state for `url`: an entry from another URL restarts the attempts but
 * keeps the captured local preview. */
export function mediaRetryAtUrl(state: MediaRetryState, url: string): MediaRetryState {
  return state.url === url ? state : initialMediaRetryState(url, state.preview);
}

/** The state after a scheduled backoff elapsed: the next attempt starts. */
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
    // Only the remote bytes end the preview: the local preview's own load
    // must not drop it before the upload's URL arrives.
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

/** Restarts the attempts, keeping the captured local preview. */
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

/** True only when every attempt failed and no preview is left to show. */
export function isMediaRetryUnavailable(state: MediaRetryState): boolean {
  return state.failed && state.preview === undefined;
}

export interface MediaRetryOptions {
  /** The image source to load (already proxied on web). */
  url: string;
  /** A local preview to keep on screen until the remote image loads. */
  preview?: string | undefined;
  /** Whether a failed load is retried; a direct (peer) URL is not. */
  retryable?: boolean;
}

export interface MediaRetryResult {
  /** The image source for this attempt (the URL carries the retry counter). */
  src: string;
  /** The local preview to keep showing until the remote image loads, if any. */
  preview: string | undefined;
  /** True once the remote loaded. */
  loaded: boolean;
  /** True once every attempt failed and no preview is left to show. */
  unavailable: boolean;
  /** The cache-busting counter of the current attempt. */
  attempt: number;
  onLoad: () => void;
  onError: () => void;
  /** Restarts the attempts (the Retry control). */
  retry: () => void;
}

/**
 * The shared image-load state machine (T-1337, W1-j). It keys `src` on the
 * message URL, retries a failed fetch with backoff through a cache-busting
 * counter, and keeps a captured local preview on screen until the remote
 * image has loaded, so a just-sent photo never sticks on "Image unavailable".
 * The web and mobile hooks are thin adapters over this one.
 */
export function useMediaRetry({
  url,
  preview,
  retryable = true,
}: MediaRetryOptions): MediaRetryResult {
  const [state, setState] = useState<MediaRetryState>(() => initialMediaRetryState(url, preview));
  // A URL change resets the attempts but keeps the preview: derive it during
  // render so the first paint after the swap is already correct.
  const active = mediaRetryAtUrl(state, url);

  // A pending retry fires after its backoff, as an Effect fiber; a URL change
  // or unmount interrupts it. The state update runs in the fiber's callback,
  // never synchronously in the effect.
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

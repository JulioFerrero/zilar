import { withMediaRetry } from '@zilar/chat-core';
import { MEDIA_RETRY_DELAYS_MS, useMediaRetry as useSharedMediaRetry } from '@zilar/client-core';

export { MEDIA_RETRY_DELAYS_MS, withMediaRetry };

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
 * The native adapter over the shared hook (T-1337, W1-j). The captured
 * `file://` preview is kept across the upload's URL swap and reported as
 * failed only when every attempt is spent and no preview is left to show.
 */
export function useMediaRetry(url: string, localUri: string | undefined): MobileMediaRetry {
  const media = useSharedMediaRetry({ url, preview: localUri });
  return {
    localUri: media.loaded ? undefined : media.preview,
    retry: media.attempt,
    loaded: media.loaded,
    failed: media.unavailable,
    onLoad: media.onLoad,
    onError: media.onError,
    restart: media.retry,
  };
}

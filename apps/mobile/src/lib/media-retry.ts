import { withMediaRetry } from '@zilar/chat-core';
import { MEDIA_RETRY_DELAYS_MS, useMediaRetry as useSharedMediaRetry } from '@zilar/client-core';

export { MEDIA_RETRY_DELAYS_MS, withMediaRetry };

export interface MobileMediaRetry {
  localUri: string | undefined;
  retry: number;
  loaded: boolean;
  failed: boolean;
  onLoad: () => void;
  onError: () => void;
  restart: () => void;
}

/**
 * The captured `file://` preview is kept across the upload's URL swap and reported failed only when every attempt is spent.
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

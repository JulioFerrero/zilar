import { useMediaRetry as useSharedMediaRetry, type MediaRetryResult } from '@zilar/client-core';
import { mediaSrc } from './attachments';

export { MEDIA_RETRY_DELAYS_MS, isLocalPreviewUrl } from '@zilar/client-core';

export type MediaRetry = MediaRetryResult;

/** Only a same-origin upload routes through /api/files, and only that fetch may be retried;
 * a blob: or a peer's URL is loaded directly. */
export function useMediaRetry(chatId: string, url: string): MediaRetry {
  const source = mediaSrc(chatId, url);
  return useSharedMediaRetry({ url: source, retryable: source !== url });
}

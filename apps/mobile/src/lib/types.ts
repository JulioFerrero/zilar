export const CURRENT_USER_ID = 'me';

/**
 * Only backs the older `topicInFolder` helper; server folders match through `chat-core`'s `ChatFolder`.
 */
export type LegacyFolder = 'all' | 'personal' | 'ai' | 'work';

export type ChatFolder = LegacyFolder;

import type { UiMessage } from '@zilar/chat-core';

/**
 * `localUri` is the `file://` preview shown while the bytes upload, and `uploadProgress` is 0..1; both are cleared when the upload settles and never go on the wire.
 */
export type MobileMessage = UiMessage & {
  localUri?: string | undefined;
  uploadProgress?: number | undefined;
};

export function mobileUploadOf(message: UiMessage): {
  localUri?: string | undefined;
  uploadProgress?: number | undefined;
} {
  const candidate = message as Partial<MobileMessage>;
  const localUri = typeof candidate.localUri === 'string' ? candidate.localUri : undefined;
  const progress = candidate.uploadProgress;
  return {
    ...(localUri === undefined ? {} : { localUri }),
    ...(typeof progress === 'number' && Number.isFinite(progress)
      ? { uploadProgress: progress }
      : {}),
  };
}

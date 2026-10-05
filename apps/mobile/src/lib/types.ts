/** The signed-in user until real auth lands (T-0015). */
export const CURRENT_USER_ID = 'me';
export const CURRENT_USER_NAME = 'You';

/**
 * The pre-server mobile folder keys (T-0135). Chat folders now come from the
 * server (T-0248) and match through `chat-core`'s `ChatFolder`; this union
 * only backs the older `topicInFolder` helper.
 */
export type LegacyFolder = 'all' | 'personal' | 'ai' | 'work';

/** @deprecated Use `LegacyFolder`. Kept for `lib/topics.ts`'s `topicInFolder`. */
export type ChatFolder = LegacyFolder;

export type {
  AiStatus,
  ChatKind,
  ChatSummary,
  MessageStatus,
  ReplyRef,
  UiImage,
  UiMessage,
} from '@zilar/chat-core';

import type { UiMessage } from '@zilar/chat-core';

/**
 * A mobile chat message: the shared `UiMessage` plus local-only upload state
 * (T-0150). `localUri` is the `file://` preview shown while the bytes
 * upload; `uploadProgress` is 0..1 while the PUT runs. Both are cleared
 * when the upload settles and never go on the wire. Every consumer that
 * reads or writes these fields uses this alias instead of widening the
 * shared `UiMessage`.
 */
export type MobileMessage = UiMessage & {
  localUri?: string | undefined;
  uploadProgress?: number | undefined;
};

/** Type guard for the local-only upload fields (unknown or drifted data). */
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

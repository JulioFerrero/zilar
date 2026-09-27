/** The signed-in user until real auth lands (T-0015). */
export const CURRENT_USER_ID = 'me';
export const CURRENT_USER_NAME = 'You';

/** The mobile folder tabs; `chat-core` has no folder concept. */
export type ChatFolder = 'all' | 'personal' | 'ai' | 'work';

export type {
  AiStatus,
  ChatKind,
  ChatSummary,
  MessageStatus,
  ReplyRef,
  UiImage,
  UiMessage,
} from '@galena/chat-core';

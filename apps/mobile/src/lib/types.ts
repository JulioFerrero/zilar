import type { Payload, VoiceMeta } from '@galena/protocol';

/** The signed-in user until real auth lands (T-0015). */
export const CURRENT_USER_ID = 'me';
export const CURRENT_USER_NAME = 'You';

export type ChatKind = 'dm' | 'group' | 'ai';

export type ChatSpace = 'personal' | 'work';

export type ChatFolder = 'all' | 'personal' | 'ai' | 'work';

export type MessageStatus = 'sending' | 'sent' | 'read';

export type AiStatus = 'idle' | 'working';

export type UiImage = {
  url: string;
  width: number;
  height: number;
};

export type UiReply = {
  senderName: string;
  excerpt: string;
};

export type UiMessage = {
  id: string;
  chatId: string;
  senderId: string;
  senderName: string;
  text?: string;
  createdAt: string;
  status: MessageStatus;
  replyTo?: UiReply;
  voice?: VoiceMeta;
  image?: UiImage;
  card?: Payload;
};

export type ChatSummary = {
  id: string;
  title: string;
  kind: ChatKind;
  isAI: boolean;
  space: ChatSpace;
  avatarUrl?: string;
  unread: number;
  muted: boolean;
  lastMessage?: UiMessage;
  online?: boolean;
  lastSeenAt?: string;
  memberCount?: number;
  onlineCount?: number;
  aiStatus?: AiStatus;
};

import type { Payload, VoiceMeta } from '@galena/protocol';

export type ChatKind = 'dm' | 'group' | 'ai';

export type Space = 'personal' | 'work';

export type MessageStatus = 'sending' | 'sent' | 'read';

export type AiStatus = 'idle' | 'working';

export interface UiImage {
  url: string;
  width: number;
  height: number;
}

export interface ReplyRef {
  id: string;
  senderName: string;
  text?: string;
}

/** A member who can be mentioned in a group: a bare JID and a display name. */
export interface MentionMember {
  jid: string;
  name: string;
}

/** One rendered mention on a message, with offsets into its text. */
export interface UiMention {
  jid: string;
  name: string;
  /** Start offset in UTF-16 code units. */
  begin: number;
  /** End offset (exclusive) in UTF-16 code units. */
  end: number;
}

export interface UiMessage {
  id: string;
  chatId: string;
  senderId: string;
  senderName: string;
  text?: string;
  createdAt: Date;
  status: MessageStatus;
  replyTo?: ReplyRef;
  mentions?: UiMention[];
  voice?: VoiceMeta;
  image?: UiImage;
  card?: Payload;
  /** XEP-0444 reaction chips, newest state first-used; empty/absent means none. */
  reactions?: UiReaction[];
}

/** One reaction chip shown under a bubble: an emoji, its count and my state. */
export interface UiReaction {
  emoji: string;
  count: number;
  /** True when my own reaction is one of them. */
  mine: boolean;
  /** Display names of the reactors, in first-reacted order. */
  reactors: string[];
}

export interface ChatSummary {
  id: string;
  title: string;
  kind: ChatKind;
  isAI: boolean;
  space: Space;
  avatarUrl?: string;
  unread: number;
  muted: boolean;
  lastMessage?: UiMessage;
  online?: boolean;
  onlineCount?: number;
  memberCount?: number;
  aiStatus?: AiStatus;
  lastSeenAt?: Date;
}

export interface DateSeparatorItem {
  kind: 'separator';
  id: string;
  date: Date;
}

export interface MessageItem {
  kind: 'message';
  message: UiMessage;
  firstInGroup: boolean;
  lastInGroup: boolean;
}

export type RenderItem = DateSeparatorItem | MessageItem;

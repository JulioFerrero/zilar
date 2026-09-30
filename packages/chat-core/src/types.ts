import type { Attachment, Payload, VoiceMeta } from '@galena/protocol';

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
  /** A file or image sent with the `attachment` payload (T-0065). */
  attachment?: Attachment;
  card?: Payload;
  /**
   * True when an outgoing attachment could not be uploaded. The message keeps
   * its local data and shows a Retry action instead of a "sending" state.
   */
  failed?: boolean;
  /** XEP-0444 reaction chips, newest state first-used; empty/absent means none. */
  reactions?: UiReaction[];
  /** True when the message was corrected (XEP-0308) after it was sent. */
  edited?: boolean;
  /**
   * True when the message was retracted for everyone (XEP-0424). A deleted
   * message carries no text, payload or reactions.
   */
  deleted?: boolean;
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

export type TopicKind = 'chat' | 'task' | 'bug' | 'ui' | 'routine';

export type TopicStatus = 'open' | 'in_progress' | 'in_review' | 'blocked' | 'done';

export type TopicVisibility = 'public' | 'private';

export interface TopicOwner {
  kind: 'user' | 'ai';
  id: string;
  name: string;
}

/**
 * The task strip of a group topic (T-0111). Present only on chats that are
 * topics; absent on DMs and AI chats. The General topic carries `isGeneral`
 * and its chat id is the group's old chat id, so old `/c/<jid>` links open it.
 */
export interface TopicInfo {
  id: string;
  glyph: string;
  kind: TopicKind;
  status: TopicStatus;
  visibility: TopicVisibility;
  isGeneral: boolean;
  archived: boolean;
  owner: TopicOwner | null;
  linkUrl: string | null;
  linkLabel: string | null;
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
  /** The group this topic belongs to; set on every topic chat. */
  groupId?: string;
  /**
   * The group's title, for the `Group › Topic` breadcrumb until the group
   * detail loads. Never a private topic's name: this row is only ever
   * created for topics the server returned as visible to the viewer.
   */
  groupTitle?: string;
  /** Present when the chat is a group topic (T-0111). */
  topic?: TopicInfo;
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

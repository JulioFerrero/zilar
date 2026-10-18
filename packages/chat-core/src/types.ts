import type { Attachment, ForwardOrigin, Payload, VoiceMeta } from '@zilar/protocol';

export type ChatKind = 'dm' | 'group' | 'ai';

export type Space = 'personal' | 'work';

export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

// Fixed, user-safe buckets: raw error text, URLs and tokens never reach the UI or the logs. A failed message keeps its local blob so it can be retried.
export type SendFailureReason =
  | 'too_large'
  | 'unsupported_file'
  | 'server_unavailable'
  | 'upload_refused'
  | 'network'
  | 'timed_out';

export type AiStatus = 'idle' | 'working';

export interface UiImage {
  url: string;
  width: number;
  height: number;
}

export interface AlbumRef {
  id: string;
  index: number;
  count: number;
}

export interface ReplyRef {
  id: string;
  senderName: string;
  // Lets a quote colour by the sender even before the replied-to message is loaded.
  senderId?: string;
  text?: string;
}

export interface MentionMember {
  jid: string;
  name: string;
  handle?: string | undefined;
}

export interface UiMention {
  jid: string;
  name: string;
  begin: number;
  end: number;
}

export interface UiMessage {
  id: string;
  // The XEP-0359 origin id; a DM card is recorded under it.
  originId?: string | undefined;
  chatId: string;
  senderId: string;
  senderName: string;
  text?: string;
  createdAt: Date;
  status: MessageStatus;
  replyTo?: ReplyRef;
  forward?: ForwardOrigin;
  mentions?: UiMention[];
  voice?: VoiceMeta;
  image?: UiImage;
  attachment?: Attachment;
  album?: AlbumRef;
  card?: Payload;
  // Instead of a sending state, the message keeps its local data and shows a Retry action.
  failed?: boolean;
  // Always a fixed `SendFailureReason`, never raw error text.
  failureReason?: SendFailureReason;
  reactions?: UiReaction[];
  archiveId?: string;
  edited?: boolean;
  editedAt?: Date;
  deleted?: boolean;
}

export interface UiReaction {
  emoji: string;
  count: number;
  mine: boolean;
  reactors: string[];
}

export type TopicVisibility = 'public' | 'private';

export type TopicAiState = 'working' | 'waiting' | 'done';

export interface TopicAiActivity {
  aiId: string;
  name: string;
  jid?: string;
  avatarUrl?: string;
  questionId?: string;
  state: TopicAiState;
}

export interface TopicInfoAi {
  id: string;
  name: string;
  avatarUrl?: string;
  jid?: string;
}

// The General topic carries `isGeneral` and its chat id is the group's old chat id, so old `/c/<jid>` links open it.
export interface TopicInfo {
  id: string;
  glyph: string;
  visibility: TopicVisibility;
  isGeneral: boolean;
  archived: boolean;
  doneAt: string | null;
  linkUrl: string | null;
  linkLabel: string | null;
  activity: TopicAiActivity[];
  memberIds?: string[];
  ais?: TopicInfoAi[];
}

export interface ChatSummary {
  id: string;
  title: string;
  kind: ChatKind;
  isAI: boolean;
  space: Space;
  avatarUrl?: string;
  unread: number;
  unreadMark?: boolean;
  muted: boolean;
  // A new message never auto-unarchives: archived chats stay archived until the user unarchives them.
  archived?: boolean;
  pinnedAt?: Date;
  lastMessage?: UiMessage;
  // A chat with no `lastMessage` sorts by this, so it leads the list like Telegram instead of sinking to the bottom.
  createdAt?: Date;
  // The delivered mark the server reported, an archive id in the caller's own-message terms; absent when nobody confirmed yet.
  deliveredUntil?: string;
  // The peer's read mark the server reported, an archive id in the caller's own-message terms; absent until the peer has read.
  readUntil?: string;
  online?: boolean;
  onlineCount?: number;
  memberCount?: number;
  // `channel` is the broadcast feed (its General topic), where only admins post. Absent = group.
  chatKind?: 'group' | 'channel';
  subscriberCount?: number;
  description?: string | null;
  visibility?: 'private' | 'public';
  handle?: string | null;
  myRole?: 'owner' | 'admin' | 'member';
  aiStatus?: AiStatus;
  lastSeenAt?: Date;
  groupId?: string;
  groupTitle?: string;
  topic?: TopicInfo;
  groupBackground?: {
    backgroundPreset: string | null;
    backgroundImageId: string | null;
    backgroundDim: number | null;
  };
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

// The album's first photo, so a list that only knows how to draw a message bubble keeps working.
export interface AlbumItem {
  kind: 'album';
  message: UiMessage;
  messages: UiMessage[];
  count: number;
  firstInGroup: boolean;
  lastInGroup: boolean;
}

export type RenderItem = DateSeparatorItem | MessageItem | AlbumItem;

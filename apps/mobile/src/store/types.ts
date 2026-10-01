import type {
  ChatSummary,
  EditsState,
  ReactionsState,
  ReplyRef,
  UiMessage,
} from '@galena/chat-core';

import type { Contact, GroupDetail, Me } from '../lib/chat-api';
import type {
  CreatedInviteLink,
  CreateGroupInviteLinkInput,
  GroupInviteLink,
  JoinPreview,
  JoinResult,
} from '../lib/invite-links-api';
import type { PickedFile } from '../lib/attachment-ports';
import type { CustomGroupRole } from '../lib/roles-api';
import type {
  ApproverRole,
  CreateTopicInput,
  PatchTopicInput,
  SetTopicRolesInput,
  TopicRole,
} from '../lib/topics-api';
import type { PutChatPrefInput } from '../lib/chat-prefs-api';
import type { Pin } from '../lib/pins-api';
import type { ChatFolder } from '../lib/types';

/** Connection state shown by the thin "Connecting…" bar in the chat list. */
export type ConnectionStatus = 'offline' | 'connecting' | 'online' | 'reconnecting';

export type TypingState = {
  names: string[];
};

export type SendTextOptions = {
  replyTo?: ReplyRef;
};

/** Options for `sendAttachment`: a caption and an optional reply, like web. */
export type SendAttachmentOptions = {
  caption?: string;
  replyTo?: ReplyRef;
};

/** The tap-to-send choice the sticker panel hands to the store. */
export type SendStickerChoice = {
  stickerId: string;
  packId: string;
  url: string;
  emoji?: string | undefined;
  width: number;
  height: number;
  mime: 'image/webp' | 'image/png';
};

/**
 * A quiet load state (T-0067): `loading` until the data has actually arrived,
 * `error` when it failed, `loaded` once it is known. "empty" is not a load
 * state; it is what a finished load with no rows looks like.
 */
export type LoadState = 'loading' | 'loaded' | 'error';

/** The live AI draft of one chat: the latest cumulative reply text. */
export type DraftState = {
  turnId: string;
  text: string;
};

/**
 * The list key of a message (T-0056). A message that finished a draft keeps the
 * draft's `draft-<turnId>` key, so the bubble component is reused and its reveal
 * carries over instead of snapping in as a new message.
 */
export function draftEntryKey(
  messageId: string,
  finishedDraftMessages: Record<string, string>,
): string {
  const turnId = finishedDraftMessages[messageId];
  return turnId === undefined ? messageId : `draft-${turnId}`;
}

/** What the chat list shows for its current load state and row count. */
export type ChatsListView = 'skeleton' | 'error' | 'empty' | 'list';

/**
 * The chat list's view state (T-0067): a load that has never shown rows gets
 * the skeleton, a failure with no rows the centered Retry, and the empty text
 * only once a load has settled. Rows already shown keep the list.
 */
export function chatsListView(load: LoadState, chatCount: number): ChatsListView {
  if (chatCount > 0) {
    return 'list';
  }
  if (load === 'loading') {
    return 'skeleton';
  }
  if (load === 'error') {
    return 'error';
  }
  return 'empty';
}

/** What the chat screen shows for its current load state and message count. */
export type MessagesListView = 'skeleton' | 'error' | 'empty' | 'messages';

/** The message list's view state (T-0067); live messages override loading. */
export function messagesListView(load: LoadState, messageCount: number): MessagesListView {
  if (messageCount > 0) {
    return 'messages';
  }
  if (load === 'loading') {
    return 'skeleton';
  }
  if (load === 'error') {
    return 'error';
  }
  return 'empty';
}

/**
 * The empty-list text. A filtered or searched list that matched nothing says
 * "No chats found"; a list with no chats at all says "No chats yet" (T-0067).
 */
export function emptyChatsText(chatCount: number): string {
  return chatCount === 0 ? 'No chats yet' : 'No chats found';
}

/**
 * The state and actions the mobile screens use. Both the mock store and the
 * real store implement it, so the components do not care which one is running.
 */
export interface ChatStoreState {
  currentUserId: string;
  me?: Me;
  status: ConnectionStatus;
  /**
   * The first chat-list load (T-0067). `error` keeps any chats already shown,
   * so a failed refresh never blanks a list the user is looking at.
   */
  chatsLoad: LoadState;
  chats: ChatSummary[];
  contacts: Contact[];
  messagesByChat: Record<string, UiMessage[]>;
  /** The first history page of each chat, by chat id (T-0067). */
  historyLoad: Record<string, LoadState>;
  search: string;
  activeFolder: ChatFolder;
  activeChatId: string | null;
  historyComplete: Record<string, boolean>;
  typing: Record<string, TypingState>;
  /**
   * Edit state (XEP-0308 corrections and XEP-0424 retractions) per chat id.
   * The store canonicalises every target through its alias map before calling
   * the reducers, and updates that arrive before their target stays pending.
   */
  edits: Record<string, EditsState>;
  /**
   * Reaction state (XEP-0444) per chat id. The store canonicalises every
   * target through its alias map before applying an update.
   */
  reactions: Record<string, ReactionsState>;
  /**
   * Live AI reply drafts by chat id (the AI's bare JID), from
   * `/api/drafts/stream` (T-0056). Empty when no AI is writing.
   */
  drafts: Record<string, DraftState>;
  /**
   * Message id -> the draft turn it replaced (T-0056). The final message keeps
   * rendering on the draft's key so its reveal continues instead of snapping.
   */
  finishedDraftMessages: Record<string, string>;
  /** The message the composer is currently editing, or undefined when idle. */
  editTarget?: { chatId: string; messageId: string };
  /** A user-facing failure from a recent edit/delete (T-0085). */
  actionError?: { chatId: string; message: string };
  /**
   * The hostnames attachment rendering auto-loads from (T-0150, the mobile
   * twin of web's `mediaTrustedHosts`): the XMPP service host, the XMPP
   * domain and `upload.<domain>`, from the latest XMPP token. Undefined
   * until the token arrives; the bubble then trusts nothing.
   */
  mediaTrustedHosts?: ReadonlySet<string>;
  messages: (chatId: string) => UiMessage[];
  hasMore: (chatId: string) => boolean;
  openChat: (chatId: string) => void;
  /**
   * Opens a chat and waits until `messageId` is loaded, paging backwards at
   * most `MESSAGE_JUMP_MAX_PAGES` history pages (T-0138, like web's
   * `openAtMessage`). Returns the message once it is loaded so the screen
   * can scroll to it, or throws `message_not_found` when history runs out.
   */
  openAtMessage: (chatId: string, messageId: string) => Promise<UiMessage>;
  /**
   * The message a search hit asked to land on. Set by `openAtMessage` once
   * the message is loaded; the chat screen scrolls to it, then clears it.
   */
  jumpTarget?: { chatId: string; messageId: string };
  /** Clears `jumpTarget` after the chat screen has scrolled to it. */
  clearJumpTarget: () => void;
  loadOlder: (chatId: string) => void;
  /** Refetch the chat list (pull-to-refresh and the list's Retry key). */
  reloadChats: () => void;
  /** Retry the first history page of a chat after it failed. */
  retryHistory: (chatId: string) => void;
  sendText: (chatId: string, text: string, options?: SendTextOptions) => void;
  sendTyping: (chatId: string) => void;
  /** Sends a picked file as an attachment payload in the chat (T-0150). */
  sendAttachment: (chatId: string, file: PickedFile, options?: SendAttachmentOptions) => void;
  /** Retries a failed attachment send (the bytes are kept for the retry). */
  retryAttachment: (chatId: string, messageId: string) => void;
  /** Cancels the in-flight upload of an attachment send. */
  cancelAttachment: (chatId: string, messageId: string) => void;
  /** Sends a sticker payload in the chat (same path as other payload messages). */
  sendSticker: (chatId: string, sticker: SendStickerChoice, options?: SendTextOptions) => void;
  /** Retries a failed sticker send (the payload is already on the message). */
  retrySticker: (chatId: string, messageId: string) => void;
  /** Toggle my reaction of `emoji` on a message (XEP-0444). */
  react: (chatId: string, messageId: string, emoji: string) => void;
  /** Begin editing `messageId`: composer switches to edit mode with its text. */
  startEdit: (chatId: string, messageId: string) => void;
  /** Cancel the current edit without sending anything. */
  cancelEdit: () => void;
  /** Save the edited text and send a XEP-0308 correction. */
  editMessage: (chatId: string, messageId: string, text: string) => void;
  /** Send a XEP-0424 retraction ("delete for everyone"). */
  deleteForEveryone: (chatId: string, messageId: string) => void;
  /** Dismiss the current `actionError` inline notice. */
  dismissActionError: () => void;
  /**
   * The short notice shown when the open topic disappeared (made private,
   * archived, or I was removed) and the view moved to the topics screen.
   * Private topic names never appear here: the text is fixed.
   */
  topicNotice: { groupId: string; message: string } | undefined;
  /** Dismisses the topic notice (or clears a stale one for another group). */
  dismissTopicNotice: () => void;
  /**
   * Bumped every time a group detail finishes loading, so `groupDetail`
   * selectors re-fire for screens mounted before the fetch resolved.
   */
  groupDetailsRevision: number;
  /**
   * The group detail (people + roles + AIs) of one group, keyed by **group
   * id** (not chat id): the topics screen passes its route param straight
   * through. `undefined` until `refreshGroupDetail` has loaded it.
   */
  groupDetail: (groupId: string) => GroupDetail | undefined;
  /**
   * Loads the group detail of one group id (people + roles + AIs), unless a
   * fresh detail is already cached or a load is in flight. Mount effects use
   * this (T-0139): opening the chat and then the group screen costs one GET,
   * not one per mount. `refreshGroupDetail` forces instead.
   */
  ensureGroupDetail: (groupId: string) => void;
  /** Reloads the group detail of one group id, even when cached. Use for an
   *  explicit user refresh or after a write that changes the group. */
  refreshGroupDetail: (groupId: string) => void;
  /** The AIs the viewer owns, for the new-topic sheet's unticked list. */
  ownedAis: { id: string; name: string }[];
  /**
   * Sets a per-user pref on one chat (mute/archive/pin), optimistic with a
   * re-fetch of the row on success and a state restore on failure. Rejects
   * on failure. For topics the caller passes the row chat id (a topic room
   * JID); group mute = a pref on the General row, inherited by its topics.
   */
  setChatPref: (chatId: string, input: PutChatPrefInput) => Promise<void>;
  /**
   * Pins of one chat, newest first. Loaded when the chat opens (and on
   * focus), refreshed while it is open, optimistic on pin/unpin.
   */
  pins: (chatId: string) => Pin[];
  /** A user-facing pins failure for one chat (load/pin/unpin). */
  pinsError?: { chatId: string; message: string };
  /** Loads the pins of one chat (called on open; silent while open). */
  refreshPins: (chatId: string) => Promise<void>;
  /** The pin for a loaded message, if it is pinned. */
  pinFor: (chatId: string, messageId: string) => Pin | undefined;
  /**
   * Whether the viewer may pin in a chat: either side of a DM, a group
   * owner/admin for topics (the manager rule, minus the topic-creator edge
   * the client cannot see — the server still enforces it).
   */
  canPin: (chatId: string) => boolean;
  /** Pins a loaded message with its display-only snapshot. Rejects on failure. */
  pinMessage: (chatId: string, messageId: string) => Promise<void>;
  /** Unpins by pin id, echoing the removed row. Rejects on failure. */
  unpinMessage: (chatId: string, pinId: string) => Promise<void>;
  /** Dismisses the current `pinsError` inline notice. */
  dismissPinsError: () => void;
  /**
   * Stops the open chat's pins poll (leaving the chat). The store also
   * stops it when another chat opens, the app goes idle, or it stops.
   */
  stopPinsPoll: () => void;
  /**
   * Creates a topic in the group that owns `chatId` and opens it. Rejects on
   * failure. Returns the new topic's chat id (its room JID).
   */
  createTopic: (chatId: string, input: CreateTopicInput) => Promise<string>;
  /**
   * Patches the topic that owns `chatId` (status, owner, link, visibility,
   * archive), updating the row. Rejects on failure.
   */
  patchTopic: (chatId: string, input: PatchTopicInput) => Promise<void>;
  /** Archives the topic that owns `chatId`. Rejects on failure. */
  archiveTopic: (chatId: string) => Promise<void>;
  /** Adds an AI to the topic and refreshes the row. Rejects on failure. */
  addTopicAi: (chatId: string, aiId: string) => Promise<void>;
  /** Removes an AI from the topic and refreshes the row. Rejects on failure. */
  removeTopicAi: (chatId: string, aiId: string) => Promise<void>;
  /** Adds a person to a private topic and refreshes the row. Rejects on failure. */
  addTopicMember: (chatId: string, userId: string) => Promise<void>;
  /** Removes a person from a private topic. Rejects on failure. */
  removeTopicMember: (chatId: string, userId: string) => Promise<void>;
  /** Leaves a private topic. Rejects on failure. */
  leaveTopic: (chatId: string) => Promise<void>;
  /** Reads the members of a private topic (public topics read the group). */
  listTopicMembers: (chatId: string) => Promise<{ userId: string; name: string }[]>;
  /** Reads the AIs in a topic. */
  listTopicAis: (chatId: string) => Promise<{ id: string; name: string }[]>;
  /**
   * The active invite links of one group (owner/admin only, same rule as
   * web): hints, labels, uses and state — never tokens (T-0136). Rejects on
   * failure.
   */
  listInviteLinks: (groupId: string) => Promise<GroupInviteLink[]>;
  /**
   * Creates an invite link for one group. Resolves with the link shown once
   * (the URL carries the token); the caller shows it and never stores it.
   */
  createInviteLink: (
    groupId: string,
    input: CreateGroupInviteLinkInput,
  ) => Promise<CreatedInviteLink>;
  /** Revokes an invite link. Idempotent; rejects on failure. */
  revokeInviteLink: (groupId: string, linkId: string) => Promise<void>;
  /**
   * Creates a channel (T-0144, title + optional description ≤ 300) and
   * refreshes the chat list. Resolves with the new group id. Rejects on
   * failure.
   */
  createChannel: (input: { title: string; description?: string }) => Promise<string>;
  /**
   * Leaves a channel (T-0144): removes the caller through the member route
   * and refreshes the chat list. Rejects on failure.
   */
  leaveChannel: (chatId: string) => Promise<void>;
  /**
   * Reads the members slice for one group (T-0144): the full audience for
   * owners/admins, the owner/admins slice for channel subscribers (never the
   * audience). Rejects on failure.
   */
  listChannelMembers: (
    groupId: string,
  ) => Promise<{ userId: string; name: string; role: 'owner' | 'admin' | 'member' }[]>;
  /**
   * Promotes a subscriber to admin or demotes one back (T-0144, owner only,
   * channels only). Refreshes the detail and the chat list, so the acting
   * device's rows (myRole, counts) match server truth and the composer bar
   * flips. The last-admin demotion rejects. Rejects on failure.
   */
  changeChannelRole: (chatId: string, userId: string, role: 'admin' | 'member') => Promise<void>;
  /** Previews a join-by-link token: group title and member count only. */
  previewJoinLink: (token: string) => Promise<JoinPreview>;
  /**
   * Joins the group behind a link token as `member` and refreshes the chat
   * list. Resolves with the group id. Rejects on failure.
   */
  joinByLink: (token: string) => Promise<JoinResult>;
  /**
   * The custom roles of one group (T-0137), keyed by **group id** like the
   * group detail. `undefined` until `refreshGroupRoles` has loaded them;
   * every member reads the list, only owners/admins write it.
   */
  groupRoles: (groupId: string) => CustomGroupRole[] | undefined;
  /** Loads the custom roles of one group id. Rejects on failure. */
  refreshGroupRoles: (groupId: string) => Promise<void>;
  /** Creates a role in `groupId` (the screen passes its route param, so an
   *  empty group with no loaded topic rows still works). Rejects on failure. */
  createGroupRole: (groupId: string, name: string) => Promise<CustomGroupRole>;
  /** Renames a role in `groupId`. Rejects on failure. */
  renameGroupRole: (groupId: string, roleId: string, name: string) => Promise<CustomGroupRole>;
  /** Deletes a role in `groupId` everywhere. Rejects on failure. */
  deleteGroupRole: (groupId: string, roleId: string) => Promise<void>;
  /**
   * Replaces a role's holder set in `groupId` (the server diffs inside a
   * transaction, so the full desired member list goes over the wire).
   * Rejects on failure.
   */
  setGroupRoleMembers: (
    groupId: string,
    roleId: string,
    userIds: string[],
  ) => Promise<CustomGroupRole>;
  /**
   * Replaces a private topic's roles and picks its approver role,
   * refreshing the row. Public topics show no role controls. Going public
   * clears roles server-side, so the refreshed row carries none. Rejects on
   * failure.
   */
  setTopicRoles: (chatId: string, input: SetTopicRolesInput) => Promise<void>;
  /**
   * The roles attached to the topic that owns `chatId` plus its approver
   * role (T-0137). `undefined` until `refreshTopicRoles` has loaded them.
   */
  topicRoles: (
    chatId: string,
  ) => { roles: TopicRole[]; approverRole: ApproverRole | null } | undefined;
  /** Loads the attached roles + approver role of the topic. Rejects on failure. */
  refreshTopicRoles: (chatId: string) => Promise<void>;
  setSearch: (search: string) => void;
  setActiveFolder: (folder: ChatFolder) => void;
  start: () => void;
  stop: () => void;
}

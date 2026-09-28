import type {
  ChatSummary,
  MentionMember,
  MessageStatus,
  ReactionsState,
  ReplyRef,
  UiMention,
  UiMessage,
  UiReaction,
  VoiceMeta,
} from '@galena/chat-core';
import {
  applyReaction,
  emptyReactions,
  mergeTargets,
  mentionsForTrimmedText,
  summarize,
} from '@galena/chat-core';
import { clearChatListCache, readChatListCache, writeChatListCache } from './chatListCache';
import {
  createXmppCore,
  type ChatMessage,
  type Occupant,
  type PresenceEvent,
  type XmppCore,
  type XmppCoreOptions,
} from '@galena/xmpp-core';
import type { StoreApi } from 'zustand/vanilla';
import { createStore } from 'zustand/vanilla';
import {
  addGroupAi as addGroupAiRequest,
  createGroup as createGroupRequest,
  createInvite as createInviteRequest,
  getChats,
  getContacts,
  getGroup,
  getMe,
  getXmppToken,
  listAis as listAisRequest,
  removeGroupAi as removeGroupAiRequest,
  type ChatEntry,
  type Contact,
  type GroupDetail,
  type Invite,
  type Me,
  type PublicAi,
  type XmppToken,
} from '@/lib/api';
import { authClient } from '@/lib/auth';
import {
  subscribeToDrafts,
  type DraftEndEvent,
  type DraftHubEvent,
  type OpenDraftStream,
} from '@/lib/drafts';
import { defaultVoicePort, type VoicePort } from '@/lib/voice';
import type { ChatStoreState, ConnectionStatus, DraftState } from './store';

const LAST_READ_PREFIX = 'galena:lastRead:';
const PREVIEW_HISTORY_MAX = 1;
const PAGE_HISTORY_MAX = 50;
const TYPING_CLEAR_MS = 5000;
const CHAT_REFRESH_DEBOUNCE_MS = 500;
// Waits between XMPP connect attempts after a failed token or login.
export const CONNECT_RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000];

// A finished draft is kept until its final XMPP message arrives. If that never
// happens (XMPP down), it is dropped after this long so it cannot stick.
export const DRAFT_END_FALLBACK_MS = 5_000;

// A draft that sees no further event for this long is stale (e.g. the server
// restarted mid-turn); the idle timer drops it rather than leaving it forever.
export const DRAFT_IDLE_MS = 60_000;

// Finished turn ids are remembered only to ignore a late `draft`. The set is
// capped so it cannot grow for the life of the tab.
const FINISHED_TURNS_MAX = 50;

// Records which final message took over a draft's turn, capped like the
// finished-turn set. Insertion order is the cap order.
function rememberFinishedDraftMessage(
  record: Record<string, string>,
  messageId: string,
  turnId: string,
): Record<string, string> {
  const next = { ...record, [messageId]: turnId };
  const keys = Object.keys(next);
  if (keys.length > FINISHED_TURNS_MAX) {
    for (const key of keys.slice(0, keys.length - FINISHED_TURNS_MAX)) {
      delete next[key];
    }
  }
  return next;
}

export interface ApiClient {
  getMe(): Promise<Me>;
  getChats(): Promise<ChatEntry[]>;
  getContacts(): Promise<Contact[]>;
  getGroup(groupId: string): Promise<GroupDetail>;
  getXmppToken(): Promise<XmppToken>;
  createGroup(input: { title: string; memberIds: string[] }): Promise<GroupDetail>;
  createInvite(): Promise<Invite>;
  listAis(): Promise<PublicAi[]>;
  addGroupAi(groupId: string, aiId: string): Promise<GroupDetail>;
  removeGroupAi(groupId: string, aiId: string): Promise<GroupDetail>;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface RealStoreDeps {
  api?: ApiClient;
  createXmpp?: (options: XmppCoreOptions) => XmppCore;
  storage?: StorageLike | null;
  now?: () => Date;
  documentVisible?: () => boolean;
  /** Conversion + XEP-0363 upload; tests inject fakes. */
  voice?: VoicePort;
  /** The AI draft SSE stream; tests inject a fake. */
  openDrafts?: OpenDraftStream;
}

const realApi: ApiClient = {
  getMe,
  getChats,
  getContacts,
  getGroup,
  getXmppToken,
  createGroup: createGroupRequest,
  createInvite: createInviteRequest,
  listAis: listAisRequest,
  addGroupAi: addGroupAiRequest,
  removeGroupAi: removeGroupAiRequest,
};

function readLastRead(storage: StorageLike | null, userId: string): Record<string, string> {
  if (storage === null) {
    return {};
  }
  try {
    const raw = storage.getItem(`${LAST_READ_PREFIX}${userId}`);
    if (raw === null) {
      return {};
    }
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') {
      return {};
    }
    const result: Record<string, string> = {};
    for (const [chatId, messageId] of Object.entries(parsed)) {
      if (typeof messageId === 'string') {
        result[chatId] = messageId;
      }
    }
    return result;
  } catch {
    return {};
  }
}

function defaultStorage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function defaultVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible';
}

// `URL.createObjectURL` is missing in some test environments.
function objectUrlFor(blob: Blob): string | undefined {
  try {
    return URL.createObjectURL(blob);
  } catch {
    return undefined;
  }
}

function coreKind(chat: ChatSummary): 'chat' | 'groupchat' {
  return chat.kind === 'group' ? 'groupchat' : 'chat';
}

function mentionLocalpart(jid: string): string {
  const bare = jid.split('/')[0] ?? jid;
  const at = bare.indexOf('@');
  return at === -1 ? bare : bare.slice(0, at);
}

function sortMessages(messages: UiMessage[]): UiMessage[] {
  return [...messages].sort(
    (left, right) =>
      left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id),
  );
}

function sortByRecency(chats: ChatSummary[]): ChatSummary[] {
  return [...chats].sort((left, right) => {
    const leftTime = left.lastMessage?.createdAt.getTime() ?? Number.NEGATIVE_INFINITY;
    const rightTime = right.lastMessage?.createdAt.getTime() ?? Number.NEGATIVE_INFINITY;
    return rightTime - leftTime || left.title.localeCompare(right.title);
  });
}

function moveChatToTop(chats: ChatSummary[], chatId: string): ChatSummary[] {
  const index = chats.findIndex((chat) => chat.id === chatId);
  if (index <= 0) {
    return chats;
  }
  const next = [...chats];
  const [chat] = next.splice(index, 1);
  if (chat !== undefined) {
    next.unshift(chat);
  }
  return next;
}

/**
 * Fresh server entries merged over what is already painted (the cached list
 * from the last visit): each chat keeps its preview and unread count, so rows
 * don't lose their second line or jump while XMPP catches up. A cached list
 * that belongs to another user is dropped.
 */
export function mergeWithPainted(
  painted: readonly ChatSummary[],
  fresh: ChatSummary[],
  paintedIsSameUser: boolean,
): ChatSummary[] {
  if (!paintedIsSameUser || painted.length === 0) {
    return fresh;
  }
  const byId = new Map(painted.map((chat) => [chat.id, chat]));
  return sortByRecency(
    fresh.map((chat) => {
      const previous = byId.get(chat.id);
      if (previous === undefined) {
        return chat;
      }
      const merged: ChatSummary = { ...chat, unread: previous.unread };
      if (previous.lastMessage !== undefined) {
        merged.lastMessage = previous.lastMessage;
      }
      return merged;
    }),
  );
}

function summaryFor(entry: ChatEntry): ChatSummary {
  const base = {
    id: entry.chatJid,
    title: entry.title,
    isAI: false,
    space: 'personal' as const,
    unread: 0,
    muted: false,
  };
  if (entry.kind === 'dm') {
    return {
      ...base,
      kind: 'dm',
      isAI: entry.isAi === true,
      ...(entry.avatarUrl === undefined ? {} : { avatarUrl: entry.avatarUrl }),
      online: false,
    };
  }
  return {
    ...base,
    kind: 'group',
    memberCount: entry.memberCount,
    onlineCount: 0,
  };
}

export function createRealChatStore(deps: RealStoreDeps = {}): StoreApi<ChatStoreState> {
  const api = deps.api ?? realApi;
  const storage = deps.storage === undefined ? defaultStorage() : deps.storage;
  const now = deps.now ?? ((): Date => new Date());
  const isVisible = deps.documentVisible ?? defaultVisible;
  const createXmpp = deps.createXmpp ?? ((options: XmppCoreOptions) => createXmppCore(options));
  const voicePort = deps.voice ?? defaultVoicePort;
  const openDrafts = deps.openDrafts ?? subscribeToDrafts;

  return createStore<ChatStoreState>((set, get) => {
    let core: XmppCore | undefined;
    let unsubscribers: Array<() => void> = [];
    let typingTimers: Record<string, ReturnType<typeof setTimeout>> = {};
    let sequence = 0;
    let lastRead: Record<string, string> = {};
    let lastReadUserId: string | undefined;
    let generation = 0;
    let connectRetryTimer: ReturnType<typeof setTimeout> | undefined;
    let connectRetryAttempt = 0;
    // Group history (MUC MAM) only works once the room is joined, which
    // happens after the connection is online.
    let groupsJoined = false;
    // The user whose cached chat list was painted on start, if any.
    let cachedUserId: string | undefined;
    // Closes the draft stream once opened; undefined means it is not open.
    let closeDraftStream: (() => void) | undefined;
    // Fallback removal of a finished draft, keyed by chat id.
    const draftTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
    // Turn ids whose draft is done, so a late `draft` is ignored.
    const finishedTurns = new Set<string>();
    const finishedTurnOrder: string[] = [];

    function saveChatList(): void {
      const state = get();
      if (state.chatsState === 'ready') {
        writeChatListCache(storage, state.currentUserId, state.chats);
      }
    }
    let firstToken: XmppToken | undefined;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const cursors: Record<string, string | undefined> = {};
    const pendingOutgoing = new Map<string, string[]>();
    const messageAliases = new Map<string, string>();
    const groupIds = new Map<string, string>();
    // chatId -> (lowercased user id -> member)
    const groupMembers = new Map<string, Map<string, MentionMember>>();
    // chatId -> the last group detail (people + AIs), for the info panel.
    const groupInfos = new Map<string, GroupDetail>();
    const loadingGroupMembers = new Set<string>();
    const loadingOlder = new Set<string>();
    // First-page history loads currently in flight, by chat id.
    const loadingHistory = new Set<string>();
    // A chat opened before the core was connected or before the chats had
    // arrived (e.g. a reload of /c/<jid>). Only the latest one counts; it
    // loads as soon as both are ready.
    let pendingOpenChatId: string | undefined;

    function persistLastRead(): void {
      if (storage === null || lastReadUserId === undefined) {
        return;
      }
      try {
        storage.setItem(`${LAST_READ_PREFIX}${lastReadUserId}`, JSON.stringify(lastRead));
      } catch {
        // A full or blocked localStorage must never break messaging.
      }
    }

    function recordRead(chatId: string, messageId: string | undefined): void {
      if (messageId !== undefined) {
        lastRead[chatId] = messageId;
        persistLastRead();
      }
      set((state) => ({
        chats: state.chats.map((chat) =>
          chat.id === chatId && chat.unread > 0 ? { ...chat, unread: 0 } : chat,
        ),
      }));
    }

    function signatureFor(chatId: string, body: string, replyTo: ReplyRef | undefined): string {
      return `${chatId}|${body}|${replyTo?.id ?? ''}`;
    }

    // A message may be known under its optimistic local id and later under its
    // server id. The alias map keeps the two linked so a status change can be
    // applied to whichever form is currently in the store.
    function aliasRoot(id: string): string {
      let current = id;
      let next = messageAliases.get(current);
      while (next !== undefined && next !== current) {
        current = next;
        next = messageAliases.get(current);
      }
      return current;
    }

    function linkMessageIds(left: string, right: string): void {
      if (left === right) {
        return;
      }
      const rootLeft = aliasRoot(left);
      const rootRight = aliasRoot(right);
      if (rootLeft !== rootRight) {
        messageAliases.set(rootRight, rootLeft);
        // Reactions were stored under whichever id was known when they
        // arrived; move them onto the surviving root so the alias-aware
        // lookup finds them.
        migrateReactionTargets(rootRight, rootLeft);
      }
    }

    function migrateReactionTargets(from: string, to: string): void {
      const state = get();
      let changed = false;
      const next: Record<string, ReactionsState> = { ...state.reactions };
      for (const [chatId, chatState] of Object.entries(state.reactions)) {
        if (chatState.targets[from] === undefined) {
          continue;
        }
        next[chatId] = mergeTargets(chatState, from, to);
        changed = true;
      }
      if (!changed) {
        return;
      }
      set({ reactions: next });
      for (const chatId of Object.keys(next)) {
        refreshReactions(chatId);
      }
    }

    function sameMessage(left: string, right: string): boolean {
      return aliasRoot(left) === aliasRoot(right);
    }

    // A status only moves forward: sending -> sent -> read. A late echo or
    // send confirmation must never downgrade a message the peer already read.
    const STATUS_RANK: Record<MessageStatus, number> = { sending: 0, sent: 1, read: 2 };

    function advanceStatus(current: MessageStatus, next: MessageStatus): MessageStatus {
      return STATUS_RANK[next] > STATUS_RANK[current] ? next : current;
    }

    // Updates a message's status in the open conversation and, when it is the
    // same message, in the chat list preview, so the two always agree.
    function updateMessageStatus(chatId: string, messageId: string, status: MessageStatus): void {
      set((state) => {
        const list = listFor(state, chatId);
        const next = list.map((item) =>
          sameMessage(item.id, messageId)
            ? { ...item, status: advanceStatus(item.status, status) }
            : item,
        );
        const last = state.chats.find((chat) => chat.id === chatId)?.lastMessage;
        const lastMatches = last !== undefined && sameMessage(last.id, messageId);
        return {
          messagesByChat: { ...state.messagesByChat, [chatId]: next },
          chats: lastMatches
            ? state.chats.map((chat) =>
                chat.id === chatId && chat.lastMessage !== undefined
                  ? {
                      ...chat,
                      lastMessage: {
                        ...chat.lastMessage,
                        status: advanceStatus(chat.lastMessage.status, status),
                      },
                    }
                  : chat,
              )
            : state.chats,
        };
      });
    }

    // Swaps the placeholder voice metadata of an optimistic message for the
    // server's duration, waveform and upload URL.
    function updateMessageVoice(chatId: string, messageId: string, voice: VoiceMeta): void {
      set((state) => {
        const list = listFor(state, chatId).map((item) =>
          sameMessage(item.id, messageId) ? { ...item, voice } : item,
        );
        const last = state.chats.find((chat) => chat.id === chatId)?.lastMessage;
        const lastMatches = last !== undefined && sameMessage(last.id, messageId);
        return {
          messagesByChat: { ...state.messagesByChat, [chatId]: list },
          chats: lastMatches
            ? state.chats.map((chat) =>
                chat.id === chatId && chat.lastMessage !== undefined
                  ? { ...chat, lastMessage: { ...chat.lastMessage, voice } }
                  : chat,
              )
            : state.chats,
        };
      });
    }

    function myJid(): string | undefined {
      const jid = get().me?.jid;
      return jid === undefined || jid === null || jid === '' ? undefined : jid;
    }

    function isOwnSender(fromJid: string): boolean {
      const jid = myJid();
      return jid !== undefined && fromJid === jid;
    }

    // The localpart of a JID on our own domain, used only as a lookup key.
    // It is never shown; the localpart of a user JID is the user id lowercased.
    function userLocalpartOf(fromJid: string): string | undefined {
      const mine = myJid();
      if (mine === undefined) {
        return undefined;
      }
      const domain = mine.slice(mine.indexOf('@') + 1);
      const at = fromJid.indexOf('@');
      if (at === -1) {
        return undefined;
      }
      const local = fromJid.slice(0, at);
      const host = fromJid.slice(at + 1);
      return host === domain ? local.toLowerCase() : undefined;
    }

    function groupMemberNameFor(chatId: string, fromJid: string): string | undefined {
      const members = groupMembers.get(chatId);
      if (members === undefined) {
        return undefined;
      }
      const localpart = userLocalpartOf(fromJid);
      if (localpart === undefined) {
        return undefined;
      }
      const member = members.get(localpart);
      return member !== undefined && member.name !== '' ? member.name : undefined;
    }

    function occupantNameFor(chatId: string, fromJid: string): string | undefined {
      if (core === undefined) {
        return undefined;
      }
      const occupant = core
        .occupants(chatId)
        .find((item) => item.realJid === fromJid || item.jid === fromJid);
      const nick = occupant?.nick;
      return nick !== undefined && nick !== '' ? nick : undefined;
    }

    // Resolves a display name without ever falling back to a JID localpart.
    // Order: me, contact, MUC nick, group member, room occupant, DM title,
    // then "Someone".
    function senderNameFor(message: ChatMessage): string {
      if (message.outgoing || isOwnSender(message.fromJid)) {
        return 'You';
      }
      const contact = get().contacts.find((entry) => entry.jid === message.fromJid);
      if (contact !== undefined) {
        return contact.name;
      }
      if (message.fromNick !== undefined && message.fromNick !== '') {
        return message.fromNick;
      }
      const member = groupMemberNameFor(message.chatJid, message.fromJid);
      if (member !== undefined) {
        return member;
      }
      const occupant = occupantNameFor(message.chatJid, message.fromJid);
      if (occupant !== undefined) {
        return occupant;
      }
      const chat = get().chats.find((entry) => entry.id === message.chatJid);
      if (chat !== undefined && chat.kind === 'dm') {
        return chat.title;
      }
      return 'Someone';
    }

    // A reactor's display name: "You" for me, the DM title for a DM, else the
    // group member, the room occupant, or "Someone".
    function reactorName(chatId: string, reactorJid: string): string {
      const mine = myJid();
      if (mine !== undefined && reactorJid === mine) {
        return 'You';
      }
      const chat = get().chats.find((entry) => entry.id === chatId);
      if (chat !== undefined && chat.kind === 'dm') {
        return chat.title;
      }
      return (
        groupMemberNameFor(chatId, reactorJid) ?? occupantNameFor(chatId, reactorJid) ?? 'Someone'
      );
    }

    // The chips of a message, from the stored reaction updates. The lookup is
    // alias-aware, like `sameMessage`: an optimistic id and the server id of
    // the same message resolve to one target.
    function reactionChips(
      state: ReactionsState | undefined,
      chatId: string,
      messageId: string,
    ): UiReaction[] | undefined {
      if (state === undefined) {
        return undefined;
      }
      const summary = summarize(state, aliasRoot(messageId), myJid() ?? '');
      if (summary.length === 0) {
        return undefined;
      }
      return summary.map((entry) => ({
        emoji: entry.emoji,
        count: entry.count,
        mine: entry.mine,
        reactors: entry.reactors.map((reactor) => reactorName(chatId, reactor)),
      }));
    }

    function reactionsEqual(
      left: UiReaction[] | undefined,
      right: UiReaction[] | undefined,
    ): boolean {
      if (left === undefined || right === undefined) {
        return left === right;
      }
      if (left.length !== right.length) {
        return false;
      }
      return left.every((entry, index) => {
        const other = right[index];
        return (
          other !== undefined &&
          entry.emoji === other.emoji &&
          entry.count === other.count &&
          entry.mine === other.mine &&
          entry.reactors.join('\u0000') === other.reactors.join('\u0000')
        );
      });
    }

    // Re-attaches the current chips to every loaded message of a chat after a
    // reaction update changed the derived state.
    function refreshReactions(chatId: string): void {
      const state = get();
      const list = state.messagesByChat[chatId];
      const reactions = state.reactions[chatId];
      if (list === undefined || reactions === undefined) {
        return;
      }
      let changed = false;
      const next = list.map((message) => {
        const chips = reactionChips(reactions, chatId, message.id);
        if (reactionsEqual(message.reactions, chips)) {
          return message;
        }
        changed = true;
        if (chips === undefined) {
          const withoutReactions: UiMessage = { ...message };
          delete withoutReactions.reactions;
          return withoutReactions;
        }
        return { ...message, reactions: chips };
      });
      if (!changed) {
        return;
      }
      set((previous) => ({ messagesByChat: { ...previous.messagesByChat, [chatId]: next } }));
    }

    // Applies one reaction update and refreshes the loaded messages. The target
    // is canonicalised through the alias map so it matches whatever id the
    // message is currently known by.
    function applyReactionUpdate(
      chatId: string,
      targetId: string,
      reactorJid: string,
      emojis: string[],
      order: number,
    ): void {
      set((state) => ({
        reactions: {
          ...state.reactions,
          [chatId]: applyReaction(state.reactions[chatId] ?? emptyReactions(), {
            targetId: aliasRoot(targetId),
            reactorJid,
            emojis,
            order,
          }),
        },
      }));
      refreshReactions(chatId);
    }

    // A reaction update is not a chat message: it only changes reaction state,
    // so it never becomes a bubble or bumps the preview or unread count.
    function ingestReaction(message: ChatMessage): void {
      const reactions = message.reactions;
      if (reactions === undefined) {
        return;
      }
      const mine = myJid();
      const reactorJid = message.outgoing && mine !== undefined ? mine : message.fromJid;
      applyReactionUpdate(
        message.chatJid,
        reactions.targetId,
        reactorJid,
        reactions.emojis,
        message.timestamp.getTime(),
      );
    }

    function ingestHistoryReactions(messages: readonly ChatMessage[]): void {
      for (const message of messages) {
        ingestReaction(message);
      }
    }

    function rememberGroupIds(entries: ChatEntry[]): void {
      for (const entry of entries) {
        if (entry.kind === 'group') {
          groupIds.set(entry.chatJid, entry.groupId);
        }
      }
    }

    // Loads the members of a group once per chat, so a typing indicator
    // or a message from a member who is not a contact can still show a name.
    // The mention picker and the group panel read the same list. The AIs the
    // group holds (T-0054) ride along, keyed by their `ai-` localpart.
    async function ensureGroupMembers(chatId: string, force = false): Promise<void> {
      if (loadingGroupMembers.has(chatId)) {
        return;
      }
      if (!force && groupInfos.has(chatId)) {
        return;
      }
      const groupId = groupIds.get(chatId);
      const mine = myJid();
      if (groupId === undefined || mine === undefined) {
        return;
      }
      const domain = mine.slice(mine.indexOf('@') + 1);
      loadingGroupMembers.add(chatId);
      try {
        const detail = await api.getGroup(groupId);
        applyGroupDetail(chatId, detail, domain);
      } catch {
        // The name falls back to the occupant nick or "Someone".
      } finally {
        loadingGroupMembers.delete(chatId);
      }
    }

    // Caches a group detail and rebuilds the mention members from it, so the
    // picker and the panel agree after a load, an add or a remove.
    function applyGroupDetail(chatId: string, detail: GroupDetail, domain: string): void {
      const members = new Map<string, MentionMember>();
      for (const member of detail.members) {
        const localpart = member.userId.toLowerCase();
        members.set(localpart, { jid: `${localpart}@${domain}`, name: member.name });
      }
      for (const ai of detail.ais) {
        const localpart = (ai.jid.split('@')[0] ?? ai.jid).toLowerCase();
        members.set(localpart, { jid: ai.jid, name: ai.name });
      }
      groupMembers.set(chatId, members);
      groupInfos.set(chatId, detail);
      set((state) => ({ groupInfos: { ...state.groupInfos, [chatId]: detail } }));
    }

    // Maps the usable mentions of a message to names: the known group member,
    // else the text the range covers, else the JID's localpart.
    function mentionsFor(message: ChatMessage): UiMention[] {
      const body = message.body;
      if (body === undefined || message.mentions === undefined) {
        return [];
      }
      const mentions: UiMention[] = [];
      for (const mention of message.mentions) {
        const { begin, end } = mention;
        if (begin === undefined || end === undefined) continue;
        if (begin < 0 || begin >= end || end > body.length) continue;
        const textAtRange = body.slice(begin, end);
        const name =
          groupMemberNameFor(message.chatJid, mention.jid) ??
          (textAtRange !== '' ? textAtRange : mentionLocalpart(mention.jid));
        mentions.push({ jid: mention.jid, name, begin, end });
      }
      return mentions;
    }

    function toUiMessage(message: ChatMessage, meId: string): UiMessage {
      const ui: UiMessage = {
        id: message.id,
        chatId: message.chatJid,
        senderId: message.outgoing ? meId : message.fromJid,
        senderName: senderNameFor(message),
        createdAt: message.timestamp,
        status: message.outgoing ? 'sent' : 'read',
      };
      if (message.body !== undefined) {
        ui.text = message.body;
      }
      if (message.replyTo !== undefined) {
        const referenced = get().messagesByChat[message.chatJid]?.find(
          (item) => item.id === message.replyTo?.id,
        );
        ui.replyTo = {
          id: message.replyTo.id,
          senderName: referenced?.senderName ?? '',
          ...(referenced?.text === undefined ? {} : { text: referenced.text }),
        };
      }
      const mentions = mentionsFor(message);
      if (mentions.length > 0) {
        ui.mentions = mentions;
      }
      if (message.payload !== undefined && message.payload.type === 'voice') {
        ui.voice = message.payload.data;
      }
      const reactions = reactionChips(
        get().reactions[message.chatJid],
        message.chatJid,
        message.id,
      );
      if (reactions !== undefined) {
        ui.reactions = reactions;
      }
      return ui;
    }

    function setChatMessage(chatId: string, message: UiMessage, clearUnread: boolean): void {
      set((state) => ({
        messagesByChat: {
          ...state.messagesByChat,
          [chatId]: sortMessages([...listFor(state, chatId), message]),
        },
        chats: moveChatToTop(
          state.chats.map((chat) =>
            chat.id === chatId
              ? {
                  ...chat,
                  lastMessage: message,
                  unread: clearUnread ? 0 : chat.unread,
                }
              : chat,
          ),
          chatId,
        ),
      }));
    }

    function listFor(state: ChatStoreState, chatId: string): UiMessage[] {
      return state.messagesByChat[chatId] ?? [];
    }

    function setHistoryState(chatId: string, state: 'loading' | 'ready' | 'error'): void {
      set((previous) => ({ historyState: { ...previous.historyState, [chatId]: state } }));
    }

    // Drops the 'loading' marker of a pending chat that was superseded before
    // it ever loaded, so no ownerless entry stays behind. Settled entries and
    // in-flight loads are left alone.
    function clearSupersededMarker(chatId: string): void {
      if (loadingHistory.has(chatId)) {
        return;
      }
      set((previous) => {
        if (previous.historyState[chatId] !== 'loading') {
          return previous;
        }
        const next = { ...previous.historyState };
        delete next[chatId];
        return { historyState: next };
      });
    }

    function markTurnFinished(turnId: string): void {
      if (finishedTurns.has(turnId)) {
        return;
      }
      finishedTurns.add(turnId);
      finishedTurnOrder.push(turnId);
      while (finishedTurnOrder.length > FINISHED_TURNS_MAX) {
        const oldest = finishedTurnOrder.shift();
        if (oldest !== undefined) {
          finishedTurns.delete(oldest);
        }
      }
    }

    function withoutDraft(
      drafts: Record<string, DraftState>,
      chatId: string,
    ): Record<string, DraftState> {
      if (drafts[chatId] === undefined) {
        return drafts;
      }
      const next = { ...drafts };
      delete next[chatId];
      return next;
    }

    function clearDraftTimeout(chatId: string): void {
      const timer = draftTimeouts.get(chatId);
      if (timer !== undefined) {
        clearTimeout(timer);
        draftTimeouts.delete(chatId);
      }
    }

    function clearDraftState(): void {
      for (const timer of draftTimeouts.values()) {
        clearTimeout(timer);
      }
      draftTimeouts.clear();
      finishedTurns.clear();
      finishedTurnOrder.length = 0;
    }

    // (Re)arms the one removal timer of a chat, replacing any previous one.
    // It removes the draft only when the same turn is still shown, so a newer
    // turn's draft is never dropped by an older turn's timer.
    function armDraftRemoval(chatJid: string, turnId: string, delay: number): void {
      clearDraftTimeout(chatJid);
      const timer = setTimeout(() => {
        draftTimeouts.delete(chatJid);
        // Not marked finished here: an idle turn (e.g. a slow tool call) may
        // resume, and its next draft must show again. `end` marks it itself.
        set((state) => {
          const current = state.drafts[chatJid];
          if (current === undefined || current.turnId !== turnId) {
            return state;
          }
          return { drafts: withoutDraft(state.drafts, chatJid) };
        });
      }, delay);
      draftTimeouts.set(chatJid, timer);
    }

    // A draft disappears only once its final message is there, so the two
    // never leave a gap. Each `draft` re-arms an idle timer (a dead turn, e.g.
    // the server restarted mid-turn, would otherwise leave the bubble forever);
    // `end` replaces it with the short fallback; the final XMPP message (a
    // separate channel) removes the draft in the same update that adds it.
    function handleDraftEvent(event: DraftHubEvent): void {
      if (event.type === 'end') {
        handleDraftEnd(event);
        return;
      }
      if (finishedTurns.has(event.turnId)) {
        return;
      }
      set((state) => ({
        drafts: { ...state.drafts, [event.chatJid]: { turnId: event.turnId, text: event.text } },
      }));
      armDraftRemoval(event.chatJid, event.turnId, DRAFT_IDLE_MS);
    }

    function handleDraftEnd(event: DraftEndEvent): void {
      markTurnFinished(event.turnId);
      const shown = get().drafts[event.chatJid];
      if (shown === undefined || shown.turnId !== event.turnId) {
        return;
      }
      armDraftRemoval(event.chatJid, event.turnId, DRAFT_END_FALLBACK_MS);
    }

    function startDraftStream(gen: number): void {
      if (gen !== generation || closeDraftStream !== undefined) {
        return;
      }
      closeDraftStream = openDrafts(handleDraftEvent);
    }

    function handleMessage(message: ChatMessage): void {
      // A reaction update is a body-less message that only changes reactions:
      // it must never render as a bubble or move the chat list preview.
      if (message.reactions !== undefined) {
        ingestReaction(message);
        return;
      }
      const meId = get().currentUserId;
      const chatId = message.chatJid;
      const ui = toUiMessage(message, meId);

      if (message.outgoing) {
        // Reconcile our optimistic message with the server echo.
        const signature = signatureFor(
          chatId,
          message.body ?? '',
          message.replyTo === undefined ? undefined : { id: message.replyTo.id, senderName: '' },
        );
        const queue = pendingOutgoing.get(signature);
        const localId = queue?.shift();
        if (queue !== undefined && queue.length === 0) {
          pendingOutgoing.delete(signature);
        }
        if (localId !== undefined) {
          linkMessageIds(localId, ui.id);
        }
        set((state) => {
          const existing = listFor(state, chatId);
          const previous = existing.find((item) => sameMessage(item.id, ui.id));
          const reconciled: UiMessage =
            previous === undefined
              ? ui
              : { ...ui, status: advanceStatus(previous.status, ui.status) };
          const withoutLocal =
            localId === undefined ? existing : existing.filter((item) => item.id !== localId);
          return {
            messagesByChat: {
              ...state.messagesByChat,
              [chatId]: sortMessages([
                ...withoutLocal.filter((item) => item.id !== reconciled.id),
                reconciled,
              ]),
            },
            chats: moveChatToTop(
              state.chats.map((chat) =>
                chat.id === chatId ? { ...chat, lastMessage: reconciled } : chat,
              ),
              chatId,
            ),
          };
        });
        return;
      }

      const active = get().activeChatId === chatId && isVisible();
      const isRead = active;
      // Only the AI's own message in its DM finishes the draft. A message from
      // my own JID (e.g. my second device) must leave the draft running.
      const fromAi = message.fromJid === chatId && !isOwnSender(message.fromJid);
      const draft = get().drafts[chatId];
      if (draft !== undefined && fromAi) {
        markTurnFinished(draft.turnId);
        clearDraftTimeout(chatId);
      }
      set((state) => ({
        messagesByChat: {
          ...state.messagesByChat,
          [chatId]: sortMessages([
            ...listFor(state, chatId).filter((item) => item.id !== ui.id),
            ui,
          ]),
        },
        chats: moveChatToTop(
          state.chats.map((chat) =>
            chat.id === chatId
              ? { ...chat, lastMessage: ui, unread: isRead ? 0 : chat.unread + 1 }
              : chat,
          ),
          chatId,
        ),
        // The final message replaces the draft in one update: the bubble never
        // leaves the screen, so there is no gap and no duplicate.
        drafts: draft !== undefined && fromAi ? withoutDraft(state.drafts, chatId) : state.drafts,
        // Remember the turn so the bubble keeps revealing on the draft's key.
        finishedDraftMessages:
          draft !== undefined && fromAi
            ? rememberFinishedDraftMessage(state.finishedDraftMessages, ui.id, draft.turnId)
            : state.finishedDraftMessages,
      }));
      if (isRead && core !== undefined) {
        const chat = get().chats.find((entry) => entry.id === chatId);
        if (chat !== undefined) {
          recordRead(chatId, ui.id);
          core.markDisplayed(chatId, coreKind(chat), ui.id);
        }
      }
    }

    function handleTyping(event: {
      chatJid: string;
      fromJid: string;
      state: string;
      outgoing: boolean;
    }): void {
      // A MUC reflects my own chat states back to me. When the sender cannot be
      // resolved to a real JID, xmpp-core marks the reflection `outgoing` and
      // keeps the full room JID, so the JID check alone is not enough.
      if (event.outgoing || isOwnSender(event.fromJid)) {
        return;
      }
      const chatId = event.chatJid;
      void ensureGroupMembers(chatId);
      const name = senderNameFor({
        chatJid: chatId,
        fromJid: event.fromJid,
        outgoing: false,
      } as ChatMessage);
      const existing = typingTimers[chatId];
      if (existing !== undefined) {
        clearTimeout(existing);
      }
      if (event.state === 'composing') {
        set((state) => ({ typing: { ...state.typing, [chatId]: { names: [name] } } }));
        typingTimers[chatId] = setTimeout(() => {
          set((state) => {
            const next = { ...state.typing };
            delete next[chatId];
            return { typing: next };
          });
          delete typingTimers[chatId];
        }, TYPING_CLEAR_MS);
      } else {
        set((state) => {
          const next = { ...state.typing };
          delete next[chatId];
          return { typing: next };
        });
      }
    }

    function handleDisplayed(event: {
      chatJid: string;
      fromJid: string;
      messageId: string;
      outgoing: boolean;
    }): void {
      // A reflected marker of my own message means I displayed it, not that a
      // peer read it. `outgoing` covers the unresolved full-room-JID case.
      if (event.outgoing || isOwnSender(event.fromJid)) {
        return;
      }
      updateMessageStatus(event.chatJid, event.messageId, 'read');
    }

    function handleOccupants(event: { roomJid: string; occupants: Occupant[] }): void {
      const online = event.occupants.filter((occupant) => occupant.available).length;
      set((state) => ({
        chats: state.chats.map((chat) =>
          chat.id === event.roomJid
            ? {
                ...chat,
                onlineCount: online,
                memberCount: Math.max(chat.memberCount ?? 0, event.occupants.length),
              }
            : chat,
        ),
      }));
    }

    function handlePresence(event: PresenceEvent): void {
      set((state) => ({
        chats: state.chats.map((chat) =>
          chat.id === event.jid
            ? {
                ...chat,
                online: event.available,
                ...(event.available ? {} : { lastSeenAt: now() }),
              }
            : chat,
        ),
      }));
    }

    function subscribe(current: XmppCore): void {
      unsubscribers = [
        current.on('status', (status: ConnectionStatus) => {
          set({ status });
          if (status === 'online') {
            flushPending();
          }
        }),
        current.on('message', handleMessage),
        current.on('typing', handleTyping),
        current.on('displayed', handleDisplayed),
        current.on('occupants', handleOccupants),
        current.on('presence', handlePresence),
        current.on('invited', handleInvited),
        current.on('roster', handleRoster),
      ];
    }

    function nick(me: Me): string {
      const name = me.name.trim();
      if (name.length > 0) {
        return name;
      }
      return me.jid?.split('@')[0] ?? 'me';
    }

    async function joinGroups(current: XmppCore, me: Me): Promise<void> {
      for (const chat of get().chats) {
        if (chat.kind !== 'group') {
          continue;
        }
        void ensureGroupMembers(chat.id);
        try {
          await current.joinRoom(chat.id, nick(me));
        } catch {
          // A room can be joined later when the user opens it.
        }
      }
    }

    // A group invitation or a roster push means the chat list changed on the
    // server. Refetch it, join any new group rooms and load their preview.
    function handleInvited(): void {
      scheduleChatsRefresh();
    }

    function handleRoster(): void {
      scheduleChatsRefresh();
    }

    function scheduleChatsRefresh(): void {
      if (refreshTimer !== undefined) {
        clearTimeout(refreshTimer);
      }
      refreshTimer = setTimeout(() => {
        refreshTimer = undefined;
        void refreshChats();
      }, CHAT_REFRESH_DEBOUNCE_MS);
    }

    async function refreshChats(): Promise<void> {
      const gen = generation;
      let entries: ChatEntry[];
      try {
        entries = await api.getChats();
      } catch {
        return;
      }
      if (gen !== generation) {
        return;
      }

      const previous = get().chats;
      const known = new Map(previous.map((chat) => [chat.id, chat]));
      const fresh = entries.filter((entry) => !known.has(entry.chatJid)).map(summaryFor);
      const kept = entries
        .filter((entry) => known.has(entry.chatJid))
        .map((entry) => {
          const existing = known.get(entry.chatJid);
          const summary = summaryFor(entry);
          if (existing === undefined) {
            return summary;
          }
          return {
            ...summary,
            ...(existing.lastMessage === undefined ? {} : { lastMessage: existing.lastMessage }),
            unread: existing.unread,
            ...(existing.online === undefined ? {} : { online: existing.online }),
            ...(existing.onlineCount === undefined ? {} : { onlineCount: existing.onlineCount }),
          };
        });
      // New chats appear at the top; the rest keep their recency order.
      set({ chats: [...fresh, ...sortByRecency(kept)] });
      rememberGroupIds(entries);
      flushPending();

      const current = core;
      const me = get().me;
      if (current === undefined || me === undefined) {
        return;
      }
      for (const entry of entries) {
        if (known.has(entry.chatJid) || entry.kind !== 'group') {
          continue;
        }
        await current.joinRoom(entry.chatJid, nick(me)).catch(() => {});
        void ensureGroupMembers(entry.chatJid);
      }
      for (const entry of entries) {
        if (known.has(entry.chatJid)) {
          continue;
        }
        const chat = get().chats.find((item) => item.id === entry.chatJid);
        if (chat !== undefined) {
          await loadPreview(current, chat);
        }
      }
    }

    async function loadPreview(current: XmppCore, chat: ChatSummary): Promise<void> {
      try {
        const page = await current.loadHistory(chat.id, coreKind(chat), {
          max: PREVIEW_HISTORY_MAX,
        });
        ingestHistoryReactions(page.messages);
        const last = page.messages.filter((message) => message.reactions === undefined).at(-1);
        if (last === undefined) {
          return;
        }
        const ui = toUiMessage(last, get().currentUserId);
        set((state) => ({
          chats: state.chats.map((entry) =>
            entry.id === chat.id && entry.lastMessage === undefined
              ? { ...entry, lastMessage: ui }
              : entry,
          ),
        }));
        if (lastRead[chat.id] === undefined) {
          lastRead[chat.id] = ui.id;
          persistLastRead();
        }
        cursors[chat.id] = page.first;
        set((state) => ({
          historyComplete: { ...state.historyComplete, [chat.id]: page.complete },
        }));
      } catch {
        // Preview is best-effort; the chat still works when opened.
      }
    }

    // Runs the pending open once the core is connected and the chat is
    // known. Called after every point where either can become ready: the
    // first chat merge, a background refresh, and (re)connect.
    function flushPending(): void {
      const pending = pendingOpenChatId;
      if (pending === undefined) {
        return;
      }
      const chat = get().chats.find((entry) => entry.id === pending);
      if (chat === undefined || !canLoadHistory(chat)) {
        return;
      }
      pendingOpenChatId = undefined;
      void openHistory(pending);
    }

    function canLoadHistory(chat: ChatSummary): boolean {
      return (
        core !== undefined && get().status === 'online' && (chat.kind !== 'group' || groupsJoined)
      );
    }

    async function openHistory(chatId: string): Promise<void> {
      const chat = get().chats.find((entry) => entry.id === chatId);
      const current = core;
      // `core` is assigned before `connect()` resolves, so "ready" means
      // online: a MAM query sent while still connecting fails.
      if (current === undefined || chat === undefined || !canLoadHistory(chat)) {
        // The chat screen mounted before the data was there (e.g. a reload
        // of /c/<jid>). Remember it and load once both are ready.
        pendingOpenChatId = chatId;
        setHistoryState(chatId, 'loading');
        return;
      }
      if (loadingHistory.has(chatId)) {
        // A load for this chat is already in flight; it covers this open.
        if (pendingOpenChatId === chatId) {
          pendingOpenChatId = undefined;
        }
        return;
      }
      if (pendingOpenChatId === chatId) {
        pendingOpenChatId = undefined;
      }
      loadingHistory.add(chatId);
      setHistoryState(chatId, 'loading');
      try {
        const page = await current.loadHistory(chatId, coreKind(chat), { max: PAGE_HISTORY_MAX });
        ingestHistoryReactions(page.messages);
        const loaded = page.messages
          .filter((message) => message.reactions === undefined)
          .map((message) => toUiMessage(message, get().currentUserId));
        const newest = loaded.at(-1);
        set((state) => {
          const live = listFor(state, chatId).filter(
            (message) => !loaded.some((item) => item.id === message.id),
          );
          return {
            messagesByChat: {
              ...state.messagesByChat,
              [chatId]: sortMessages([...loaded, ...live]),
            },
            historyComplete: { ...state.historyComplete, [chatId]: page.complete },
            chats:
              newest === undefined
                ? state.chats
                : state.chats.map((entry) =>
                    entry.id === chatId ? { ...entry, lastMessage: newest } : entry,
                  ),
          };
        });
        cursors[chatId] = page.first;
        const last = loaded.at(-1);
        if (last !== undefined) {
          recordRead(chatId, last.id);
          current.markDisplayed(chatId, coreKind(chat), last.id);
        }
        setHistoryState(chatId, 'ready');
      } catch {
        // Keep whatever live messages we have; the view offers a retry.
        setHistoryState(chatId, 'error');
      } finally {
        loadingHistory.delete(chatId);
      }
      flushPending();
    }

    function loadOlder(chatId: string): void {
      const chat = get().chats.find((entry) => entry.id === chatId);
      const cursor = cursors[chatId];
      if (
        core === undefined ||
        chat === undefined ||
        cursor === undefined ||
        loadingOlder.has(chatId)
      ) {
        return;
      }
      loadingOlder.add(chatId);
      void core
        .loadHistory(chatId, coreKind(chat), { before: cursor, max: PAGE_HISTORY_MAX })
        .then((page) => {
          ingestHistoryReactions(page.messages);
          const older = page.messages
            .filter((message) => message.reactions === undefined)
            .map((message) => toUiMessage(message, get().currentUserId));
          set((state) => ({
            messagesByChat: {
              ...state.messagesByChat,
              [chatId]: sortMessages([...older, ...listFor(state, chatId)]),
            },
            historyComplete: { ...state.historyComplete, [chatId]: page.complete },
          }));
          cursors[chatId] = page.first;
        })
        .catch(() => {
          // A failed page load leaves the cursor for a later retry.
        })
        .finally(() => {
          loadingOlder.delete(chatId);
        });
    }

    async function boot(gen: number): Promise<void> {
      let me: Me;
      let entries: ChatEntry[];
      let contacts: Contact[];
      try {
        [me, entries, contacts] = await Promise.all([
          api.getMe(),
          api.getChats(),
          api.getContacts(),
        ]);
      } catch {
        if (gen === generation) {
          set({ status: 'offline', chatsState: 'error' });
        }
        return;
      }
      if (gen !== generation) {
        return;
      }

      lastReadUserId = me.id;
      lastRead = readLastRead(storage, me.id);
      rememberGroupIds(entries);
      set({
        me,
        currentUserId: me.id,
        chats: mergeWithPainted(get().chats, entries.map(summaryFor), cachedUserId === me.id),
        contacts,
        chatsState: 'ready',
      });
      startDraftStream(gen);
      flushPending();
      await connectXmpp(gen, me);
    }

    // After a failed token or login, try again with growing waits instead of
    // staying offline until a reload (a 429 on the token route used to leave
    // the app on "Waiting for network…" for good).
    function scheduleConnectRetry(gen: number, me: Me): void {
      if (gen !== generation || connectRetryTimer !== undefined) {
        return;
      }
      const delay =
        CONNECT_RETRY_DELAYS_MS[Math.min(connectRetryAttempt, CONNECT_RETRY_DELAYS_MS.length - 1)];
      connectRetryAttempt += 1;
      connectRetryTimer = setTimeout(() => {
        connectRetryTimer = undefined;
        if (gen === generation) {
          void connectXmpp(gen, me);
        }
      }, delay);
    }

    async function connectXmpp(gen: number, me: Me): Promise<void> {
      let token: XmppToken;
      try {
        token = await api.getXmppToken();
      } catch {
        if (gen === generation) {
          set({ status: 'offline' });
          scheduleConnectRetry(gen, me);
        }
        return;
      }
      if (gen !== generation) {
        return;
      }
      firstToken = token;

      const options: XmppCoreOptions = {
        service: token.service,
        domain: token.domain,
        getToken: async () => {
          if (firstToken !== undefined) {
            const fresh = firstToken;
            firstToken = undefined;
            return { jid: fresh.jid, token: fresh.token };
          }
          const fresh = await api.getXmppToken();
          return { jid: fresh.jid, token: fresh.token };
        },
      };

      const current = createXmpp(options);
      core = current;
      subscribe(current);
      try {
        await current.connect();
      } catch {
        if (gen === generation) {
          set({ status: 'offline' });
          for (const unsubscribe of unsubscribers) {
            unsubscribe();
          }
          unsubscribers = [];
          core = undefined;
          void current.disconnect().catch(() => {});
          scheduleConnectRetry(gen, me);
        }
        return;
      }
      if (gen !== generation) {
        void current.disconnect().catch(() => {});
        return;
      }
      connectRetryAttempt = 0;
      set({ status: 'online' });
      flushPending();
      await joinGroups(current, me);
      if (gen === generation) {
        groupsJoined = true;
        flushPending();
      }
      await Promise.all(get().chats.map((chat) => loadPreview(current, chat)));
      if (gen === generation) {
        set((state) => ({ chats: sortByRecency(state.chats) }));
        saveChatList();
      }
    }

    return {
      currentUserId: '',
      me: undefined,
      status: 'offline',
      chatsState: 'loading',
      historyState: {},
      // Unknown means never requested, and the real store never has data
      // without requesting it: that is still loading, never empty.
      historyStateFor: (chatId) => get().historyState[chatId] ?? 'loading',
      chats: [],
      contacts: [],
      messagesByChat: {},
      reactions: {},
      activeChatId: undefined,
      historyComplete: {},
      groupInfos: {},
      search: '',
      activeFolder: 'all',
      typing: {},
      drafts: {},
      finishedDraftMessages: {},
      messages: (chatId) => get().messagesByChat[chatId] ?? [],
      groupMembers: (chatId) => [...(groupMembers.get(chatId)?.values() ?? [])],
      groupInfo: (chatId) => get().groupInfos[chatId],
      refreshGroupInfo: (chatId) => {
        void ensureGroupMembers(chatId, true);
      },
      listMyAis: () => api.listAis(),
      addGroupAi: async (chatId, aiId) => {
        const groupId = groupIds.get(chatId);
        const mine = myJid();
        if (groupId === undefined || mine === undefined) {
          throw new Error('This group is not available yet.');
        }
        const domain = mine.slice(mine.indexOf('@') + 1);
        const detail = await api.addGroupAi(groupId, aiId);
        applyGroupDetail(chatId, detail, domain);
      },
      removeGroupAi: async (chatId, aiId) => {
        const groupId = groupIds.get(chatId);
        const mine = myJid();
        if (groupId === undefined || mine === undefined) {
          throw new Error('This group is not available yet.');
        }
        const domain = mine.slice(mine.indexOf('@') + 1);
        const detail = await api.removeGroupAi(groupId, aiId);
        applyGroupDetail(chatId, detail, domain);
      },
      hasMore: (chatId) => get().historyComplete[chatId] !== true && cursors[chatId] !== undefined,
      openChat: (chatId) => {
        set({ activeChatId: chatId });
        recordRead(chatId, lastRead[chatId]);
        void ensureGroupMembers(chatId);
        if (pendingOpenChatId !== undefined && pendingOpenChatId !== chatId) {
          clearSupersededMarker(pendingOpenChatId);
        }
        pendingOpenChatId = chatId;
        void openHistory(chatId);
      },
      retryChats: () => {
        generation += 1;
        const gen = generation;
        set({ chatsState: 'loading' });
        void boot(gen);
      },
      retryHistory: (chatId) => {
        void openHistory(chatId);
      },
      loadOlder,
      react: (chatId, messageId, emoji) => {
        const chat = get().chats.find((entry) => entry.id === chatId);
        const mine = myJid();
        if (chat === undefined || mine === undefined) {
          return;
        }
        const targetId = aliasRoot(messageId);
        const current = get().reactions[chatId]?.targets[targetId]?.[mine]?.emojis ?? [];
        const next = current.includes(emoji)
          ? current.filter((entry) => entry !== emoji)
          : [...current, emoji];
        const apply = (emojis: string[]): void => {
          applyReactionUpdate(chatId, targetId, mine, emojis, now().getTime());
        };
        apply(next);
        const currentCore = core;
        if (currentCore === undefined) {
          return;
        }
        currentCore.sendReactions(chatId, coreKind(chat), messageId, next).catch(() => {
          // The send failed: undo the optimistic toggle.
          apply(current);
        });
      },
      sendTyping: (chatId) => {
        const chat = get().chats.find((entry) => entry.id === chatId);
        if (core !== undefined && chat !== undefined) {
          core.sendTyping(chatId, coreKind(chat), 'composing');
        }
      },
      sendText: (chatId, text, options) => {
        const trimmed = text.trim();
        const chat = get().chats.find((entry) => entry.id === chatId);
        if (trimmed.length === 0 || chat === undefined) {
          return;
        }
        const mentions = mentionsForTrimmedText(text, trimmed, options?.mentions ?? []);
        sequence += 1;
        const localId = `local-${sequence}`;
        const replyTo = options?.replyTo;
        const message: UiMessage = {
          id: localId,
          chatId,
          senderId: get().currentUserId,
          senderName: 'You',
          text: trimmed,
          createdAt: now(),
          status: 'sending',
          ...(mentions.length === 0 ? {} : { mentions }),
          ...(replyTo === undefined ? {} : { replyTo }),
        };
        const signature = signatureFor(chatId, trimmed, replyTo);
        const queue = pendingOutgoing.get(signature) ?? [];
        queue.push(localId);
        pendingOutgoing.set(signature, queue);
        setChatMessage(chatId, message, true);

        if (core === undefined) {
          return;
        }
        core
          .sendMessage(chatId, coreKind(chat), trimmed, {
            ...(replyTo === undefined ? {} : { replyTo: { id: replyTo.id } }),
            ...(mentions.length === 0
              ? {}
              : {
                  mentions: mentions.map((mention) => ({
                    jid: mention.jid,
                    begin: mention.begin,
                    end: mention.end,
                  })),
                }),
          })
          .then((sent) => {
            linkMessageIds(localId, sent.id);
            updateMessageStatus(chatId, localId, 'sent');
          })
          .catch(() => {
            // The message stays marked as sending; a reconnect can resend later.
          });
      },
      sendVoice: (chatId, recording, options) => {
        const chat = get().chats.find((entry) => entry.id === chatId);
        if (chat === undefined || recording.blob.size === 0) {
          return;
        }
        sequence += 1;
        const localId = `local-${sequence}`;
        const replyTo = options?.replyTo;
        const localUrl = objectUrlFor(recording.blob);
        const waveform = recording.waveform.length > 0 ? recording.waveform : [12];
        const message: UiMessage = {
          id: localId,
          chatId,
          senderId: get().currentUserId,
          senderName: 'You',
          createdAt: now(),
          status: 'sending',
          voice: {
            duration_ms: Math.max(1, recording.durationMs),
            mime: 'audio/mp4',
            waveform,
            ...(localUrl === undefined ? {} : { url: localUrl }),
          },
          ...(replyTo === undefined ? {} : { replyTo }),
        };
        const signature = signatureFor(chatId, '', replyTo);
        const queue = pendingOutgoing.get(signature) ?? [];
        queue.push(localId);
        pendingOutgoing.set(signature, queue);
        setChatMessage(chatId, message, true);

        const current = core;
        if (current === undefined) {
          return;
        }

        void (async () => {
          try {
            const converted = await voicePort.convert(recording.blob);
            const url = await voicePort.upload(current, converted.audio);
            const voice: VoiceMeta = {
              duration_ms: converted.durationMs,
              mime: 'audio/mp4',
              waveform,
              url,
            };
            updateMessageVoice(chatId, localId, voice);
            const sent = await current.sendMessage(chatId, coreKind(chat), '', {
              payload: { v: 0, type: 'voice', data: voice },
              ...(replyTo === undefined ? {} : { replyTo: { id: replyTo.id } }),
            });
            linkMessageIds(localId, sent.id);
            updateMessageStatus(chatId, localId, 'sent');
          } catch {
            // The optimistic bubble keeps its local audio and stays "sending";
            // the next attempt would resend after a reconnect.
          }
        })();
      },
      createGroup: async (title, memberIds) => {
        const detail = await api.createGroup({ title, memberIds });
        const entries = await api.getChats();
        rememberGroupIds(entries);
        const previous = get().chats;
        set({
          chats: sortByRecency(
            entries.map((entry) => {
              const before = previous.find((chat) => chat.id === entry.chatJid);
              const summary = summaryFor(entry);
              return before === undefined
                ? summary
                : {
                    ...summary,
                    ...(before.lastMessage === undefined
                      ? {}
                      : { lastMessage: before.lastMessage }),
                    unread: before.unread,
                    ...(before.online === undefined ? {} : { online: before.online }),
                  };
            }),
          ),
        });
        const created = entries.find(
          (entry) => entry.kind === 'group' && entry.groupId === detail.id,
        );
        if (created === undefined) {
          throw new Error('the new group did not appear in the chat list');
        }
        const me = get().me;
        if (core !== undefined && me !== undefined) {
          await core.joinRoom(created.chatJid, nick(me)).catch(() => {});
        }
        void ensureGroupMembers(created.chatJid);
        await openHistory(created.chatJid);
        return created.chatJid;
      },
      createInvite: async () => {
        const invite = await api.createInvite();
        return invite.url;
      },
      signOut: async () => {
        get().stop();
        clearChatListCache(storage);
        cachedUserId = undefined;
        lastRead = {};
        if (storage !== null && lastReadUserId !== undefined) {
          try {
            storage.removeItem(`${LAST_READ_PREFIX}${lastReadUserId}`);
          } catch {
            // Ignore storage failures on the way out.
          }
        }
        set({
          currentUserId: '',
          me: undefined,
          status: 'offline',
          chatsState: 'loading',
          historyState: {},
          chats: [],
          contacts: [],
          messagesByChat: {},
          reactions: {},
          activeChatId: undefined,
          historyComplete: {},
          groupInfos: {},
          typing: {},
          drafts: {},
          finishedDraftMessages: {},
          search: '',
          activeFolder: 'all',
        });
        groupMembers.clear();
        groupInfos.clear();
        try {
          await authClient.signOut();
        } catch {
          // The app still clears local state even if sign-out fails.
        }
        // A reload gives the next user a fresh store and XMPP connection.
        if (typeof window !== 'undefined') {
          window.location.assign('/login');
        }
      },
      start: () => {
        generation += 1;
        if (get().chats.length === 0) {
          const cached = readChatListCache(storage);
          if (cached === null) {
            set({ chatsState: 'loading' });
          } else {
            // Paint the last list at once; boot replaces it with fresh data.
            cachedUserId = cached.userId;
            set({ chats: cached.chats, chatsState: 'ready' });
          }
        }
        if (typeof window !== 'undefined') {
          window.addEventListener('pagehide', saveChatList);
        }
        void boot(generation);
      },
      stop: () => {
        generation += 1;
        closeDraftStream?.();
        closeDraftStream = undefined;
        clearDraftState();
        set({ drafts: {}, finishedDraftMessages: {} });
        pendingOpenChatId = undefined;
        for (const unsubscribe of unsubscribers) {
          unsubscribe();
        }
        unsubscribers = [];
        for (const timer of Object.values(typingTimers)) {
          clearTimeout(timer);
        }
        typingTimers = {};
        if (refreshTimer !== undefined) {
          clearTimeout(refreshTimer);
          refreshTimer = undefined;
        }
        if (connectRetryTimer !== undefined) {
          clearTimeout(connectRetryTimer);
          connectRetryTimer = undefined;
        }
        connectRetryAttempt = 0;
        groupsJoined = false;
        if (typeof window !== 'undefined') {
          window.removeEventListener('pagehide', saveChatList);
        }
        const current = core;
        core = undefined;
        if (current !== undefined) {
          void current.disconnect().catch(() => {});
        }
      },
      setSearch: (value) => set({ search: value }),
      setActiveFolder: (folder) => set({ activeFolder: folder }),
    };
  });
}

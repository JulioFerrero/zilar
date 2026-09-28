import type { ChatSummary, MessageStatus, ReplyRef, UiMessage } from '@galena/chat-core';
import {
  createXmppCore,
  type ChatMessage,
  type Occupant,
  type PresenceEvent,
  type XmppCore,
  type XmppCoreOptions,
} from '@galena/xmpp-core';
import { createStore, type StoreApi } from 'zustand/vanilla';

import {
  createChatApi,
  type ChatApi,
  type ChatEntry,
  type Contact,
  type Me,
} from '../lib/chat-api';
import { API_URL } from '../lib/auth';
import {
  DRAFT_STREAM_PATH,
  subscribeToDrafts,
  type DraftEndEvent,
  type DraftHubEvent,
  type OpenDraftStream,
} from '../lib/drafts';
import { getSessionToken } from '../lib/session-token';
import { CURRENT_USER_ID } from '../lib/types';
import type { ChatStoreState, ConnectionStatus, DraftState } from './types';

const PREVIEW_HISTORY_MAX = 1;
const PAGE_HISTORY_MAX = 50;
const TYPING_CLEAR_MS = 5000;
const CHAT_REFRESH_DEBOUNCE_MS = 500;

// A finished draft is kept until its final XMPP message arrives. If that never
// happens (XMPP down), it is dropped after this long so it cannot stick.
export const DRAFT_END_FALLBACK_MS = 5_000;

// A draft that sees no further event for this long is stale (e.g. the server
// restarted mid-turn); the idle timer drops it rather than leaving it forever.
export const DRAFT_IDLE_MS = 60_000;

// Finished turn ids are remembered only to ignore a late `draft`. The set is
// capped so it cannot grow for the life of the app session.
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

/** The slice of React Native's `AppState` the store listens to. */
export interface AppStateLike {
  current(): string;
  subscribe(handler: (state: string) => void): () => void;
}

export interface RealStoreDeps {
  api?: ChatApi;
  createXmpp?: (options: XmppCoreOptions) => XmppCore;
  now?: () => Date;
  appState?: AppStateLike;
  /** The AI draft SSE stream; tests inject a fake. */
  openDrafts?: OpenDraftStream;
}

function coreKind(chat: ChatSummary): 'chat' | 'groupchat' {
  return chat.kind === 'group' ? 'groupchat' : 'chat';
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

// The default `AppState` seam: always foreground and never changes. The app
// injects React Native's real `AppState` so a real device reconnects on resume.
const alwaysActive: AppStateLike = {
  current: () => 'active',
  subscribe: () => () => {},
};

/** The subset of a message needed to resolve a sender name. */
interface SenderInput {
  chatJid: string;
  fromJid: string;
  outgoing: boolean;
  fromNick?: string;
}

/**
 * The real store: the same behaviour as the web (`apps/web/src/store/realStore.ts`)
 * with mobile storage/AppState seams. It loads chats and contacts over HTTP,
 * connects `xmpp-core`, and turns its events into store updates.
 */
export function createRealChatStore(deps: RealStoreDeps = {}): StoreApi<ChatStoreState> {
  const api = deps.api ?? createChatApi(getSessionToken);
  const now = deps.now ?? ((): Date => new Date());
  const appState = deps.appState ?? alwaysActive;
  const createXmpp = deps.createXmpp ?? ((options: XmppCoreOptions) => createXmppCore(options));
  const openDrafts =
    deps.openDrafts ??
    ((onEvent) =>
      subscribeToDrafts(onEvent, {
        url: `${API_URL}${DRAFT_STREAM_PATH}`,
        getToken: getSessionToken,
        appState,
      }));

  return createStore<ChatStoreState>((set, get) => {
    let core: XmppCore | undefined;
    let unsubscribers: Array<() => void> = [];
    let removeAppState: (() => void) | undefined;
    let typingTimers: Record<string, ReturnType<typeof setTimeout>> = {};
    // Closes the draft stream once opened; undefined means it is not open.
    let closeDraftStream: (() => void) | undefined;
    // Idle/fallback removal of a draft, keyed by chat id.
    const draftTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
    // Turn ids whose draft is done, so a late `draft` is ignored.
    const finishedTurns = new Set<string>();
    const finishedTurnOrder: string[] = [];
    let sequence = 0;
    let lastRead: Record<string, string> = {};
    let generation = 0;
    let started = false;
    let firstToken: { jid: string; token: string } | undefined;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const cursors: Record<string, string | undefined> = {};
    const pendingOutgoing = new Map<string, string[]>();
    const messageAliases = new Map<string, string>();
    const groupIds = new Map<string, string>();
    // chatId -> (lowercased userId -> display name)
    const groupMembers = new Map<string, Map<string, string>>();
    const loadingGroupMembers = new Set<string>();
    const loadingOlder = new Set<string>();

    function isVisible(): boolean {
      return appState.current() === 'active';
    }

    function recordRead(chatId: string, messageId: string | undefined): void {
      if (messageId !== undefined) {
        lastRead[chatId] = messageId;
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
      const name = members.get(localpart);
      return name !== undefined && name !== '' ? name : undefined;
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
    function senderNameFor(message: SenderInput): string {
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

    function rememberGroupIds(entries: ChatEntry[]): void {
      for (const entry of entries) {
        if (entry.kind === 'group') {
          groupIds.set(entry.chatJid, entry.groupId);
        }
      }
    }

    // Loads the member names of a group once per chat, so a typing indicator
    // or a message from a member who is not a contact can still show a name.
    async function ensureGroupMembers(chatId: string): Promise<void> {
      if (groupMembers.has(chatId) || loadingGroupMembers.has(chatId)) {
        return;
      }
      const groupId = groupIds.get(chatId);
      if (groupId === undefined) {
        return;
      }
      loadingGroupMembers.add(chatId);
      try {
        const detail = await api.getGroup(groupId);
        const members = new Map<string, string>();
        for (const member of detail.members) {
          members.set(member.userId.toLowerCase(), member.name);
        }
        groupMembers.set(chatId, members);
      } catch {
        // The name falls back to the occupant nick or "Someone".
      } finally {
        loadingGroupMembers.delete(chatId);
      }
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

    // (Re)arms the one removal timer of a chat, replacing any previous one. It
    // removes the draft only when the same turn is still shown, so a newer
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

    // A draft disappears only once its final message is there, so the two never
    // leave a gap. Each `draft` re-arms an idle timer (a dead turn, e.g. the
    // server restarted mid-turn, would otherwise leave the bubble forever);
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
              ? { ...chat, lastMessage: ui, unread: active ? 0 : chat.unread + 1 }
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
      if (active && core !== undefined) {
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
      });
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
        current.on('status', (status: ConnectionStatus) => set({ status })),
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
        const last = page.messages.at(-1);
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
        }
        cursors[chat.id] = page.first;
        set((state) => ({
          historyComplete: { ...state.historyComplete, [chat.id]: page.complete },
        }));
      } catch {
        // Preview is best-effort; the chat still works when opened.
      }
    }

    async function openHistory(chatId: string): Promise<void> {
      const chat = get().chats.find((entry) => entry.id === chatId);
      if (core === undefined || chat === undefined) {
        return;
      }
      try {
        const page = await core.loadHistory(chatId, coreKind(chat), { max: PAGE_HISTORY_MAX });
        const loaded = page.messages.map((message) => toUiMessage(message, get().currentUserId));
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
          core.markDisplayed(chatId, coreKind(chat), last.id);
        }
      } catch {
        // Keep whatever live messages we have.
      }
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
          const older = page.messages.map((message) => toUiMessage(message, get().currentUserId));
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
          set({ status: 'offline' });
        }
        return;
      }
      if (gen !== generation) {
        return;
      }

      lastRead = {};
      rememberGroupIds(entries);
      set({
        me,
        currentUserId: me.id,
        chats: entries.map(summaryFor),
        contacts,
      });
      startDraftStream(gen);

      let token: { jid: string; token: string; service: string; domain: string };
      try {
        token = await api.getXmppToken();
      } catch {
        if (gen === generation) {
          set({ status: 'offline' });
        }
        return;
      }
      if (gen !== generation) {
        return;
      }
      firstToken = { jid: token.jid, token: token.token };

      const options: XmppCoreOptions = {
        service: token.service,
        domain: token.domain,
        getToken: async () => {
          if (firstToken !== undefined) {
            const fresh = firstToken;
            firstToken = undefined;
            return fresh;
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
        }
        return;
      }
      if (gen !== generation) {
        void current.disconnect().catch(() => {});
        return;
      }
      set({ status: 'online' });
      await joinGroups(current, me);
      await Promise.all(get().chats.map((chat) => loadPreview(current, chat)));
      if (gen === generation) {
        set((state) => ({ chats: sortByRecency(state.chats) }));
      }
    }

    // A real device suspends the socket in the background, so on resume we must
    // not assume it is alive: reconnect whenever the status is not `online`.
    async function reconnect(): Promise<void> {
      if (!started) {
        return;
      }
      const current = core;
      if (current === undefined) {
        await boot(generation);
        return;
      }
      if (get().status === 'online') {
        return;
      }
      try {
        await current.connect();
        set({ status: 'online' });
        const me = get().me;
        if (me !== undefined) {
          await joinGroups(current, me);
        }
      } catch {
        set({ status: 'offline' });
      }
    }

    return {
      currentUserId: CURRENT_USER_ID,
      me: undefined,
      status: 'offline',
      chats: [],
      contacts: [],
      messagesByChat: {},
      activeChatId: null,
      historyComplete: {},
      search: '',
      activeFolder: 'all',
      typing: {},
      drafts: {},
      finishedDraftMessages: {},
      messages: (chatId) => get().messagesByChat[chatId] ?? [],
      hasMore: (chatId) => get().historyComplete[chatId] !== true && cursors[chatId] !== undefined,
      openChat: (chatId) => {
        set({ activeChatId: chatId });
        recordRead(chatId, lastRead[chatId]);
        void ensureGroupMembers(chatId);
        void openHistory(chatId);
      },
      loadOlder,
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
          .sendMessage(
            chatId,
            coreKind(chat),
            trimmed,
            replyTo === undefined ? undefined : { replyTo: { id: replyTo.id } },
          )
          .then((sent) => {
            linkMessageIds(localId, sent.id);
            updateMessageStatus(chatId, localId, 'sent');
          })
          .catch(() => {
            // The message stays marked as sending; a reconnect can resend later.
          });
      },
      setSearch: (value) => set({ search: value }),
      setActiveFolder: (folder) => set({ activeFolder: folder }),
      start: () => {
        if (started) {
          return;
        }
        started = true;
        generation += 1;
        removeAppState = appState.subscribe((state) => {
          if (state !== 'active') {
            return;
          }
          void reconnect();
        });
        void boot(generation);
      },
      stop: () => {
        started = false;
        generation += 1;
        if (removeAppState !== undefined) {
          removeAppState();
          removeAppState = undefined;
        }
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
        closeDraftStream?.();
        closeDraftStream = undefined;
        clearDraftState();
        set({ drafts: {}, finishedDraftMessages: {} });
        const current = core;
        core = undefined;
        if (current !== undefined) {
          void current.disconnect().catch(() => {});
        }
        set({ status: 'offline' });
      },
    };
  });
}

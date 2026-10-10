import type { ChatSummary, MentionMember, UiMessage } from '@zilar/chat-core';
import { forwardedPayloadFor, forwardedUiFieldsFor } from '@zilar/chat-core';
import {
  advanceStatus,
  clearFailure,
  coreKind,
  createMessageLedger,
  moveChatToTop,
  rememberFinishedDraftMessage,
  signatureFor,
  sortByRecency,
  sortMessages,
  stickerSignatureFor,
  withoutDraft,
} from '@zilar/client-core/store';
import { Effect } from 'effect';
import {
  type ChatMessage,
  type Occupant,
  type PresenceEvent,
  type XmppCore,
} from '@zilar/xmpp-core';
import { ForwardOriginSchema, isValid, type ForwardOrigin } from '@zilar/protocol';
import { createAtomStore, type StoreApi } from './atomStore';

import type { ChatEntry, GroupDetail, Me } from '../lib/chat-api';
import type { ChatPref } from '../lib/chat-prefs-api';
import { type ApproverRole, type Topic, type TopicRole } from '../lib/topics-api';
import type { CustomGroupRole } from '../lib/roles-api';
import { summariesForTopicsEntry } from '../lib/topics';
import { makeEvents } from './effects/events';
import { makeGroups } from './effects/groups';
import { makeHistory } from './effects/history';
import { makeLifecycle } from './effects/lifecycle';
import { makePins } from './effects/pins';
import { makeSend } from './effects/send';
import { makePolling } from './effects/polling';
import { Ports, PortsLive, type RealStoreDeps } from './effects/ports';
import { makeLife, makeRunners, type StoreCtx, type StoreState } from './effects/runtime';
import type { MediaTokenShape } from '../lib/attachments';
import type { PickedFile } from '../lib/attachment-ports';
import type { RecordedVoice } from '../lib/voice';
import type { VoiceFailureReason } from '../lib/voice-native';
import { CURRENT_USER_ID, mobileUploadOf, type MobileMessage } from '../lib/types';
import type { ChatStoreState } from './types';

export { MESSAGE_JUMP_MAX_PAGES, MESSAGE_JUMP_WAIT_MS } from './effects/history';
export {
  DRAFT_END_FALLBACK_MS,
  DRAFT_IDLE_MS,
  PINS_REFRESH_INTERVAL_MS,
  TOPIC_REFRESH_INTERVAL_MS,
} from './effects/polling';

export type { AppStateLike, RealStoreDeps } from './effects/ports';

/**
 * XEP-0308 corrections, XEP-0424 retractions and XEP-0444 reactions arrive as
 * their own stanzas. They are never chat messages: an edit carries the new
 * full body, a retraction is empty, and a reaction-only update carries no body.
 * The store applies them through `ingestEdit` / `ingestReaction` instead of
 * adding them as their own bubble or preview row.
 */
export function isUpdateStanza(message: ChatMessage): boolean {
  return (
    message.correction !== undefined ||
    message.retraction !== undefined ||
    message.reactions !== undefined
  );
}

function summaryFor(entry: ChatEntry): ChatSummary {
  const base = {
    id: entry.chatJid,
    title: entry.title,
    isAI: entry.kind === 'dm' && entry.isAi === true,
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

/**
 * One `/api/chats` entry to its chat rows (T-0112): DMs map to one row; a
 * group with `topics` maps to one row per visible topic (General keeps the
 * group's old chat id); a group without the field keeps its single legacy
 * row. Malformed topic rows are dropped by `chatEntryTopics`, never rendered.
 */
export function summariesFor(entry: ChatEntry): ChatSummary[] {
  if (entry.kind !== 'group') {
    return [summaryFor(entry)];
  }
  const rows = summariesForTopicsEntry(entry);
  // `summariesForTopicsEntry` already falls back to the legacy row for an
  // older server; `summariesFor` only keeps the export beside `summaryFor`.
  return rows;
}

/**
 * The real store: the same behaviour as the web (`apps/web/src/store/realStore.ts`)
 * with mobile storage/AppState seams. It loads chats and contacts over HTTP,
 * connects `xmpp-core`, and turns its events into store updates.
 */
// One shared empty list: a selector must return the same reference while
// nothing changed, or React re-renders forever ("Maximum update depth").
const EMPTY_MESSAGES: UiMessage[] = [];

export function createRealChatStore(deps: RealStoreDeps = {}): StoreApi<ChatStoreState> {
  // Every outside dependency comes from the `Ports` layer (injected or live).
  const ports = Effect.runSync(Ports.use(Effect.succeed).pipe(Effect.provide(PortsLive(deps))));
  const { now, appState } = ports;
  // The trusted media hosts (T-0150): the service host, the XMPP domain and
  // `upload.<domain>`, from the latest XMPP token. Incoming image (and
  // GIF-video) attachments auto-load only from these hosts; anything else is
  // downgraded to a file row that never fetches without a tap.
  let mediaToken: MediaTokenShape | undefined;
  let mediaTrustedHosts: ReadonlySet<string> = new Set();

  // The local bytes of an outgoing attachment, kept for a Retry after a
  // failed upload (like web's `pendingAttachments`).
  const pendingUploads = new Map<string, PickedFile>();
  // A finished voice recording per optimistic message, kept for a Retry after
  // a failed convert/upload/send (like web's `pendingVoices`, T-0154).
  const pendingVoices = new Map<string, RecordedVoice>();

  return createAtomStore<ChatStoreState>((set, get) => {
    let core: XmppCore | undefined;
    let lastRead: Record<string, string> = {};
    const cursors: Record<string, string | undefined> = {};
    const pendingOutgoing = new Map<string, string[]>();
    const groupIds = new Map<string, string>();
    // groupId -> the group detail (people + roles + AIs), loaded on demand by
    // the topics screen and the task strip owner picker. Keyed by group id
    // (not chat id) so every topic row of a group shares one entry; the one
    // exception is a legacy group row, whose own chat id doubles as the key
    // until the server answers (see `rememberGroupIds`).
    const groupDetails = new Map<string, GroupDetail>();
    const loadingGroupDetails = new Set<string>();
    // groupId -> the custom roles (T-0137), loaded on demand by the group
    // screen. Keyed by group id like `groupDetails` so every topic row of a
    // group shares one entry; published through `set()` (the
    // `groupDetailsRevision` bump) so selectors re-fire. Replaced wholesale
    // on every successful load or role write.
    const groupRolesById = new Map<string, CustomGroupRole[]>();
    const loadingGroupRoles = new Set<string>();
    // topicId -> the attached roles + approver role (T-0137), loaded on
    // demand by the topic info sheet. Replaced wholesale from every full
    // topic response, so a private-to-public flip never leaves stale roles
    // behind (the server clears them, and the response carries none).
    const topicRolesById = new Map<
      string,
      { roles: TopicRole[]; approverRole: ApproverRole | null }
    >();
    const loadingTopicRoles = new Set<string>();
    // Per-user chat prefs (T-0135), keyed by lowercase chat JID. Loaded with
    // the chat list at boot and after every background refresh. The API
    // client is injected by the app (`RealStoreDeps.chatPrefsApi`); tests
    // that never touch prefs inject nothing and read empty rows.
    let chatPrefRows: ChatPref[] = [];

    // The user's chat folders (T-0248), sorted by position, are loaded with
    // the chats (`effects/history.ts`) and written in `effects/events.ts`; a
    // missing client keeps `[]`.
    // chatId -> (lowercased userId -> display name)
    const groupMembers = new Map<string, Map<string, string>>();
    const loadingGroupMembers = new Set<string>();
    const loadingOlder = new Set<string>();
    // First-page history loads currently in flight, by chat id (T-0067).
    const loadingHistory = new Set<string>();
    // A chat opened before the core was connected or before the chats had
    // arrived. Only the latest one counts; it loads once both are ready.
    let pendingOpenChatId: string | undefined;
    // True once the group rooms are joined; a MAM query for a group before that
    // fails, so a pending group history waits for it (T-0067).
    let groupsJoined = false;

    // The state the effect modules share. The members that code in this
    // closure still reads by their old names are bridged to those names.
    const life = makeLife();
    const s: StoreState = {
      get core() {
        return core;
      },
      set core(value) {
        core = value;
      },
      started: false,
      firstToken: undefined,
      boot: undefined,
      cursors,
      loadingHistory,
      loadingOlder,
      groupIds,
      pendingOutgoing,
      pendingUploads,
      pendingVoices,
      groupDetails,
      loadingGroupDetails,
      groupRolesById,
      loadingGroupRoles,
      topicRolesById,
      loadingTopicRoles,
      groupMembers,
      loadingGroupMembers,
      get groupsJoined() {
        return groupsJoined;
      },
      set groupsJoined(value) {
        groupsJoined = value;
      },
      get pendingOpenChatId() {
        return pendingOpenChatId;
      },
      set pendingOpenChatId(value) {
        pendingOpenChatId = value;
      },
      get mediaToken() {
        return mediaToken;
      },
      set mediaToken(value) {
        mediaToken = value;
      },
      get mediaTrustedHosts() {
        return mediaTrustedHosts;
      },
      set mediaTrustedHosts(value) {
        mediaTrustedHosts = value;
      },
      get lastRead() {
        return lastRead;
      },
      set lastRead(value) {
        lastRead = value;
      },
      get chatPrefRows() {
        return chatPrefRows;
      },
      set chatPrefRows(value) {
        chatPrefRows = value;
      },
    };

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

    // Message ids and aliases, edits, reactions, mentions, sender names and
    // the message mutators (`@zilar/client-core/store`).
    const ledger = createMessageLedger({
      get,
      set,
      memberName: (chatId, localpart) => groupMembers.get(chatId)?.get(localpart),
      occupantNick: (chatId, fromJid) =>
        core?.occupants(chatId).find((item) => item.realJid === fromJid || item.jid === fromJid)
          ?.nick,
      mediaToken: () => mediaToken,
    });
    const {
      aliasRoot,
      authorFor,
      applyReactionUpdate,
      correctionTargetFor,
      ingestEdit,
      ingestHistoryEdits,
      ingestHistoryReactions,
      ingestReaction,
      isEditStanza,
      isOwnSender,
      isReactionOnly,
      linkLocalToServer,
      linkMessageIds,
      listFor,
      myJid,
      previewFor,
      refreshEdits,
      refreshReactions,
      rememberAuthor,
      rememberOriginId,
      resolvePendingEdits,
      restoreEdits,
      restoreMessage,
      retractionTargetFor,
      sameMessage,
      senderNameFor,
      toUiMessage,
      updateMessageAttachment,
      updateMessageStatus,
      updateMessageVoice,
      withEdits,
      wireTargetFor,
    } = ledger;

    function clearAttachmentFailure(chatId: string, messageId: string): void {
      set((state) => ({
        messagesByChat: {
          ...state.messagesByChat,
          [chatId]: listFor(state, chatId).map((item) =>
            sameMessage(item.id, messageId) ? clearFailure(item) : item,
          ),
        },
      }));
    }

    function setUploadProgress(chatId: string, messageId: string, progress: number): void {
      set((state) => ({
        messagesByChat: {
          ...state.messagesByChat,
          [chatId]: listFor(state, chatId).map((item) =>
            sameMessage(item.id, messageId)
              ? {
                  ...item,
                  uploadProgress: Math.min(1, Math.max(0, progress)),
                }
              : item,
          ),
        },
      }));
    }

    function clearUploadProgress(chatId: string, messageId: string): void {
      set((state) => ({
        messagesByChat: {
          ...state.messagesByChat,
          [chatId]: listFor(state, chatId).map((item) => {
            if (
              !sameMessage(item.id, messageId) ||
              mobileUploadOf(item).uploadProgress === undefined
            ) {
              return item;
            }
            const next: UiMessage = { ...item };
            delete (next as Partial<MobileMessage>).uploadProgress;
            return next;
          }),
        },
      }));
    }

    // A failed voice send (T-0154, review round 1): the bubble keeps its
    // local recording and shows a Retry with the plain reason, never a
    // silent "sending". The reason rides the message in a subset of the
    // shared `SendFailureReason` buckets plus `other` (a subset so the
    // message keeps exactly the shared type); the bubble renders the
    // matching copy.
    function markVoiceFailed(
      chatId: string,
      messageId: string,
      reason: VoiceFailureReason = 'server_unavailable',
    ): void {
      set((state) => ({
        messagesByChat: {
          ...state.messagesByChat,
          [chatId]: listFor(state, chatId).map((item): UiMessage =>
            sameMessage(item.id, messageId)
              ? { ...item, failed: true, failureReason: reason }
              : item,
          ),
        },
      }));
    }

    // The room identity a forward may carry (T-0432): only a public group or
    // topic has a room JID safe to reveal. A DM/AI chat has no room JID, and a
    // private topic (or private group) must omit both so the target never
    // learns a room it may not see (forwarding plan §3.1/§3.6).
    function forwardPublicRoomFor(source: ChatSummary | undefined): ChatSummary | undefined {
      if (source === undefined || source.kind !== 'group') {
        return undefined;
      }
      const visibility = source.topic?.visibility ?? source.visibility;
      return visibility === 'public' ? source : undefined;
    }

    // The origin header of one forwarded copy. Reusing a message's own
    // `forward` keeps the first author on a forward of a forward. Otherwise it
    // is built from the source message; `ForwardOriginSchema` caps over-long
    // names and rejects a bad timestamp, and such a message is skipped instead
    // of putting junk on the wire.
    function forwardOriginFor(message: UiMessage): ForwardOrigin | undefined {
      if (message.forward !== undefined) {
        return isValid(ForwardOriginSchema)(message.forward) ? message.forward : undefined;
      }
      const createdAt = message.createdAt.getTime();
      if (Number.isNaN(createdAt)) {
        return undefined;
      }
      const author = authorFor(message.id);
      const room = forwardPublicRoomFor(get().chats.find((entry) => entry.id === message.chatId));
      const originalId = correctionTargetFor(message.id);
      const candidate = {
        sender_id: author?.jid ?? message.senderId,
        sender_name: message.senderName,
        ...(room === undefined ? {} : { chat_id: room.id, chat_name: room.title }),
        ...(originalId === undefined ? {} : { original_id: originalId }),
        original_at: new Date(createdAt).toISOString(),
      };
      return isValid(ForwardOriginSchema)(candidate) ? candidate : undefined;
    }

    function rememberGroupIds(entries: ChatEntry[]): void {
      for (const entry of entries) {
        if (entry.kind === 'group') {
          groupIds.set(entry.chatJid, entry.groupId);
          for (const row of summariesFor(entry)) {
            groupIds.set(row.id, entry.groupId);
          }
        }
      }
    }

    // The group id behind one chat row: topic rows carry it directly
    // (T-0139: the live row first, so a deep-linked topic works before any
    // entry flowed through `rememberGroupIds`), legacy group rows resolve it
    // through the remembered `/api/chats` entries.
    function groupIdForChat(chatId: string): string | undefined {
      return get().chats.find((entry) => entry.id === chatId)?.groupId ?? groupIds.get(chatId);
    }

    // Remembers the roles of one full topic response (create/patch/roles),
    // replacing whatever was cached. The response is the server truth, so a
    // private-to-public flip clears the entry instead of leaving it stale.
    function rememberTopicRoles(topic: Topic): void {
      topicRolesById.set(topic.id, { roles: topic.roles, approverRole: topic.approverRole });
      set((state) => ({ groupDetailsRevision: state.groupDetailsRevision + 1 }));
    }

    // Remembers the member names of a group for one chat row (the loader is
    // `ensureGroupMembers` in `effects/groups.ts`).
    function rememberMembers(chatId: string, detail: GroupDetail): void {
      const members = new Map<string, string>();
      for (const member of detail.members) {
        members.set(member.userId.toLowerCase(), member.name);
      }
      groupMembers.set(chatId, members);
    }

    // The mention members behind one chat row (T-0227, built like web's
    // `applyGroupDetail`): people as `{ jid: localpart@domain, name, handle?
    // }` plus the group's AIs as `{ jid, name }`, never yourself. Self is
    // excluded by `userId` against `currentUserId` (T-0227 S2): `me?.jid`
    // is undefined before boot and in the mock store, while `currentUserId`
    // is always set (`me.id` after boot). The sender-name map above keeps
    // working from the same detail. Reads the shared detail cache (so
    // every topic row of a group agrees) and never fetches on its own.
    function mentionMembersFor(chatId: string): MentionMember[] {
      const groupId = groupIdForChat(chatId);
      if (groupId === undefined) {
        return [];
      }
      const detail = groupDetails.get(groupId);
      if (detail === undefined) {
        return [];
      }
      const mine = myJid();
      const domain = mine === undefined ? undefined : mine.slice(mine.indexOf('@') + 1);
      const meId = get().currentUserId;
      const members: MentionMember[] = [];
      for (const member of detail.members) {
        if (member.userId === meId) {
          continue;
        }
        const localpart = member.userId.toLowerCase();
        members.push({
          jid: domain === undefined ? member.userId : `${localpart}@${domain}`,
          name: member.name,
          ...(member.handle === undefined || member.handle === '' ? {} : { handle: member.handle }),
        });
      }
      for (const ai of detail.ais) {
        members.push({ jid: ai.jid, name: ai.name });
      }
      return members;
    }

    // An optimistic bubble also records its text as the base text, which the
    // ledger restores when an edit is reverted (the web send pipeline does the
    // same). Without it a revert would strip the text of an unechoed message.
    function setChatMessage(chatId: string, message: UiMessage, clearUnread: boolean): void {
      ledger.setChatMessage(chatId, message, clearUnread);
      if (message.text !== undefined) {
        ledger.rememberBaseText(message.id, message.text);
      }
    }

    // The ack of a send names the sender-generated id. The send effects reach
    // it through `h.linkLocalToServer`, which has no chat argument, so the
    // chat is found by the message it holds; a group echo that already filed
    // the room's stanza id keeps it (`linkAckToServer`).
    function linkAck(localId: string, serverId: string): void {
      const state = get();
      for (const chat of state.chats) {
        if (listFor(state, chat.id).some((item) => sameMessage(item.id, localId))) {
          ledger.linkAckToServer(chat, localId, serverId);
          return;
        }
      }
      linkLocalToServer(localId, serverId);
    }

    function setHistoryLoad(chatId: string, load: 'loading' | 'loaded' | 'error'): void {
      set((state) => ({ historyLoad: { ...state.historyLoad, [chatId]: load } }));
    }

    // Drops the `loading` marker of a pending chat that was superseded before it
    // ever loaded, so no ownerless entry stays behind. Settled entries and
    // in-flight loads are left alone.
    function clearSupersededMarker(chatId: string): void {
      if (loadingHistory.has(chatId)) {
        return;
      }
      set((state) => {
        if (state.historyLoad[chatId] !== 'loading') {
          return state;
        }
        const next = { ...state.historyLoad };
        delete next[chatId];
        return { historyLoad: next };
      });
    }

    function handleMessage(message: ChatMessage): void {
      // A correction or a retraction is never a chat message: it edits another
      // one, so it is ingested and returns before any rendering.
      if (isEditStanza(message)) {
        ingestEdit(message);
        return;
      }
      // A reactions message that is only that (no body, no payload) must never
      // render as a bubble or move the chat list preview. A message that also
      // carries a body or payload is a normal message: its reactions are
      // ingested and it is rendered as usual.
      if (message.reactions !== undefined) {
        ingestReaction(message);
        if (isReactionOnly(message)) {
          return;
        }
      }
      const meId = get().currentUserId;
      const chatId = message.chatJid;
      const ui = toUiMessage(message, meId);

      if (message.outgoing) {
        // Reconcile our optimistic message with the server echo. Sticker
        // echoes carry the sticker id in the payload, so they match the
        // sticker-scoped signature (not the bare emoji body). Attachment
        // echoes match the bare caption signature, exactly like web.
        const reply =
          message.replyTo === undefined ? undefined : { id: message.replyTo.id, senderName: '' };
        const signature =
          message.payload !== undefined && message.payload.type === 'sticker'
            ? stickerSignatureFor(
                chatId,
                message.body ?? '',
                message.payload.data.sticker_id,
                reply,
              )
            : signatureFor(chatId, message.body ?? '', reply);
        const queue = pendingOutgoing.get(signature);
        const localId = queue?.shift();
        if (queue !== undefined && queue.length === 0) {
          pendingOutgoing.delete(signature);
        }
        if (localId !== undefined) {
          linkMessageIds(localId, ui.id);
          linkLocalToServer(localId, ui.id);
          // The upload finished: drop the kept bytes and the local preview
          // fields, so a later Retry is a no-op and the echo carries the
          // served URL only. Voice keeps its recording the same way.
          pendingUploads.delete(localId);
          pendingUploads.delete(aliasRoot(localId));
          pendingVoices.delete(localId);
          pendingVoices.delete(aliasRoot(localId));
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
        // The merged id may have been the target of an edit or reaction
        // received under the optimistic id.
        resolvePendingEdits(chatId);
        refreshEdits(chatId);
        refreshReactions(chatId);
        return;
      }

      const active = get().activeChatId === chatId && isVisible();
      // Only the AI's own message in its DM finishes the draft. A message from
      // my own JID (e.g. my second device) must leave the draft running.
      const fromAi = message.fromJid === chatId && !isOwnSender(message.fromJid);
      const draft = get().drafts[chatId];
      if (draft !== undefined && fromAi) {
        polling.markTurnFinished(draft.turnId);
        polling.clearDraftTimeout(chatId);
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
      // A message that just loaded may be the target of a correction or a
      // retraction read earlier, from an older history page.
      resolvePendingEdits(chatId);
      refreshEdits(chatId);
      if (active && core !== undefined) {
        const chat = get().chats.find((entry) => entry.id === chatId);
        if (chat !== undefined) {
          recordRead(chatId, ui.id);
          core.markDisplayed(chatId, coreKind(chat), ui.id);
        }
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

    function nick(me: Me): string {
      const name = me.name.trim();
      if (name.length > 0) {
        return name;
      }
      return me.jid?.split('@')[0] ?? 'me';
    }

    // A group invitation or a roster push means the chat list changed on the
    // server. Refetch it, join any new group rooms and load their preview.
    function handleInvited(): void {
      events.scheduleChatsRefresh();
    }

    function handleRoster(): void {
      events.scheduleChatsRefresh();
    }

    // The effect modules, built once the closure's helpers exist. `fx` bridges
    // the concerns that still live in this closure as Promise functions.
    const ctx: StoreCtx = {
      ports,
      get,
      set,
      s,
      life,
      h: {
        sortByRecency,
        summariesFor,
        rememberGroupIds,
        nick,
        flushPending: () => history.flushPending(),
        isVisible,
        coreKind,
        isReactionOnly,
        isEditStanza,
        sortMessages,
        ingestHistoryReactions,
        ingestHistoryEdits,
        toUiMessage,
        resolvePendingEdits,
        withEdits,
        previewFor,
        refreshEdits,
        recordRead,
        sameMessage,
        listFor,
        setHistoryLoad,
        clearSupersededMarker,
        groupIdForChat,
        isOwnSender,
        senderNameFor,
        wireTargetFor,
        correctionTargetFor,
        retractionTargetFor,
        applyReactionUpdate,
        restoreMessage,
        restoreEdits,
        rememberTopicRoles,
        rememberMembers,
        myJid,
        aliasRoot,
        rememberAuthor,
        rememberOriginId,
        linkMessageIds,
        linkLocalToServer: linkAck,
        updateMessageStatus,
        signatureFor,
        stickerSignatureFor,
        setChatMessage,
        markStickerFailed: ledger.markStickerFailed,
        markAttachmentFailed: ledger.markAttachmentFailed,
        markVoiceFailed,
        clearFailure,
        clearAttachmentFailure,
        updateMessageAttachment,
        updateMessageVoice,
        setUploadProgress,
        clearUploadProgress,
        forwardOriginFor,
        forwardedPayloadFor,
        forwardedUiFieldsFor,
        startDraftStream: () => polling.startDraftStream(),
        startTopicsPolling: () => polling.startTopicsPolling(),
        teardown,
        handleMessage,
        handleTyping: (event) => events.handleTyping(event),
        handleDisplayed,
        handleOccupants,
        handlePresence,
        handleInvited,
        handleRoster,
      },
      fx: {
        get loadPrefRows() {
          return history.loadPrefRows;
        },
        get loadFolders() {
          return history.loadFolders;
        },
        get refreshChats() {
          return history.refreshChats;
        },
        loadPreview: (current, chat) => history.loadPreview(current, chat),
        loadPins: (chatId, loud) => pins.loadPins(chatId, loud),
        joinGroups: (current, me) => groups.joinGroups(current, me),
        ensureGroupDetail: (groupId, force) => groups.ensureGroupDetail(groupId, force),
        ensureGroupMembers: (chatId) => groups.ensureGroupMembers(chatId),
        startPinsPolling: (chatId) => polling.startPinsPolling(chatId),
        restartBoot: () => lifecycle.restartBoot(),
      },
      ...makeRunners(ports, life),
    };
    const lifecycle = makeLifecycle(ctx);
    const polling = makePolling(ctx);
    const history = makeHistory(ctx);
    const send = makeSend(ctx);
    const groups = makeGroups(ctx);
    const events = makeEvents(ctx);
    const pins = makePins(ctx);

    // The user scoped fields and their values before any user signed in. The
    // store starts from them and `stop()` returns to them, so the next user
    // never sees the previous user's chats, contacts or messages.
    const initialUserState = (): Pick<
      ChatStoreState,
      | 'currentUserId'
      | 'me'
      | 'chatsLoad'
      | 'chats'
      | 'contacts'
      | 'messagesByChat'
      | 'historyLoad'
      | 'activeChatId'
      | 'historyComplete'
      | 'search'
      | 'activeFolder'
      | 'folders'
      | 'foldersLoaded'
      | 'typing'
      | 'editTarget'
      | 'actionError'
      | 'jumpTarget'
      | 'topicNotice'
      | 'pinsError'
      | 'ownedAis'
    > => ({
      currentUserId: CURRENT_USER_ID,
      me: undefined,
      chatsLoad: 'loading',
      chats: [],
      contacts: [],
      messagesByChat: {},
      historyLoad: {},
      activeChatId: null,
      historyComplete: {},
      search: '',
      activeFolder: 'all',
      folders: [],
      foldersLoaded: false,
      typing: {},
      editTarget: undefined,
      actionError: undefined,
      jumpTarget: undefined,
      topicNotice: undefined,
      pinsError: undefined,
      ownedAis: ports.ownedAis ?? [],
    });

    // What `stop()` clears besides the scopes: timers, caches, per-session maps,
    // and every user scoped field of the state.
    function teardown(): void {
      events.clearTimers();
      polling.clearDraftState();
      for (const chatId of Object.keys(cursors)) {
        delete cursors[chatId];
      }
      lastRead = {};
      chatPrefRows = [];
      groupIds.clear();
      groupMembers.clear();
      loadingOlder.clear();
      pendingOutgoing.clear();
      pendingVoices.clear();
      groupDetails.clear();
      loadingGroupDetails.clear();
      groupRolesById.clear();
      loadingGroupRoles.clear();
      topicRolesById.clear();
      loadingTopicRoles.clear();
      set({
        ...initialUserState(),
        drafts: {},
        finishedDraftMessages: {},
        edits: {},
        reactions: {},
      });
      loadingHistory.clear();
      ledger.reset();
      pendingUploads.clear();
    }

    return {
      ...initialUserState(),
      status: 'offline',
      edits: {},
      reactions: {},
      drafts: {},
      finishedDraftMessages: {},
      mediaTrustedHosts: undefined,
      messages: (chatId) => get().messagesByChat[chatId] ?? EMPTY_MESSAGES,
      hasMore: (chatId) => get().historyComplete[chatId] !== true && cursors[chatId] !== undefined,
      groupMembers: (chatId) => mentionMembersFor(chatId),
      groupIdForChat: (chatId) => groupIdForChat(chatId),
      openChat: (chatId) => history.openChat(chatId),
      reloadChats: () => history.reloadChats(),
      retryHistory: (chatId) => history.retryHistory(chatId),
      loadOlder: (chatId) => history.loadOlder(chatId),
      openAtMessage: (chatId, messageId) => history.openAtMessage(chatId, messageId),
      clearJumpTarget: () => set({ jumpTarget: undefined }),
      ...send,
      ...events.actions,
      dismissTopicNotice: () => set({ topicNotice: undefined }),
      groupDetailsRevision: 0,
      ...groups.actions,
      ...pins.actions,
      stopPinsPoll: () => {
        polling.stopPinsPolling();
      },
      setSearch: (value) => set({ search: value }),
      setActiveFolder: (folder) => set({ activeFolder: folder }),
      start: lifecycle.start,
      stop: lifecycle.stop,
    };
  });
}

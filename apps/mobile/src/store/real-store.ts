import type {
  ChatSummary,
  EditAuthor,
  EditUpdate,
  EditsState,
  MentionMember,
  MessageStatus,
  ReactionsState,
  ReplyRef,
  UiMention,
  UiMessage,
  UiReaction,
} from '@zilar/chat-core';
import {
  applyEdit,
  applyReaction,
  editsFor,
  emptyEdits,
  emptyReactions,
  forwardedPayloadFor,
  forwardedUiFieldsFor,
  mentionsEqual,
  mergeEdits,
  mergeTargets,
  reactionChips as sharedReactionChips,
  reactionsEqual,
  resolveEdits,
  userLocalpartOf as sharedUserLocalpartOf,
} from '@zilar/chat-core';
import { Effect } from 'effect';
import {
  type ChatMessage,
  type Occupant,
  type PresenceEvent,
  type XmppCore,
} from '@zilar/xmpp-core';
import {
  ForwardOriginSchema,
  isValid,
  type Attachment,
  type ForwardOrigin,
  type VoiceMeta,
} from '@zilar/protocol';
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
import { makePolling, FINISHED_TURNS_MAX, withoutDraft } from './effects/polling';
import { Ports, PortsLive, type RealStoreDeps } from './effects/ports';
import { makeLife, makeRunners, type StoreCtx, type StoreState } from './effects/runtime';
import {
  isTrustedMediaUrl,
  sanitizeIncomingAttachment,
  trustedMediaHosts,
  type MediaTokenShape,
} from '../lib/attachments';
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

export type { AppStateLike, RealStoreDeps } from './effects/ports';

function coreKind(chat: ChatSummary): 'chat' | 'groupchat' {
  return chat.kind === 'group' ? 'groupchat' : 'chat';
}

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

/**
 * A reactions message is swallowed only when it is truly body-less and
 * payload-less: one that also carries a body or a payload is a normal message
 * that happens to update reactions too.
 */
function isReactionOnly(message: ChatMessage): boolean {
  return (
    message.reactions !== undefined && message.body === undefined && message.payload === undefined
  );
}

/**
 * A XEP-0308 correction or a XEP-0424 retraction is never a chat message:
 * it edits another message and never renders as a bubble.
 */
function isEditStanza(message: ChatMessage): boolean {
  return message.correction !== undefined || message.retraction !== undefined;
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
    const messageAliases = new Map<string, string>();
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

    function signatureFor(chatId: string, body: string, replyTo: ReplyRef | undefined): string {
      return `${chatId}|${body}|${replyTo?.id ?? ''}`;
    }

    // Sticker sends share one emoji body per pack, so the echo queue is keyed
    // by sticker id too — otherwise two quick stickers with the same emoji
    // can link the wrong server id (web does the same).
    function stickerSignatureFor(
      chatId: string,
      body: string,
      stickerId: string,
      replyTo: ReplyRef | undefined,
    ): string {
      return `${signatureFor(chatId, body, replyTo)}|sticker:${stickerId}`;
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
        // Reactions and edits were stored under whichever id was known when
        // they arrived; move them onto the surviving root so the alias-aware
        // lookup finds them.
        migrateReactionTargets(rootRight, rootLeft);
        migrateEditTargets(rootRight, rootLeft);
      }
    }

    // Remembers the server id a local optimistic id resolved to, so a reaction
    // sent after the echo can name the target everyone else knows.
    const messageServerIds = new Map<string, string>();

    function linkLocalToServer(localId: string, serverId: string): void {
      if (localId !== serverId) {
        messageServerIds.set(localId, serverId);
        // Also under the alias root so an action that already canonicalised
        // (e.g. a chip tap before the echo) resolves to the server id.
        messageServerIds.set(aliasRoot(localId), serverId);
      }
    }

    // The id to put on the wire for a message: the server id when it is known,
    // else the message id itself. A still-unacked `local-*` id has no server id
    // yet and cannot be named, so it resolves to undefined.
    function wireTargetFor(messageId: string): string | undefined {
      const root = aliasRoot(messageId);
      const server = messageServerIds.get(root);
      if (server !== undefined) {
        return server;
      }
      return root.startsWith('local-') ? undefined : root;
    }

    function sameMessage(left: string, right: string): boolean {
      return aliasRoot(left) === aliasRoot(right);
    }

    // Any known message id -> the author as the stanza described it, used to
    // authorize a correction or retraction from the original sender only.
    const messageAuthors = new Map<string, EditAuthor>();
    // Any known message id -> the sender-generated origin id (the stanza's
    // `id` attribute or `<origin-id/>`), used to name an edit's target.
    const messageOriginIds = new Map<string, string>();

    function rememberAuthor(messageId: string, author: EditAuthor): void {
      messageAuthors.set(messageId, author);
      messageAuthors.set(aliasRoot(messageId), author);
    }

    function rememberOriginId(messageId: string, originId: string): void {
      messageOriginIds.set(messageId, originId);
      messageOriginIds.set(aliasRoot(messageId), originId);
    }

    function authorFor(messageId: string): EditAuthor | undefined {
      return messageAuthors.get(aliasRoot(messageId)) ?? messageAuthors.get(messageId);
    }

    function authorOfChatMessage(message: ChatMessage): EditAuthor {
      const author: EditAuthor = { jid: message.fromJid, resolved: message.fromResolved };
      if (message.occupantId !== undefined) author.occupantId = message.occupantId;
      if (message.fromNick !== undefined) author.nick = message.fromNick;
      return author;
    }

    // Moves the edits stored under `from` onto `to` and removes `from`. Called
    // when two message ids turn out to be the same (the optimistic local id
    // and the server id).
    function migrateEditTargets(from: string, to: string): void {
      const state = get();
      let changed = false;
      const next: Record<string, EditsState> = { ...state.edits };
      for (const [chatId, chatEdits] of Object.entries(state.edits)) {
        if (chatEdits.targets[from] === undefined) {
          continue;
        }
        next[chatId] = mergeEdits(chatEdits, from, to);
        changed = true;
      }
      if (!changed) {
        return;
      }
      set({ edits: next });
      for (const chatId of Object.keys(next)) {
        refreshEdits(chatId);
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

    // Maps the usable mentions of a message to names: the known group member,
    // else the text the range covers. Edits carry their own mention ranges;
    // mobile has no member directory, so the JID's localpart is used as the
    // fallback name (web falls back further, but the message itself shows it).
    function mapMentions(
      mentions: readonly { jid: string; begin?: number; end?: number }[],
      body: string,
    ): UiMention[] {
      const mapped: UiMention[] = [];
      for (const mention of mentions) {
        const { begin, end } = mention;
        if (begin === undefined || end === undefined) continue;
        if (begin < 0 || begin >= end || end > body.length) continue;
        mapped.push({ jid: mention.jid, name: body.slice(begin, end), begin, end });
      }
      return mapped;
    }

    // The edit update the wire would carry: built from one stanza and passed
    // to `applyEditUpdate`. A retraction needs no body; a correction without
    // one has no new text, so it is ignored.
    function editUpdateFor(message: ChatMessage): EditUpdate | undefined {
      const order = message.timestamp.getTime();
      const author = authorOfChatMessage(message);
      if (message.retraction !== undefined) {
        return {
          kind: 'retraction',
          targetId: aliasRoot(message.retraction.targetId),
          author,
          order,
        };
      }
      if (message.correction !== undefined) {
        if (message.body === undefined) {
          return undefined;
        }
        const update: EditUpdate = {
          kind: 'correction',
          targetId: aliasRoot(message.correction.targetId),
          author,
          text: message.body,
          order,
        };
        if (message.mentions !== undefined && message.mentions.length > 0) {
          update.mentions = message.mentions.map((mention) => ({
            jid: mention.jid,
            begin: mention.begin,
            end: mention.end,
          }));
        }
        return update;
      }
      return undefined;
    }

    function applyEditUpdate(chatId: string, update: EditUpdate): void {
      const target = authorFor(update.targetId);
      set((state) => ({
        edits: {
          ...state.edits,
          [chatId]: applyEdit(state.edits[chatId] ?? emptyEdits(), update, target),
        },
      }));
      resolvePendingEdits(chatId);
      refreshEdits(chatId);
    }

    // A correction or retraction message only changes edit state; it never
    // touches the preview or the unread count.
    function ingestEdit(message: ChatMessage): void {
      const update = editUpdateFor(message);
      if (update === undefined) {
        return;
      }
      applyEditUpdate(message.chatJid, update);
    }

    function ingestHistoryEdits(messages: readonly ChatMessage[]): void {
      for (const message of messages) {
        if (isEditStanza(message)) {
          ingestEdit(message);
        }
      }
    }

    /**
     * An incoming voice message on an untrusted host would make the player
     * fetch whatever URL a chat peer put in the payload, leaking the
     * viewer's IP just like an image would. Drop the URL: the bubble still
     * shows the waveform and the duration, but nothing is fetched. Mirrors
     * web's `sanitizeIncomingVoice`.
     */
    function sanitizeVoice(voice: VoiceMeta, token: MediaTokenShape | undefined): VoiceMeta {
      if (voice.url === undefined) {
        return voice;
      }
      const trusted = token === undefined ? undefined : trustedMediaHosts(token);
      if (trusted !== undefined && isTrustedMediaUrl(voice.url, trusted)) {
        return voice;
      }
      const stripped: VoiceMeta = { ...voice };
      delete stripped.url;
      return stripped;
    }

    // Applies the edits that arrived before their target message was loaded.
    function resolvePendingEdits(chatId: string): void {
      const chatEdits = get().edits[chatId];
      if (chatEdits === undefined) {
        return;
      }
      let next = chatEdits;
      let changed = false;
      for (const targetId of Object.keys(chatEdits.targets)) {
        const entry = next.targets[targetId];
        if (entry === undefined || entry.pending.length === 0) {
          continue;
        }
        const author = authorFor(targetId);
        if (author === undefined) {
          continue;
        }
        next = resolveEdits(next, targetId, author);
        changed = true;
      }
      if (!changed) {
        return;
      }
      set((state) => ({ edits: { ...state.edits, [chatId]: next } }));
    }

    // Applies one message's current edit state. A deleted message keeps only
    // its place and identity; a corrected one shows the new text and mentions.
    function withEdits(message: UiMessage, chatId: string): UiMessage {
      const chatEdits = get().edits[chatId];
      const state =
        chatEdits === undefined ? undefined : editsFor(chatEdits, aliasRoot(message.id));
      if (state === undefined || (!state.edited && !state.deleted)) {
        if (message.edited === undefined && message.deleted === undefined) {
          return message;
        }
        const plain: UiMessage = { ...message };
        delete plain.edited;
        delete plain.deleted;
        return plain;
      }
      if (state.deleted) {
        const upload = mobileUploadOf(message);
        if (
          message.deleted === true &&
          message.text === undefined &&
          message.voice === undefined &&
          message.image === undefined &&
          message.attachment === undefined &&
          message.card === undefined &&
          message.reactions === undefined &&
          message.mentions === undefined &&
          message.edited === undefined &&
          message.failed === undefined &&
          message.failureReason === undefined &&
          upload.localUri === undefined &&
          upload.uploadProgress === undefined
        ) {
          return message;
        }
        const deleted: UiMessage = { ...message, deleted: true };
        delete deleted.text;
        delete deleted.voice;
        delete deleted.image;
        delete deleted.attachment;
        delete (deleted as Partial<MobileMessage>).localUri;
        delete (deleted as Partial<MobileMessage>).uploadProgress;
        delete deleted.card;
        delete deleted.reactions;
        delete deleted.mentions;
        delete deleted.edited;
        delete deleted.failed;
        delete deleted.failureReason;
        return deleted;
      }
      const text = state.text ?? message.text;
      const mentions =
        state.mentions === undefined ? undefined : mapMentions(state.mentions, text ?? '');
      if (
        message.edited === true &&
        message.deleted === undefined &&
        message.text === text &&
        mentionsEqual(message.mentions, mentions)
      ) {
        return message;
      }
      const edited: UiMessage = { ...message, edited: true };
      delete edited.deleted;
      if (text === undefined) {
        delete edited.text;
      } else {
        edited.text = text;
      }
      if (mentions === undefined || mentions.length === 0) {
        delete edited.mentions;
      } else {
        edited.mentions = mentions;
      }
      return edited;
    }

    // The list preview of a deleted message; the message itself carries no
    // text, but the chat row says what happened.
    function previewFor(message: UiMessage): UiMessage {
      return message.deleted === true ? { ...message, text: 'Message deleted' } : message;
    }

    // Puts a message back exactly as it was before an optimistic edit or delete,
    // so a failed send restores the fields a retraction had stripped.
    function restoreMessage(chatId: string, snapshot: UiMessage): void {
      set((state) => ({
        messagesByChat: {
          ...state.messagesByChat,
          [chatId]: listFor(state, chatId).map((item) =>
            sameMessage(item.id, snapshot.id) ? snapshot : item,
          ),
        },
      }));
    }

    // Rolls back the edits slice a store action was about to apply, so a
    // failed send leaves no optimistic deletion or correction behind.
    function restoreEdits(chatId: string, previous: EditsState | undefined): void {
      set((state) => {
        const edits = { ...state.edits };
        if (previous === undefined) {
          delete edits[chatId];
        } else {
          edits[chatId] = previous;
        }
        return { edits };
      });
      refreshEdits(chatId);
    }

    // The id a correction must name: the original sender-generated id, in DMs
    // and in groups alike (XEP-0308).
    function correctionTargetFor(messageId: string): string | undefined {
      const root = aliasRoot(messageId);
      return messageOriginIds.get(root) ?? messageOriginIds.get(messageId);
    }

    // The id a retraction must name: the origin id in a DM, the stanza-id in a
    // group (XEP-0424). A still-unacked group message has no stanza-id yet.
    function retractionTargetFor(chat: ChatSummary, messageId: string): string | undefined {
      if (chat.kind === 'group') {
        const message = listFor(get(), chat.id).find((item) => sameMessage(item.id, messageId));
        const stanzaId = message?.id;
        return stanzaId === undefined || stanzaId.startsWith('local-') ? undefined : stanzaId;
      }
      return correctionTargetFor(messageId);
    }

    // A reply quote follows its target: the corrected text, or "Deleted
    // message" once the target was retracted.
    function withReplyQuote(list: readonly UiMessage[], message: UiMessage): UiMessage {
      const quote = message.replyTo;
      if (quote === undefined) {
        return message;
      }
      const referenced = list.find((item) => sameMessage(item.id, quote.id));
      if (referenced === undefined) {
        return message;
      }
      const text = referenced.deleted === true ? 'Deleted message' : referenced.text;
      if (text === quote.text) {
        return message;
      }
      const replyTo: ReplyRef = { ...quote };
      if (text === undefined) {
        delete replyTo.text;
      } else {
        replyTo.text = text;
      }
      return { ...message, replyTo };
    }

    // Re-attaches the current edit state to every loaded message of a chat and
    // follows reply quotes and the preview.
    function refreshEdits(chatId: string): void {
      const state = get();
      const list = listFor(state, chatId);
      if (
        state.edits[chatId] === undefined &&
        !list.some((m) => m.edited === true || m.deleted === true)
      ) {
        return;
      }
      const edited = list.map((message) => withEdits(message, chatId));
      const refreshed = edited.map((message) => withReplyQuote(edited, message));
      const listChanged = refreshed.some((message, index) => message !== list[index]);
      const last = state.chats.find((chat) => chat.id === chatId)?.lastMessage;
      const lastRefreshed =
        last === undefined ? undefined : refreshed.find((item) => sameMessage(item.id, last.id));
      const lastChanged =
        last !== undefined && lastRefreshed !== undefined && lastRefreshed !== last;
      if (!listChanged && !lastChanged) {
        return;
      }
      const changedLast = lastChanged ? lastRefreshed : undefined;
      set((previous) => ({
        messagesByChat: listChanged
          ? { ...previous.messagesByChat, [chatId]: refreshed }
          : previous.messagesByChat,
        chats:
          changedLast === undefined
            ? previous.chats
            : previous.chats.map((chat) =>
                chat.id === chatId && chat.lastMessage !== undefined
                  ? { ...chat, lastMessage: previewFor(changedLast) }
                  : chat,
              ),
      }));
    }

    function reactionChips(
      state: ReactionsState | undefined,
      chatId: string,
      messageId: string,
    ): UiReaction[] | undefined {
      return sharedReactionChips(state, chatId, messageId, { aliasRoot, myJid, reactorName });
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

    // A status only moves forward: sending -> sent -> read. A late echo or
    // send confirmation must never downgrade a message the peer already read.
    // `failed` is outside the ladder: `advanceStatus` never moves into or out
    // of it by accident — only an explicit retry does (web's T-0168).
    const STATUS_RANK: Record<MessageStatus, number> = {
      sending: 0,
      sent: 1,
      read: 2,
      failed: 2,
    };

    function advanceStatus(current: MessageStatus, next: MessageStatus): MessageStatus {
      if (current === 'failed' || next === 'failed') {
        return current;
      }
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

    // A failed sticker keeps the message and shows a Retry instead of a
    // silent "sending" state, like attachments do on web.
    function markStickerFailed(chatId: string, messageId: string): void {
      set((state) => ({
        messagesByChat: {
          ...state.messagesByChat,
          [chatId]: listFor(state, chatId).map((item) =>
            sameMessage(item.id, messageId) ? { ...item, failed: true } : item,
          ),
        },
      }));
    }

    // A failed attachment keeps its local bytes and shows a Retry instead of
    // a silent "sending" state, like attachments do on web.
    function markAttachmentFailed(chatId: string, messageId: string): void {
      set((state) => ({
        messagesByChat: {
          ...state.messagesByChat,
          [chatId]: listFor(state, chatId).map((item) =>
            sameMessage(item.id, messageId) ? { ...item, failed: true } : item,
          ),
        },
      }));
    }

    /** Drops the `failed` flag without leaving an `undefined` value behind. */
    function clearFailure(message: UiMessage): UiMessage {
      if (message.failed === undefined && message.failureReason === undefined) {
        return message;
      }
      const next: UiMessage = { ...message };
      delete next.failed;
      delete next.failureReason;
      return next;
    }

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

    // Swaps an optimistic attachment for the uploaded one: the served URL
    // plus the payload built exactly as web does.
    function updateMessageAttachment(
      chatId: string,
      messageId: string,
      attachment: Attachment,
    ): void {
      set((state) => {
        const list = listFor(state, chatId).map((item) =>
          sameMessage(item.id, messageId) ? { ...clearFailure(item), attachment } : item,
        );
        const last = state.chats.find((chat) => chat.id === chatId)?.lastMessage;
        const lastMatches = last !== undefined && sameMessage(last.id, messageId);
        return {
          messagesByChat: { ...state.messagesByChat, [chatId]: list },
          chats: lastMatches
            ? state.chats.map((chat) =>
                chat.id === chatId && chat.lastMessage !== undefined
                  ? { ...chat, lastMessage: { ...clearFailure(chat.lastMessage), attachment } }
                  : chat,
              )
            : state.chats,
        };
      });
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

    // Swaps an optimistic voice message's placeholder metadata for the
    // uploaded one: the server-measured duration and the download URL.
    function updateMessageVoice(
      chatId: string,
      messageId: string,
      voice: { duration_ms: number; mime: string; waveform: number[]; url: string },
    ): void {
      set((state) => {
        const list = listFor(state, chatId).map((item) =>
          sameMessage(item.id, messageId)
            ? {
                ...clearFailure(item),
                voice:
                  item.voice === undefined
                    ? { ...voice }
                    : { ...item.voice, duration_ms: voice.duration_ms, url: voice.url },
              }
            : item,
        );
        const last = state.chats.find((chat) => chat.id === chatId)?.lastMessage;
        const lastMatches = last !== undefined && sameMessage(last.id, messageId);
        return {
          messagesByChat: { ...state.messagesByChat, [chatId]: list },
          chats: lastMatches
            ? state.chats.map((chat) =>
                chat.id === chatId && chat.lastMessage !== undefined
                  ? {
                      ...chat,
                      lastMessage: {
                        ...clearFailure(chat.lastMessage),
                        voice:
                          chat.lastMessage.voice === undefined
                            ? { ...voice }
                            : {
                                ...chat.lastMessage.voice,
                                duration_ms: voice.duration_ms,
                                url: voice.url,
                              },
                      },
                    }
                  : chat,
              )
            : state.chats,
        };
      });
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

    function myJid(): string | undefined {
      const jid = get().me?.jid;
      return jid === undefined || jid === null || jid === '' ? undefined : jid;
    }

    function isOwnSender(fromJid: string): boolean {
      const jid = myJid();
      return jid !== undefined && fromJid === jid;
    }

    function userLocalpartOf(fromJid: string): string | undefined {
      return sharedUserLocalpartOf(myJid(), fromJid);
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

    function toUiMessage(message: ChatMessage, meId: string): UiMessage {
      // The stanza id and the sender-generated id name the same message: link
      // them so a correction (which always names the origin id) resolves even
      // when the message is stored under its archive stanza-id.
      if (message.originId !== undefined && message.originId !== message.id) {
        linkMessageIds(message.originId, message.id);
      }
      rememberAuthor(message.id, authorOfChatMessage(message));
      if (message.originId !== undefined) {
        rememberOriginId(message.id, message.originId);
      }
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
      // An attachment payload rides `attachment`, sanitized like on web: an
      // image (or GIF-video) on an untrusted host is downgraded to a file
      // row that never auto-loads.
      if (message.payload !== undefined && message.payload.type === 'attachment') {
        ui.attachment = sanitizeIncomingAttachment(message.payload.data, mediaToken);
      }
      // A sticker payload rides `card` (like the web store); the body stays
      // the emoji fallback for clients that do not know the payload.
      if (message.payload !== undefined && message.payload.type === 'sticker') {
        ui.card = message.payload;
      }
      // A voice payload rides `voice`, sanitized like on web: a recording on
      // an untrusted host loses its URL (the bubble still shows the waveform
      // and the duration, but nothing is ever fetched).
      if (message.payload !== undefined && message.payload.type === 'voice') {
        ui.voice = sanitizeVoice(message.payload.data, mediaToken);
      }
      // A forward keeps its captured origin so the bubble can show the
      // "Forwarded from ..." header (T-0427).
      if (message.forward !== undefined) {
        ui.forward = message.forward;
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
        linkLocalToServer,
        updateMessageStatus,
        signatureFor,
        stickerSignatureFor,
        setChatMessage,
        markStickerFailed,
        markAttachmentFailed,
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
      messageAliases.clear();
      messageAuthors.clear();
      messageOriginIds.clear();
      messageServerIds.clear();
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

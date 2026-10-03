import type {
  ChatSummary,
  EditAuthor,
  EditUpdate,
  EditsState,
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
  canDeleteMessage,
  canEditMessage,
  editsFor,
  emptyEdits,
  emptyReactions,
  mergeEdits,
  mergeTargets,
  mentionsForTrimmedText,
  rebaseMentions,
  resolveEdits,
  summarize,
} from '@zilar/chat-core';
import {
  createXmppCore,
  type ChatMessage,
  type Occupant,
  type PresenceEvent,
  type XmppCore,
  type XmppCoreOptions,
} from '@zilar/xmpp-core';
import { StickerSchema, type Attachment, type Payload, type VoiceMeta } from '@zilar/protocol';
import { createStore, type StoreApi } from 'zustand/vanilla';

import {
  createChatApi,
  type ChatApi,
  type ChatEntry,
  type Contact,
  type GroupDetail,
  type Me,
} from '../lib/chat-api';
import type { ChatPref, ChatPrefsApi, PutChatPrefInput } from '../lib/chat-prefs-api';
import { applyChatPrefs, optimisticPrefRow } from '../lib/chat-prefs';
import {
  createPinsApi,
  pinKindFor,
  pinSnapshotText,
  type Pin,
  type PinsApi,
} from '../lib/pins-api';
import { API_URL } from '../lib/auth';
import { createInviteLinksApi, type InviteLinksApi } from '../lib/invite-links-api';
import {
  createTopicsApi,
  type ApproverRole,
  type CreateTopicInput,
  type PatchTopicInput,
  type SetTopicRolesInput,
  type Topic,
  type TopicRole,
  type TopicsApi,
} from '../lib/topics-api';
import { createRolesApi, type CustomGroupRole, type RolesApi } from '../lib/roles-api';
import { createGroupsApi, type ChannelMemberRole, type GroupsApi } from '../lib/groups-api';
import { summariesForTopicsEntry, TOPIC_GONE_NOTICE } from '../lib/topics';
import {
  DRAFT_STREAM_PATH,
  subscribeToDrafts,
  type DraftEndEvent,
  type DraftHubEvent,
  type OpenDraftStream,
} from '../lib/drafts';
import { getSessionToken } from '../lib/session-token';
import {
  attachmentDataFor,
  isTrustedMediaUrl,
  MAX_ATTACHMENT_BYTES,
  sanitizeIncomingAttachment,
  trustedMediaHosts,
  type MediaTokenShape,
} from '../lib/attachments';
import type { AttachmentUploader, PickedFile } from '../lib/attachment-ports';
import type { ConvertedVoice, RecordedVoice, VoicePort } from '../lib/voice';
import {
  createVoicePort,
  validateRecording,
  VoiceError,
  voiceSendRefusalMessage,
} from '../lib/voice';
import { voiceFailureReasonFor, type VoiceFailureReason } from '../lib/voice-native';
import { CURRENT_USER_ID, mobileUploadOf, type MobileMessage } from '../lib/types';
import type { ChatStoreState, ConnectionStatus, DraftState } from './types';

const PREVIEW_HISTORY_MAX = 1;
const PAGE_HISTORY_MAX = 50;
const TYPING_CLEAR_MS = 5000;
const CHAT_REFRESH_DEBOUNCE_MS = 500;

// A search jump loads at most this many history pages back looking for the
// hit before giving up with "Message not found" (web uses the same cap).
export const MESSAGE_JUMP_MAX_PAGES = 20;
// Upper bound for one stalled history wait inside `openAtMessage`: after
// this the jump gives up with "Message not found" instead of hanging.
export const MESSAGE_JUMP_WAIT_MS = 10_000;

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
  topicsApi?: TopicsApi;
  /** The group invite-links API (T-0136); tests inject a fake. */
  inviteLinksApi?: InviteLinksApi;
  rolesApi?: RolesApi;
  /** The channel management API (T-0144); tests inject a fake. */
  groupsApi?: GroupsApi;
  chatPrefsApi?: ChatPrefsApi;
  pinsApi?: PinsApi;
  ownedAis?: { id: string; name: string }[];
  createXmpp?: (options: XmppCoreOptions) => XmppCore;
  /** Uploads picked bytes to a XEP-0363 slot (T-0150); tests inject a fake. */
  uploader?: AttachmentUploader;
  /**
   * Resolves the real byte size of a local file (T-0157): the store re-stats
   * an unknown-size pick right before the slot request, since the slot API
   * needs an exact count. Tests inject a fake; the app injects the
   * `expo-file-system` stat.
   */
  statSize?: (uri: string) => Promise<number | undefined>;
  /** Converts + uploads voice recordings (T-0154); tests inject a fake. */
  voice?: VoicePort;
  now?: () => Date;
  appState?: AppStateLike;
  /** The AI draft SSE stream; tests inject a fake. */
  openDrafts?: OpenDraftStream;
}

/** Refetch `/api/chats` every 60 s while the app is active (T-0112). */
export const TOPIC_REFRESH_INTERVAL_MS = 60_000;

/** Refetch pins while a chat is open, same cadence as the topic poll. */
export const PINS_REFRESH_INTERVAL_MS = 60_000;

function topicsApi2(deps: RealStoreDeps): TopicsApi {
  if (deps.topicsApi !== undefined) {
    return deps.topicsApi;
  }
  return createTopicsApi(getSessionToken, fetch, API_URL);
}

function pinsApi2(deps: RealStoreDeps): PinsApi {
  if (deps.pinsApi !== undefined) {
    return deps.pinsApi;
  }
  return createPinsApi(getSessionToken, fetch, API_URL);
}

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
// One shared empty list: a selector must return the same reference while
// nothing changed, or React re-renders forever ("Maximum update depth").
const EMPTY_PINS: Pin[] = [];
const EMPTY_MESSAGES: UiMessage[] = [];

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

  const topics = topicsApi2(deps);
  const inviteLinks = deps.inviteLinksApi ?? createInviteLinksApi(getSessionToken, fetch, API_URL);

  function rolesApi2(deps: RealStoreDeps): RolesApi {
    if (deps.rolesApi !== undefined) {
      return deps.rolesApi;
    }
    return createRolesApi(getSessionToken, fetch, API_URL);
  }

  const rolesApi = rolesApi2(deps);
  const pinsApi = pinsApi2(deps);
  const groupsApi = deps.groupsApi ?? createGroupsApi(getSessionToken, fetch, API_URL);
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
  // The voice pipeline (T-0154): conversion through `POST /api/voice` when
  // the recording is not already M4A, then the XEP-0363 upload. The app
  // wires the real port through the uploader seam; tests inject a fake.
  function voicePortFor(): VoicePort {
    if (deps.voice !== undefined) {
      return deps.voice;
    }
    const uploader = deps.uploader;
    if (uploader === undefined) {
      return {
        convert: async () => {
          throw new VoiceError('network_error', 'Could not reach the server');
        },
        upload: async () => {
          throw new VoiceError('network_error', 'Could not reach the server');
        },
      };
    }
    return createVoicePort({ apiUrl: API_URL, getToken: getSessionToken, uploader });
  }

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

    /** The prefs rows: server truth when injected, empty otherwise. */
    async function loadPrefRows(): Promise<ChatPref[]> {
      const api = deps.chatPrefsApi;
      if (api === undefined) {
        return [];
      }
      return api.listChatPrefs().catch((): ChatPref[] => chatPrefRows);
    }
    // Pins by chat id (T-0135), newest first. Loaded when a chat opens and
    // refreshed on focus and every 60 s while it is open.
    const pinsByChat = new Map<string, Pin[]>();
    let pinsPollTimer: ReturnType<typeof setInterval> | undefined;
    let removePinsPollListener: (() => void) | undefined;
    // The 60 s active-app poll for new/removed topics (T-0112), plus its
    // AppState listener. Both stop when the store stops (or restarts).
    let topicsPollTimer: ReturnType<typeof setInterval> | undefined;
    let removeTopicsPollListener: (() => void) | undefined;
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

    // Two mentions are equal when their ids and ranges match, in order.
    function mentionsEqual(left: UiMention[] | undefined, right: UiMention[] | undefined): boolean {
      if (left === undefined || right === undefined) {
        return left === right;
      }
      if (left.length !== right.length) {
        return false;
      }
      return left.every((entry, idx) => {
        const other = right[idx];
        return (
          other !== undefined &&
          entry.jid === other.jid &&
          entry.begin === other.begin &&
          entry.end === other.end
        );
      });
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

    // The upload steps of an attachment, re-runnable from a Retry: ask the
    // chat's XMPP session for a XEP-0363 slot, PUT the bytes with the slot's
    // headers, then send the payload message exactly as web does. The kept
    // bytes stay until the stanza send succeeds, so a Retry after a failed
    // send still has them; they are dropped only then (and on cancel). A
    // 'cancelled' error is swallowed only when this very message was
    // cancelled by the user (the bubble is already gone); any other abort
    // marks the message failed so Retry appears.
    function runAttachmentUpload(
      chat: ChatSummary,
      localId: string,
      file: PickedFile,
      caption: string,
      replyTo: ReplyRef | undefined,
    ): void {
      const current = core;
      if (current === undefined) {
        markAttachmentFailed(chat.id, localId);
        return;
      }
      const uploader = deps.uploader;
      if (uploader === undefined) {
        // No uploader injected (tests inject a fake; the app injects the
        // expo-file-system one): fail loudly instead of hanging a bubble in
        // "sending" forever.
        markAttachmentFailed(chat.id, localId);
        return;
      }
      const messageAlive = (): boolean =>
        listFor(get(), chat.id).some((item) => sameMessage(item.id, localId));
      void (async () => {
        try {
          const contentType = file.mimeType === '' ? 'application/octet-stream' : file.mimeType;
          // Unknown size: the slot API needs an exact byte count, so stat
          // once more right before the request; a still-unknown size fails
          // the send like any other upload failure (Retry stays available).
          const statSize = deps.statSize;
          const size = file.size ?? (statSize === undefined ? undefined : await statSize(file.uri));
          if (size === undefined) {
            markAttachmentFailed(chat.id, localId);
            return;
          }
          const slot = await current.requestUploadSlot({
            filename: attachmentDataFor(file, '').name,
            size,
            contentType,
          });
          // A cancel during the slot round-trip removes the bubble: stop
          // here and send nothing.
          if (!messageAlive()) {
            return;
          }
          await uploader.upload(
            file,
            { putUrl: slot.putUrl, headers: slot.headers },
            (fraction) => setUploadProgress(chat.id, localId, fraction),
            localId,
          );
          if (!messageAlive()) {
            return;
          }
          const data = attachmentDataFor(file, slot.getUrl);
          updateMessageAttachment(chat.id, localId, data);
          clearUploadProgress(chat.id, localId);
          const sent = await current.sendMessage(chat.id, coreKind(chat), caption, {
            payload: { v: 0, type: 'attachment', data },
            ...(replyTo === undefined ? {} : { replyTo: { id: replyTo.id } }),
          });
          if (!messageAlive()) {
            return;
          }
          pendingUploads.delete(localId);
          linkMessageIds(localId, sent.id);
          linkLocalToServer(localId, sent.id);
          rememberOriginId(localId, sent.id);
          updateMessageStatus(chat.id, localId, 'sent');
        } catch (error) {
          clearUploadProgress(chat.id, localId);
          // Keep the local bytes so the bubble can offer a Retry. A cancel
          // removes the bubble first (see `cancelAttachment`); a 'cancelled'
          // error for a message that is already gone is that cancel landing,
          // so it stays silent. Any other abort means the upload itself
          // failed and Retry must appear.
          if (error instanceof Error && error.message === 'cancelled' && !messageAlive()) {
            return;
          }
          if (messageAlive()) {
            markAttachmentFailed(chat.id, localId);
          }
        }
      })();
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

    // The voice pipeline (T-0154), re-runnable from a Retry: convert (skipped
    // for m4a), PUT the bytes through the XEP-0363 slot, then send the `voice`
    // payload message exactly as web does. The recording stays in
    // `pendingVoices` until the stanza send succeeds, so a Retry after a
    // failed send re-runs the same pipeline from the kept file. A
    // 'cancelled' error is swallowed only when this very message was
    // cancelled by the user (the bubble is already gone); any other failure
    // marks the message failed so Retry appears.
    function runVoiceSend(
      chat: ChatSummary,
      localId: string,
      recording: RecordedVoice,
      waveform: number[],
      replyTo: ReplyRef | undefined,
    ): void {
      const current = core;
      if (current === undefined) {
        markVoiceFailed(chat.id, localId, 'network');
        return;
      }
      const messageAlive = (): boolean =>
        listFor(get(), chat.id).some((item) => sameMessage(item.id, localId));
      void (async () => {
        try {
          const converted: ConvertedVoice = await voicePortFor().convert(recording);
          if (!messageAlive()) {
            return;
          }
          const url = await voicePortFor().upload(
            current,
            converted,
            (fraction) => setUploadProgress(chat.id, localId, fraction),
            localId,
          );
          if (!messageAlive()) {
            return;
          }
          const voice = {
            duration_ms: converted.durationMs,
            mime: 'audio/mp4',
            waveform,
            url,
          };
          updateMessageVoice(chat.id, localId, voice);
          clearUploadProgress(chat.id, localId);
          const sent = await current.sendMessage(chat.id, coreKind(chat), '', {
            payload: { v: 0, type: 'voice', data: voice },
            ...(replyTo === undefined ? {} : { replyTo: { id: replyTo.id } }),
          });
          if (!messageAlive()) {
            return;
          }
          pendingVoices.delete(localId);
          pendingVoices.delete(aliasRoot(localId));
          linkMessageIds(localId, sent.id);
          linkLocalToServer(localId, sent.id);
          rememberOriginId(localId, sent.id);
          updateMessageStatus(chat.id, localId, 'sent');
        } catch (error) {
          clearUploadProgress(chat.id, localId);
          if (error instanceof Error && error.message === 'cancelled' && !messageAlive()) {
            return;
          }
          if (messageAlive()) {
            markVoiceFailed(
              chat.id,
              localId,
              voiceFailureReasonFor(error, get().status !== 'online'),
            );
          }
        }
      })();
    }
    // The send step of a sticker, re-runnable from a Retry: the payload is
    // already on the optimistic message, so only the stanza is (re)sent.
    function runStickerSend(
      chat: ChatSummary,
      localId: string,
      payload: Extract<Payload, { type: 'sticker' }>,
      body: string,
      replyTo: ReplyRef | undefined,
    ): void {
      const current = core;
      if (current === undefined) {
        markStickerFailed(chat.id, localId);
        return;
      }
      current
        .sendMessage(chat.id, coreKind(chat), body, {
          payload,
          ...(replyTo === undefined ? {} : { replyTo: { id: replyTo.id } }),
        })
        .then((sent) => {
          linkMessageIds(localId, sent.id);
          linkLocalToServer(localId, sent.id);
          rememberOriginId(localId, sent.id);
          updateMessageStatus(chat.id, localId, 'sent');
        })
        .catch(() => {
          markStickerFailed(chat.id, localId);
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

    // One topic row refreshed from the server (create/patch/member/AI):
    // re-reads `/api/chats`, merges the row, and preserves its local state.
    async function applyTopicRow(topic: Topic): Promise<void> {
      const entries = await api.getChats();
      rememberGroupIds(entries);
      const rows = entries.flatMap((entry) => summariesFor(entry));
      const match = rows.find((row) => row.topic?.id === topic.id);
      set((state) => {
        if (match === undefined) {
          return state;
        }
        const before = state.chats.find((chat) => chat.id === match.id);
        const prefed = applyChatPrefs([match], chatPrefRows, now().getTime())[0] ?? match;
        const merged: ChatSummary =
          before === undefined
            ? prefed
            : {
                ...prefed,
                ...(before.lastMessage === undefined ? {} : { lastMessage: before.lastMessage }),
                unread: before.unread,
                ...(before.online === undefined ? {} : { online: before.online }),
                ...(before.onlineCount === undefined ? {} : { onlineCount: before.onlineCount }),
              };
        return {
          chats: state.chats.some((chat) => chat.id === merged.id)
            ? state.chats.map((chat) => (chat.id === merged.id ? merged : chat))
            : sortByRecency([...state.chats, merged]),
        };
      });
    }

    // The topic id + group id of the topic that owns `chatId`. Rejects for a
    // chat that is not a topic yet (e.g. a legacy group row).
    async function topicIdFor(chatId: string): Promise<{ topicId: string; groupId: string }> {
      const chat = get().chats.find((entry) => entry.id === chatId);
      const topicId = chat?.topic?.id;
      const groupId = chat?.groupId ?? groupIds.get(chatId);
      if (topicId === undefined || groupId === undefined) {
        throw new Error('This topic is not available yet.');
      }
      return { topicId, groupId };
    }

    // Pins (T-0135): load on open, focus + 60 s poll while open. A failure
    // surfaces as `pinsError` for an explicit load, stays silent on the
    // background tick (the next tick retries). Only the latest opened chat
    // polls: opening another chat, or stopping its poll, ends this one.
    // Each publish bumps the chat's revision once, so `pins(chatId)`
    // selectors re-fire exactly once per publish.
    let pinsRevision = 0;
    const pinsRevisionByChat = new Map<string, number>();

    // Publishes one chat's pins and bumps its revision, so selectors for
    // that chat re-fire exactly once per publish.
    function publishPins(chatId: string, pins: Pin[]): void {
      pinsByChat.set(chatId, pins);
      pinsRevision += 1;
      pinsRevisionByChat.set(chatId, pinsRevision);
      set((state) => ({
        pinsError: state.pinsError?.chatId === chatId ? undefined : state.pinsError,
      }));
    }

    // Publishes an optimistic pins change (pin/unpin/rollback) for one
    // chat: same single bump, so the revision always matches the map.
    function publishOptimisticPins(chatId: string, pins: Pin[]): void {
      pinsByChat.set(chatId, pins);
      pinsRevision += 1;
      pinsRevisionByChat.set(chatId, pinsRevision);
      set((state) => ({ pinsError: state.pinsError }));
    }

    async function loadPins(chatId: string, loud: boolean): Promise<void> {
      try {
        publishPins(chatId, await pinsApi.listPins(chatId));
      } catch {
        if (loud) {
          set({ pinsError: { chatId, message: 'Could not load pins. Try again.' } });
        }
      }
    }

    function startPinsPolling(chatId: string, gen: number): void {
      stopPinsPolling();
      const tick = (): void => {
        if (gen !== generation || get().activeChatId !== chatId) {
          return;
        }
        if (!isVisible()) {
          return;
        }
        void loadPins(chatId, false);
      };
      pinsPollTimer = setInterval(tick, PINS_REFRESH_INTERVAL_MS);
      removePinsPollListener = appState.subscribe((state) => {
        if (state === 'active' && gen === generation && get().activeChatId === chatId) {
          void loadPins(chatId, false);
        }
      });
    }

    // Ends the pins poll of the open chat: leaving the chat, opening
    // another one, or stopping the store. Ends a no-op when nothing polls.
    function stopPinsPolling(): void {
      if (pinsPollTimer !== undefined) {
        clearInterval(pinsPollTimer);
        pinsPollTimer = undefined;
      }
      if (removePinsPollListener !== undefined) {
        removePinsPollListener();
        removePinsPollListener = undefined;
      }
    }

    // Whether the viewer may pin in a chat: either side of a DM; for topics
    // a group owner/admin whose detail has loaded (roles ride `getGroup`).
    // The topic-creator edge is server-enforced only, like on web.
    function canPinIn(chatId: string): boolean {
      const state = get();
      const chat = state.chats.find((entry) => entry.id === chatId);
      if (chat === undefined) {
        return false;
      }
      if (chat.kind === 'dm') {
        return true;
      }
      if (chat.topic === undefined || chat.groupId === undefined) {
        return false;
      }
      const detail = groupDetails.get(chat.groupId);
      const meId = state.me?.id ?? state.currentUserId;
      const role = detail?.members.find((member) => member.userId === meId)?.role;
      return role === 'owner' || role === 'admin';
    }

    // The periodic + foreground refresh: refetches `/api/chats` while active
    // so a topic created, made private, or where I was removed appears or
    // disappears without a reload. Failures are silent; the next tick retries.
    function startTopicsPolling(gen: number): void {
      if (topicsPollTimer !== undefined) {
        clearInterval(topicsPollTimer);
        topicsPollTimer = undefined;
      }
      if (removeTopicsPollListener !== undefined) {
        removeTopicsPollListener();
        removeTopicsPollListener = undefined;
      }
      const tick = (): void => {
        if (gen !== generation) {
          return;
        }
        if (!isVisible()) {
          return;
        }
        void refreshChats();
      };
      topicsPollTimer = setInterval(tick, TOPIC_REFRESH_INTERVAL_MS);
      removeTopicsPollListener = appState.subscribe((state) => {
        if (state === 'active' && gen === generation) {
          void refreshChats();
        }
      });
    }

    function stopTopicsPolling(): void {
      if (topicsPollTimer !== undefined) {
        clearInterval(topicsPollTimer);
        topicsPollTimer = undefined;
      }
      if (removeTopicsPollListener !== undefined) {
        removeTopicsPollListener();
        removeTopicsPollListener = undefined;
      }
      stopPinsPolling();
    }

    // Loads the group detail (people + roles + AIs) of a group once, so the
    // topics screen, the owner picker and the role checks can read it. The
    // detail is published through `set()` so `groupDetail` selectors re-fire.
    // Waiters (e.g. `ensureGroupMembers`) subscribe through
    // `groupDetailSettled` so one in-flight GET serves them all.
    const groupDetailWaiters = new Map<string, Set<() => void>>();

    // Resolves once the in-flight detail load for a group settles (success
    // or failure), so waiters share the single GET instead of fetching.
    function groupDetailSettled(groupId: string): Promise<void> {
      return new Promise<void>((resolve) => {
        let set = groupDetailWaiters.get(groupId);
        if (set === undefined) {
          set = new Set();
          groupDetailWaiters.set(groupId, set);
        }
        set.add(resolve);
      });
    }

    function notifyGroupDetailSettled(groupId: string): void {
      const set = groupDetailWaiters.get(groupId);
      if (set === undefined) {
        return;
      }
      groupDetailWaiters.delete(groupId);
      for (const resolve of set) {
        resolve();
      }
    }

    async function ensureGroupDetail(groupId: string, force = false): Promise<void> {
      if (groupId === '') {
        return;
      }
      if (loadingGroupDetails.has(groupId)) {
        return;
      }
      if (!force && groupDetails.has(groupId)) {
        return;
      }
      loadingGroupDetails.add(groupId);
      try {
        const detail = await api.getGroup(groupId);
        groupDetails.set(groupId, detail);
        // Publishing a monotonically increasing revision notifies every
        // `groupDetail(groupId)` subscriber, including screens mounted before
        // the fetch resolved.
        set((state) => ({ groupDetailsRevision: state.groupDetailsRevision + 1 }));
      } catch {
        // The sheet falls back to an empty member list and hides creation.
      } finally {
        loadingGroupDetails.delete(groupId);
        notifyGroupDetailSettled(groupId);
      }
    }

    // The group id behind one chat row: topic rows carry it directly
    // (T-0139: the live row first, so a deep-linked topic works before any
    // entry flowed through `rememberGroupIds`), legacy group rows resolve it
    // through the remembered `/api/chats` entries.
    function groupIdForChat(chatId: string): string | undefined {
      return get().chats.find((entry) => entry.id === chatId)?.groupId ?? groupIds.get(chatId);
    }

    // Loads the custom roles (T-0137) of a group once, so the group screen
    // and the topic access sheet can read them. Published through `set()`
    // (the `groupDetailsRevision` bump) so `groupRoles` selectors re-fire.
    // Rejects on failure so the screen can show Retry.
    async function ensureGroupRoles(groupId: string, force = false): Promise<void> {
      if (groupId === '') {
        return;
      }
      if (loadingGroupRoles.has(groupId)) {
        return;
      }
      if (!force && groupRolesById.has(groupId)) {
        return;
      }
      loadingGroupRoles.add(groupId);
      try {
        const roles = await rolesApi.listGroupRoles(groupId);
        groupRolesById.set(groupId, roles);
        set((state) => ({ groupDetailsRevision: state.groupDetailsRevision + 1 }));
      } finally {
        loadingGroupRoles.delete(groupId);
      }
    }

    // Remembers the roles of one full topic response (create/patch/roles),
    // replacing whatever was cached. The response is the server truth, so a
    // private-to-public flip clears the entry instead of leaving it stale.
    function rememberTopicRoles(topic: Topic): void {
      topicRolesById.set(topic.id, { roles: topic.roles, approverRole: topic.approverRole });
      set((state) => ({ groupDetailsRevision: state.groupDetailsRevision + 1 }));
    }

    // Loads the attached roles + approver role of the topic that owns
    // `chatId` once, so the topic info sheet can read them. Rejects on
    // failure so the sheet can show Retry.
    async function ensureTopicRoles(chatId: string, force = false): Promise<void> {
      const chat = get().chats.find((entry) => entry.id === chatId);
      const topicId = chat?.topic?.id;
      if (topicId === undefined) {
        return;
      }
      if (loadingTopicRoles.has(topicId)) {
        return;
      }
      if (!force && topicRolesById.has(topicId)) {
        return;
      }
      loadingTopicRoles.add(topicId);
      try {
        const topic = await topics.getTopic(topicId);
        rememberTopicRoles(topic);
      } finally {
        loadingTopicRoles.delete(topicId);
      }
    }

    // Loads the member names of a group once per chat, so a typing indicator
    // or a message from a member who is not a contact can still show a name.
    // T-0147: resolves through the shared group detail only — never its own
    // `api.getGroup`. When no detail is cached or in flight, this starts the
    // shared detail load itself (which fills the detail cache), so concurrent
    // rows collapse into one GET however they arrive.
    function rememberMembers(chatId: string, detail: GroupDetail): void {
      const members = new Map<string, string>();
      for (const member of detail.members) {
        members.set(member.userId.toLowerCase(), member.name);
      }
      groupMembers.set(chatId, members);
    }

    async function ensureGroupMembers(chatId: string): Promise<void> {
      if (groupMembers.has(chatId) || loadingGroupMembers.has(chatId)) {
        return;
      }
      const groupId = groupIdForChat(chatId);
      if (groupId === undefined) {
        return;
      }
      const cached = groupDetails.get(groupId);
      if (cached !== undefined) {
        rememberMembers(chatId, cached);
        return;
      }
      loadingGroupMembers.add(chatId);
      try {
        // Starts the shared detail load when nothing is in flight (a no-op
        // when someone else already started it), then waits for it: one GET
        // serves every topic row of the group, and the fallback fills the
        // detail cache instead of a side map.
        await ensureGroupDetail(groupId);
        let settled = groupDetails.get(groupId);
        if (settled === undefined && loadingGroupDetails.has(groupId)) {
          try {
            await groupDetailSettled(groupId);
          } catch {
            return;
          }
          settled = groupDetails.get(groupId);
        }
        if (settled === undefined) {
          return;
        }
        rememberMembers(chatId, settled);
      } finally {
        loadingGroupMembers.delete(chatId);
      }
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
        // The detail first: it fills the cache, so the member-name fallback
        // behind every topic row shares the same GET (T-0147 ordering).
        const groupId = groupIdForChat(chat.id);
        if (groupId !== undefined) {
          void ensureGroupDetail(groupId);
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

    // Merges a fresh chat list, preserving the local last message, unread
    // count, mute flag and presence of the chats already shown. Topic entries
    // (T-0112) expand to one row per visible topic; rows that disappeared
    // (made private, archived, or I was removed) vanish here, and the open
    // topic moves to the topics screen with a short, name-free notice.
    // Chat prefs (T-0135) are applied after the merge so server rows pin,
    // mute and archive the summaries; a pref whose chat is gone is ignored.
    // Returns the previous chats so the caller can tell which rows are new.
    function mergeChatEntries(entries: ChatEntry[]): Map<string, ChatSummary> {
      const previous = get().chats;
      const known = new Map(previous.map((chat) => [chat.id, chat]));
      const rows = entries.flatMap((entry) => summariesFor(entry));
      const wanted = new Set(rows.map((row) => row.id));
      const fresh = rows.filter((row) => !known.has(row.id));
      const kept = rows
        .filter((row) => known.has(row.id))
        .map((row) => {
          const existing = known.get(row.id);
          if (existing === undefined) {
            return row;
          }
          return {
            ...row,
            ...(existing.lastMessage === undefined ? {} : { lastMessage: existing.lastMessage }),
            unread: existing.unread,
            ...(existing.online === undefined ? {} : { online: existing.online }),
            ...(existing.onlineCount === undefined ? {} : { onlineCount: existing.onlineCount }),
          };
        });
      // New chats appear at the top; the rest keep their recency order.
      const merged = applyChatPrefs(
        [...fresh, ...sortByRecency(kept)],
        chatPrefRows,
        now().getTime(),
      );
      set({ chats: merged });
      rememberGroupIds(entries);
      // A topic that disappeared while open navigates back to its group's
      // topics screen with a short notice that never names the topic.
      const openId = get().activeChatId;
      if (openId !== null && !wanted.has(openId)) {
        const was = previous.find((chat) => chat.id === openId);
        if (was?.topic !== undefined && was.groupId !== undefined) {
          set({
            activeChatId: null,
            topicNotice: { groupId: was.groupId, message: TOPIC_GONE_NOTICE },
          });
        } else {
          set({ activeChatId: null });
        }
      }
      return known;
    }

    // Joins the rooms of the new groups and loads their preview, best-effort.
    // Topic rows (T-0112) each join their own room, like group rows today.
    async function adoptChatEntries(
      entries: ChatEntry[],
      known: Map<string, ChatSummary>,
    ): Promise<void> {
      const current = core;
      const me = get().me;
      if (current === undefined || me === undefined) {
        return;
      }
      // Dedupe the roster path per group id (T-0147): every topic row of one
      // group joins its own room, but the member names come from one shared
      // detail GET per group, not one per row.
      const detailStarted = new Set<string>();
      const freshRows = entries
        .flatMap((entry) => summariesFor(entry))
        .filter((row) => !known.has(row.id) && row.kind === 'group');
      for (const row of freshRows) {
        await current.joinRoom(row.id, nick(me)).catch(() => {});
        const groupId = row.groupId ?? groupIds.get(row.id);
        if (groupId !== undefined && !detailStarted.has(groupId)) {
          detailStarted.add(groupId);
          void ensureGroupDetail(groupId);
        }
        void ensureGroupMembers(row.id);
      }
      for (const row of entries.flatMap((entry) => summariesFor(entry))) {
        if (known.has(row.id)) {
          continue;
        }
        const chat = get().chats.find((item) => item.id === row.id);
        if (chat !== undefined) {
          await loadPreview(current, chat);
        }
      }
    }

    async function refreshChats(): Promise<void> {
      const gen = generation;
      let entries: ChatEntry[];
      let prefs: ChatPref[];
      try {
        [entries, prefs] = await Promise.all([api.getChats(), loadPrefRows()]);
      } catch {
        // A background refresh failure stays silent; the manual reload reports it.
        return;
      }
      if (gen !== generation) {
        return;
      }

      chatPrefRows = prefs;
      const known = mergeChatEntries(entries);
      flushPending();
      await adoptChatEntries(entries, known);
    }

    // Pull-to-refresh and the list's Retry key. Unlike a background refresh it
    // reports a failure in `chatsLoad`, and it only re-runs boot when the first
    // boot never got as far as a core (e.g. the first `/api/chats` failed).
    async function reloadChatsList(): Promise<void> {
      const gen = generation;
      let entries: ChatEntry[];
      let prefs: ChatPref[];
      try {
        [entries, prefs] = await Promise.all([api.getChats(), loadPrefRows()]);
      } catch {
        if (gen === generation) {
          set({ chatsLoad: 'error' });
        }
        return;
      }
      if (gen !== generation) {
        return;
      }
      chatPrefRows = prefs;
      const known = mergeChatEntries(entries);
      set({ chatsLoad: 'loaded' });
      flushPending();
      await adoptChatEntries(entries, known);
    }

    async function loadPreview(current: XmppCore, chat: ChatSummary): Promise<void> {
      try {
        const page = await current.loadHistory(chat.id, coreKind(chat), {
          max: PREVIEW_HISTORY_MAX,
        });
        // Edits and reactions update derived state and never render as a
        // bubble or preview row.
        ingestHistoryReactions(page.messages);
        ingestHistoryEdits(page.messages);
        const last = page.messages
          .filter((message) => !isReactionOnly(message) && !isEditStanza(message))
          .at(-1);
        if (last === undefined) {
          return;
        }
        const ui = toUiMessage(last, get().currentUserId);
        resolvePendingEdits(chat.id);
        const preview = previewFor(withEdits(ui, chat.id));
        set((state) => ({
          chats: state.chats.map((entry) =>
            entry.id === chat.id && entry.lastMessage === undefined
              ? { ...entry, lastMessage: preview }
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

    // A history load is safe only once the core is online (it is assigned
    // before `connect()` resolves, so presence alone is not enough: a MAM query
    // sent while still connecting fails) and, for a group, once its room joined.
    function canLoadHistory(chat: ChatSummary): boolean {
      return (
        core !== undefined && get().status === 'online' && (chat.kind !== 'group' || groupsJoined)
      );
    }

    // Runs the pending open once the core is online and the chat is known.
    // Called after every point where either can become ready: the first chat
    // merge, a background refresh, a manual reload and (re)connect.
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

    async function openHistory(chatId: string): Promise<void> {
      const chat = get().chats.find((entry) => entry.id === chatId);
      const current = core;
      if (current === undefined || chat === undefined || !canLoadHistory(chat)) {
        // The chat screen mounted before the data was there. Remember it and
        // load once the core and the chat are both ready; never query MAM while
        // the core is still connecting.
        pendingOpenChatId = chatId;
        setHistoryLoad(chatId, 'loading');
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
      setHistoryLoad(chatId, 'loading');
      try {
        const page = await current.loadHistory(chatId, coreKind(chat), { max: PAGE_HISTORY_MAX });
        // Edits and reactions update derived state and never render as a
        // bubble or preview row.
        ingestHistoryReactions(page.messages);
        ingestHistoryEdits(page.messages);
        const loaded = page.messages
          .filter((message) => !isReactionOnly(message) && !isEditStanza(message))
          .map((message) => toUiMessage(message, get().currentUserId));
        resolvePendingEdits(chatId);
        const withEditsApplied = loaded.map((message) => withEdits(message, chatId));
        const newest = withEditsApplied.at(-1);
        set((state) => {
          const live = listFor(state, chatId).filter(
            (message) => !withEditsApplied.some((item) => sameMessage(item.id, message.id)),
          );
          return {
            messagesByChat: {
              ...state.messagesByChat,
              [chatId]: sortMessages([...withEditsApplied, ...live]),
            },
            historyComplete: { ...state.historyComplete, [chatId]: page.complete },
            chats:
              newest === undefined
                ? state.chats
                : state.chats.map((entry) =>
                    entry.id === chatId ? { ...entry, lastMessage: previewFor(newest) } : entry,
                  ),
          };
        });
        cursors[chatId] = page.first;
        refreshEdits(chatId);
        const last = withEditsApplied.at(-1);
        if (last !== undefined) {
          recordRead(chatId, last.id);
          current.markDisplayed(chatId, coreKind(chat), last.id);
        }
        setHistoryLoad(chatId, 'loaded');
      } catch {
        // Keep whatever live messages we have; the view offers a retry.
        setHistoryLoad(chatId, 'error');
      } finally {
        loadingHistory.delete(chatId);
      }
      flushPending();
    }

    // One backwards history page, shared by `loadOlder` and `openAtMessage`.
    async function loadOlderPage(chatId: string, cursor: string): Promise<void> {
      const chat = get().chats.find((entry) => entry.id === chatId);
      const current = core;
      if (chat === undefined || current === undefined || loadingOlder.has(chatId)) {
        return;
      }
      loadingOlder.add(chatId);
      try {
        const page = await current.loadHistory(chatId, coreKind(chat), {
          before: cursor,
          max: PAGE_HISTORY_MAX,
        });
        // Edits and reactions update derived state and never render as a
        // bubble or preview row.
        ingestHistoryReactions(page.messages);
        ingestHistoryEdits(page.messages);
        const older = page.messages
          .filter((message) => !isReactionOnly(message) && !isEditStanza(message))
          .map((message) => toUiMessage(message, get().currentUserId));
        resolvePendingEdits(chatId);
        const withEditsApplied = older.map((message) => withEdits(message, chatId));
        set((state) => ({
          messagesByChat: {
            ...state.messagesByChat,
            [chatId]: sortMessages([...withEditsApplied, ...listFor(state, chatId)]),
          },
          historyComplete: { ...state.historyComplete, [chatId]: page.complete },
        }));
        cursors[chatId] = page.first;
        refreshEdits(chatId);
      } catch {
        // A failed page load leaves the cursor for a later retry.
      } finally {
        loadingOlder.delete(chatId);
      }
    }

    function loadOlder(chatId: string): void {
      const cursor = cursors[chatId];
      if (cursor === undefined) {
        return;
      }
      void loadOlderPage(chatId, cursor);
    }

    // Resolves true once the in-flight first-page load for a chat settles,
    // so a search jump never pages past a page that is still arriving.
    function waitForHistory(chatId: string): Promise<boolean> {
      return new Promise<boolean>((resolve) => {
        if (!loadingHistory.has(chatId)) {
          resolve(true);
          return;
        }
        const timer = setInterval(() => {
          if (!loadingHistory.has(chatId)) {
            clearInterval(timer);
            clearTimeout(timeout);
            resolve(true);
          }
        }, 25);
        const timeout = setTimeout(() => {
          clearInterval(timer);
          resolve(false);
        }, MESSAGE_JUMP_WAIT_MS);
      });
    }

    async function boot(gen: number): Promise<void> {
      let me: Me;
      let entries: ChatEntry[];
      let contacts: Contact[];
      let prefs: ChatPref[];
      try {
        [me, entries, contacts, prefs] = await Promise.all([
          api.getMe(),
          api.getChats(),
          api.getContacts(),
          // Prefs ride the boot like the web store; a failure reads as no
          // rows (older server, offline) rather than failing the boot.
          loadPrefRows().catch((): ChatPref[] => []),
        ]);
      } catch {
        if (gen === generation) {
          set({ status: 'offline', chatsLoad: 'error' });
        }
        return;
      }
      if (gen !== generation) {
        return;
      }

      lastRead = {};
      rememberGroupIds(entries);
      chatPrefRows = prefs;
      set({
        me,
        currentUserId: me.id,
        chats: applyChatPrefs(
          entries.flatMap((entry) => summariesFor(entry)),
          prefs,
          now().getTime(),
        ),
        contacts,
        chatsLoad: 'loaded',
        ownedAis: deps.ownedAis ?? get().ownedAis,
      });
      startDraftStream(gen);
      flushPending();

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
      // The trusted media hosts follow the XMPP token (web does the same):
      // the upload service answers on these hosts in dev and production.
      mediaToken = { service: token.service, domain: token.domain };
      mediaTrustedHosts = trustedMediaHosts(mediaToken);
      set({ mediaTrustedHosts });

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
          mediaToken = { service: fresh.service, domain: fresh.domain };
          mediaTrustedHosts = trustedMediaHosts(mediaToken);
          set({ mediaTrustedHosts });
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
      flushPending();
      await joinGroups(current, me);
      if (gen !== generation) {
        return;
      }
      groupsJoined = true;
      flushPending();
      await Promise.all(get().chats.map((chat) => loadPreview(current, chat)));
      if (gen === generation) {
        set((state) => ({ chats: sortByRecency(state.chats) }));
      }
    }

    // A real device suspends the socket in the background, so on resume we must
    // not assume it is alive: reconnect whenever the status is not `online`.
    // A boot already in flight (slow network, quick background/foreground)
    // is awaited instead of starting a second one: two boots would create
    // two cores and double every XMPP subscription.
    let bootPromise: Promise<void> | undefined;
    async function runBoot(gen: number): Promise<void> {
      if (bootPromise === undefined) {
        bootPromise = boot(gen).finally(() => {
          bootPromise = undefined;
        });
      }
      await bootPromise;
    }
    async function reconnect(): Promise<void> {
      if (!started) {
        return;
      }
      if (bootPromise !== undefined) {
        await bootPromise;
        return;
      }
      const current = core;
      if (current === undefined) {
        await runBoot(generation);
        return;
      }
      if (get().status === 'online') {
        return;
      }
      try {
        await current.connect();
        set({ status: 'online' });
        flushPending();
        const me = get().me;
        if (me !== undefined) {
          await joinGroups(current, me);
          groupsJoined = true;
        }
        flushPending();
      } catch {
        set({ status: 'offline' });
      }
    }

    return {
      currentUserId: CURRENT_USER_ID,
      me: undefined,
      status: 'offline',
      chatsLoad: 'loading',
      chats: [],
      contacts: [],
      messagesByChat: {},
      historyLoad: {},
      activeChatId: null,
      historyComplete: {},
      search: '',
      activeFolder: 'all',
      typing: {},
      edits: {},
      reactions: {},
      drafts: {},
      finishedDraftMessages: {},
      editTarget: undefined,
      actionError: undefined,
      mediaTrustedHosts: undefined,
      messages: (chatId) => get().messagesByChat[chatId] ?? EMPTY_MESSAGES,
      hasMore: (chatId) => get().historyComplete[chatId] !== true && cursors[chatId] !== undefined,
      jumpTarget: undefined,
      openChat: (chatId) => {
        set((state) => {
          const chat = state.chats.find((entry) => entry.id === chatId);
          const noticeGroup = state.topicNotice?.groupId;
          const keepNotice =
            noticeGroup !== undefined &&
            chat?.groupId !== undefined &&
            chat.groupId === noticeGroup;
          return {
            activeChatId: chatId,
            topicNotice: keepNotice ? state.topicNotice : undefined,
          };
        });
        recordRead(chatId, lastRead[chatId]);
        // The detail first: it fills the cache, so the member-name fallback
        // shares the same GET on a cold open (T-0147 ordering).
        {
          const groupId = groupIdForChat(chatId);
          if (groupId !== undefined) {
            void ensureGroupDetail(groupId);
          }
        }
        void ensureGroupMembers(chatId);
        // Pins load when the chat opens and refresh on focus + 60 s while
        // it is open, like the web store (no realtime channel yet).
        void loadPins(chatId, true);
        startPinsPolling(chatId, generation);
        if (pendingOpenChatId !== undefined && pendingOpenChatId !== chatId) {
          clearSupersededMarker(pendingOpenChatId);
        }
        pendingOpenChatId = chatId;
        void openHistory(chatId);
      },
      reloadChats: () => {
        set({ chatsLoad: 'loading' });
        // A first boot that never reached a core (e.g. `/api/chats` failed) is
        // retried whole; a running session just refetches the list.
        if (core === undefined) {
          generation += 1;
          void runBoot(generation);
          return;
        }
        void reloadChatsList();
      },
      retryHistory: (chatId) => {
        void openHistory(chatId);
      },
      loadOlder,
      openAtMessage: async (chatId, messageId) => {
        get().openChat(chatId);
        const chat = get().chats.find((entry) => entry.id === chatId);
        const current = core;
        if (chat === undefined || current === undefined || !canLoadHistory(chat)) {
          const found = listFor(get(), chatId).find((item) => sameMessage(item.id, messageId));
          if (found === undefined) {
            throw new Error('message_not_found');
          }
          set({ jumpTarget: { chatId, messageId } });
          return found;
        }
        // Wait for the opening page when it is still in flight, then page
        // backwards until the message is loaded or history runs out. A
        // stalled wait (false) breaks out to "Message not found".
        for (let pages = 0; pages < MESSAGE_JUMP_MAX_PAGES; pages += 1) {
          const loaded = listFor(get(), chatId).find((item) => sameMessage(item.id, messageId));
          if (loaded !== undefined) {
            set({ jumpTarget: { chatId, messageId } });
            return loaded;
          }
          if (get().historyComplete[chatId] === true) {
            break;
          }
          if (loadingHistory.has(chatId)) {
            if (!(await waitForHistory(chatId))) {
              break;
            }
            continue;
          }
          const cursor = cursors[chatId];
          if (cursor === undefined) {
            if (!(await waitForHistory(chatId))) {
              break;
            }
            continue;
          }
          await loadOlderPage(chatId, cursor);
        }
        const found = listFor(get(), chatId).find((item) => sameMessage(item.id, messageId));
        if (found === undefined) {
          throw new Error('message_not_found');
        }
        set({ jumpTarget: { chatId, messageId } });
        return found;
      },
      clearJumpTarget: () => set({ jumpTarget: undefined }),
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
        const mine = myJid();
        if (mine !== undefined) {
          rememberAuthor(localId, { jid: mine, resolved: true });
        }

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
            linkLocalToServer(localId, sent.id);
            rememberOriginId(localId, sent.id);
            updateMessageStatus(chatId, localId, 'sent');
          })
          .catch(() => {
            // The message stays marked as sending; a reconnect can resend later.
          });
      },
      sendSticker: (chatId, sticker, options) => {
        const chat = get().chats.find((entry) => entry.id === chatId);
        if (chat === undefined) {
          return;
        }
        // The choice may come from tampered storage recents or drifted pack
        // rows: validate before the optimistic insert, because `encodePayload`
        // throws synchronously on an invalid payload and would otherwise leave
        // a stuck `sending` bubble with no retry.
        const data = {
          pack_id: sticker.packId,
          sticker_id: sticker.stickerId,
          url: sticker.url,
          ...(sticker.emoji === undefined ? {} : { emoji: sticker.emoji }),
          width: sticker.width,
          height: sticker.height,
          mime: sticker.mime,
        };
        if (!StickerSchema.safeParse(data).success) {
          set({ actionError: { chatId, message: 'That sticker could not be sent.' } });
          return;
        }
        sequence += 1;
        const localId = `local-${sequence}`;
        const replyTo = options?.replyTo;
        const body = sticker.emoji ?? '';
        const payload = { v: 0, type: 'sticker', data } as const;
        const message: UiMessage = {
          id: localId,
          chatId,
          senderId: get().currentUserId,
          senderName: 'You',
          text: body,
          createdAt: now(),
          status: 'sending',
          card: payload,
          ...(replyTo === undefined ? {} : { replyTo }),
        };
        const signature = stickerSignatureFor(chatId, body, sticker.stickerId, replyTo);
        const queue = pendingOutgoing.get(signature) ?? [];
        queue.push(localId);
        pendingOutgoing.set(signature, queue);
        set((state) => ({
          // A later validated send clears this chat's stale error banner.
          actionError: state.actionError?.chatId === chatId ? undefined : state.actionError,
        }));
        setChatMessage(chatId, message, true);
        const mine = myJid();
        if (mine !== undefined) {
          rememberAuthor(localId, { jid: mine, resolved: true });
        }
        runStickerSend(chat, localId, payload, body, replyTo);
      },
      retrySticker: (chatId, messageId) => {
        const chat = get().chats.find((entry) => entry.id === chatId);
        if (chat === undefined) {
          return;
        }
        const message = listFor(get(), chatId).find((item) => sameMessage(item.id, messageId));
        const payload =
          message?.card !== undefined && message.card.type === 'sticker' ? message.card : undefined;
        if (message === undefined || payload === undefined) {
          return;
        }
        if (!StickerSchema.safeParse(payload.data).success) {
          markStickerFailed(chatId, messageId);
          return;
        }
        set((state) => ({
          // A later validated send clears this chat's stale error banner.
          actionError: state.actionError?.chatId === chatId ? undefined : state.actionError,
          messagesByChat: {
            ...state.messagesByChat,
            [chatId]: listFor(state, chatId).map((item) =>
              sameMessage(item.id, messageId) ? clearFailure(item) : item,
            ),
          },
        }));
        // Enqueue the id under the sticker signature so the server echo
        // reconciles with this bubble instead of duplicating it (a retry
        // without the enqueue keeps the local row AND appends the echo).
        const signature = stickerSignatureFor(
          chatId,
          message.text ?? '',
          payload.data.sticker_id,
          message.replyTo,
        );
        const queue = pendingOutgoing.get(signature) ?? [];
        queue.push(messageId);
        pendingOutgoing.set(signature, queue);
        runStickerSend(chat, messageId, payload, message.text ?? '', message.replyTo);
      },
      sendAttachment: (chatId, file, options) => {
        const chat = get().chats.find((entry) => entry.id === chatId);
        if (chat === undefined) {
          return;
        }
        // An empty or oversized file is refused inline, before any request,
        // exactly like web's composer. The cap follows the server upload
        // limit (50 MiB); a refused slot still fails on Retry with the same
        // message. Only a REAL zero says "That file is empty": an unknown
        // size (undefined) is never refused as empty — the upload decides.
        if (file.size !== undefined && file.size === 0) {
          set({ actionError: { chatId, message: 'That file is empty.' } });
          return;
        }
        if (file.size !== undefined && file.size > MAX_ATTACHMENT_BYTES) {
          set({ actionError: { chatId, message: 'That file is larger than 50 MB.' } });
          return;
        }
        sequence += 1;
        const localId = `local-${sequence}`;
        const replyTo = options?.replyTo;
        const caption = options?.caption?.trim() ?? '';
        const kind = attachmentDataFor(file, '').kind;
        const localUrl = kind === 'image' ? file.uri : '';
        const message: UiMessage = {
          id: localId,
          chatId,
          senderId: get().currentUserId,
          senderName: 'You',
          createdAt: now(),
          status: 'sending',
          attachment: attachmentDataFor(file, localUrl),
          ...(caption.length === 0 ? {} : { text: caption }),
          ...(replyTo === undefined ? {} : { replyTo }),
        };
        // The local preview URI rides alongside (never on the wire): the
        // bubble shows the local bytes while the upload runs.
        (message as Partial<MobileMessage>).localUri = file.uri;
        const signature = signatureFor(chatId, caption, replyTo);
        const queue = pendingOutgoing.get(signature) ?? [];
        queue.push(localId);
        pendingOutgoing.set(signature, queue);
        set((state) => ({
          // A later validated send clears this chat's stale error banner.
          actionError: state.actionError?.chatId === chatId ? undefined : state.actionError,
        }));
        setChatMessage(chatId, message, true);
        pendingUploads.set(localId, file);
        const mine = myJid();
        if (mine !== undefined) {
          rememberAuthor(localId, { jid: mine, resolved: true });
        }
        runAttachmentUpload(chat, localId, file, caption, replyTo);
      },
      retryAttachment: (chatId, messageId) => {
        const root = aliasRoot(messageId);
        const file = pendingUploads.get(root) ?? pendingUploads.get(messageId);
        const chat = get().chats.find((entry) => entry.id === chatId);
        if (file === undefined || chat === undefined) {
          return;
        }
        const message = listFor(get(), chatId).find((item) => sameMessage(item.id, messageId));
        if (message === undefined) {
          return;
        }
        clearAttachmentFailure(chatId, messageId);
        // The retry re-keys the local preview (a retried message keeps the
        // local URI) and re-runs the upload from the kept bytes.
        set((state) => ({
          messagesByChat: {
            ...state.messagesByChat,
            [chatId]: listFor(state, chatId).map((item) =>
              sameMessage(item.id, messageId) ? { ...item, localUri: file.uri } : item,
            ),
          },
        }));
        runAttachmentUpload(chat, messageId, file, message.text ?? '', message.replyTo);
      },
      cancelAttachment: (chatId, messageId) => {
        // Cancelling aborts only this message's in-flight PUT and removes
        // the optimistic bubble, like web's composer cancel. The bytes are
        // dropped, so a later Retry is a no-op. Other messages' uploads keep
        // running: the uploader keys controllers per message id.
        deps.uploader?.cancel(aliasRoot(messageId));
        deps.uploader?.cancel(messageId);
        pendingUploads.delete(aliasRoot(messageId));
        pendingUploads.delete(messageId);
        set((state) => ({
          messagesByChat: {
            ...state.messagesByChat,
            [chatId]: listFor(state, chatId).filter((item) => !sameMessage(item.id, messageId)),
          },
        }));
      },
      sendVoice: (chatId, recording, options) => {
        const chat = get().chats.find((entry) => entry.id === chatId);
        if (chat === undefined) {
          return;
        }
        // The send boundary (finding 1, review round 2): refuse an
        // over-limit recording here too, before any optimistic bubble, slot
        // request or PUT — the composer is not the only caller. The banner
        // names the actual refusal (finding 4, round 3), never a guess.
        try {
          validateRecording(recording);
        } catch (error) {
          set({ actionError: { chatId, message: voiceSendRefusalMessage(error) } });
          return;
        }
        const durationMs = Math.max(1, Math.round(recording.durationMs));
        const waveform = recording.waveform.length > 0 ? recording.waveform : [12];
        sequence += 1;
        const localId = `local-${sequence}`;
        const replyTo = options?.replyTo;
        const kept: RecordedVoice = {
          uri: recording.uri,
          mimeType: recording.mimeType,
          size: recording.size,
          durationMs,
        };
        const message: UiMessage = {
          id: localId,
          chatId,
          senderId: get().currentUserId,
          senderName: 'You',
          createdAt: now(),
          status: 'sending',
          voice: {
            duration_ms: durationMs,
            mime: 'audio/mp4',
            waveform,
            ...(recording.uri === '' ? {} : { url: recording.uri }),
          },
          ...(replyTo === undefined ? {} : { replyTo }),
        };
        // The local file URI rides alongside (never on the wire): the bubble
        // plays the local bytes while the upload runs.
        (message as Partial<MobileMessage>).localUri = recording.uri;
        const signature = signatureFor(chatId, '', replyTo);
        const queue = pendingOutgoing.get(signature) ?? [];
        queue.push(localId);
        pendingOutgoing.set(signature, queue);
        set((state) => ({
          // A later validated send clears this chat's stale error banner.
          actionError: state.actionError?.chatId === chatId ? undefined : state.actionError,
        }));
        setChatMessage(chatId, message, true);
        pendingVoices.set(localId, kept);
        const mine = myJid();
        if (mine !== undefined) {
          rememberAuthor(localId, { jid: mine, resolved: true });
        }
        runVoiceSend(chat, localId, kept, waveform, replyTo);
      },
      retryVoice: (chatId, messageId) => {
        const root = aliasRoot(messageId);
        const kept = pendingVoices.get(root) ?? pendingVoices.get(messageId);
        const chat = get().chats.find((entry) => entry.id === chatId);
        if (kept === undefined || chat === undefined) {
          return;
        }
        const message = listFor(get(), chatId).find((item) => sameMessage(item.id, messageId));
        if (message === undefined || message.voice === undefined || message.failed !== true) {
          return;
        }
        clearAttachmentFailure(chatId, messageId);
        // The retry re-keys the local preview and re-runs the pipeline from
        // the kept recording.
        set((state) => ({
          messagesByChat: {
            ...state.messagesByChat,
            [chatId]: listFor(state, chatId).map((item) =>
              sameMessage(item.id, messageId) ? { ...item, localUri: kept.uri } : item,
            ),
          },
        }));
        runVoiceSend(chat, messageId, kept, message.voice.waveform, message.replyTo);
      },
      cancelVoice: (chatId, messageId) => {
        // Cancelling aborts only this message's in-flight PUT and removes
        // the optimistic bubble. The recording is dropped, so a later Retry
        // is a no-op. The uploader keys controllers per message id.
        deps.uploader?.cancel(aliasRoot(messageId));
        deps.uploader?.cancel(messageId);
        pendingVoices.delete(aliasRoot(messageId));
        pendingVoices.delete(messageId);
        set((state) => ({
          messagesByChat: {
            ...state.messagesByChat,
            [chatId]: listFor(state, chatId).filter((item) => !sameMessage(item.id, messageId)),
          },
        }));
      },
      react: (chatId, messageId, emoji) => {
        const chat = get().chats.find((entry) => entry.id === chatId);
        const mine = myJid();
        if (chat === undefined || mine === undefined) {
          return;
        }
        // The local key is alias-resolved; the wire target must be the server
        // id everyone else knows. An unacked message has none yet, so reacting
        // would send a target nobody could match: do nothing until it has one.
        const targetId = aliasRoot(messageId);
        const wireTarget = wireTargetFor(messageId);
        const currentCore = core;
        if (wireTarget === undefined || currentCore === undefined) {
          return;
        }
        const current = get().reactions[chatId]?.targets[targetId]?.[mine]?.emojis ?? [];
        const next = current.includes(emoji)
          ? current.filter((entry) => entry !== emoji)
          : [...current, emoji];
        const apply = (emojis: string[]): void => {
          applyReactionUpdate(chatId, targetId, mine, emojis, now().getTime());
        };
        apply(next);
        currentCore.sendReactions(chatId, coreKind(chat), wireTarget, next).catch(() => {
          // The send failed: undo the optimistic toggle.
          apply(current);
        });
      },
      startEdit: (chatId, messageId) => {
        set({ editTarget: { chatId, messageId }, actionError: undefined });
      },
      cancelEdit: () => {
        set({ editTarget: undefined });
      },
      editMessage: (chatId, messageId, text) => {
        const trimmed = text.trim();
        const chat = get().chats.find((entry) => entry.id === chatId);
        const mine = myJid();
        if (chat === undefined || mine === undefined || trimmed.length === 0) {
          return;
        }
        const message = listFor(get(), chatId).find((item) => sameMessage(item.id, messageId));
        if (message === undefined || !canEditMessage(message, get().currentUserId, now())) {
          return;
        }
        // The UI already blocks a no-op edit; the store does too, so no stanza
        // is ever sent for an unchanged text.
        if (message.text === trimmed) {
          return;
        }
        // XEP-0308 names the original by its sender-generated id.
        const wireTarget = correctionTargetFor(messageId);
        const currentCore = core;
        if (wireTarget === undefined || currentCore === undefined) {
          return;
        }
        const targetId = aliasRoot(messageId);
        const author: EditAuthor = { jid: mine, resolved: true };
        const priorMentions = rebaseMentions(message.text ?? '', text, message.mentions ?? []);
        const mentions = mentionsForTrimmedText(text, trimmed, priorMentions);
        const update: EditUpdate = {
          kind: 'correction',
          targetId,
          author,
          text: trimmed,
          order: now().getTime(),
        };
        if (mentions.length > 0) {
          update.mentions = mentions;
        }
        const previous = get().edits[chatId];
        set({ actionError: undefined });
        set((state) => ({
          edits: {
            ...state.edits,
            [chatId]: applyEdit(state.edits[chatId] ?? emptyEdits(), update, author),
          },
        }));
        refreshEdits(chatId);
        currentCore
          .sendCorrection(
            chatId,
            coreKind(chat),
            wireTarget,
            trimmed,
            mentions.length === 0
              ? undefined
              : {
                  mentions: mentions.map((mention) => ({
                    jid: mention.jid,
                    begin: mention.begin,
                    end: mention.end,
                  })),
                },
          )
          .catch(() => {
            restoreMessage(chatId, message);
            restoreEdits(chatId, previous);
            set({
              actionError: { chatId, message: 'Could not save the edit. Try again.' },
            });
          });
      },
      deleteForEveryone: (chatId, messageId) => {
        const chat = get().chats.find((entry) => entry.id === chatId);
        const mine = myJid();
        if (chat === undefined || mine === undefined) {
          return;
        }
        const message = listFor(get(), chatId).find((item) => sameMessage(item.id, messageId));
        if (message === undefined || !canDeleteMessage(message, get().currentUserId)) {
          return;
        }
        const wireTarget = retractionTargetFor(chat, messageId);
        const currentCore = core;
        if (wireTarget === undefined || currentCore === undefined) {
          return;
        }
        const targetId = aliasRoot(messageId);
        const author: EditAuthor = { jid: mine, resolved: true };
        const update: EditUpdate = {
          kind: 'retraction',
          targetId,
          author,
          order: now().getTime(),
        };
        const previous = get().edits[chatId];
        set({ actionError: undefined });
        set((state) => ({
          edits: {
            ...state.edits,
            [chatId]: applyEdit(state.edits[chatId] ?? emptyEdits(), update, author),
          },
        }));
        refreshEdits(chatId);
        currentCore.sendRetraction(chatId, coreKind(chat), wireTarget).catch(() => {
          restoreMessage(chatId, message);
          restoreEdits(chatId, previous);
          set({
            actionError: { chatId, message: 'Could not delete the message. Try again.' },
          });
        });
      },
      dismissActionError: () => {
        set({ actionError: undefined });
      },
      topicNotice: undefined,
      dismissTopicNotice: () => set({ topicNotice: undefined }),
      groupDetailsRevision: 0,
      groupDetail: (groupId) => {
        // Reading the revision subscribes the selector to detail loads.
        void get().groupDetailsRevision;
        return groupDetails.get(groupId);
      },
      refreshGroupDetail: (groupId) => {
        void ensureGroupDetail(groupId, true);
      },
      ensureGroupDetail: (groupId) => {
        void ensureGroupDetail(groupId);
      },
      ownedAis: deps.ownedAis ?? [],
      setChatPref: async (chatId, input) => {
        const api = deps.chatPrefsApi;
        if (api === undefined) {
          throw new Error('Chat preferences are not available.');
        }
        const nowMs = now().getTime();
        // Optimistic: merge the intended row into a copy of the full saved
        // rows first, like the web store; the saved truth below replaces
        // it. Merging into the full rows (not a single-row list) keeps
        // every other chat's prefs, and seeding from the chat's own saved
        // row keeps its kept fields on a partial write: a single row built
        // from the input alone would strip both until the PUT returns.
        const optimisticRows = [
          ...chatPrefRows.filter((row) => row.chatJid.toLowerCase() !== chatId.toLowerCase()),
          optimisticPrefRow(chatId, chatPrefRows, input as PutChatPrefInput, new Date(nowMs)),
        ];
        set((state) => ({ chats: applyChatPrefs(state.chats, optimisticRows, nowMs) }));
        try {
          const saved = await api.putChatPref(chatId, input as PutChatPrefInput);
          chatPrefRows =
            saved === null
              ? chatPrefRows.filter((row) => row.chatJid.toLowerCase() !== chatId.toLowerCase())
              : [
                  ...chatPrefRows.filter(
                    (row) => row.chatJid.toLowerCase() !== chatId.toLowerCase(),
                  ),
                  saved,
                ];
          const refreshed = now().getTime();
          set((state) => ({ chats: applyChatPrefs(state.chats, chatPrefRows, refreshed) }));
        } catch (error) {
          // A failure re-merges the saved rows instead of restoring the
          // pre-write snapshot: anything that landed mid-flight (a new
          // message, an unread bump, a background refresh) survives, and
          // only the failed pref change is dropped.
          set((state) => ({ chats: applyChatPrefs(state.chats, chatPrefRows, now().getTime()) }));
          throw error;
        }
      },
      pins: (chatId) => {
        // Reading the revision subscribes the selector to pin publishes
        // for this chat, like `groupDetail` does with its own revision.
        void (pinsRevisionByChat.get(chatId) ?? 0);
        return pinsByChat.get(chatId) ?? EMPTY_PINS;
      },
      pinsError: undefined,
      refreshPins: async (chatId) => {
        await loadPins(chatId, true);
      },
      pinFor: (chatId, messageId) =>
        pinsByChat.get(chatId)?.find((pin) => pin.messageId === messageId),
      canPin: (chatId) => canPinIn(chatId),
      pinMessage: async (chatId, messageId) => {
        if (!canPinIn(chatId)) {
          throw new Error('You cannot pin here.');
        }
        const message = listFor(get(), chatId).find((item) => sameMessage(item.id, messageId));
        if (message === undefined) {
          throw new Error('Message not found');
        }
        const shape = {
          text: message.text,
          image: message.image,
          voice: message.voice,
          card: message.card,
          attachment: message.attachment,
        };
        const snapshot = {
          chat: chatId,
          messageId: message.id,
          senderName: message.senderName,
          text: pinSnapshotText({ ...shape, deleted: message.deleted }),
          kind: pinKindFor(shape),
        };
        const before = pinsByChat.get(chatId) ?? [];
        const optimistic: Pin = {
          ...snapshot,
          id: `pin-local-${now().getTime()}`,
          pinnedBy: get().me?.id ?? get().currentUserId,
          pinnedAt: new Date(now().getTime()).toISOString(),
        };
        publishOptimisticPins(chatId, [optimistic, ...before]);
        try {
          const saved = await pinsApi.pinMessage(snapshot);
          const current = pinsByChat.get(chatId) ?? [];
          publishOptimisticPins(
            chatId,
            current.some((pin) => pin.id === saved.id)
              ? current.map((pin) => (pin.id === optimistic.id ? saved : pin))
              : [saved, ...current.filter((pin) => pin.id !== optimistic.id)],
          );
        } catch (error) {
          publishOptimisticPins(chatId, before);
          throw error;
        }
      },
      unpinMessage: async (chatId, pinId) => {
        const before = pinsByChat.get(chatId) ?? [];
        publishOptimisticPins(
          chatId,
          before.filter((pin) => pin.id !== pinId),
        );
        try {
          const echoed = await pinsApi.unpinMessage(pinId);
          const current = pinsByChat.get(chatId) ?? [];
          publishOptimisticPins(
            chatId,
            current.filter((pin) => pin.id !== echoed.id),
          );
        } catch (error) {
          publishOptimisticPins(chatId, before);
          set({ pinsError: { chatId, message: 'Could not unpin. Try again.' } });
          throw error;
        }
      },
      dismissPinsError: () => {
        set({ pinsError: undefined });
      },
      stopPinsPoll: () => {
        stopPinsPolling();
      },
      createTopic: async (chatId, input) => {
        const chat = get().chats.find((entry) => entry.id === chatId);
        const groupId = chat?.groupId ?? groupIds.get(chatId);
        if (groupId === undefined) {
          throw new Error('This group is not available yet.');
        }
        const topic = await topics.createTopic(groupId, input as CreateTopicInput);
        rememberTopicRoles(topic);
        // The topic exists on the server now: a failed follow-up re-read
        // must not report "Could not create" (the sheet would invite a
        // retry that makes a duplicate). Refresh best-effort and fall back
        // to the created topic's own chat JID.
        await applyTopicRow(topic).catch(() => {});
        const row = get().chats.find((entry) => entry.topic?.id === topic.id);
        const rowId = row?.id ?? topic.chatJid;
        const me = get().me;
        if (core !== undefined && me !== undefined) {
          await core.joinRoom(rowId, nick(me)).catch(() => {});
        }
        return rowId;
      },
      patchTopic: async (chatId, input) => {
        const { topicId } = await topicIdFor(chatId);
        const topic = await topics.patchTopic(topicId, input as PatchTopicInput);
        // The patch response is the server truth: a private-to-public flip
        // cleared the roles there, so the cache is replaced, not merged.
        rememberTopicRoles(topic);
        await applyTopicRow(topic);
      },
      archiveTopic: async (chatId) => {
        const { topicId } = await topicIdFor(chatId);
        const topic = await topics.archiveTopic(topicId);
        await applyTopicRow(topic).catch(() => {});
        await refreshChats().catch(() => {});
      },
      addTopicAi: async (chatId, aiId) => {
        const { topicId } = await topicIdFor(chatId);
        const topic = await topics.addTopicAi(topicId, aiId);
        await applyTopicRow(topic);
      },
      removeTopicAi: async (chatId, aiId) => {
        const { topicId } = await topicIdFor(chatId);
        const topic = await topics.removeTopicAi(topicId, aiId);
        await applyTopicRow(topic);
      },
      addTopicMember: async (chatId, userId) => {
        const { topicId } = await topicIdFor(chatId);
        const topic = await topics.addTopicMember(topicId, userId);
        await applyTopicRow(topic);
      },
      removeTopicMember: async (chatId, userId) => {
        const { topicId } = await topicIdFor(chatId);
        try {
          const topic = await topics.removeTopicMember(topicId, userId);
          await applyTopicRow(topic);
        } catch (error) {
          // Removing the last member archives the topic (server 404): it is
          // gone from the visible list either way, so refresh like the
          // removed-while-open flow.
          await refreshChats().catch(() => {});
          throw error;
        }
      },
      leaveTopic: async (chatId) => {
        const me = get().me;
        if (me === undefined) {
          throw new Error('This topic is not available yet.');
        }
        await get().removeTopicMember(chatId, me.id);
      },
      listTopicMembers: async (chatId) => {
        const { topicId } = await topicIdFor(chatId);
        return topics.listTopicMembers(topicId);
      },
      listTopicAis: async (chatId) => {
        const { topicId } = await topicIdFor(chatId);
        return topics.listTopicAis(topicId);
      },
      listInviteLinks: async (groupId) => inviteLinks.listGroupInviteLinks(groupId),
      createInviteLink: async (groupId, input) => inviteLinks.createGroupInviteLink(groupId, input),
      revokeInviteLink: async (groupId, linkId) =>
        inviteLinks.revokeGroupInviteLink(groupId, linkId),
      previewJoinLink: async (token) => inviteLinks.previewJoinLink(token),
      joinByLink: async (token) => {
        const result = await inviteLinks.joinByLink(token);
        await refreshChats().catch(() => {});
        return result;
      },
      // T-0144: channels share the chat-list flow with groups (the detail
      // carries `kind`, the feed row paints the channel). Create refreshes
      // the list and returns the new group id from the POST answer.
      createChannel: async (input) => {
        const trimmed = input.title.trim();
        if (trimmed === '') {
          throw new Error('Enter a channel name.');
        }
        if (input.description !== undefined && input.description.length > 300) {
          throw new Error('The description must be at most 300 characters.');
        }
        const created = await groupsApi.createChannel({
          title: trimmed,
          ...(input.description === undefined || input.description.trim() === ''
            ? {}
            : { description: input.description.trim() }),
        });
        await refreshChats().catch(() => {});
        return created.id;
      },
      // T-0144: leaving a channel removes the caller through the member
      // route, then refreshes the list (the row disappears); the caller
      // navigates away.
      leaveChannel: async (chatId) => {
        const groupId = groupIdForChat(chatId);
        const me = get().me;
        if (groupId === undefined || me?.id === undefined) {
          throw new Error('This channel is not available yet.');
        }
        await groupsApi.removeGroupMember(groupId, me.id);
        await refreshChats().catch(() => {});
      },
      // T-0144: the members slice for the channel screen — the full audience
      // for managers, the owner/admins slice for subscribers (never the
      // audience), 404 for strangers. The server enforces the rule; the
      // client renders whatever it answers.
      listChannelMembers: async (groupId) => groupsApi.listGroupMembers(groupId),
      // T-0144: promote/demote through the role route (owner only, channels
      // only). The detail refreshes first so the channel screen updates at
      // once, then the chat list — the acting device's rows (myRole, counts)
      // match server truth and the composer bar flips. Demoting the last
      // admin rejects with 409 `channel_needs_admin`.
      changeChannelRole: async (chatId, userId, role: ChannelMemberRole) => {
        const groupId = groupIdForChat(chatId);
        if (groupId === undefined) {
          throw new Error('This channel is not available yet.');
        }
        await groupsApi.changeGroupMemberRole(groupId, userId, role);
        await ensureGroupDetail(groupId, true).catch(() => {});
        set((state) => ({ groupDetailsRevision: state.groupDetailsRevision + 1 }));
        await refreshChats().catch(() => {});
      },
      groupRoles: (groupId) => {
        // Reading the revision subscribes the selector to roles loads, like
        // `groupDetail`.
        void get().groupDetailsRevision;
        return groupRolesById.get(groupId);
      },
      refreshGroupRoles: (groupId) => {
        return ensureGroupRoles(groupId, true);
      },
      createGroupRole: async (groupId, name) => {
        const role = await rolesApi.createGroupRole(groupId, name);
        groupRolesById.set(groupId, [...(groupRolesById.get(groupId) ?? []), role]);
        set((state) => ({ groupDetailsRevision: state.groupDetailsRevision + 1 }));
        return role;
      },
      renameGroupRole: async (groupId, roleId, name) => {
        const role = await rolesApi.renameGroupRole(groupId, roleId, name);
        groupRolesById.set(
          groupId,
          (groupRolesById.get(groupId) ?? []).map((entry) => (entry.id === roleId ? role : entry)),
        );
        set((state) => ({ groupDetailsRevision: state.groupDetailsRevision + 1 }));
        return role;
      },
      deleteGroupRole: async (groupId, roleId) => {
        await rolesApi.deleteGroupRole(groupId, roleId);
        groupRolesById.set(
          groupId,
          (groupRolesById.get(groupId) ?? []).filter((entry) => entry.id !== roleId),
        );
        set((state) => ({ groupDetailsRevision: state.groupDetailsRevision + 1 }));
      },
      setGroupRoleMembers: async (groupId, roleId, userIds) => {
        const role = await rolesApi.setGroupRoleMembers(groupId, roleId, userIds);
        const known = groupRolesById.get(groupId);
        groupRolesById.set(
          groupId,
          known === undefined
            ? [role]
            : known.some((entry) => entry.id === roleId)
              ? known.map((entry) => (entry.id === roleId ? role : entry))
              : [...known, role],
        );
        set((state) => ({ groupDetailsRevision: state.groupDetailsRevision + 1 }));
        return role;
      },
      setTopicRoles: async (chatId, input) => {
        const { topicId } = await topicIdFor(chatId);
        const topic = await topics.setTopicRoles(topicId, input as SetTopicRolesInput);
        // The refreshed row carries the server truth: going public cleared
        // the roles there, so no stale roles stay in the store.
        rememberTopicRoles(topic);
        await applyTopicRow(topic);
      },
      topicRoles: (chatId) => {
        // Reading the revision subscribes the selector to topic-roles loads,
        // like `groupDetail`.
        void get().groupDetailsRevision;
        const topicId = get().chats.find((entry) => entry.id === chatId)?.topic?.id;
        if (topicId === undefined) {
          return undefined;
        }
        return topicRolesById.get(topicId);
      },
      refreshTopicRoles: (chatId) => {
        return ensureTopicRoles(chatId, true);
      },
      setSearch: (value) => set({ search: value }),
      setActiveFolder: (folder) => set({ activeFolder: folder }),
      start: () => {
        if (started) {
          return;
        }
        started = true;
        generation += 1;
        if (get().chats.length === 0) {
          set({ chatsLoad: 'loading' });
        }
        removeAppState = appState.subscribe((state) => {
          if (state !== 'active') {
            return;
          }
          void reconnect();
        });
        startTopicsPolling(generation);
        void runBoot(generation);
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
        stopTopicsPolling();
        clearDraftState();
        groupDetails.clear();
        loadingGroupDetails.clear();
        groupRolesById.clear();
        loadingGroupRoles.clear();
        topicRolesById.clear();
        loadingTopicRoles.clear();
        set({ drafts: {}, finishedDraftMessages: {}, edits: {}, reactions: {} });
        pendingOpenChatId = undefined;
        loadingHistory.clear();
        groupsJoined = false;
        messageAliases.clear();
        messageAuthors.clear();
        messageOriginIds.clear();
        messageServerIds.clear();
        mediaToken = undefined;
        mediaTrustedHosts = new Set();
        pendingUploads.clear();
        const current = core;
        core = undefined;
        if (current !== undefined) {
          void current.disconnect().catch(() => {});
        }
        set({ status: 'offline', mediaTrustedHosts: undefined });
      },
    };
  });
}

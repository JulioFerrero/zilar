// The message ledger shared by the web and mobile chat stores: message ids and
// their aliases, origin ids, authors and base texts, edits, reactions,
// mentions, previews, reply quotes, sender and reactor names, the mapping of a
// received stanza to a bubble, and the mutators every send and receive path
// goes through. It reads and writes the store state through `get` and `set`,
// and reads back its own writes (`refreshEdits`, `migrateReactionTargets`), so
// the store must keep a synchronous `set`.
import type {
  Attachment,
  ChatSummary,
  EditAuthor,
  EditsState,
  EditUpdate,
  MediaTokenShape,
  MessageStatus,
  ReactionsState,
  ReplyRef,
  SendFailureReason,
  UiMention,
  UiMessage,
  UiReaction,
  VoiceMeta,
} from '@zilar/chat-core';
import {
  applyEdit,
  applyReaction,
  editsFor,
  emptyEdits,
  emptyReactions,
  isTrustedMediaUrl,
  mentionsEqual,
  mergeEdits,
  mergeTargets,
  reactionChips as sharedReactionChips,
  reactionsEqual,
  resolveEdits,
  sanitizeIncomingAttachment,
  trustedMediaHosts,
  userLocalpartOf as sharedUserLocalpartOf,
} from '@zilar/chat-core';
import type { ForwardOrigin, Payload } from '@zilar/protocol';
import { jidLocal } from '@zilar/protocol';
import { advanceStatus, clearFailure, moveChatToTop, sortMessages } from './rows';

/**
 * The fields of a received stanza the ledger reads. `ChatMessage` of
 * `@zilar/xmpp-core` satisfies it; the ledger does not import that package
 * because its sources need the `@xmpp/client` ambient types, which only the
 * apps' tsconfigs include.
 */
export interface LedgerStanza {
  id: string;
  originId?: string;
  chatJid: string;
  fromJid: string;
  fromResolved: boolean;
  fromNick?: string;
  occupantId?: string;
  body?: string;
  payload?: Payload;
  forward?: ForwardOrigin;
  replyTo?: { id: string };
  reactions?: { targetId: string; emojis: string[] };
  correction?: { targetId: string };
  retraction?: { targetId: string };
  mentions?: { jid: string; begin?: number; end?: number }[];
  timestamp: Date;
  outgoing: boolean;
}

/**
 * A stored chat message: the shared `UiMessage` plus mobile's local-only
 * upload state (`apps/mobile/src/lib/types.ts` `MobileMessage`). Web never
 * sets the two upload fields, so its messages pass through unchanged.
 */
export type StoreMessage = UiMessage & {
  localUri?: string | undefined;
  uploadProgress?: number | undefined;
};

export interface LedgerContact {
  readonly jid: string;
  readonly name: string;
}

/** The part of a store's state the ledger reads; both apps' states satisfy it. */
export interface LedgerState {
  readonly messagesByChat: Readonly<Record<string, StoreMessage[]>>;
  readonly chats: ChatSummary[];
  readonly edits: Record<string, EditsState>;
  readonly reactions: Record<string, ReactionsState>;
  readonly contacts: readonly LedgerContact[];
  readonly me: { readonly jid?: string | null | undefined } | null | undefined;
}

/** The part of a store's state the ledger writes. */
export interface LedgerPatch {
  messagesByChat?: Record<string, StoreMessage[]>;
  chats?: ChatSummary[];
  edits?: Record<string, EditsState>;
  reactions?: Record<string, ReactionsState>;
}

export type LedgerSet = (update: LedgerPatch | ((state: LedgerState) => LedgerPatch)) => void;

export interface MessageLedgerDeps {
  readonly get: () => LedgerState;
  readonly set: LedgerSet;
  /** The group member name behind a lowercased user id, in one chat. */
  readonly memberName: (chatId: string, localpart: string) => string | undefined;
  /** The MUC nick of a room occupant (by real or room JID), when connected. */
  readonly occupantNick: (chatId: string, fromJid: string) => string | undefined;
  /** The XMPP token of the latest session, for the media allow-list. */
  readonly mediaToken: () => MediaTokenShape | undefined;
}

/**
 * An incoming voice message on an untrusted host would make `<audio
 * preload="metadata">` fetch whatever URL a chat peer put in the payload,
 * leaking the viewer's IP just like an image would. Drop the URL: the bubble
 * still shows the waveform and the duration, but nothing is fetched.
 */
function sanitizeIncomingVoice(voice: VoiceMeta, token: MediaTokenShape | undefined): VoiceMeta {
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

function mentionLocalpart(jid: string): string {
  return jidLocal(jid);
}

export function signatureFor(chatId: string, body: string, replyTo: ReplyRef | undefined): string {
  return `${chatId}|${body}|${replyTo?.id ?? ''}`;
}

// Sticker sends share one emoji body per pack ("🐱" for every cat), so the
// echo queue is keyed by sticker id too — otherwise two quick stickers
// with the same emoji can link the wrong server id.
export function stickerSignatureFor(
  chatId: string,
  body: string,
  stickerId: string,
  replyTo: ReplyRef | undefined,
): string {
  return `${signatureFor(chatId, body, replyTo)}|sticker:${stickerId}`;
}

// A reactions message is swallowed only when it is truly body-less and
// payload-less: one that also carries a body or a payload is a normal
// message that happens to update reactions too.
export function isReactionOnly(message: LedgerStanza): boolean {
  return (
    message.reactions !== undefined && message.body === undefined && message.payload === undefined
  );
}

// A XEP-0308 correction or a XEP-0424 retraction is never a chat message:
// it edits another message and never renders as a bubble.
export function isEditStanza(message: LedgerStanza): boolean {
  return message.correction !== undefined || message.retraction !== undefined;
}

export function listFor(state: LedgerState, chatId: string): StoreMessage[] {
  return state.messagesByChat[chatId] ?? [];
}

function authorOfChatMessage(message: LedgerStanza): EditAuthor {
  const author: EditAuthor = { jid: message.fromJid, resolved: message.fromResolved };
  if (message.occupantId !== undefined) author.occupantId = message.occupantId;
  if (message.fromNick !== undefined) author.nick = message.fromNick;
  return author;
}

// The list preview of a deleted message; the message itself carries no
// text, but the chat row says what happened.
export function previewFor(message: StoreMessage): StoreMessage {
  return message.deleted === true ? { ...message, text: 'Message deleted' } : message;
}

export type MessageLedger = ReturnType<typeof createMessageLedger>;

export function createMessageLedger(deps: MessageLedgerDeps) {
  const { get, set } = deps;
  const messageAliases = new Map<string, string>();
  // Local optimistic id -> the server id it resolved to, once known.
  const messageServerIds = new Map<string, string>();
  // Any known message id -> the sender-generated origin id (the stanza's
  // `id` attribute or `<origin-id/>`), used to name an edit's target.
  const messageOriginIds = new Map<string, string>();
  // Any known message id -> the author as the stanza described it, used to
  // authorize a correction or retraction from the original sender only.
  const messageAuthors = new Map<string, EditAuthor>();
  // Any known message id -> the text the message was first seen with. A
  // correction rewrites the stored message; this is what a reverted edit
  // restores.
  const messageBaseTexts = new Map<string, string>();

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
      migrateEditTargets(rootRight, rootLeft);
      migrateIdMap(messageOriginIds, rootRight, rootLeft);
      migrateIdMap(messageAuthors, rootRight, rootLeft);
      migrateIdMap(messageBaseTexts, rootRight, rootLeft);
    }
  }

  // Copies the value stored under `from` (when any) onto `to`, keeping both
  // keys readable; used for the per-message side tables when two ids merge.
  function migrateIdMap<T>(map: Map<string, T>, from: string, to: string): void {
    const value = map.get(from);
    if (value === undefined) {
      return;
    }
    map.set(to, value);
    map.set(from, value);
  }

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

  function sameMessage(left: string, right: string): boolean {
    return aliasRoot(left) === aliasRoot(right);
  }

  // Remembers the server id that a local optimistic id resolved to, so a
  // reaction sent after the echo can name the target everyone else knows.
  function linkLocalToServer(localId: string, serverId: string): void {
    if (localId !== serverId) {
      messageServerIds.set(localId, serverId);
      // Also under the alias root so an action that already canonicalised
      // (e.g. a chip tap before the echo) resolves to the server id.
      messageServerIds.set(aliasRoot(localId), serverId);
    }
  }

  // The same link for a send's ack, which names the sender-generated id. In a
  // group, reactions must name the room's stanza id (XEP-0444), which only the
  // echo carries: when the echo came first and filed it, the later ack keeps
  // it. When the ack comes first, the echo overwrites the ack's id as before.
  // A DM links the ack's id either way, as before.
  function linkAckToServer(chat: ChatSummary, localId: string, serverId: string): void {
    if (
      chat.kind === 'group' &&
      (messageServerIds.has(localId) || messageServerIds.has(aliasRoot(localId)))
    ) {
      return;
    }
    linkLocalToServer(localId, serverId);
  }

  // The id to put on the wire for a message: the server (or archive) id when
  // it is known, else the message id itself. A still-unacked `local-*` id has
  // no server id yet and cannot be named, so it resolves to undefined.
  function wireTargetFor(messageId: string): string | undefined {
    const root = aliasRoot(messageId);
    const server = messageServerIds.get(root);
    if (server !== undefined) {
      return server;
    }
    return root.startsWith('local-') ? undefined : root;
  }

  // Remembers the author as the stanza described it, under both its own id
  // and its alias root, so a later edit can be authorized without the
  // original stanza.
  function rememberAuthor(messageId: string, author: EditAuthor): void {
    messageAuthors.set(messageId, author);
    messageAuthors.set(aliasRoot(messageId), author);
  }

  function rememberOriginId(messageId: string, originId: string): void {
    messageOriginIds.set(messageId, originId);
    messageOriginIds.set(aliasRoot(messageId), originId);
  }

  function rememberBaseText(messageId: string, text: string): void {
    messageBaseTexts.set(messageId, text);
    messageBaseTexts.set(aliasRoot(messageId), text);
  }

  function baseTextFor(messageId: string): string | undefined {
    return messageBaseTexts.get(aliasRoot(messageId)) ?? messageBaseTexts.get(messageId);
  }

  function authorFor(messageId: string): EditAuthor | undefined {
    return messageAuthors.get(aliasRoot(messageId)) ?? messageAuthors.get(messageId);
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

  function editUpdateFor(message: LedgerStanza): EditUpdate | undefined {
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
      // A correction without a body has no new text: ignore it rather than
      // blanking the original.
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
        update.mentions = message.mentions;
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
  function ingestEdit(message: LedgerStanza): void {
    const update = editUpdateFor(message);
    if (update === undefined) {
      return;
    }
    applyEditUpdate(message.chatJid, update);
  }

  function ingestHistoryEdits(messages: readonly LedgerStanza[]): void {
    for (const message of messages) {
      if (isEditStanza(message)) {
        ingestEdit(message);
      }
    }
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
  // its place and identity (a retraction also drops the local upload state);
  // a corrected one shows the new text and mentions.
  function withEdits(message: StoreMessage, chatId: string): StoreMessage {
    const chatEdits = get().edits[chatId];
    const state = chatEdits === undefined ? undefined : editsFor(chatEdits, aliasRoot(message.id));
    if (state === undefined || (!state.edited && !state.deleted)) {
      // A reverted edit restores the text the message was first seen with.
      const base = baseTextFor(message.id);
      const restoreText = message.text !== base;
      if (message.edited === undefined && message.deleted === undefined && !restoreText) {
        return message;
      }
      const plain: StoreMessage = { ...message };
      delete plain.edited;
      delete plain.deleted;
      if (restoreText) {
        if (base === undefined) {
          delete plain.text;
        } else {
          plain.text = base;
        }
      }
      return plain;
    }
    if (state.deleted) {
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
        message.localUri === undefined &&
        message.uploadProgress === undefined
      ) {
        return message;
      }
      const deleted: StoreMessage = { ...message, deleted: true };
      delete deleted.text;
      delete deleted.voice;
      delete deleted.image;
      delete deleted.attachment;
      delete deleted.localUri;
      delete deleted.uploadProgress;
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
      state.mentions === undefined ? undefined : mapMentions(chatId, state.mentions, text ?? '');
    if (
      message.edited === true &&
      message.deleted === undefined &&
      message.text === text &&
      mentionsEqual(message.mentions, mentions)
    ) {
      return message;
    }
    const edited: StoreMessage = { ...message, edited: true };
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

  // A reply quote follows its target: the corrected text, or "Deleted
  // message" once the target was retracted.
  function withReplyQuote(list: readonly StoreMessage[], message: StoreMessage): StoreMessage {
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
    const lastChanged = last !== undefined && lastRefreshed !== undefined && lastRefreshed !== last;
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

  // Puts a message back exactly as it was before an optimistic edit or delete,
  // so a failed send restores the fields a retraction had stripped.
  function restoreMessage(chatId: string, snapshot: StoreMessage): void {
    set((state) => ({
      messagesByChat: {
        ...state.messagesByChat,
        [chatId]: listFor(state, chatId).map((item) =>
          sameMessage(item.id, snapshot.id) ? snapshot : item,
        ),
      },
    }));
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

  // Swaps an optimistic attachment for the uploaded one: the served URL plus
  // any dimensions read from the local file.
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

  // A failed voice or attachment send (T-0168): the bubble leaves
  // `sending` for `failed` with a fixed user-safe reason, keeping its local
  // blob/file so it can be retried. The `failed` flag mirrors the status
  // for readers that only check it. A failure never moves a message that
  // already settled (`sent`/`read`/`failed`): a late hang racing a success
  // must not downgrade it.
  function markSendFailed(chatId: string, messageId: string, reason: SendFailureReason): void {
    set((state) => {
      const fail = (item: StoreMessage): StoreMessage =>
        item.status === 'sending' && sameMessage(item.id, messageId)
          ? { ...item, status: 'failed' as const, failed: true, failureReason: reason }
          : item;
      const next = listFor(state, chatId).map(fail);
      const last = state.chats.find((chat) => chat.id === chatId)?.lastMessage;
      const lastMatches =
        last !== undefined && last.status === 'sending' && sameMessage(last.id, messageId);
      return {
        messagesByChat: { ...state.messagesByChat, [chatId]: next },
        chats: lastMatches
          ? state.chats.map((chat) =>
              chat.id === chatId && chat.lastMessage !== undefined
                ? {
                    ...chat,
                    lastMessage: {
                      ...chat.lastMessage,
                      status: 'failed' as const,
                      failed: true,
                      failureReason: reason,
                    },
                  }
                : chat,
            )
          : state.chats,
      };
    });
  }

  // Clears a bubble's send-failure state (status back to `sending`-ladder
  // shape, flags dropped) without touching its content: used when a server
  // echo proves the stanza was delivered after all. Only `failed` bubbles
  // move; anything else is left alone.
  function clearSendFailure(chatId: string, messageId: string): void {
    set((state) => {
      const clear = (item: StoreMessage): StoreMessage =>
        item.status === 'failed' && sameMessage(item.id, messageId)
          ? { ...clearFailure(item), status: 'sent' as const }
          : item;
      const next = listFor(state, chatId).map(clear);
      const last = state.chats.find((chat) => chat.id === chatId)?.lastMessage;
      const lastMatches =
        last !== undefined && last.status === 'failed' && sameMessage(last.id, messageId);
      return {
        messagesByChat: { ...state.messagesByChat, [chatId]: next },
        chats: lastMatches
          ? state.chats.map((chat) =>
              chat.id === chatId && chat.lastMessage !== undefined
                ? {
                    ...chat,
                    lastMessage: { ...clearFailure(chat.lastMessage), status: 'sent' as const },
                  }
                : chat,
            )
          : state.chats,
      };
    });
  }

  // Moves a failed bubble back to `sending` for an explicit retry (T-0168).
  // Only `failed` messages move: this is the one path that may leave that
  // status, so `advanceStatus` can stay closed to it.
  function markSendRetrying(chatId: string, messageId: string): void {
    set((state) => {
      const retry = (item: StoreMessage): StoreMessage =>
        item.status === 'failed' && sameMessage(item.id, messageId)
          ? { ...clearFailure(item), status: 'sending' as const }
          : item;
      const next = listFor(state, chatId).map(retry);
      const last = state.chats.find((chat) => chat.id === chatId)?.lastMessage;
      const lastMatches =
        last !== undefined && last.status === 'failed' && sameMessage(last.id, messageId);
      return {
        messagesByChat: { ...state.messagesByChat, [chatId]: next },
        chats: lastMatches
          ? state.chats.map((chat) =>
              chat.id === chatId && chat.lastMessage !== undefined
                ? {
                    ...chat,
                    lastMessage: {
                      ...clearFailure(chat.lastMessage),
                      status: 'sending' as const,
                    },
                  }
                : chat,
            )
          : state.chats,
      };
    });
  }

  // Removes a failed local bubble (T-0168): the send never reached the
  // server, so there is nothing to retract — only a local message still in
  // `failed` status may go. The store drops its kept bytes first.
  function removeFailedMessage(chatId: string, messageId: string): void {
    set((state) => {
      const next = listFor(state, chatId).filter(
        (item) => !(item.status === 'failed' && sameMessage(item.id, messageId)),
      );
      if (next.length === listFor(state, chatId).length) {
        return state;
      }
      const last = state.chats.find((chat) => chat.id === chatId)?.lastMessage;
      const lastMatches =
        last !== undefined && last.status === 'failed' && sameMessage(last.id, messageId);
      return {
        messagesByChat: { ...state.messagesByChat, [chatId]: sortMessages(next) },
        chats: lastMatches
          ? state.chats.map((chat) => {
              if (chat.id !== chatId) {
                return chat;
              }
              const latest = [...next].reverse().find((item) => item.chatId === chatId);
              if (latest === undefined) {
                const { lastMessage: _dropped, ...rest } = chat;
                return rest;
              }
              return { ...chat, lastMessage: latest };
            })
          : state.chats,
      };
    });
  }

  // A failed sticker keeps the message and shows a Retry instead of a
  // silent "sending" state, like attachments do.
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

  // A failed upload keeps the message and its local bytes, but shows a Retry
  // instead of a silent "sending" state.
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
    const localpart = userLocalpartOf(fromJid);
    if (localpart === undefined) {
      return undefined;
    }
    const name = deps.memberName(chatId, localpart);
    return name !== undefined && name !== '' ? name : undefined;
  }

  function occupantNameFor(chatId: string, fromJid: string): string | undefined {
    const nick = deps.occupantNick(chatId, fromJid);
    return nick !== undefined && nick !== '' ? nick : undefined;
  }

  // Resolves a display name without ever falling back to a JID localpart.
  // Order: me, contact, MUC nick, group member, room occupant, DM title,
  // then "Someone".
  function senderNameFor(message: LedgerStanza): string {
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
        const withoutReactions: StoreMessage = { ...message };
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
  function ingestReaction(message: LedgerStanza): void {
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

  function ingestHistoryReactions(messages: readonly LedgerStanza[]): void {
    for (const message of messages) {
      ingestReaction(message);
    }
  }

  // Maps the usable mentions of a message to names: the known group member,
  // else the text the range covers, else the JID's localpart.
  function mapMentions(
    chatId: string,
    mentions: readonly { jid: string; begin?: number; end?: number }[],
    body: string,
  ): UiMention[] {
    const mapped: UiMention[] = [];
    for (const mention of mentions) {
      const { begin, end } = mention;
      if (begin === undefined || end === undefined) continue;
      if (begin < 0 || begin >= end || end > body.length) continue;
      const textAtRange = body.slice(begin, end);
      const name =
        groupMemberNameFor(chatId, mention.jid) ??
        (textAtRange !== '' ? textAtRange : mentionLocalpart(mention.jid));
      mapped.push({ jid: mention.jid, name, begin, end });
    }
    return mapped;
  }

  function mentionsFor(message: LedgerStanza): UiMention[] {
    const body = message.body;
    if (body === undefined || message.mentions === undefined) {
      return [];
    }
    return mapMentions(message.chatJid, message.mentions, body);
  }

  function toUiMessage(message: LedgerStanza, meId: string): StoreMessage {
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
    if (message.body !== undefined) {
      rememberBaseText(message.id, message.body);
    }
    const ui: StoreMessage = {
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
    if (message.forward !== undefined) {
      ui.forward = message.forward;
    }
    const mentions = mentionsFor(message);
    if (mentions.length > 0) {
      ui.mentions = mentions;
    }
    const mediaToken = deps.mediaToken();
    if (message.payload !== undefined && message.payload.type === 'voice') {
      ui.voice = sanitizeIncomingVoice(message.payload.data, mediaToken);
    }
    if (message.payload !== undefined && message.payload.type === 'attachment') {
      ui.attachment = sanitizeIncomingAttachment(message.payload.data, mediaToken);
    }
    if (message.payload !== undefined && message.payload.type === 'sticker') {
      // The same-origin check happens at render time (`StickerMessage`);
      // the payload is kept as-is so the bubble can show a placeholder.
      ui.card = message.payload;
    }
    const reactions = reactionChips(get().reactions[message.chatJid], message.chatJid, message.id);
    if (reactions !== undefined) {
      ui.reactions = reactions;
    }
    return ui;
  }

  function setChatMessage(chatId: string, message: StoreMessage, clearUnread: boolean): void {
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

  return {
    /** Read by the store's sign-out, which clears them. */
    messageAuthors,
    messageOriginIds,
    messageBaseTexts,
    listFor,
    sameMessage,
    ingestHistoryReactions,
    ingestHistoryEdits,
    isReactionOnly,
    isEditStanza,
    toUiMessage,
    resolvePendingEdits,
    withEdits,
    refreshEdits,
    previewFor,
    myJid,
    aliasRoot,
    linkMessageIds,
    linkLocalToServer,
    linkAckToServer,
    rememberOriginId,
    rememberAuthor,
    rememberBaseText,
    authorFor,
    correctionTargetFor,
    signatureFor,
    stickerSignatureFor,
    setChatMessage,
    updateMessageStatus,
    updateMessageVoice,
    updateMessageAttachment,
    markSendFailed,
    markSendRetrying,
    markStickerFailed,
    markAttachmentFailed,
    removeFailedMessage,
    clearSendFailure,
    isOwnSender,
    senderNameFor,
    ingestEdit,
    ingestReaction,
    applyReactionUpdate,
    wireTargetFor,
    retractionTargetFor,
    restoreMessage,
    restoreEdits,
  };
}

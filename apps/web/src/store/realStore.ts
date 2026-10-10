import type {
  Attachment,
  ChatSummary,
  EditAuthor,
  EditsState,
  EditUpdate,
  MentionMember,
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
  mentionsEqual,
  mergeEdits,
  mergeTargets,
  reactionChips as sharedReactionChips,
  reactionsEqual,
  resolveEdits,
  sanitizeIncomingAttachment,
  sortFolders,
  userLocalpartOf as sharedUserLocalpartOf,
} from '@zilar/chat-core';
import { jidLocal } from '@zilar/protocol';
import { type ChatMessage, type XmppCore } from '@zilar/xmpp-core';
import {
  advanceStatus,
  clearFailure,
  moveChatToTop,
  sortByRecency,
  sortMessages,
  summariesFor,
} from './effects/chatRows';
import {
  loadOlder as loadOlderInStore,
  openAtMessage as openAtMessageEffect,
  openChat as openChatInStore,
  openHistory as openHistoryEffect,
  scheduleChatsRefresh,
} from './effects/history';
import {
  loadChatMedia,
  pinMessage,
  refreshPinsFor as refreshPinsForEffect,
  setPushPair,
  unpinMessage,
} from './effects/pins';
import type { SendRun, StoreCtx } from './effects/ctx';
import { loadGroupMembersInBackground } from './effects/groupMembers';
import { deleteForEveryone, editMessage, react, sendTyping } from './effects/messageActions';
import {
  refreshChatPrefs,
  refreshDefaultBackground,
  setArchived,
  setChatBackground,
  setChatBackgroundImage,
  setDefaultBackground,
  setDefaultBackgroundImage,
  setMuted,
  setPinned,
} from './effects/prefs';
import {
  addGroupAi,
  addTopicAi,
  addTopicMember,
  changeChannelRole,
  createChannel as createChannelEffect,
  createGroup as createGroupEffect,
  createInvite as createInviteEffect,
  createTopic,
  joinPublicGroup,
  leaveChannel,
  leaveTopic,
  patchTopic,
  refreshGeneralTopic,
  refreshTopicRow,
  removeGroupAi,
  removeTopicAi,
  removeTopicMember,
  setGroupBackground,
  setGroupListener,
  setGroupVisibility,
  setMembersCanCreateTopics,
  setTopicRoles,
} from './effects/groups';
import {
  deleteFailedMessage,
  forwardMessages,
  retryAttachment,
  retrySticker,
  retryVoice,
  sendAttachment,
  sendSticker,
  sendText,
  sendVoice,
} from './effects/send';
import { retryBoot, signOutStore, startStore, stopStore } from './effects/lifecycle';
import { portsLayer, readPorts, type RealStoreDeps } from './effects/ports';
import { makeLifetime } from './effects/runtime';
import { createAtomStore, type StoreApi } from './atomStore';
import { type ChatEntry, type GroupDetail, type Me } from '@/lib/api';
import { isTrustedMediaUrl, trustedMediaHosts, type MediaTokenShape } from '@/lib/attachments';
import type { ChatStoreState } from './store';

export { CONNECT_RETRY_DELAYS_MS, TOPIC_REFRESH_INTERVAL_MS } from './effects/constants';
export { mergeWithPainted, summariesFor } from './effects/chatRows';

export { SEND_TIMEOUT_MS } from './effects/constants';
export { sendFailureReasonFor } from './effects/sendFailure';
export { DRAFT_END_FALLBACK_MS, DRAFT_IDLE_MS } from './effects/constants';

export type { ApiClient, RealStoreDeps, StorageLike } from './effects/ports';

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

export function createRealChatStore(deps: RealStoreDeps = {}): StoreApi<ChatStoreState> {
  const ports = readPorts(portsLayer(deps));
  const { api } = ports;
  const rt = makeLifetime(ports);

  return createAtomStore<ChatStoreState>((set, get) => {
    let core: XmppCore | undefined;
    let lastRead: Record<string, string> = {};
    let lastReadUserId: string | undefined;
    // Group history (MUC MAM) only works once the room is joined, which
    // happens after the connection is online.
    let groupsJoined = false;
    // Turn ids whose draft is done, so a late `draft` is ignored.
    const finishedTurns = new Set<string>();
    const finishedTurnOrder: string[] = [];

    // The XMPP token the latest session connected with, kept for the media
    // allow-list (T-0065 round 1): images are only auto-loaded from hosts the
    // server names, so a chat peer cannot make every viewer fetch a tracker.
    let mediaToken: MediaTokenShape | undefined;
    // Open chat ids whose next disappearance moves silently (T-0130 review):
    // the client just archived that topic itself from its own header, so
    // the removed-while-open flow navigates without the "no longer
    // available" notice. Consumed on first use.
    const quietArchiveIds = new Set<string>();
    const cursors: Record<string, string | undefined> = {};
    const pendingOutgoing = new Map<string, string[]>();
    // An outgoing attachment's bytes, kept for a Retry after a failed upload.
    const pendingAttachments = new Map<string, File>();
    // An outgoing voice recording's bytes, kept for a Retry after a failed
    // send (T-0168); dropped once the stanza send succeeds, like attachments.
    const pendingVoices = new Map<string, { blob: Blob; waveform: number[] }>();
    // The current send attempt of a message, keyed by its alias root (T-0168).
    // The run lets a retry's deadline and a previous run's late pipeline agree
    // on which outcome counts.
    const sendRuns = new Map<string, SendRun>();
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

    function signatureFor(chatId: string, body: string, replyTo: ReplyRef | undefined): string {
      return `${chatId}|${body}|${replyTo?.id ?? ''}`;
    }

    // Sticker sends share one emoji body per pack ("🐱" for every cat), so the
    // echo queue is keyed by sticker id too — otherwise two quick stickers
    // with the same emoji can link the wrong server id.
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
      }
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

    // A reactions message is swallowed only when it is truly body-less and
    // payload-less: one that also carries a body or a payload is a normal
    // message that happens to update reactions too.
    function isReactionOnly(message: ChatMessage): boolean {
      return (
        message.reactions !== undefined &&
        message.body === undefined &&
        message.payload === undefined
      );
    }

    // A XEP-0308 correction or a XEP-0424 retraction is never a chat message:
    // it edits another message and never renders as a bubble.
    function isEditStanza(message: ChatMessage): boolean {
      return message.correction !== undefined || message.retraction !== undefined;
    }

    function authorOfChatMessage(message: ChatMessage): EditAuthor {
      const author: EditAuthor = { jid: message.fromJid, resolved: message.fromResolved };
      if (message.occupantId !== undefined) author.occupantId = message.occupantId;
      if (message.fromNick !== undefined) author.nick = message.fromNick;
      return author;
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
        // A reverted edit restores the text the message was first seen with.
        const base = baseTextFor(message.id);
        const restoreText = message.text !== base;
        if (message.edited === undefined && message.deleted === undefined && !restoreText) {
          return message;
        }
        const plain: UiMessage = { ...message };
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
          message.failureReason === undefined
        ) {
          return message;
        }
        const deleted: UiMessage = { ...message, deleted: true };
        delete deleted.text;
        delete deleted.voice;
        delete deleted.image;
        delete deleted.attachment;
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
        const fail = (item: UiMessage): UiMessage =>
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
        const clear = (item: UiMessage): UiMessage =>
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
        const retry = (item: UiMessage): UiMessage =>
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
    // `failed` status may go. Its kept bytes go with it.
    function removeFailedMessage(chatId: string, messageId: string): void {
      pendingAttachments.delete(aliasRoot(messageId));
      pendingAttachments.delete(messageId);
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

    function rememberGroupIds(entries: ChatEntry[]): void {
      for (const entry of entries) {
        if (entry.kind === 'group') {
          for (const row of summariesFor(entry)) {
            groupIds.set(row.id, entry.groupId);
          }
        }
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

    function mentionsFor(message: ChatMessage): UiMention[] {
      const body = message.body;
      if (body === undefined || message.mentions === undefined) {
        return [];
      }
      return mapMentions(message.chatJid, message.mentions, body);
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
      if (message.body !== undefined) {
        rememberBaseText(message.id, message.body);
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

    function nick(me: Me): string {
      const name = me.name.trim();
      if (name.length > 0) {
        return name;
      }
      return me.jid?.split('@')[0] ?? 'me';
    }

    // What the Effect modules share. The accessors read and write the
    // closure variables the helpers above still use.
    const ctx: StoreCtx = {
      get,
      set,
      ports,
      rt,
      k: {
        rememberGroupIds,
        nick,
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
      },
      get core() {
        return core;
      },
      set core(value) {
        core = value;
      },
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
      get lastRead() {
        return lastRead;
      },
      set lastRead(value) {
        lastRead = value;
      },
      get lastReadUserId() {
        return lastReadUserId;
      },
      set lastReadUserId(value) {
        lastReadUserId = value;
      },
      cachedUserId: undefined,
      connectRetryAttempt: 0,
      connectRetryPending: false,
      groupIds,
      loadingGroupMembers,
      groupMembers,
      groupInfos,
      messageAuthors,
      messageOriginIds,
      messageBaseTexts,
      finishedTurns,
      finishedTurnOrder,
      cursors,
      loadingHistory,
      loadingOlder,
      quietArchiveIds,
      sequence: 0,
      pendingOutgoing,
      pendingAttachments,
      pendingVoices,
      sendRuns,
    };

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
      chatPrefs: {},
      defaultBackground: null,
      messagesByChat: {},
      reactions: {},
      pinsByChat: {},
      pinsReady: {},
      pinsError: undefined,
      dismissPinsError: () => set({ pinsError: undefined }),
      activeChatId: undefined,
      historyComplete: {},
      groupInfos: {},
      edits: {},
      editTarget: undefined,
      actionError: undefined,
      mediaTrustedHosts: undefined,
      search: '',
      searchChat: undefined,
      activeFolder: 'all',
      folders: [],
      typing: {},
      drafts: {},
      finishedDraftMessages: {},
      messages: (chatId) => get().messagesByChat[chatId] ?? [],
      groupMembers: (chatId) => [...(groupMembers.get(chatId)?.values() ?? [])],
      groupInfo: (chatId) => get().groupInfos[chatId],
      refreshGroupInfo: (chatId) => {
        loadGroupMembersInBackground(ctx, chatId, true);
      },
      listMyAis: () => api.listAis(),
      topicNotice: undefined,
      dismissTopicNotice: () => set({ topicNotice: undefined }),
      refreshChats: () => {
        scheduleChatsRefresh(ctx);
      },
      // T-0130 (review): resolves General from the painted list, refreshing
      // it first. `refreshChats` only schedules the 500 ms debounce, so this
      // runs the real refresh and waits for it, never the schedule.
      refreshGeneralTopic: (groupId) => rt.runPromise(refreshGeneralTopic(ctx, groupId)),
      createTopic: (chatId, input) => rt.runPromise(createTopic(ctx, chatId, input)),
      patchTopic: (chatId, input) => rt.runPromise(patchTopic(ctx, chatId, input)),
      addTopicAi: (chatId, aiId) => rt.runPromise(addTopicAi(ctx, chatId, aiId)),
      removeTopicAi: (chatId, aiId) => rt.runPromise(removeTopicAi(ctx, chatId, aiId)),
      addTopicMember: (chatId, userId) => rt.runPromise(addTopicMember(ctx, chatId, userId)),
      removeTopicMember: (chatId, userId) => rt.runPromise(removeTopicMember(ctx, chatId, userId)),
      setTopicRoles: (chatId, input) => rt.runPromise(setTopicRoles(ctx, chatId, input)),
      // T-0130 (review): re-reads the chat list and reports whether the
      // topic row is still there, so a member-removal 404 can be told
      // apart from a gone topic (last member removed → archived). A
      // failed refresh throws (instead of reading a stale list as
      // "alive"), so the panel shows the inline removal error.
      refreshTopicRow: (chatId, topicId) => rt.runPromise(refreshTopicRow(ctx, chatId, topicId)),
      leaveTopic: (chatId) => rt.runPromise(leaveTopic(ctx, chatId)),
      // T-0124: channels share the create/list/refresh flow with groups (the
      // detail carries `kind`, the chat list paints the feed row).
      // T-0164: `visibility: 'public'` + `handle` creates the channel with
      // its directory entry in one transaction.
      createChannel: (title, memberIds, description, options) =>
        rt.runPromise(createChannelEffect(ctx, title, memberIds, description, options)),
      // T-0124: leaving a channel removes the caller's membership through
      // the member route (the same route admins use to remove others). The
      // list refreshes itself away; the caller navigates away.
      leaveChannel: (chatId) => rt.runPromise(leaveChannel(ctx, chatId)),
      // T-0124: promote/demote through the role route (owner only). The
      // detail refreshes, so the panel updates at once; the chat list
      // refreshes too, so the acting device's rows (myRole, counts) match
      // server truth and the composer bar flips. The target's own device
      // converges on the next list refresh (60s poll / focus), like every
      // other membership change in the app.
      changeChannelRole: (chatId, userId, role) =>
        rt.runPromise(changeChannelRole(ctx, chatId, userId, role)),
      setMembersCanCreateTopics: (chatId, allowed) =>
        rt.runPromise(setMembersCanCreateTopics(ctx, chatId, allowed)),
      // T-0466: owners/admins set the group's shared background; the detail
      // refresh repaints every chat of the group at once.
      setGroupBackground: (chatId, background) =>
        rt.runPromise(setGroupBackground(ctx, chatId, background)),
      // T-0478: owners/admins turn the group's AI listener on/off or set its
      // eagerness; the detail refresh repaints the panel.
      setGroupListener: (chatId, input) => rt.runPromise(setGroupListener(ctx, chatId, input)),
      // T-0164: the owner flips a group public (with a handle) or back to
      // private. The detail refreshes from server truth (like the role
      // change), so the panel, the label and the share link update at once.
      setGroupVisibility: (chatId, input) => rt.runPromise(setGroupVisibility(ctx, chatId, input)),
      // T-0164: joins a public group with one request, then opens it: the
      // list refreshes (the new membership arrives) and the General chat id
      // resolves from the painted rows, falling back to undefined when the
      // list has not caught up yet (the caller navigates home instead).
      joinPublicGroup: (groupId) => rt.runPromise(joinPublicGroup(ctx, groupId)),
      addGroupAi: (chatId, aiId) => rt.runPromise(addGroupAi(ctx, chatId, aiId)),
      removeGroupAi: (chatId, aiId) => rt.runPromise(removeGroupAi(ctx, chatId, aiId)),
      hasMore: (chatId) => get().historyComplete[chatId] !== true && cursors[chatId] !== undefined,
      openChat: (chatId) => {
        openChatInStore(ctx, chatId);
      },
      retryChats: () => {
        rt.runDetached(retryBoot(ctx));
      },
      retryHistory: (chatId) => {
        rt.fork(openHistoryEffect(ctx, chatId));
      },
      loadOlder: (chatId) => {
        loadOlderInStore(ctx, chatId);
      },
      pins: (chatId) => get().pinsByChat[chatId] ?? [],
      pinsLoaded: (chatId) => get().pinsReady[chatId] === true,
      loadPins: (chatId) => rt.runPromise(refreshPinsForEffect(ctx, chatId)),
      loadChatMedia: (chatId, tab, before) =>
        rt.runPromise(loadChatMedia(ctx, chatId, tab, before)),
      canPin: (chatId) => {
        const state = get();
        const chat = state.chats.find((entry) => entry.id === chatId);
        if (chat === undefined) {
          return false;
        }
        // Either side of a DM may pin.
        if (chat.kind === 'dm') {
          return true;
        }
        // A topic manager: a group owner/admin (roles ride the group
        // detail loaded on open), or the topic creator. The creator edge
        // without a manager role is enforced by the server; the menu hides
        // until the detail loads rather than guessing.
        const role = state.groupInfos[chatId]?.members.find(
          (member) => member.userId === state.currentUserId,
        )?.role;
        return role === 'owner' || role === 'admin';
      },
      pinFor: (chatId, messageId) =>
        (get().pinsByChat[chatId] ?? []).find((pin) => pin.messageId === messageId),
      pinMessage: (chatId, messageId) => rt.runPromise(pinMessage(ctx, chatId, messageId)),
      unpinMessage: (chatId, pinId) => rt.runPromise(unpinMessage(ctx, chatId, pinId)),
      pinsPanel: undefined,
      setPinsPanel: (chatId) => set({ pinsPanel: chatId === undefined ? undefined : { chatId } }),
      openAtMessage: (chatId, messageId) =>
        rt.runPromise(openAtMessageEffect(ctx, chatId, messageId)),
      react: (chatId, messageId, emoji) => {
        react(ctx, chatId, messageId, emoji);
      },
      startEdit: (chatId, messageId) => {
        set({ editTarget: { chatId, messageId }, actionError: undefined });
      },
      cancelEdit: () => {
        set({ editTarget: undefined });
      },
      editMessage: (chatId, messageId, text) => {
        editMessage(ctx, chatId, messageId, text);
      },
      deleteForEveryone: (chatId, messageId) => {
        deleteForEveryone(ctx, chatId, messageId);
      },
      sendTyping: (chatId) => {
        sendTyping(ctx, chatId);
      },
      setPushPair: (input) => rt.runPromise(setPushPair(ctx, input)),
      sendText: (chatId, text, options) => {
        sendText(ctx, chatId, text, options);
      },
      sendVoice: (chatId, recording, options) => {
        sendVoice(ctx, chatId, recording, options);
      },
      retryVoice: (chatId, messageId) => {
        retryVoice(ctx, chatId, messageId);
      },
      deleteFailedMessage: (chatId, messageId) => {
        deleteFailedMessage(ctx, chatId, messageId);
      },
      sendAttachment: (chatId, file, options) => {
        sendAttachment(ctx, chatId, file, options);
      },
      sendSticker: (chatId, sticker, options) => {
        sendSticker(ctx, chatId, sticker, options);
      },
      forwardMessages: (targets, messages, options) => {
        forwardMessages(ctx, targets, messages, options);
      },
      retrySticker: (chatId, messageId) => {
        retrySticker(ctx, chatId, messageId);
      },
      retryAttachment: (chatId, messageId) => {
        retryAttachment(ctx, chatId, messageId);
      },
      createGroup: (title, memberIds, options) =>
        rt.runPromise(createGroupEffect(ctx, title, memberIds, options)),
      createInvite: () => rt.runPromise(createInviteEffect()),
      signOut: () => rt.runPromise(signOutStore(ctx)),
      start: () => {
        rt.runDetached(startStore(ctx));
      },
      stop: () => {
        rt.runDetached(stopStore(ctx));
      },
      setSearch: (value) => set({ search: value }),
      setSearchChat: (chatId) => set({ searchChat: chatId }),
      setActiveFolder: (folder) => set({ activeFolder: folder }),
      setFolders: (folders) => {
        const sorted = sortFolders(folders);
        set((state) => ({
          folders: sorted,
          activeFolder:
            state.activeFolder === 'all' ||
            sorted.some((folder) => folder.id === state.activeFolder)
              ? state.activeFolder
              : 'all',
        }));
      },
      refreshChatPrefs: () => rt.runPromise(refreshChatPrefs(ctx)),
      refreshDefaultBackground: () => rt.runPromise(refreshDefaultBackground(ctx)),
      setPinned: (chatId, pinned) => rt.runPromise(setPinned(ctx, chatId, pinned)),
      setMuted: (chatId, duration) => rt.runPromise(setMuted(ctx, chatId, duration)),
      setArchived: (chatId, archived) => rt.runPromise(setArchived(ctx, chatId, archived)),
      setChatBackground: (chatId, presetId) =>
        rt.runPromise(setChatBackground(ctx, chatId, presetId)),
      setDefaultBackground: (presetId) => rt.runPromise(setDefaultBackground(ctx, presetId)),
      setChatBackgroundImage: (chatId, imageId, dim) =>
        rt.runPromise(setChatBackgroundImage(ctx, chatId, imageId, dim)),
      setDefaultBackgroundImage: (imageId, dim) =>
        rt.runPromise(setDefaultBackgroundImage(ctx, imageId, dim)),
      archivedChats: () =>
        sortByRecency(
          get().chats.filter((chat) => chat.archived === true && chat.topic === undefined),
        ),
    };
  });
}

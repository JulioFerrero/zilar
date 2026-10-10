// Turns a received stanza into a stored bubble: the media sanitising, the
// mention mapping, the display name, the preview/reply quote, the reaction
// chips, and appending the message to its chat and the chat list. Moved
// unchanged from `store/ledger.ts` (size split).
import type { MediaTokenShape, UiMention, VoiceMeta } from '@zilar/chat-core';
import { isTrustedMediaUrl, sanitizeIncomingAttachment, trustedMediaHosts } from '@zilar/chat-core';
import { moveChatToTop, sortMessages } from './rows';
import type { LedgerIds } from './ledger-ids';
import type { LedgerIdentity } from './ledger-identity';
import type { LedgerReactions } from './ledger-reactions';
import { authorOfChatMessage, listFor, mentionLocalpart } from './ledger-signatures';
import type {
  LedgerSet,
  LedgerState,
  LedgerStanza,
  MessageLedgerDeps,
  StoreMessage,
} from './ledger-types';

interface LedgerIncomingDeps {
  readonly get: () => LedgerState;
  readonly set: LedgerSet;
  readonly deps: MessageLedgerDeps;
  readonly ids: LedgerIds;
  readonly identity: LedgerIdentity;
  readonly reactions: LedgerReactions;
}

export function createLedgerIncoming(ledger: LedgerIncomingDeps) {
  const { get, set, deps } = ledger;
  const { linkMessageIds, rememberAuthor, rememberOriginId, rememberBaseText } = ledger.ids;
  const { senderNameFor, groupMemberNameFor } = ledger.identity;
  const { reactionChips } = ledger.reactions;

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

  return { mapMentions, toUiMessage, setChatMessage };
}

export type LedgerIncoming = ReturnType<typeof createLedgerIncoming>;

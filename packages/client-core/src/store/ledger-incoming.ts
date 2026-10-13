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
  const { rememberAuthor, rememberOriginId, rememberBaseText, sameMessage } = ledger.ids;
  const { myJid, senderNameFor, groupMemberNameFor } = ledger.identity;
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

  function mentionsFor(message: LedgerStanza, body: string | undefined): UiMention[] {
    const mentions = message.mentions;
    if (body === undefined || mentions === undefined) {
      return [];
    }
    // The decoded body already has the reply fallback stripped and the
    // mention offsets moved past it, so they map as-is.
    return mapMentions(message.chatJid, mentions, body);
  }

  // A name for a reply's wire `to` JID when its target is not loaded, from the
  // same sources `senderNameFor` reads for a sender (`ledger-identity.ts:45`):
  // me, a contact, or a group member.
  function nameForReplyTo(chatId: string, jid: string): string | undefined {
    const me = myJid();
    if (me !== undefined && jid === me) {
      return 'You';
    }
    const contact = get().contacts.find((entry) => entry.jid === jid);
    if (contact !== undefined) {
      return contact.name;
    }
    return groupMemberNameFor(chatId, jid);
  }

  // The sender name and excerpt a reply quote resolves to, from the loaded
  // messages of the chat or from the page being mapped: history maps a whole
  // page before inserting it, so a target on the same page is not in the store
  // yet (T-1333).
  function replyReferenceFor(
    chatId: string,
    replyTo: { readonly id: string },
    page: readonly LedgerStanza[] | undefined,
  ): { senderName: string; text?: string } | undefined {
    const stored = get().messagesByChat[chatId]?.find((item) => sameMessage(item.id, replyTo.id));
    if (stored !== undefined) {
      return {
        senderName: stored.senderName,
        ...(stored.text === undefined ? {} : { text: stored.text }),
      };
    }
    const stanza = page?.find((item) => sameMessage(item.id, replyTo.id));
    if (stanza === undefined) {
      return undefined;
    }
    return {
      senderName: senderNameFor(stanza),
      ...(stanza.body === undefined ? {} : { text: stanza.body }),
    };
  }

  function toUiMessage(
    message: LedgerStanza,
    meId: string,
    page?: readonly LedgerStanza[],
  ): StoreMessage {
    const senderId = message.outgoing ? meId : message.fromJid;
    // The stanza id and the sender-generated id name the same message: record
    // the origin id under the chat and sender so a correction (which always
    // names the origin id) resolves even when the message is stored under its
    // archive stanza-id, and so a second archived row of the same resend
    // aliases to the first copy (`rememberOriginId`).
    rememberAuthor(message.id, authorOfChatMessage(message));
    if (message.originId !== undefined) {
      rememberOriginId(message.id, message.originId, message.chatJid, senderId);
    }
    // The decoded body already has the XEP-0461 fallback quote stripped;
    // the reply bar renders the quote from `replyTo`.
    const body = message.body;
    if (body !== undefined) {
      rememberBaseText(message.id, body);
    }
    const ui: StoreMessage = {
      id: message.id,
      chatId: message.chatJid,
      senderId,
      senderName: senderNameFor(message),
      createdAt: message.timestamp,
      status: message.outgoing ? 'sent' : 'read',
    };
    if (body !== undefined) {
      ui.text = body;
    }
    if (message.album !== undefined) {
      ui.album = message.album;
    }
    const replyTo = message.replyTo;
    if (replyTo !== undefined) {
      // Alias-aware: a reply names the message by the id both sides share (the
      // origin id in a DM, the room stanza-id in a group), which may differ
      // from the id it is stored under here. The page is checked too, because
      // history maps a whole page before inserting it. With no match, the
      // fallback quote parsed off the wire is used (UI-6).
      const reference = replyReferenceFor(message.chatJid, replyTo, page);
      // With no loaded target, the wire `to` JID still names the sender (the
      // same lookup `senderNameFor` uses) and gives the quote a sender id to
      // colour by (T-1333).
      const senderName =
        reference?.senderName ??
        (replyTo.to === undefined ? undefined : nameForReplyTo(message.chatJid, replyTo.to));
      const text = reference?.text ?? replyTo.text;
      ui.replyTo = {
        id: replyTo.id,
        senderName: senderName ?? '',
        ...(replyTo.to === undefined ? {} : { senderId: replyTo.to }),
        ...(text === undefined ? {} : { text }),
      };
    }
    if (message.forward !== undefined) {
      ui.forward = message.forward;
    }
    const mentions = mentionsFor(message, body);
    if (mentions.length > 0) {
      ui.mentions = mentions;
    }
    const mediaToken = deps.mediaToken();
    if (message.payload !== undefined) {
      if (message.payload.type === 'voice') {
        ui.voice = sanitizeIncomingVoice(message.payload.data, mediaToken);
      } else if (message.payload.type === 'attachment') {
        ui.attachment = sanitizeIncomingAttachment(message.payload.data, mediaToken);
      } else {
        // Every other payload is a card the bubble renders from `message.card`:
        // progress, approval request, sticker and the rest. This mirrors the
        // optimistic send and forward mapping (`forwardedUiFieldsFor`), so a
        // received card and its own echo land on the same fields. A sticker is
        // kept as-is; its same-origin check happens at render time.
        ui.card = message.payload;
      }
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

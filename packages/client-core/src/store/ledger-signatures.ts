// Pure helpers over a ledger stanza or message: the echo signature a send is
// queued under, whether a stanza is a reaction-only message or an edit, the
// stored list for a chat, the author a stanza describes and the list preview of
// a deleted message. Moved unchanged from `store/ledger.ts` (size split).
import type { EditAuthor, ReplyRef } from '@zilar/chat-core';
import { jidLocal } from '@zilar/protocol';
import type { LedgerStanza, LedgerState, StoreMessage } from './ledger-types';

export function mentionLocalpart(jid: string): string {
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

export function authorOfChatMessage(message: LedgerStanza): EditAuthor {
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

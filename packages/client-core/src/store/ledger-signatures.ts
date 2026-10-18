import type { EditAuthor, ReplyRef } from '@zilar/chat-core';
import { jidLocal } from '@zilar/protocol';
import type { LedgerStanza, LedgerState, StoreMessage } from './ledger-types';

export function mentionLocalpart(jid: string): string {
  return jidLocal(jid);
}

// The echo signature is over the logical text: the sender queues the typed text and the
// echo arrives with the fallback quote stripped, so the two agree.
export function signatureFor(chatId: string, body: string, replyTo: ReplyRef | undefined): string {
  return `${chatId}|${body}|${replyTo?.id ?? ''}`;
}

// Sticker sends share one emoji body per pack, so the echo queue is keyed by sticker id
// too; otherwise two quick stickers can link the wrong server id.
export function stickerSignatureFor(
  chatId: string,
  body: string,
  stickerId: string,
  replyTo: ReplyRef | undefined,
): string {
  return `${signatureFor(chatId, body, replyTo)}|sticker:${stickerId}`;
}

// A reactions message is swallowed only when it is truly body-less and payload-less.
export function isReactionOnly(message: LedgerStanza): boolean {
  return (
    message.reactions !== undefined && message.body === undefined && message.payload === undefined
  );
}

// A XEP-0308 correction or XEP-0424 retraction is never a chat message: it edits another
// and never renders.
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

// The list preview of a deleted message: the message carries no text, but the chat row
// says what happened.
export function previewFor(message: StoreMessage): StoreMessage {
  return message.deleted === true ? { ...message, text: 'Message deleted' } : message;
}

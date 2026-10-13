import { formatTime, type MessageStatus, type UiMessage } from '@zilar/chat-core';

/**
 * T-1317: the words a screen reader speaks for one message bubble. The inline
 * tick icon is hidden from accessibility (it would otherwise be read as the
 * object-replacement `￼`), so the bubble carries this label instead: the body
 * (or the attachment's kind), the time, and, on my own messages, the delivery
 * state. Telegram reads the same shape: "Offline four, 08:59, read".
 */

const STATUS_WORDS: Record<MessageStatus, string> = {
  sending: 'sending',
  sent: 'sent',
  delivered: 'delivered',
  read: 'read',
  failed: 'failed',
};

/** What the bubble shows when it carries no text: the attachment or kind. */
function bodyWord(message: UiMessage): string {
  // A sticker's body is its emoji, but its label always reads "Sticker", never
  // the emoji as text (T-1318).
  if (message.card?.type === 'sticker') {
    return 'Sticker';
  }
  if (message.text !== undefined && message.text.length > 0) {
    return message.text;
  }
  if (message.album !== undefined) {
    return 'Album';
  }
  const attachment = message.attachment;
  if (attachment !== undefined) {
    return attachment.kind === 'image' ? 'Photo' : `File, ${attachment.name}`;
  }
  if (message.image !== undefined) {
    return 'Photo';
  }
  if (message.voice !== undefined) {
    return 'Voice message';
  }
  if (message.card !== undefined) {
    return 'Card';
  }
  return '';
}

/** The label for a bubble's accessible root: body, time, then my status. */
export function messageAccessibilityLabel(message: UiMessage, outgoing: boolean): string {
  const body = [bodyWord(message), formatTime(message.createdAt)].filter((part) => part !== '');
  return outgoing ? `${body.join(', ')}, ${STATUS_WORDS[message.status]}` : body.join(', ');
}

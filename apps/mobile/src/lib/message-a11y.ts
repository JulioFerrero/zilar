import { formatTime, type MessageStatus, type UiMessage } from '@zilar/chat-core';

/**
 * The inline tick icon is hidden from accessibility (it reads as the object-replacement `￼`), so the bubble carries the body, the time and, on my own messages, the delivery state as its label.
 */

const STATUS_WORDS: Record<MessageStatus, string> = {
  sending: 'sending',
  sent: 'sent',
  delivered: 'delivered',
  read: 'read',
  failed: 'failed',
};

function bodyWord(message: UiMessage): string {
  // A sticker's body is its emoji, but its label always reads "Sticker", never
  // the emoji as text.
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

export function messageAccessibilityLabel(message: UiMessage, outgoing: boolean): string {
  const body = [bodyWord(message), formatTime(message.createdAt)].filter((part) => part !== '');
  return outgoing ? `${body.join(', ')}, ${STATUS_WORDS[message.status]}` : body.join(', ');
}

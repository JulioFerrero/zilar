import { formatVoiceDuration } from './time';
import type { UiMessage } from './types';
import type { Payload } from '@galena/protocol';

export type PreviewParts = {
  prefix?: string;
  body: string;
};

function cardLabel(card: Payload | undefined): string | undefined {
  if (!card) {
    return undefined;
  }
  switch (card.type) {
    case 'progress':
      return card.data.stage;
    case 'approval.request':
      return card.data.summary;
    default:
      return undefined;
  }
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** The chat list preview from ui-style.md §4, split so the name can be colored. */
export function previewParts(
  message: UiMessage | undefined,
  options: { isGroup: boolean; currentUserId: string },
): PreviewParts {
  if (!message) {
    return { body: '' };
  }
  const body = message.voice
    ? `🎤 Voice message (${formatVoiceDuration(message.voice.duration_ms)})`
    : !message.text && message.image
      ? '🖼 Photo'
      : (message.text ?? cardLabel(message.card) ?? '');
  if (message.senderId === options.currentUserId) {
    return { prefix: 'You:', body };
  }
  if (options.isGroup) {
    return { prefix: `${firstName(message.senderName)}:`, body };
  }
  return { body };
}

export function previewText(
  message: UiMessage | undefined,
  options: { isGroup: boolean; currentUserId: string },
): string {
  const { prefix, body } = previewParts(message, options);
  return prefix ? `${prefix} ${body}` : body;
}

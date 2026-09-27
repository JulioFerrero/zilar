import { formatDuration } from './format';
import type { RenderItem, UiMessage } from './types';

export const GROUP_WINDOW_MS = 5 * 60 * 1000;

export interface PreviewOptions {
  isGroup: boolean;
  currentUserId: string;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function startsNewGroup(previous: UiMessage | undefined, message: UiMessage): boolean {
  if (previous === undefined) {
    return true;
  }
  return (
    previous.senderId !== message.senderId ||
    !sameDay(previous.createdAt, message.createdAt) ||
    message.createdAt.getTime() - previous.createdAt.getTime() > GROUP_WINDOW_MS
  );
}

/**
 * Serialises messages into render items: consecutive messages from the same
 * sender within five minutes become one group, and a date separator is inserted
 * whenever the calendar day changes.
 */
export function groupMessages(messages: readonly UiMessage[]): RenderItem[] {
  const sorted = [...messages].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const items: RenderItem[] = [];
  let index = 0;

  while (index < sorted.length) {
    const first = sorted[index];
    if (first === undefined) {
      break;
    }

    const previous = sorted[index - 1];
    if (previous === undefined || !sameDay(previous.createdAt, first.createdAt)) {
      items.push({ kind: 'separator', id: `separator-${first.id}`, date: first.createdAt });
    }

    let end = index;
    let next = sorted[end + 1];
    while (next !== undefined && !startsNewGroup(sorted[end], next)) {
      end += 1;
      next = sorted[end + 1];
    }

    for (let cursor = index; cursor <= end; cursor += 1) {
      const message = sorted[cursor];
      if (message === undefined) {
        continue;
      }
      items.push({
        kind: 'message',
        message,
        firstInGroup: cursor === index,
        lastInGroup: cursor === end,
      });
    }

    index = end + 1;
  }

  return items;
}

/** First word of a display name, used as the sender prefix in group previews. */
export function firstName(name: string): string {
  const [first] = name.trim().split(/\s+/);
  return first ?? name;
}

/** Sender prefix for a list preview (`You: `, `Ana: `) or an empty string. */
export function previewPrefix(lastMessage: UiMessage | undefined, options: PreviewOptions): string {
  if (lastMessage === undefined || !options.isGroup) {
    return '';
  }
  const name =
    lastMessage.senderId === options.currentUserId ? 'You' : firstName(lastMessage.senderName);
  return `${name}: `;
}

/** Body of a list preview: voice, photo, text or a generic attachment. */
export function previewBody(lastMessage: UiMessage | undefined): string {
  if (lastMessage === undefined) {
    return '';
  }
  if (lastMessage.voice !== undefined) {
    return `🎤 Voice message (${formatDuration(lastMessage.voice.duration_ms)})`;
  }
  if (lastMessage.image !== undefined) {
    return '🖼 Photo';
  }
  if (lastMessage.text !== undefined && lastMessage.text.length > 0) {
    return lastMessage.text;
  }
  if (lastMessage.card !== undefined) {
    return '📎 Attachment';
  }
  return '';
}

/** Full one-line preview shown in the chat list (see `ui-style.md` §4). */
export function previewText(lastMessage: UiMessage | undefined, options: PreviewOptions): string {
  return previewPrefix(lastMessage, options) + previewBody(lastMessage);
}

/**
 * Index in `items` at which to render the "Unread messages" divider, i.e. just
 * above the first unread message. The anchor is either the id of the last read
 * message or the unread count. Returns `null` when there is no divider to show.
 */
export function unreadDividerIndex(
  items: readonly RenderItem[],
  anchor: string | number,
): number | null {
  const messagePositions: number[] = [];
  items.forEach((item, index) => {
    if (item.kind === 'message') {
      messagePositions.push(index);
    }
  });

  const total = messagePositions.length;
  if (total === 0) {
    return null;
  }

  if (typeof anchor === 'string') {
    const found = messagePositions.findIndex((position) => {
      const item = items[position];
      return item?.kind === 'message' && item.message.id === anchor;
    });
    if (found === -1) {
      return null;
    }
    return messagePositions[found + 1] ?? null;
  }

  if (!Number.isFinite(anchor) || anchor <= 0) {
    return null;
  }
  const firstUnread = Math.max(0, total - Math.floor(anchor));
  return messagePositions[firstUnread] ?? null;
}

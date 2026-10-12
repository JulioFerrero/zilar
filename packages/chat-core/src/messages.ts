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
 * Whether `message` continues the album run that `previous` is in: the same
 * non-empty `album.id`, the same sender, the same day and inside the group
 * window (the run itself already guarantees the last three).
 */
function continuesAlbum(previous: UiMessage, message: UiMessage, id: string): boolean {
  return message.album?.id === id && !startsNewGroup(previous, message);
}

/** The album's loaded photos, in `index` order; missing siblings are just absent. */
function albumMembers(sorted: readonly UiMessage[], from: number, to: number): UiMessage[] {
  const members: UiMessage[] = [];
  for (let cursor = from; cursor <= to; cursor += 1) {
    const member = sorted[cursor];
    if (member !== undefined) {
      members.push(member);
    }
  }
  return members.sort((a, b) => (a.album?.index ?? 0) - (b.album?.index ?? 0));
}

/**
 * Serialises messages into render items: consecutive messages from the same
 * sender within five minutes become one group, and a date separator is inserted
 * whenever the calendar day changes. A consecutive run of same-album messages
 * (same `album.id`, sender, day and window) becomes one `album` item instead.
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

    let cursor = index;
    while (cursor <= end) {
      const message = sorted[cursor];
      if (message === undefined) {
        cursor += 1;
        continue;
      }

      // A message carrying an album marker and the consecutive same-album rows
      // after it become one album item; a lone marker (siblings not loaded) is
      // an album of one, so the item does not flip as older pages arrive.
      const albumId = message.album?.id;
      let last = cursor;
      if (albumId !== undefined) {
        while (last < end) {
          const previous = sorted[last];
          const next = sorted[last + 1];
          if (previous === undefined || next === undefined) break;
          if (!continuesAlbum(previous, next, albumId)) break;
          last += 1;
        }
      }

      if (albumId !== undefined) {
        const members = albumMembers(sorted, cursor, last);
        const head = members[0] ?? message;
        items.push({
          kind: 'album',
          message: head,
          messages: members,
          count: head.album?.count ?? 0,
          firstInGroup: cursor === index,
          lastInGroup: last === end,
        });
        cursor = last + 1;
        continue;
      }

      items.push({
        kind: 'message',
        message,
        firstInGroup: cursor === index,
        lastInGroup: cursor === end,
      });
      cursor += 1;
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

/** Body of a list preview: voice, photo, attachment, text or a generic card. */
export function previewBody(lastMessage: UiMessage | undefined): string {
  if (lastMessage === undefined) {
    return '';
  }
  if (lastMessage.album !== undefined) {
    return `🖼 ${lastMessage.album.count} photos`;
  }
  if (lastMessage.voice !== undefined) {
    return `🎤 Voice message (${formatDuration(lastMessage.voice.duration_ms)})`;
  }
  if (lastMessage.image !== undefined) {
    return '🖼 Photo';
  }
  if (lastMessage.attachment !== undefined) {
    const base =
      lastMessage.attachment.kind === 'image' ? '🖼 Photo' : `📎 ${lastMessage.attachment.name}`;
    const caption = lastMessage.text;
    return caption !== undefined && caption.length > 0 ? `${base}, ${caption}` : base;
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
  // One position per photo at that item: an album of three counts as three, so
  // the count math below matches what the same three single photos would do.
  const positions: number[] = [];
  const ids: string[] = [];
  items.forEach((item, index) => {
    if (item.kind === 'message') {
      positions.push(index);
      ids.push(item.message.id);
    } else if (item.kind === 'album') {
      const members = item.messages.length > 0 ? item.messages : [item.message];
      for (const member of members) {
        positions.push(index);
        ids.push(member.id);
      }
    }
  });

  const total = positions.length;
  if (total === 0) {
    return null;
  }

  if (typeof anchor === 'string') {
    const found = ids.indexOf(anchor);
    if (found === -1) {
      return null;
    }
    return positions[found + 1] ?? null;
  }

  if (!Number.isFinite(anchor) || anchor <= 0) {
    return null;
  }
  const firstUnread = Math.max(0, total - Math.floor(anchor));
  return positions[firstUnread] ?? null;
}

import { formatDuration } from './format';
import type { RenderItem, ReplyRef, UiMessage } from './types';

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

function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `day:${date.getFullYear()}-${month}-${day}`;
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
      items.push({ kind: 'separator', id: dayKey(first.createdAt), date: first.createdAt });
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

/** The small icon a chat row shows before a non-text preview. */
export type PreviewKind = 'photo' | 'album' | 'voice' | 'file' | 'card';

/**
 * Icon kind for the list preview, in the same priority `previewBody` reads the
 * payload (`photo`, `album`, `voice`, `file`, `card`), or `undefined` for a
 * plain text preview. The web and mobile rows map it to a lucide icon; the
 * emoji stay out of the app chrome.
 */
export function previewKind(lastMessage: UiMessage | undefined): PreviewKind | undefined {
  if (lastMessage === undefined) {
    return undefined;
  }
  if (lastMessage.album !== undefined) {
    return 'album';
  }
  if (lastMessage.voice !== undefined) {
    return 'voice';
  }
  if (lastMessage.image !== undefined) {
    return 'photo';
  }
  if (lastMessage.attachment !== undefined) {
    return lastMessage.attachment.kind === 'image' ? 'photo' : 'file';
  }
  if (lastMessage.text !== undefined && lastMessage.text.length > 0) {
    return undefined;
  }
  if (lastMessage.card !== undefined) {
    return 'card';
  }
  return undefined;
}

/** Body of a list preview: voice, photo, attachment, text or a generic card. */
export function previewBody(lastMessage: UiMessage | undefined): string {
  if (lastMessage === undefined) {
    return '';
  }
  if (lastMessage.album !== undefined) {
    return `${lastMessage.album.count} photos`;
  }
  if (lastMessage.voice !== undefined) {
    return `Voice message (${formatDuration(lastMessage.voice.duration_ms)})`;
  }
  if (lastMessage.image !== undefined) {
    return 'Photo';
  }
  if (lastMessage.attachment !== undefined) {
    const base = lastMessage.attachment.kind === 'image' ? 'Photo' : lastMessage.attachment.name;
    const caption = lastMessage.text;
    return caption !== undefined && caption.length > 0 ? `${base}, ${caption}` : base;
  }
  if (lastMessage.text !== undefined && lastMessage.text.length > 0) {
    return lastMessage.text;
  }
  if (lastMessage.card !== undefined) {
    return 'Attachment';
  }
  return '';
}

/** Full one-line preview shown in the chat list (see `ui-style.md` §4). */
export function previewText(lastMessage: UiMessage | undefined, options: PreviewOptions): string {
  return previewPrefix(lastMessage, options) + previewBody(lastMessage);
}

/**
 * The label a reply quote shows when the replied-to message carries no text:
 * a media kind ("Photo", "Video", "Voice message", "Sticker", "GIF") or the
 * file name, in the same priority `previewBody` reads the payload. `undefined`
 * for a plain text message or an unknown card.
 */
export function replyQuoteLabel(message: UiMessage | undefined): string | undefined {
  if (message === undefined) {
    return undefined;
  }
  if (message.album !== undefined || message.image !== undefined) {
    return 'Photo';
  }
  if (message.voice !== undefined) {
    return 'Voice message';
  }
  if (message.attachment !== undefined) {
    const { kind, name, mime } = message.attachment;
    if (kind === 'image') {
      return 'Photo';
    }
    // The GIF send path names files `gif-<id>.<ext>` with a video mime (T-0122).
    if (name.startsWith('gif-') && (mime === 'video/mp4' || mime === 'video/webm')) {
      return 'GIF';
    }
    return mime.startsWith('video/') ? 'Video' : name;
  }
  return message.card?.type === 'sticker' ? 'Sticker' : undefined;
}

function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value.length > 0 ? value : undefined;
}

/** What a reply quote renders, resolved against the loaded replied-to message. */
export interface ReplyQuoteContent {
  /** Display name: the replied-to sender's, "You" for our own, never empty. */
  senderName: string;
  /** The replied-to sender's id, for the quote colour; the reply id when unknown. */
  senderId: string;
  /** True when the reply is to one of our own messages (renders in the accent). */
  own: boolean;
  /** The excerpt line: the replied-to text, or a media label, or absent. */
  text?: string;
}

/**
 * Resolves a reply quote against the replied-to message from the loaded
 * history: the wire reply (`{ id, to?, text? }`) carries no name, so the name
 * and the excerpt come from the target when it is loaded. Without a loaded
 * target the wire fallback is used, and the name falls back to "Message" so the
 * line is never empty. `undefined` when there is nothing at all to show: no
 * loaded target, no wire text and no name (T-1739).
 */
export function replyQuoteContent(
  quote: ReplyRef,
  referenced: UiMessage | undefined,
  currentUserId: string,
): ReplyQuoteContent | undefined {
  // The wire reply carries no sender id, so a reply to one of our own messages
  // keeps the composer's "You" name (`replyRef`); trust it as own when the
  // replied-to message is not in the loaded history.
  const own =
    referenced?.senderId === currentUserId ||
    (referenced === undefined && quote.senderName === 'You');
  const name = own ? 'You' : (referenced?.senderName ?? quote.senderName);
  const text = nonEmpty(referenced?.text) ?? nonEmpty(quote.text) ?? replyQuoteLabel(referenced);
  // An unknown sender that the wire did not name either has no quote to draw:
  // hide it instead of showing an empty "Message" line.
  if (referenced === undefined && text === undefined && name === '') {
    return undefined;
  }
  return {
    senderName: name === '' ? 'Message' : name,
    senderId: referenced?.senderId ?? quote.senderId ?? quote.id,
    own,
    ...(text === undefined ? {} : { text }),
  };
}

/**
 * Index in `items` at which to render the "Unread messages" divider, i.e. just
 * above the first unread message. The anchor is either the id of the last read
 * message or the unread count. `currentUserId` is the reader: their own
 * messages are never unread, so the divider never lands directly above one.
 * Returns `null` when there is no divider to show.
 */
export function unreadDividerIndex(
  items: readonly RenderItem[],
  anchor: string | number,
  currentUserId: string,
): number | null {
  // One position per photo at that item: an album of three counts as three, so
  // the count math below matches what the same three single photos would do.
  const positions: number[] = [];
  const ids: string[] = [];
  const senders: string[] = [];
  items.forEach((item, index) => {
    if (item.kind === 'message') {
      positions.push(index);
      ids.push(item.message.id);
      senders.push(item.message.senderId);
    } else if (item.kind === 'album') {
      const members = item.messages.length > 0 ? item.messages : [item.message];
      for (const member of members) {
        positions.push(index);
        ids.push(member.id);
        senders.push(member.senderId);
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
    for (let i = found + 1; i < total; i += 1) {
      if (senders[i] !== currentUserId) {
        return positions[i] ?? null;
      }
    }
    return null;
  }

  if (!Number.isFinite(anchor) || anchor <= 0) {
    return null;
  }
  const unread = Math.floor(anchor);
  let seen = 0;
  let earliestOther: number | null = null;
  for (let i = total - 1; i >= 0; i -= 1) {
    if (senders[i] === currentUserId) {
      continue;
    }
    earliestOther = i;
    seen += 1;
    if (seen === unread) {
      return positions[i] ?? null;
    }
  }
  // Fewer than `unread` messages from someone else: the divider goes above the
  // first one of theirs, or nowhere when the whole list is the reader's own.
  if (earliestOther === null) {
    return null;
  }
  return positions[earliestOther] ?? null;
}

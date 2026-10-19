import { canDeleteMessage } from './edits';
import { formatDuration } from './format';
import { splitLinks } from './links';
import type { ChatSummary, RenderItem, ReplyRef, UiMessage, UiReaction } from './types';

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

// The same non-empty `album.id`, sender, day and group window.
function continuesAlbum(previous: UiMessage, message: UiMessage, id: string): boolean {
  return message.album?.id === id && !startsNewGroup(previous, message);
}

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

// Consecutive messages from the same sender within five minutes become one group; a date separator is inserted when the calendar day changes. A same-album run becomes one album item.
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

      // A lone marker (siblings not loaded) is an album of one, so the item does not flip as older pages arrive.
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

export function firstName(name: string): string {
  const [first] = name.trim().split(/\s+/);
  return first ?? name;
}

export function previewPrefix(lastMessage: UiMessage | undefined, options: PreviewOptions): string {
  if (lastMessage === undefined || !options.isGroup) {
    return '';
  }
  const name =
    lastMessage.senderId === options.currentUserId ? 'You' : firstName(lastMessage.senderName);
  return `${name}: `;
}

export type PreviewKind = 'photo' | 'album' | 'voice' | 'file' | 'card';

// Icon kind for the list preview, in the same priority `previewBody` reads the payload; `undefined` for a plain text preview.
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

// `previewPrefix` already includes its trailing space, so joining prefix and body yields the exact preview text.
export function previewParts(
  lastMessage: UiMessage | undefined,
  options: PreviewOptions,
): { prefix: string; body: string; kind: PreviewKind | undefined } {
  return {
    prefix: previewPrefix(lastMessage, options),
    body: previewBody(lastMessage),
    kind: previewKind(lastMessage),
  };
}

// A media kind or the file name, in the same priority `previewBody` reads the payload; `undefined` for plain text or an unknown card.
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
    // The GIF send path names files `gif-<id>.<ext>` with a video mime.
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

export interface ReplyQuoteContent {
  senderName: string;
  senderId: string;
  own: boolean;
  text?: string;
}

// The wire reply carries no name, so the name and excerpt come from the loaded target; the name falls back to "Message" so the line is never empty.
export function replyQuoteContent(
  quote: ReplyRef,
  referenced: UiMessage | undefined,
  currentUserId: string,
): ReplyQuoteContent | undefined {
  // The wire reply carries no sender id, so a reply to one of our own keeps "You"; trust it as own when the target is not loaded.
  const own =
    referenced?.senderId === currentUserId ||
    (referenced === undefined && quote.senderName === 'You');
  const name = own ? 'You' : (referenced?.senderName ?? quote.senderName);
  const text = nonEmpty(referenced?.text) ?? nonEmpty(quote.text) ?? replyQuoteLabel(referenced);
  // An unknown sender the wire did not name has no quote to draw: hide it instead of showing an empty "Message" line.
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

// The divider sits above the first unread message; the reader's own messages are never unread.
export function unreadDividerIndex(
  items: readonly RenderItem[],
  anchor: string | number,
  currentUserId: string,
): number | null {
  // An album of three counts as three positions, so the count math matches three single photos.
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
  // Fewer than `unread` messages from someone else: the divider goes above the first of theirs, or nowhere when the list is all the reader's own.
  if (earliestOther === null) {
    return null;
  }
  return positions[earliestOther] ?? null;
}

// Only https is unfurled (the server refuses anything else); a message that
// already carries an image or attachment has no link card.
export function previewUrl(message: UiMessage, text: string): string | undefined {
  if (message.image !== undefined || message.attachment !== undefined) {
    return undefined;
  }
  for (const segment of splitLinks(text)) {
    if (segment.kind === 'link' && segment.href.startsWith('https://')) {
      return segment.href;
    }
  }
  return undefined;
}

export function chipLabel(reaction: UiReaction): string {
  return reaction.mine
    ? `${reaction.emoji} ${reaction.count}, including you`
    : `${reaction.emoji} ${reaction.count}`;
}

/** Which delete action one selected message allows, mirroring MessageMenu. */
export function deleteActionFor(
  message: UiMessage,
  meId: string,
  isDm: boolean,
): 'everyone' | 'me' | 'none' {
  if (message.status === 'sending') {
    return 'none';
  }
  if (canDeleteMessage(message, meId)) {
    return 'everyone';
  }
  return isDm && message.deleted !== true ? 'me' : 'none';
}

/** A channel row is offered only where the caller may post; a plain member or an unknown role has no voice in the feed room. */
export function canPostTo(chat: ChatSummary): boolean {
  if (chat.chatKind !== 'channel') {
    return true;
  }
  return chat.myRole === 'owner' || chat.myRole === 'admin';
}

export function withoutId(id: string, ids: ReadonlySet<string>): ReadonlySet<string> {
  const next = new Set(ids);
  next.delete(id);
  return next;
}

export function withKey(keys: ReadonlySet<string>, key: string, on: boolean): ReadonlySet<string> {
  const next = new Set(keys);
  if (on) {
    next.add(key);
  } else {
    next.delete(key);
  }
  return next;
}

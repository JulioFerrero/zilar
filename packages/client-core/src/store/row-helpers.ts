// T-1547: the shared chat-row helpers, split out of `chat-rows.ts` so both the
// row mappers there and the topic mappers in `topic-rows.ts` can use them
// without an import cycle. Pure mappers from `/api/chats` entries to chat rows,
// shared by web and mobile (T-0924). No state, no Effect.
//
// T-1207: the entry's `unread` (default 0) and `lastMessage` preview ride every
// row (DMs, group General rows and topic rows, whose topic objects carry the
// same two fields). The preview becomes a display-only `UiMessage`
// (`createdAt` from `at`, `status: 'sent'`); its `id` stays the origin id
// (markers, quote jumps and dedupe key on it) while the server's `archiveId`
// rides `UiMessage.archiveId` as the read mark; the server names only a display
// name, never a sender id, so `senderId` carries the sender name (display only:
// the row preview reads `senderName`, never `senderId`).
import type { UiMessage } from '@zilar/chat-core';

/** The `/api/chats` unread fields, read loosely (both apps decode entries
 * on their own, and an older server omits them). */
export interface ServerRowFields {
  readonly unread?: unknown;
  readonly lastMessage?: unknown;
  /** T-1318: when the chat was created or the caller joined, an ISO datetime. */
  readonly createdAt?: unknown;
  /** T-1238: the delivered mark, an archive id in the caller's terms. */
  readonly deliveredUntil?: unknown;
  /** T-1311: the peer's read mark (DMs), an archive id in the caller's terms. */
  readonly readUntil?: unknown;
}

export function archiveMarkOf(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw !== '' ? raw : undefined;
}

/** T-1318: the chat's creation/join time from the wire, or undefined when unusable. */
export function createdAtOf(raw: unknown): Date | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function unreadOf(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : 0;
}

function previewParts(
  raw: unknown,
):
  | { id: string; text: string; senderName?: string | undefined; archiveId?: string | undefined }
  | undefined {
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }
  const value = raw as {
    id?: unknown;
    text?: unknown;
    senderName?: unknown;
    archiveId?: unknown;
  };
  if (typeof value.id !== 'string' || typeof value.text !== 'string') {
    return undefined;
  }
  // T-1214: the preview keeps the origin id as its `id` (markers, quote
  // jumps and dedupe all key on it); the archive id rides separately as
  // the read mark for `clearActiveChatRead` / `recordRead`.
  const archiveId =
    typeof value.archiveId === 'string' && value.archiveId !== '' ? value.archiveId : undefined;
  return value.senderName === undefined || typeof value.senderName === 'string'
    ? { id: value.id, text: value.text, senderName: value.senderName, archiveId }
    : { id: value.id, text: value.text, archiveId };
}

/** The server preview as a display-only `UiMessage` (see the header). */
export function previewMessageOf(chatId: string, raw: unknown): UiMessage | undefined {
  const parts = previewParts(raw);
  if (parts === undefined) {
    return undefined;
  }
  const at = (raw as { at?: unknown }).at;
  if (typeof at !== 'string') {
    return undefined;
  }
  const createdAt = new Date(at);
  if (Number.isNaN(createdAt.getTime())) {
    return undefined;
  }
  return {
    id: parts.id,
    chatId,
    senderId: parts.senderName ?? '',
    senderName: parts.senderName ?? '',
    text: parts.text,
    createdAt,
    status: 'sent',
    ...(parts.archiveId === undefined ? {} : { archiveId: parts.archiveId }),
  };
}

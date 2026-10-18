// Shared chat-row helpers: pure mappers from `/api/chats` entries to rows. A preview keeps
// the origin id as its `id` (markers, quote jumps and dedupe key on it) while the server's
// `archiveId` rides `UiMessage.archiveId` as the read mark; `senderId` carries the sender
// name, display only.
import type { UiMessage } from '@zilar/chat-core';

/** The `/api/chats` unread fields, read loosely: an older server omits them. */
export interface ServerRowFields {
  readonly unread?: unknown;
  readonly lastMessage?: unknown;
  readonly createdAt?: unknown;
  /** The delivered mark, an archive id in the caller's terms. */
  readonly deliveredUntil?: unknown;
  /** The peer's read mark (DMs), an archive id in the caller's terms. */
  readonly readUntil?: unknown;
}

export function archiveMarkOf(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw !== '' ? raw : undefined;
}

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
  const archiveId =
    typeof value.archiveId === 'string' && value.archiveId !== '' ? value.archiveId : undefined;
  return value.senderName === undefined || typeof value.senderName === 'string'
    ? { id: value.id, text: value.text, senderName: value.senderName, archiveId }
    : { id: value.id, text: value.text, archiveId };
}

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

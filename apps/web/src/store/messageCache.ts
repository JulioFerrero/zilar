import type { ChatSummary, UiMessage } from '@zilar/chat-core';
import { Pin, type Pin as PinRow } from '@zilar/api-contract';
import { Result, Schema } from 'effect';
import { struct } from '@zilar/protocol';
import type { StorageLike } from './realStore';

// The newest messages of the recent chats, so a cold reload of an open chat
// paints it at once instead of staying empty until XMPP connects and history
// arrives (T-1903). The web twin of the phone's `offline-cache.ts`: display
// data only, never credentials or media bytes. It is only a first paint; the
// history page merges over these rows right after.
export const MESSAGE_CACHE_KEY = 'zilar:messages';
const CACHE_VERSION = 1;
const MAX_CACHED_CHATS = 30;
const MAX_CACHED_MESSAGES = 50;
// The browser gives us about 5 MB; the cache must never be able to break the
// page, so the payload is capped well below that.
const MAX_CACHE_BYTES = 1_500_000;
// Writes are throttled this long after the last message change; `pagehide`
// flushes the pending state at once (`effects/lifecycle.ts`).
export const MESSAGE_CACHE_WRITE_DELAY_MS = 2_000;

// Unknown keys are kept, like the chat-list cache's schema: a newer build may
// add fields to a cached row and an older cache must still paint it.
const passthrough = [Schema.Record(Schema.String, Schema.Unknown)] as const;

// A message is written with its dates as ISO strings; nothing else changes.
const cachedMessageSchema = Schema.StructWithRest(
  struct({
    id: Schema.String,
    chatId: Schema.String,
    senderId: Schema.String,
    senderName: Schema.String,
    text: Schema.optional(Schema.String),
    createdAt: Schema.String,
    status: Schema.String,
  }),
  passthrough,
);

const cacheSchema = struct({
  version: Schema.Literal(CACHE_VERSION),
  userId: Schema.String,
  messages: Schema.Record(Schema.String, Schema.mutable(Schema.Array(cachedMessageSchema))),
  pins: Schema.optional(Schema.Unknown),
});

type EncodedMessage = Record<string, unknown>;
type EncodedMessages = Record<string, EncodedMessage[]>;
type CachedPin = PinRow;

interface KeptChat {
  readonly id: string;
  readonly messages: EncodedMessage[];
  readonly pins: CachedPin[];
}

/** Whether a URL would only work on this device, so it must never be stored. */
function isLocalUrl(url: string): boolean {
  return url.startsWith('blob:') || url.startsWith('data:');
}

/**
 * Whether a message may be cached. A `local-*` id is a still-unacked optimistic
 * send: the server echo would show it twice after a restart. A `sending` or
 * `failed` one is in flight or broken, so it would keep a clock or a Retry that
 * can never settle.
 */
function isCacheable(message: UiMessage): boolean {
  return (
    message.status !== 'sending' && message.status !== 'failed' && !message.id.startsWith('local-')
  );
}

/** Drops a local preview URL and the media object that only pointed at it. */
function stripLocalFields(message: UiMessage): UiMessage {
  const cleaned: UiMessage = { ...message };
  if (cleaned.attachment !== undefined && isLocalUrl(cleaned.attachment.url)) {
    delete cleaned.attachment;
  }
  if (cleaned.image !== undefined && isLocalUrl(cleaned.image.url)) {
    delete cleaned.image;
  }
  if (cleaned.voice?.url !== undefined && isLocalUrl(cleaned.voice.url)) {
    delete cleaned.voice;
  }
  return cleaned;
}

/** Encodes one message; only the dates need the string form. */
function encodeMessage(message: UiMessage): EncodedMessage {
  const cleaned = stripLocalFields(message);
  return {
    ...cleaned,
    createdAt: cleaned.createdAt.toISOString(),
    editedAt: cleaned.editedAt?.toISOString(),
  };
}

function decodeMessage(message: Schema.Schema.Type<typeof cachedMessageSchema>): UiMessage {
  const { editedAt: rawEditedAt, ...rest } = message as unknown as UiMessage & {
    editedAt?: unknown;
  };
  const createdAt = new Date(message.createdAt);
  const decoded: UiMessage = {
    ...rest,
    createdAt: Number.isNaN(createdAt.getTime()) ? new Date(0) : createdAt,
  };
  if (typeof rawEditedAt === 'string') {
    const editedAt = new Date(rawEditedAt);
    if (!Number.isNaN(editedAt.getTime())) {
      decoded.editedAt = editedAt;
    }
  }
  return decoded;
}

/**
 * Keeps the pins of a cached chat, dropping an entry the contract does not
 * accept (an older or newer server may write something we cannot paint).
 */
function decodePins(raw: unknown): Record<string, CachedPin[]> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {};
  }
  const pins: Record<string, CachedPin[]> = {};
  for (const [chatId, list] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(list)) {
      continue;
    }
    const decoded: CachedPin[] = [];
    for (const entry of list) {
      const result = Schema.decodeUnknownResult(Pin)(entry);
      if (Result.isSuccess(result)) {
        decoded.push(result.success);
      }
    }
    if (decoded.length > 0) {
      pins[chatId] = decoded;
    }
  }
  return pins;
}

function serialize(userId: string, kept: readonly KeptChat[]): string {
  const messages: EncodedMessages = {};
  const pins: Record<string, CachedPin[]> = {};
  for (const chat of kept) {
    messages[chat.id] = chat.messages;
    if (chat.pins.length > 0) {
      pins[chat.id] = chat.pins;
    }
  }
  const payload: {
    version: number;
    userId: string;
    messages: EncodedMessages;
    pins?: Record<string, CachedPin[]>;
  } = { version: CACHE_VERSION, userId, messages };
  if (Object.keys(pins).length > 0) {
    payload.pins = pins;
  }
  return JSON.stringify(payload);
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/**
 * Reads the payload for `userId`, or `undefined` when there is none or it is
 * unusable. The key is dropped when it belongs to a different account, so one
 * user's copy can never be painted for another.
 */
function readPayload(
  storage: StorageLike | null,
  userId: string,
): Schema.Schema.Type<typeof cacheSchema> | undefined {
  if (storage === null || userId === '') {
    return undefined;
  }
  try {
    const raw = storage.getItem(MESSAGE_CACHE_KEY);
    if (raw === null) {
      return undefined;
    }
    const parsed = Schema.decodeUnknownResult(cacheSchema)(JSON.parse(raw));
    if (!Result.isSuccess(parsed)) {
      return undefined;
    }
    if (parsed.success.userId !== userId) {
      storage.removeItem(MESSAGE_CACHE_KEY);
      return undefined;
    }
    return parsed.success;
  } catch {
    return undefined;
  }
}

/**
 * The cached messages for `userId`, or an empty map when there is none or it
 * is unusable.
 */
export function readMessageCache(
  storage: StorageLike | null,
  userId: string,
): Record<string, UiMessage[]> {
  const payload = readPayload(storage, userId);
  if (payload === undefined) {
    return {};
  }
  const messages: Record<string, UiMessage[]> = {};
  for (const [chatId, list] of Object.entries(payload.messages)) {
    messages[chatId] = list.map(decodeMessage);
  }
  return messages;
}

/**
 * The cached pins of `userId`, or an empty map when there are none or they are
 * unusable. They let the pinned banner paint with the first frame.
 */
export function readCachedPins(
  storage: StorageLike | null,
  userId: string,
): Record<string, CachedPin[]> {
  const payload = readPayload(storage, userId);
  if (payload === undefined) {
    return {};
  }
  return decodePins(payload.pins);
}

/**
 * Saves the newest 50 messages of the 30 most recent chats in the list's order,
 * and the pins of the chats it keeps. The payload is kept under 1.5 MB by
 * dropping the oldest chats first, then the oldest rows of the newest chat, then
 * the pins, so a huge history can never fill the quota.
 */
export function writeMessageCache(
  storage: StorageLike | null,
  userId: string,
  chats: readonly ChatSummary[],
  messagesByChat: Record<string, UiMessage[]>,
  pinsByChat: Record<string, readonly CachedPin[]> = {},
): void {
  if (storage === null || userId === '') {
    return;
  }
  try {
    const kept: KeptChat[] = [];
    for (const chat of chats.slice(0, MAX_CACHED_CHATS)) {
      const list = messagesByChat[chat.id];
      if (list === undefined) {
        continue;
      }
      const recent = list.filter(isCacheable).slice(-MAX_CACHED_MESSAGES).map(encodeMessage);
      if (recent.length > 0) {
        kept.push({ id: chat.id, messages: recent, pins: [...(pinsByChat[chat.id] ?? [])] });
      }
    }
    // The list is newest first, so the oldest chats sit at the end.
    let json = serialize(userId, kept);
    while (byteLength(json) > MAX_CACHE_BYTES && kept.length > 1) {
      kept.pop();
      json = serialize(userId, kept);
    }
    // One chat may still overflow on its own: drop its oldest rows and keep
    // the newest, which is what a first paint needs.
    const newest = kept[0];
    if (newest !== undefined) {
      while (byteLength(json) > MAX_CACHE_BYTES && newest.messages.length > 1) {
        newest.messages.shift();
        json = serialize(userId, kept);
      }
    }
    // Pins are only a first paint, so they go before the last rows.
    for (
      let index = kept.length - 1;
      index >= 0 && byteLength(json) > MAX_CACHE_BYTES;
      index -= 1
    ) {
      const chat = kept[index];
      if (chat !== undefined && chat.pins.length > 0) {
        chat.pins.splice(0, chat.pins.length);
        json = serialize(userId, kept);
      }
    }
    if (byteLength(json) > MAX_CACHE_BYTES) {
      // A single message over the cap is not worth keeping anything for.
      json = serialize(userId, []);
    }
    storage.setItem(MESSAGE_CACHE_KEY, json);
  } catch {
    // A full or blocked localStorage must never break messaging.
  }
}

export function clearMessageCache(storage: StorageLike | null): void {
  try {
    storage?.removeItem(MESSAGE_CACHE_KEY);
  } catch {
    // Ignore storage failures on the way out.
  }
}

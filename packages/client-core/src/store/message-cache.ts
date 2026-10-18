// The offline message-cache codec, shared by web and phone (T-2019, W1-g).
// Both apps keep the newest messages of the recent chats so a cold start
// paints the open chat at once (web: T-1903, phone: T-1313). The file and
// storage seams stay per app; this module owns the format: the version, the
// per-chat row cap, which rows may be cached, the local-URL strip, the dates
// and the pins. It is display data only, never credentials or media bytes.
import { Pin as PinSchema, type Pin } from '@zilar/api-contract';
import type { ChatSummary, UiMessage } from '@zilar/chat-core';
import { Result, Schema } from 'effect';
import { struct } from '@zilar/protocol';

const CACHE_VERSION = 1;
const MAX_CACHED_MESSAGES = 50;

/** The cache's contents: one signed-in user's recent messages and their pins. */
export interface MessageCacheSnapshot {
  userId: string;
  messages: Record<string, UiMessage[]>;
  /** The pinned banner of a cached chat paints before the pins answer (T-1914). */
  pins?: Record<string, readonly Pin[]>;
}

export interface EncodeMessageCacheOptions {
  /**
   * URL prefixes that only work on this device (`file://` on phone,
   * `blob://` on web), so the media pointing at them must never be stored.
   */
  localUrlPrefixes: readonly string[];
  /** The serialized payload's byte cap; the oldest chats go first. */
  maxBytes?: number;
}

type EncodedMessage = Record<string, unknown>;
type EncodedMessages = Record<string, EncodedMessage[]>;
type CachedPins = Record<string, Pin[]>;

interface KeptChat {
  readonly id: string;
  readonly messages: EncodedMessage[];
  readonly pins: Pin[];
}

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
  // Decoded separately and leniently, so a bad pin never discards the messages.
  pins: Schema.optional(Schema.Unknown),
});

// The mobile-only fields the cache must drop: the `file://` preview and the
// upload progress live beside the shared `UiMessage` (`MobileMessage`), never
// on the wire, so they must never reach the file.
type LocalOnlyFields = { localUri?: string | undefined; uploadProgress?: number | undefined };

function isLocalUrl(url: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => url.startsWith(prefix));
}

/**
 * Whether a message may be cached. A `local-*` id is a still-unacked optimistic
 * send: the ledger's `wireTargetFor` (`store/ledger-ids.ts`) reports no server
 * id for one, so on restart the server echo would show the message twice (once
 * under each id). A `sending` or `failed` one is in flight or broken: keeping
 * it would show a clock or a Retry that can never settle.
 */
function isCacheable(message: UiMessage): boolean {
  return (
    message.status !== 'sending' && message.status !== 'failed' && !message.id.startsWith('local-')
  );
}

/** Drops the local-only upload fields and any local preview url they left behind. */
function stripLocalFields(message: UiMessage, prefixes: readonly string[]): UiMessage {
  const {
    localUri: _localUri,
    uploadProgress: _uploadProgress,
    ...rest
  } = message as UiMessage & LocalOnlyFields;
  const cleaned: UiMessage = { ...rest };
  if (cleaned.attachment !== undefined && isLocalUrl(cleaned.attachment.url, prefixes)) {
    delete cleaned.attachment;
  }
  if (cleaned.image !== undefined && isLocalUrl(cleaned.image.url, prefixes)) {
    delete cleaned.image;
  }
  if (cleaned.voice?.url !== undefined && isLocalUrl(cleaned.voice.url, prefixes)) {
    delete cleaned.voice;
  }
  return cleaned;
}

/** Encodes one message; only the dates need the string form. */
function encodeMessage(message: UiMessage, prefixes: readonly string[]): EncodedMessage {
  const cleaned = stripLocalFields(message, prefixes);
  return {
    ...cleaned,
    createdAt: cleaned.createdAt.toISOString(),
    editedAt: cleaned.editedAt?.toISOString(),
  };
}

/**
 * Decodes the cached pins: a missing or unusable value reads as `{}`, and a
 * bad chat entry or pin row is dropped without discarding the rest.
 */
function decodePins(raw: unknown): CachedPins {
  const record = Schema.decodeUnknownResult(Schema.Record(Schema.String, Schema.Unknown))(raw);
  if (!Result.isSuccess(record)) {
    return {};
  }
  const pins: CachedPins = {};
  for (const [chatId, entry] of Object.entries(record.success)) {
    if (!Array.isArray(entry)) {
      continue;
    }
    const list: Pin[] = [];
    for (const row of entry) {
      const pin = Schema.decodeUnknownResult(PinSchema)(row);
      if (Result.isSuccess(pin)) {
        list.push(pin.success);
      }
    }
    if (list.length > 0) {
      pins[chatId] = list;
    }
  }
  return pins;
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

function serialize(userId: string, kept: readonly KeptChat[]): string {
  const messages: EncodedMessages = {};
  const pins: CachedPins = {};
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
    pins?: CachedPins;
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
 * The chats to keep: the first `max` in display order, plus the chat currently
 * open when it falls outside them (a topic, or a chat opened from a
 * notification), so it starts from the local copy too.
 */
export function selectCachedChats(
  chats: readonly ChatSummary[],
  activeChatId: string | null | undefined,
  max: number,
): readonly ChatSummary[] {
  const first = chats.slice(0, max);
  if (activeChatId === null || activeChatId === undefined) {
    return first;
  }
  if (first.some((chat) => chat.id === activeChatId)) {
    return first;
  }
  const active = chats.find((chat) => chat.id === activeChatId);
  return active === undefined ? first : [...first, active];
}

function keptChats(snapshot: MessageCacheSnapshot, prefixes: readonly string[]): KeptChat[] {
  const kept: KeptChat[] = [];
  for (const [chatId, list] of Object.entries(snapshot.messages)) {
    const recent = list
      .filter(isCacheable)
      .slice(-MAX_CACHED_MESSAGES)
      .map((message) => encodeMessage(message, prefixes));
    if (recent.length > 0) {
      kept.push({ id: chatId, messages: recent, pins: [...(snapshot.pins?.[chatId] ?? [])] });
    }
  }
  return kept;
}

/**
 * Shrinks the payload to `maxBytes`: the record is in newest-first order, so
 * the oldest chats sit at the end and go first; a single chat that still
 * overflows loses its oldest rows, and pins go before the last rows.
 */
function fitToBytes(userId: string, kept: KeptChat[], maxBytes: number): string {
  let json = serialize(userId, kept);
  while (byteLength(json) > maxBytes && kept.length > 1) {
    kept.pop();
    json = serialize(userId, kept);
  }
  const newest = kept[0];
  if (newest !== undefined) {
    while (byteLength(json) > maxBytes && newest.messages.length > 1) {
      newest.messages.shift();
      json = serialize(userId, kept);
    }
  }
  for (let index = kept.length - 1; index >= 0 && byteLength(json) > maxBytes; index -= 1) {
    const chat = kept[index];
    if (chat !== undefined && chat.pins.length > 0) {
      chat.pins.splice(0, chat.pins.length);
      json = serialize(userId, kept);
    }
  }
  if (byteLength(json) > maxBytes) {
    // A single message over the cap is not worth keeping anything for.
    json = serialize(userId, []);
  }
  return json;
}

/**
 * Encodes a snapshot as the cache file's JSON: settled messages only, the
 * newest 50 per chat, `createdAt` and `editedAt` as ISO strings, local media
 * dropped. `maxBytes` drops the oldest chats first when given.
 */
export function encodeMessageCache(
  snapshot: MessageCacheSnapshot,
  options: EncodeMessageCacheOptions,
): string {
  const kept = keptChats(snapshot, options.localUrlPrefixes);
  if (options.maxBytes === undefined) {
    return serialize(snapshot.userId, kept);
  }
  return fitToBytes(snapshot.userId, kept, options.maxBytes);
}

/**
 * Parses the cache for `userId`, or null when it is unusable, another user's
 * or another version. A corrupt, truncated or older file reads as "none", so
 * it can never break the start.
 */
export function decodeMessageCache(raw: string, userId: string): MessageCacheSnapshot | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const decoded = Schema.decodeUnknownResult(cacheSchema)(parsed);
  if (!Result.isSuccess(decoded) || decoded.success.userId !== userId) {
    return null;
  }
  const messages: Record<string, UiMessage[]> = {};
  for (const [chatId, list] of Object.entries(decoded.success.messages)) {
    messages[chatId] = list.map(decodeMessage);
  }
  return {
    userId: decoded.success.userId,
    messages,
    pins: decodePins(decoded.success.pins),
  };
}

/**
 * The pins kept in the offline cache (T-1914), so a cold start paints the
 * pinned banner of a cached chat at once instead of popping it in when the
 * pins answer (which drops the open thread). The file schema stays at version
 * 1: `pins` is an optional field, and reading is lenient, so an older or a
 * partly corrupt file can never cost the cached messages.
 */
import { Pin as PinSchema, type Pin } from '@zilar/api-contract';
import { Result, Schema } from 'effect';

/** The cached pins, by chat id; a chat without pins takes no room. */
export type CachedPins = Record<string, Pin[]>;

const recordSchema = Schema.Record(Schema.String, Schema.Unknown);

/** Encodes the non-empty lists only. */
export function encodeCachedPins(pins: Record<string, readonly Pin[]>): CachedPins {
  const encoded: CachedPins = {};
  for (const [chatId, list] of Object.entries(pins)) {
    if (list.length > 0) {
      encoded[chatId] = [...list];
    }
  }
  return encoded;
}

/**
 * Decodes the file's pins: a missing or unusable value reads as `{}`, and a
 * bad chat entry or pin row is dropped without discarding the rest.
 */
export function decodeCachedPins(value: unknown): CachedPins {
  const record = Schema.decodeUnknownResult(recordSchema)(value);
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

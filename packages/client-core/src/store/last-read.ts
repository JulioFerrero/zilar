// Reads the last-read map a user's storage saved; anything unusable reads as none.
import { Effect, Exit, Schema } from 'effect';
import { type KeyValue } from './ports';
import { LAST_READ_PREFIX } from './reads';

const parseJson = Schema.decodeUnknownExit(Schema.fromJsonString(Schema.Unknown));

export const readLastRead = (
  storage: KeyValue | null,
  userId: string,
): Effect.Effect<Record<string, string>> => {
  const none: Record<string, string> = {};
  if (storage === null) {
    return Effect.succeed(none);
  }
  return Effect.try(() => storage.getItem(`${LAST_READ_PREFIX}${userId}`)).pipe(
    Effect.map((raw) => {
      if (raw === null) {
        return none;
      }
      const parsed = parseJson(raw);
      if (Exit.isFailure(parsed)) {
        return none;
      }
      const value = parsed.value;
      if (value === null || typeof value !== 'object') {
        return none;
      }
      const result: Record<string, string> = {};
      for (const [chatId, messageId] of Object.entries(value)) {
        if (typeof messageId === 'string') {
          result[chatId] = messageId;
        }
      }
      return result;
    }),
    Effect.orElseSucceed(() => none),
  );
};

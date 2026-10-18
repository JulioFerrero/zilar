// The draft-stream wire contract shared by web and phone (T-2028, W1-h): the
// event shapes, validation and reconnect backoff; the transport stays per app.
import { Result, Schema } from 'effect';
import { struct } from '@zilar/protocol';

import type { DraftHubEvent } from './ports';

/** Reconnect backoff: first retry after 1 s, doubling up to 30 s. */
export const DRAFT_RECONNECT_BASE_MS = 1_000;
export const DRAFT_RECONNECT_MAX_MS = 30_000;

// - `chatJid` is the AI's bare JID, which is the DM's chat id in the store.
// - `turnId` is one UUID per gateway turn.
// - `text` is cumulative, so a dropped event is harmless.
const draftEventSchema = struct({
  type: Schema.Literal('draft'),
  chatJid: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  turnId: Schema.String.pipe(Schema.check(Schema.isUUID())),
  text: Schema.String,
});

const endEventSchema = struct({
  type: Schema.Literal('end'),
  chatJid: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  turnId: Schema.String.pipe(Schema.check(Schema.isUUID())),
  outcome: Schema.Literals(['sent', 'failed']),
});

const schemas = { draft: draftEventSchema, end: endEventSchema } as const;

/**
 * Parses one SSE frame's `data` into a validated draft event, or `undefined`.
 * Non-JSON, invalid and mistyped frames are dropped silently.
 */
export function decodeDraftEvent(type: 'draft' | 'end', data: unknown): DraftHubEvent | undefined {
  if (typeof data !== 'string') {
    return undefined;
  }
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return undefined;
  }
  const parsed = Schema.decodeUnknownResult(schemas[type])(json);
  return Result.isSuccess(parsed) ? parsed.success : undefined;
}

/** The jittered wait before one reconnection: `base`, doubling per attempt to `max`. */
export function draftReconnectDelay(
  attempt: number,
  random: () => number,
  base = DRAFT_RECONNECT_BASE_MS,
  max = DRAFT_RECONNECT_MAX_MS,
): number {
  const ceiling = Math.min(max, base * 2 ** attempt);
  return Math.round(base + (ceiling - base) * random());
}

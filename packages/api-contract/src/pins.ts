// Pinned messages (T-0114): list, pin and unpin. `chat` is a room bare JID for
// groups/topics, or a DM peer's bare JID (the server keeps the canonical pair
// key, so both sides share one list). Pins arrive newest first. The snapshot
// (`senderName`/`text`/`kind`) is display only: the server trusts it for
// rendering, never for authorization.

import { Schema } from 'effect';
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api';
import { lenientLiterals } from './lenient';
import { PinsWriteRateLimit, SchemaErrors, Session } from './middleware';

export const PIN_SENDER_NAME_MAX = 80;
export const PIN_TEXT_MAX = 300;
export const PIN_MESSAGE_ID_MAX = 256;

export const PIN_KINDS = ['text', 'image', 'file', 'voice', 'card'] as const;

export const PinKind = Schema.Literals(PIN_KINDS);

export type PinKind = typeof PinKind.Type;

const CONTROL_CHAR_MAX = 0x1f;
const CONTROL_CHAR_DEL = 0x7f;
// Message bodies may carry tab and newline (Shift+Enter); the snapshot keeps
// the same rule and rejects every other control character.
const SNAPSHOT_WHITESPACE = new Set(['\t', '\n']);

function hasControlCharacters(value: string, allowWhitespace = false): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= CONTROL_CHAR_MAX || code === CONTROL_CHAR_DEL) {
      if (allowWhitespace && SNAPSHOT_WHITESPACE.has(char)) {
        continue;
      }
      return true;
    }
  }
  return false;
}

/** One required `chat` string; strict, so an excess key is a 400. */
export const ListPinsQuery = Schema.Struct({
  chat: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255)),
});

/**
 * `senderName` is trimmed before the length and control-character checks.
 * A client encodes the trimmed form, so it sends `senderName` trimmed.
 */
export const CreatePinPayload = Schema.Struct({
  chat: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255)),
  messageId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(PIN_MESSAGE_ID_MAX)),
  senderName: Schema.Trim.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(PIN_SENDER_NAME_MAX),
    Schema.makeFilter((value) =>
      hasControlCharacters(value) ? 'senderName must not contain control characters' : undefined,
    ),
  ),
  text: Schema.optional(
    Schema.String.check(
      Schema.isMaxLength(PIN_TEXT_MAX),
      Schema.makeFilter((value) =>
        hasControlCharacters(value, true) ? 'text must not contain control characters' : undefined,
      ),
    ),
  ),
  kind: Schema.optional(PinKind),
});

export type CreatePinPayload = typeof CreatePinPayload.Type;

/** A pin row. An unknown `kind` from a newer server decodes to `text`. */
export const Pin = Schema.Struct({
  id: Schema.String,
  chat: Schema.String,
  messageId: Schema.String,
  senderName: Schema.String,
  text: Schema.String,
  kind: lenientLiterals(PIN_KINDS, 'text'),
  pinnedBy: Schema.String,
  pinnedAt: Schema.String,
});

export type Pin = typeof Pin.Type;

export const PinList = Schema.Struct({ pins: Schema.Array(Pin) });

export const PinsGroup = HttpApiGroup.make('pins')
  .add(
    HttpApiEndpoint.get('list', '/pins', {
      query: ListPinsQuery,
      success: PinList,
    }).annotate(HttpApi.QueryParseOptions, { onExcessProperty: 'error' }),
    HttpApiEndpoint.post('create', '/pins', {
      payload: CreatePinPayload,
      success: Pin.pipe(HttpApiSchema.status(201)),
    })
      .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' })
      .middleware(PinsWriteRateLimit),
    // Unpinning echoes the deleted row, so a client removes it without a refetch.
    HttpApiEndpoint.delete('remove', '/pins/:id', {
      params: { id: Schema.String },
      success: Pin,
    }).middleware(PinsWriteRateLimit),
  )
  .middleware(Session)
  .middleware(SchemaErrors)
  // The edge forwards the full request path, so the group keeps the `/api` prefix.
  .prefix('/api');

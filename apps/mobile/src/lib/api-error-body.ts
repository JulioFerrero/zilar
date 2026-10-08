import { Exit, Schema, SchemaGetter } from 'effect';
import { struct } from '@zilar/protocol';

/**
 * The one shared decode of the server's error envelope
 * `{ error: { code, message } }` for every Effect mobile API client. A
 * malformed `code` must not discard a valid `message` (and vice versa), and a
 * missing or malformed envelope keeps the caller's fixed fallbacks, as the old
 * per-field guards did before the Effect conversion.
 */

const LenientErrorStringSchema = Schema.Unknown.pipe(
  Schema.decodeTo(Schema.UndefinedOr(Schema.String), {
    decode: SchemaGetter.transform((value) => (typeof value === 'string' ? value : undefined)),
    encode: SchemaGetter.transform((value) => value),
  }),
);

export const ErrorBodySchema = struct({
  error: struct({
    code: Schema.optional(LenientErrorStringSchema),
    message: Schema.optional(LenientErrorStringSchema),
  }),
});

export interface ErrorFields {
  readonly code?: string;
  readonly message?: string;
}

/**
 * Reads `code` and `message` out of a raw body. A non-string field becomes
 * `undefined` on its own and a missing or non-object `error` gives both
 * `undefined`, so the caller's `?? 'request_failed'` / `Request failed (N)`
 * fallbacks apply per field.
 */
export function errorFieldsOf(body: unknown): ErrorFields {
  const decoded = Schema.decodeUnknownExit(ErrorBodySchema)(body);
  if (!Exit.isSuccess(decoded)) {
    return {};
  }
  const error = decoded.value.error;
  return {
    ...(error.code === undefined ? {} : { code: error.code }),
    ...(error.message === undefined ? {} : { message: error.message }),
  };
}

import { Exit, Schema, SchemaGetter } from 'effect';
import { struct } from '@zilar/protocol';

/**
 * Decodes `{ error: { code, message } }`: a malformed field must not discard a valid one, and a missing envelope keeps the caller's fixed fallbacks.
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
 * A non-string field becomes `undefined` on its own, so the caller's per-field fallbacks apply.
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

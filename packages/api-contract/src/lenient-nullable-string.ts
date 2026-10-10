import { Effect, Schema, SchemaGetter } from 'effect';

/**
 * A response field that is a string or `null`. A missing, `undefined` or
 * non-string value decodes to `null` instead of failing the row, so an older
 * or newer server never breaks a whole list. Encoding (the server side) passes
 * the value through.
 */
export const LenientNullableString = Schema.Unknown.pipe(
  Schema.withDecodingDefault(Effect.succeed(null)),
  Schema.decodeTo(Schema.NullOr(Schema.String), {
    decode: SchemaGetter.transform((value) => (typeof value === 'string' ? value : null)),
    encode: SchemaGetter.transform((value) => value),
  }),
);

/**
 * Like {@link LenientNullableString}, but an absent key stays absent, so an
 * older server's payload is told apart from an explicit `null`.
 */
export const LenientOptionalNullableString = Schema.optional(
  Schema.Unknown.pipe(
    Schema.decodeTo(Schema.NullOr(Schema.String), {
      decode: SchemaGetter.transform((value) => (typeof value === 'string' ? value : null)),
      encode: SchemaGetter.transform((value) => value),
    }),
  ),
);

import { Effect, Schema, SchemaGetter } from 'effect';

// A missing, `undefined` or non-string value decodes to `null` instead of failing the row, so a server never breaks a whole list.
export const LenientNullableString = Schema.Unknown.pipe(
  Schema.withDecodingDefault(Effect.succeed(null)),
  Schema.decodeTo(Schema.NullOr(Schema.String), {
    decode: SchemaGetter.transform((value) => (typeof value === 'string' ? value : null)),
    encode: SchemaGetter.transform((value) => value),
  }),
);

// Like `LenientNullableString`, but an absent key stays absent, so an older payload is told apart from an explicit `null`.
export const LenientOptionalNullableString = Schema.optional(
  Schema.Unknown.pipe(
    Schema.decodeTo(Schema.NullOr(Schema.String), {
      decode: SchemaGetter.transform((value) => (typeof value === 'string' ? value : null)),
      encode: SchemaGetter.transform((value) => value),
    }),
  ),
);

import { Schema, SchemaGetter } from 'effect';

/**
 * A response-side enum that tolerates version skew: any value outside
 * `literals` decodes to `fallback` instead of failing the whole response, so
 * a newer server never breaks an older app. Encoding (the server side) only
 * accepts the listed literals.
 */
export function lenientLiterals<const L extends ReadonlyArray<string>>(
  literals: L,
  fallback: L[number],
) {
  const isMember = (value: unknown): value is L[number] =>
    typeof value === 'string' && literals.includes(value);
  return Schema.Unknown.pipe(
    Schema.decodeTo(Schema.Literals(literals), {
      decode: SchemaGetter.transform((value) => (isMember(value) ? value : fallback)),
      encode: SchemaGetter.transform((value) => value),
    }),
  );
}

/**
 * A response-side array that keeps the good rows: an element that fails
 * `item`'s decode is dropped instead of failing the whole response, so one
 * bad row never costs the page. A value that is not an array still fails.
 * Encoding (the server side) is strict: every row must match `item`.
 */
export function lenientArray<S extends Schema.Top & { readonly DecodingServices: never }>(item: S) {
  const isRow = (value: unknown): boolean =>
    Schema.decodeUnknownExit(item as unknown as Schema.Decoder<unknown>)(value)._tag === 'Success';
  return Schema.Unknown.pipe(
    Schema.decodeTo(Schema.Array(item), {
      // A non-array passes through unchanged, so `Schema.Array` rejects it.
      decode: SchemaGetter.transform(
        (value) => (Array.isArray(value) ? value.filter(isRow) : value) as readonly S['Encoded'][],
      ),
      encode: SchemaGetter.transform((value) => value),
    }),
  );
}

/**
 * An optional response string that tolerates a value of the wrong type: it
 * decodes to `undefined` instead of failing the response. Encoding passes the
 * value through.
 */
export const LenientOptionalString = Schema.optional(
  Schema.Unknown.pipe(
    Schema.decodeTo(Schema.UndefinedOr(Schema.String), {
      decode: SchemaGetter.transform((value) => (typeof value === 'string' ? value : undefined)),
      encode: SchemaGetter.transform((value) => value),
    }),
  ),
);

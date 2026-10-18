import { Schema, SchemaGetter } from 'effect';

// Any value outside `literals` decodes to `fallback` instead of failing the response, so a newer server never breaks an older app.
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

// Keeps the good rows: an element that fails `item` is dropped instead of failing the page; a value that is not an array still fails.
export function lenientArray<S extends Schema.Top & { readonly DecodingServices: never }>(item: S) {
  const isRow = (value: unknown): boolean =>
    Schema.decodeUnknownExit(item as unknown as Schema.Decoder<unknown>)(value)._tag === 'Success';
  return Schema.Unknown.pipe(
    Schema.decodeTo(Schema.Array(item), {
      decode: SchemaGetter.transform(
        (value) => (Array.isArray(value) ? value.filter(isRow) : value) as readonly S['Encoded'][],
      ),
      encode: SchemaGetter.transform((value) => value),
    }),
  );
}

// An optional string of the wrong type decodes to `undefined` instead of failing the response.
export const LenientOptionalString = Schema.optional(
  Schema.Unknown.pipe(
    Schema.decodeTo(Schema.UndefinedOr(Schema.String), {
      decode: SchemaGetter.transform((value) => (typeof value === 'string' ? value : undefined)),
      encode: SchemaGetter.transform((value) => value),
    }),
  ),
);

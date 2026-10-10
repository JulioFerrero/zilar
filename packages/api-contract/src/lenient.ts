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

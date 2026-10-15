// Decode helpers shared by the server config schema (T-1457): the numeric and
// boolean bridges, the URL / pinned-image / non-empty filters, and the
// defaulted field builders. Split out of `config.ts` so `server-schema.ts`
// holds only the field map; imported through the `config.ts` barrel.

import { Effect, Schema, SchemaGetter } from 'effect';

// Decode helpers shared by the string-to-number fields (the ports and the
// trusted-proxy hop count). `Number.parseInt` never throws; the numeric checks
// below reject a NaN result at the field path, so a value never reaches the
// output.
export const toInt = SchemaGetter.transform((value: string) => Number.parseInt(value, 10));
export const toText = SchemaGetter.transform((value: number) => String(value));

// `z.url()` accepts any absolute URL; the boolean predicate form keeps the
// failure anonymous so `formatIssues` renders it as `invalid`, never echoing
// the value. `false` is a failure, `true` a success.
function isAnyUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

// The custom message is written in code and never contains the value, so a
// non-postgres connection string can never leak through a configuration error.
function isPostgresUrl(value: string): string | undefined {
  return /^postgres(ql)?:\/\//.test(value) ? undefined : 'invalid database url';
}

export const anyUrlSchema = Schema.String.pipe(Schema.check(Schema.makeFilter(isAnyUrl)));
export const databaseUrlSchema = Schema.String.pipe(Schema.check(Schema.makeFilter(isPostgresUrl)));
export const nonEmptyStringSchema = Schema.String.pipe(Schema.check(Schema.isMinLength(1)));
// A pinned reference (`<name>@sha256:<64 hex>`); a tag-only value is refused.
function isPinnedImage(value: string): string | undefined {
  return /^[^@\s]+@sha256:[0-9a-f]{64}$/.test(value) ? undefined : 'invalid pinned image';
}
export const pinnedImageSchema = Schema.String.pipe(Schema.check(Schema.makeFilter(isPinnedImage)));

// A key that is absent (or `undefined`) falls back to `fallback`, matching
// zod's `.default()` / preprocess `?? default` behaviour, and the decoded type
// has the key required.
export function withDefault<S extends Schema.Constraint>(schema: S, fallback: S['Encoded']) {
  return Schema.withDecodingDefaultKey<S>(Effect.succeed(fallback))(schema);
}

export function literalWithDefault<const L extends ReadonlyArray<string>>(
  literals: L,
  fallback: L[number],
) {
  return withDefault(Schema.Literals(literals), fallback);
}

// A port in [1, 65535], parsed from a digit-only string. Empty/garbage fails
// the pattern, out-of-range numbers fail the bounds; both render as `invalid`.
export function portSchema(defaultPort: string) {
  return withDefault(
    Schema.String.pipe(
      Schema.check(Schema.isPattern(/^\d+$/)),
      Schema.decodeTo(Schema.Int, { decode: toInt, encode: toText }),
      Schema.check(Schema.isGreaterThanOrEqualTo(1)),
      Schema.check(Schema.isLessThanOrEqualTo(65535)),
    ),
    defaultPort,
  );
}

// `'true'`/`'false'` string flag decoded to a boolean; anything else is invalid.
export function booleanFlagSchema() {
  return Schema.Literals(['true', 'false']).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed('false')),
    Schema.decodeTo(Schema.Boolean, {
      decode: SchemaGetter.transform((value: 'true' | 'false') => value === 'true'),
      encode: SchemaGetter.transform((value: boolean) => (value ? 'true' : 'false')),
    }),
  );
}

export const webOriginsSchema = Schema.String.pipe(
  Schema.decodeTo(
    Schema.Array(Schema.String.pipe(Schema.check(Schema.makeFilter(isAnyUrl)))).pipe(
      Schema.check(Schema.isMinLength(1)),
    ),
    {
      decode: SchemaGetter.transform((value: string) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter((origin) => origin.length > 0),
      ),
      encode: SchemaGetter.transform((origins: ReadonlyArray<string>) => origins.join(',')),
    },
  ),
);

// `LISTENER_MODEL` is trimmed before its length checks, so a whitespace-only
// value fails `min(1)` instead of surviving as a blank model name.
export const listenerModelSchema = Schema.String.pipe(
  Schema.decodeTo(Schema.String, {
    decode: SchemaGetter.transform((value: string) => value.trim()),
    encode: SchemaGetter.transform((value: string) => value),
  }),
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(256)),
);

// `AGENT_TOOL_MAX_ROUNDS` is a string, empty meaning unset; the value is
// parsed to a number (and the tools-on/off fallback applied) after decoding.
export const agentToolRoundsSchema = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^([1-9]|10)?$/)),
);

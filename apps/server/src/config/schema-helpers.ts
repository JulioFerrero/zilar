import { Effect, Schema, SchemaGetter } from 'effect';

// `Number.parseInt` never throws; the checks below reject a NaN result at the field path.
export const toInt = SchemaGetter.transform((value: string) => Number.parseInt(value, 10));
export const toText = SchemaGetter.transform((value: number) => String(value));

// The boolean predicate keeps the failure anonymous, so `formatIssues` renders `invalid`
// without echoing the value.
function isAnyUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

// The message is code-written and never contains the value, so a connection string cannot
// leak through a config error.
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

export function withDefault<S extends Schema.Constraint>(schema: S, fallback: S['Encoded']) {
  return Schema.withDecodingDefaultKey<S>(Effect.succeed(fallback))(schema);
}

export function literalWithDefault<const L extends ReadonlyArray<string>>(
  literals: L,
  fallback: L[number],
) {
  return withDefault(Schema.Literals(literals), fallback);
}

// A port in [1, 65535] parsed from digit-only; empty/garbage or out-of-range both render
// as `invalid`.
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

// `'true'`/`'false'` decoded to a boolean; anything else is invalid.
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

// Trimmed before the length checks, so a whitespace-only value fails `min(1)`.
export const listenerModelSchema = Schema.String.pipe(
  Schema.decodeTo(Schema.String, {
    decode: SchemaGetter.transform((value: string) => value.trim()),
    encode: SchemaGetter.transform((value: string) => value),
  }),
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(256)),
);

// Empty means unset; the value is parsed and the tools-on/off fallback applied after
// decoding.
export const agentToolRoundsSchema = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^([1-9]|10)?$/)),
);

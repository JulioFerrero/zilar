import { Exit, Schema } from 'effect';

// Strict objects reject unknown keys only when decoded with this option; the
// helpers below apply it so `isValid` / `decodeOrThrow` keep the old zod
// `strictObject` behaviour everywhere in this package.
const STRICT_PARSE_OPTIONS = { onExcessProperty: 'error' } as const;

// zod object fields are mutable; Effect `Struct` fields are readonly by
// default. Consumers strip keys with `delete`, so every struct field is
// wrapped with `mutableKey` to keep the exported types the same shape.
type MutableFields<F extends Schema.Struct.Fields> = {
  readonly [K in keyof F]: Schema.mutableKey<F[K]>;
};

export function struct<const F extends Schema.Struct.Fields>(
  fields: F,
): Schema.Struct<MutableFields<F>> {
  const wrapped: Record<string, Schema.Constraint> = {};
  for (const [key, value] of Object.entries(fields)) {
    wrapped[key] = Schema.mutableKey(value);
  }
  return Schema.Struct(wrapped as MutableFields<F>);
}

export function isValid<const S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
): (input: unknown) => input is S['Type'] {
  return (input): input is S['Type'] =>
    Exit.isSuccess(Schema.decodeUnknownExit(schema, STRICT_PARSE_OPTIONS)(input));
}

export function decodeOrThrow<const S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
): (input: unknown) => S['Type'] {
  const decode = Schema.decodeUnknownSync(schema, STRICT_PARSE_OPTIONS);
  return (input) => decode(input);
}

// Bare JIDs only (`local@domain`); full JIDs with a resource are not accepted by design.
const JID_MAX_LENGTH = 3071;

export function isJid(value: string): boolean {
  return (
    value.length >= 1 &&
    value.length <= JID_MAX_LENGTH &&
    value.split('@').length === 2 &&
    !/\s/.test(value)
  );
}

export const JidSchema = Schema.String.pipe(
  Schema.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(JID_MAX_LENGTH),
    Schema.makeFilter((value) =>
      value.split('@').length === 2 ? undefined : 'a JID must contain exactly one @',
    ),
    Schema.makeFilter((value) =>
      /\s/.test(value) ? 'a JID must not contain whitespace' : undefined,
    ),
  ),
);

export type Jid = typeof JidSchema.Type;

export const IdSchema = Schema.String.pipe(
  Schema.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(128),
    Schema.isPattern(/^[A-Za-z0-9._~-]+$/),
  ),
);

export type Id = typeof IdSchema.Type;

// ISO 8601 datetime with a timezone, mirroring zod's `z.iso.datetime({ offset: true })`.
const ISO_DATE_SOURCE =
  '(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))';
const ISO_DATETIME_PATTERN = new RegExp(
  `^${ISO_DATE_SOURCE}T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z|[+-](?:[01]\\d|2[0-3]):[0-5]\\d)$`,
);

export const IsoDateTimeSchema = Schema.String.pipe(
  Schema.check(Schema.isPattern(ISO_DATETIME_PATTERN)),
);

export type IsoDateTime = typeof IsoDateTimeSchema.Type;

// Same shape but no numeric offset, mirroring zod's default `z.iso.datetime()`.
const ISO_DATETIME_ZULU_PATTERN = new RegExp(
  `^${ISO_DATE_SOURCE}T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?Z$`,
);

export const IsoDateTimeZuluSchema = Schema.String.pipe(
  Schema.check(Schema.isPattern(ISO_DATETIME_ZULU_PATTERN)),
);

export const CurrencySchema = Schema.Literals(['EUR', 'USD']);

export type Currency = typeof CurrencySchema.Type;

export const MoneySchema = struct({
  currency: CurrencySchema,
  amount: Schema.Number.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
});

export type Money = typeof MoneySchema.Type;

export const BudgetSchema = struct({
  currency: CurrencySchema,
  max: Schema.Number.pipe(Schema.check(Schema.isGreaterThan(0))),
});

export type Budget = typeof BudgetSchema.Type;

export const ArtifactKindSchema = Schema.Literals([
  'message',
  'screenshot',
  'pr',
  'preview',
  'file',
  'report',
]);

export type ArtifactKind = typeof ArtifactKindSchema.Type;

// The protocol package's lib is ES2023 only, so the DOM `URL` type is absent;
// reach the runtime constructor through `globalThis` without widening the lib.
type UrlLike = { readonly protocol: string };
const UrlConstructor = (globalThis as unknown as { URL: new (value: string) => UrlLike }).URL;

export function isHttpUrl(value: string): boolean {
  try {
    const url = new UrlConstructor(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function isUrl(value: string): boolean {
  try {
    new UrlConstructor(value);
    return true;
  } catch {
    return false;
  }
}

const HttpUrlSchema = Schema.String.pipe(
  Schema.check(
    Schema.isMaxLength(2048),
    Schema.makeFilter((value) => (isHttpUrl(value) ? undefined : 'must be an http(s) URL')),
  ),
);

export const ArtifactRefSchema = struct({
  kind: ArtifactKindSchema,
  ref: Schema.Union([IdSchema, HttpUrlSchema]),
});

export type ArtifactRef = typeof ArtifactRefSchema.Type;

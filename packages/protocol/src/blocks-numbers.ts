import { Schema } from 'effect';
import { struct } from './common';

// The shared helpers live in this file, the first group, because the four group files depend on them;
// declaring them in `blocks.ts` would make `blocks.ts` and the groups import each other, and an ESM cycle throws.
export const MAX_BLOCKS = 12;
export const MAX_BLOCK_BYTES = 16 * 1024;
export const MAX_TEXT = 120;
export const MAX_SHORT = 40;
export const MAX_ROWS = 24;
export const MAX_SERIES = 30;

export const Text = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_TEXT)),
);

export const ShortText = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_SHORT)),
);

export const NumberText = Schema.String.pipe(Schema.check(Schema.isMaxLength(MAX_SHORT)));

// A pre-formatted value and its direction: the client never formats money or dates; the AI sends the exact string.
export const ChangeSchema = struct({
  direction: Schema.Literals(['up', 'down', 'flat']),
  text: ShortText,
});

export type Change = typeof ChangeSchema.Type;

// The fixed lucide icon names, never emoji in app chrome; an unknown name fails the decode so a renderer never has to guess.
export const BlockIconSchema = Schema.Literals([
  'activity',
  'bell',
  'calendar',
  'chart',
  'check',
  'clock',
  'cloud-sun',
  'file',
  'gauge',
  'images',
  'info',
  'link',
  'list-checks',
  'loader',
  'map-pin',
  'mouse-pointer-click',
  'route',
  'sliders',
  'star',
  'table',
  'timer',
  'trending-up',
  'vote',
  'warning',
]);

export type BlockIcon = typeof BlockIconSchema.Type;

export const RatioSchema = Schema.Number.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(1)),
);

export const FiniteNumberSchema = Schema.Number.pipe(Schema.check(Schema.isFinite()));

// The protocol package's lib is ES2023 only, so the DOM `URL` type is absent; reach the runtime constructor through `globalThis`.
type UrlLike = { readonly protocol: string };
const UrlConstructor = (globalThis as unknown as { URL: new (value: string) => UrlLike }).URL;

// Only https links are allowed in blocks, unlike the http(s) `ArtifactRefSchema`.
export const HttpsUrlSchema = Schema.String.pipe(
  Schema.check(
    Schema.isMaxLength(2048),
    Schema.makeFilter((value) => {
      try {
        return new UrlConstructor(value).protocol === 'https:' ? undefined : 'must be an https URL';
      } catch {
        return 'must be an https URL';
      }
    }),
  ),
);

export const FigureBlockSchema = struct({
  kind: Schema.Literal('figure'),
  rows: Schema.mutable(
    Schema.Array(
      struct({
        label: Text,
        value: NumberText,
        change: Schema.optional(ChangeSchema),
      }),
    ),
  ).pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_ROWS))),
});

export type FigureBlock = typeof FigureBlockSchema.Type;

export const NumberBlockSchema = struct({
  kind: Schema.Literal('number'),
  label: Text,
  value: NumberText,
  code: Schema.optional(ShortText),
  change: Schema.optional(ChangeSchema),
  points: Schema.optional(
    Schema.mutable(Schema.Array(FiniteNumberSchema)).pipe(
      Schema.check(Schema.isMinLength(2), Schema.isMaxLength(MAX_SERIES)),
    ),
  ),
});

export type NumberBlock = typeof NumberBlockSchema.Type;

export const StatsBlockSchema = struct({
  kind: Schema.Literal('stats'),
  title: Schema.optional(Text),
  tiles: Schema.mutable(
    Schema.Array(
      struct({
        label: Text,
        value: NumberText,
        ratio: Schema.optional(RatioSchema),
      }),
    ),
  ).pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(6))),
});

export type StatsBlock = typeof StatsBlockSchema.Type;

export const TableBlockSchema = struct({
  kind: Schema.Literal('table'),
  title: Schema.optional(Text),
  columns: Schema.mutable(Schema.Array(Text)).pipe(
    Schema.check(Schema.isMinLength(1), Schema.isMaxLength(5)),
  ),
  rows: Schema.mutable(Schema.Array(Schema.mutable(Schema.Array(NumberText)))).pipe(
    Schema.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(MAX_ROWS),
      Schema.makeFilter((rows) => {
        const width = rows[0]?.length ?? 0;
        return rows.every((row) => row.length === width)
          ? undefined
          : 'table rows must all have the same length';
      }),
    ),
  ),
  total: Schema.optional(Schema.Boolean),
});

export type TableBlock = typeof TableBlockSchema.Type;

export const BarsBlockSchema = struct({
  kind: Schema.Literal('bars'),
  title: Schema.optional(Text),
  value: Schema.optional(NumberText),
  series: Schema.mutable(
    Schema.Array(
      struct({
        label: Text,
        value: FiniteNumberSchema,
        current: Schema.optional(Schema.Boolean),
      }),
    ),
  ).pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_SERIES))),
});

export type BarsBlock = typeof BarsBlockSchema.Type;

export const LineBlockSchema = struct({
  kind: Schema.Literal('line'),
  title: Schema.optional(Text),
  value: Schema.optional(NumberText),
  points: Schema.mutable(Schema.Array(FiniteNumberSchema)).pipe(
    Schema.check(Schema.isMinLength(2), Schema.isMaxLength(MAX_SERIES)),
  ),
  min: Schema.optional(FiniteNumberSchema),
  max: Schema.optional(FiniteNumberSchema),
  labels: Schema.optional(
    Schema.mutable(Schema.Array(ShortText)).pipe(Schema.check(Schema.isMaxLength(6))),
  ),
});

export type LineBlock = typeof LineBlockSchema.Type;

export const GaugeBlockSchema = struct({
  kind: Schema.Literal('gauge'),
  label: Text,
  ratio: RatioSchema,
  value: NumberText,
  caption: Schema.optional(ShortText),
  detail: Schema.optional(ShortText),
});

export type GaugeBlock = typeof GaugeBlockSchema.Type;

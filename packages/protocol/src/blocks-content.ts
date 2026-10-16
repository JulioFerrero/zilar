import { Schema } from 'effect';
import { IdSchema, IsoDateTimeSchema, struct } from './common';
import { HttpsUrlSchema, NumberText, ShortText, Text } from './blocks-numbers';

// 19 · LINK CARD: one https link, no images and no HTML.
export const LinkBlockSchema = struct({
  kind: Schema.Literal('link'),
  url: HttpsUrlSchema,
  site: Schema.optional(ShortText),
  title: Text,
  description: Schema.optional(Schema.String.pipe(Schema.check(Schema.isMaxLength(300)))),
});

export type LinkBlock = typeof LinkBlockSchema.Type;

// 20 · IMAGES: uploaded media ids, never URLs, so a card cannot be a tracker.
export const ImagesBlockSchema = struct({
  kind: Schema.Literal('images'),
  items: Schema.mutable(Schema.Array(IdSchema)).pipe(
    Schema.check(Schema.isMinLength(1), Schema.isMaxLength(4)),
  ),
  extra: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))),
});

export type ImagesBlock = typeof ImagesBlockSchema.Type;

// 21 · PLACE: a title and an optional map image and directions link.
export const PlaceBlockSchema = struct({
  kind: Schema.Literal('place'),
  title: Text,
  subtitle: Schema.optional(ShortText),
  map: Schema.optional(IdSchema),
  url: Schema.optional(HttpsUrlSchema),
});

export type PlaceBlock = typeof PlaceBlockSchema.Type;

// 22 · WEATHER: now, plus up to six hourly entries.
export const WeatherBlockSchema = struct({
  kind: Schema.Literal('weather'),
  place: Text,
  condition: ShortText,
  high: NumberText,
  low: NumberText,
  temp: NumberText,
  hourly: Schema.optional(
    Schema.mutable(
      Schema.Array(
        struct({
          at: ShortText,
          condition: ShortText,
          temp: NumberText,
        }),
      ),
    ).pipe(Schema.check(Schema.isMaxLength(6))),
  ),
});

export type WeatherBlock = typeof WeatherBlockSchema.Type;

// 23 · EVENT: a time range with optional calendar and map keys.
export const EventBlockSchema = struct({
  kind: Schema.Literal('event'),
  title: Text,
  startAt: IsoDateTimeSchema,
  endAt: IsoDateTimeSchema,
  detail: Schema.optional(ShortText),
  calendar: Schema.optional(Schema.Boolean),
  map: Schema.optional(IdSchema),
});

export type EventBlock = typeof EventBlockSchema.Type;

// 24 · FILE: an uploaded media id and its display metadata. The file's format
// is `format`, not `kind`, because `kind` is the block discriminator.
export const FileBlockSchema = struct({
  kind: Schema.Literal('file'),
  media: IdSchema,
  name: Text,
  size: ShortText,
  format: ShortText,
  rows: Schema.optional(NumberText),
});

export type FileBlock = typeof FileBlockSchema.Type;

// 25 · CALLOUT: one tone, one line, an optional time.
export const CalloutBlockSchema = struct({
  kind: Schema.Literal('callout'),
  tone: Schema.Literals(['success', 'warning', 'error', 'info']),
  text: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(300))),
});

export type CalloutBlock = typeof CalloutBlockSchema.Type;

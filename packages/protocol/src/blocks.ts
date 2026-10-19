import { Schema } from 'effect';
import { IdSchema, IsoDateTimeSchema, struct } from './common';
import {
  BarsBlockSchema,
  BlockIconSchema,
  FigureBlockSchema,
  GaugeBlockSchema,
  HttpsUrlSchema,
  LineBlockSchema,
  MAX_BLOCKS,
  MAX_BLOCK_BYTES,
  MAX_ROWS,
  NumberBlockSchema,
  NumberText,
  RatioSchema,
  ShortText,
  StatsBlockSchema,
  TableBlockSchema,
  Text,
} from './blocks-numbers';
const hasUniqueIds = (ids: readonly string[]): boolean => new Set(ids).size === ids.length;

const IndexSchema = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));

const CountSchema = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));

export const ButtonsBlockSchema = struct({
  kind: Schema.Literal('buttons'),
  id: IdSchema,
  text: Text,
  actions: Schema.mutable(
    Schema.Array(
      struct({
        id: IdSchema,
        label: Text,
        style: Schema.Literals(['light', 'dark']),
      }),
    ),
  ).pipe(
    Schema.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(4),
      Schema.makeFilter((actions) =>
        hasUniqueIds(actions.map((action) => action.id))
          ? undefined
          : 'button action ids must be unique',
      ),
    ),
  ),
  chosen: Schema.optional(
    struct({
      actionId: IdSchema,
      by: Schema.optional(Text),
      at: IsoDateTimeSchema,
    }),
  ),
}).pipe(
  Schema.check(
    Schema.makeFilter((block) => {
      const chosen = block.chosen;
      if (chosen === undefined || block.actions.some((action) => action.id === chosen.actionId)) {
        return undefined;
      }
      return 'buttons chosen actionId must name an action';
    }),
  ),
);

export type ButtonsBlock = typeof ButtonsBlockSchema.Type;

export const PollBlockSchema = struct({
  kind: Schema.Literal('poll'),
  id: IdSchema,
  question: Text,
  options: Schema.mutable(
    Schema.Array(
      struct({
        id: IdSchema,
        label: Text,
        votes: Schema.optional(CountSchema),
      }),
    ),
  ).pipe(
    Schema.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(8),
      Schema.makeFilter((options) =>
        hasUniqueIds(options.map((option) => option.id))
          ? undefined
          : 'poll block option ids must be unique',
      ),
    ),
  ),
  votes: Schema.optional(CountSchema),
  multiple: Schema.optional(Schema.Boolean),
});

export type PollBlock = typeof PollBlockSchema.Type;

export const ChoiceBlockSchema = struct({
  kind: Schema.Literal('choice'),
  id: IdSchema,
  question: Text,
  options: Schema.mutable(Schema.Array(Text)).pipe(
    Schema.check(Schema.isMinLength(2), Schema.isMaxLength(5)),
  ),
  selected: Schema.optional(IndexSchema),
});

export type ChoiceBlock = typeof ChoiceBlockSchema.Type;

export const FormBlockSchema = struct({
  kind: Schema.Literal('form'),
  id: IdSchema,
  title: Schema.optional(Text),
  fields: Schema.mutable(
    Schema.Array(
      struct({
        id: IdSchema,
        label: Text,
        kind: Schema.Literals(['text', 'number', 'date']),
        value: Schema.optional(NumberText),
      }),
    ),
  ).pipe(
    Schema.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(4),
      Schema.makeFilter((fields) =>
        hasUniqueIds(fields.map((field) => field.id)) ? undefined : 'form field ids must be unique',
      ),
    ),
  ),
  submit: ShortText,
  sent: Schema.optional(
    struct({
      by: Schema.optional(Text),
      at: IsoDateTimeSchema,
    }),
  ),
});

export type FormBlock = typeof FormBlockSchema.Type;

export const RatingBlockSchema = struct({
  kind: Schema.Literal('rating'),
  id: IdSchema,
  prompt: Text,
  max: Schema.Int.pipe(
    Schema.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(5)),
  ),
  selected: Schema.optional(IndexSchema),
});

export type RatingBlock = typeof RatingBlockSchema.Type;

export const AlertBlockSchema = struct({
  kind: Schema.Literal('alert'),
  id: IdSchema,
  title: Text,
  field: struct({
    label: Text,
    value: NumberText,
  }),
  on: Schema.Boolean,
  note: Schema.optional(ShortText),
});

export type AlertBlock = typeof AlertBlockSchema.Type;

// The shared helpers and caps live in `blocks-numbers.ts`, the first group; this file aggregates the groups so nothing has to import back into it.
export * from './blocks-numbers';

export const LinkBlockSchema = struct({
  kind: Schema.Literal('link'),
  url: HttpsUrlSchema,
  site: Schema.optional(ShortText),
  title: Text,
  description: Schema.optional(Schema.String.pipe(Schema.check(Schema.isMaxLength(300)))),
});

export type LinkBlock = typeof LinkBlockSchema.Type;

// Uploaded media ids, never URLs, so a card cannot be a tracker.
export const ImagesBlockSchema = struct({
  kind: Schema.Literal('images'),
  items: Schema.mutable(Schema.Array(IdSchema)).pipe(
    Schema.check(Schema.isMinLength(1), Schema.isMaxLength(4)),
  ),
  extra: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))),
});

export type ImagesBlock = typeof ImagesBlockSchema.Type;

export const PlaceBlockSchema = struct({
  kind: Schema.Literal('place'),
  title: Text,
  subtitle: Schema.optional(ShortText),
  map: Schema.optional(IdSchema),
  url: Schema.optional(HttpsUrlSchema),
});

export type PlaceBlock = typeof PlaceBlockSchema.Type;

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

// The file's format is `format`, not `kind`, because `kind` is the block discriminator.
export const FileBlockSchema = struct({
  kind: Schema.Literal('file'),
  media: IdSchema,
  name: Text,
  size: ShortText,
  format: ShortText,
  rows: Schema.optional(NumberText),
});

export type FileBlock = typeof FileBlockSchema.Type;

export const CalloutBlockSchema = struct({
  kind: Schema.Literal('callout'),
  tone: Schema.Literals(['success', 'warning', 'error', 'info']),
  text: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(300))),
});

export type CalloutBlock = typeof CalloutBlockSchema.Type;

export const ChecklistBlockSchema = struct({
  kind: Schema.Literal('checklist'),
  id: IdSchema,
  title: Text,
  items: Schema.mutable(
    Schema.Array(
      struct({
        id: IdSchema,
        label: Text,
        done: Schema.Boolean,
        by: Schema.optional(Text),
      }),
    ),
  ).pipe(
    Schema.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(MAX_ROWS),
      Schema.makeFilter((items) =>
        new Set(items.map((item) => item.id)).size === items.length
          ? undefined
          : 'checklist item ids must be unique',
      ),
    ),
  ),
});

export type ChecklistBlock = typeof ChecklistBlockSchema.Type;

export const ProgressBlockSchema = struct({
  kind: Schema.Literal('progress'),
  label: Text,
  ratio: RatioSchema,
  detail: Schema.optional(ShortText),
  note: Schema.optional(ShortText),
});

export type ProgressBlock = typeof ProgressBlockSchema.Type;

export const TimelineBlockSchema = struct({
  kind: Schema.Literal('timeline'),
  title: Text,
  steps: Schema.mutable(
    Schema.Array(
      struct({
        label: Text,
        at: Schema.optional(ShortText),
        detail: Schema.optional(ShortText),
        state: Schema.Literals(['done', 'current', 'todo']),
      }),
    ),
  ).pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(12))),
});

export type TimelineBlock = typeof TimelineBlockSchema.Type;

// `IsoDateTimeSchema` already pins the shape; the filter additionally drops a target the client's `Date.parse` could not read.
const TargetAtSchema = IsoDateTimeSchema.pipe(
  Schema.check(
    Schema.makeFilter((value) =>
      Number.isFinite(Date.parse(value)) ? undefined : 'targetAt must be a parsable date-time',
    ),
  ),
);

export const CountdownBlockSchema = struct({
  kind: Schema.Literal('countdown'),
  label: Text,
  targetAt: TargetAtSchema,
  note: Schema.optional(ShortText),
});

export type CountdownBlock = typeof CountdownBlockSchema.Type;

export const StatusBlockSchema = struct({
  kind: Schema.Literal('status'),
  title: Text,
  rows: Schema.mutable(
    Schema.Array(
      struct({
        label: Text,
        status: Schema.Literals(['ok', 'warn', 'bad']),
        value: Schema.optional(ShortText),
      }),
    ),
  ).pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_ROWS))),
});

export type StatusBlock = typeof StatusBlockSchema.Type;

export const BlockSchema = Schema.Union([
  FigureBlockSchema,
  NumberBlockSchema,
  StatsBlockSchema,
  TableBlockSchema,
  BarsBlockSchema,
  LineBlockSchema,
  GaugeBlockSchema,
  ChecklistBlockSchema,
  ProgressBlockSchema,
  TimelineBlockSchema,
  CountdownBlockSchema,
  StatusBlockSchema,
  ButtonsBlockSchema,
  PollBlockSchema,
  ChoiceBlockSchema,
  FormBlockSchema,
  RatingBlockSchema,
  AlertBlockSchema,
  LinkBlockSchema,
  ImagesBlockSchema,
  PlaceBlockSchema,
  WeatherBlockSchema,
  EventBlockSchema,
  FileBlockSchema,
  CalloutBlockSchema,
]);

export type Block = typeof BlockSchema.Type;

export const BlocksDataSchema = struct({
  title: Schema.optional(Text),
  icon: Schema.optional(BlockIconSchema),
  meta: Schema.optional(ShortText),
  // Push, previews, the chat list, search, the memory indexer and old clients all read the message body, never the blocks.
  fallback: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(1000))),
  blocks: Schema.mutable(Schema.Array(BlockSchema)).pipe(
    Schema.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(MAX_BLOCKS),
      Schema.makeFilter((blocks) =>
        JSON.stringify(blocks).length > MAX_BLOCK_BYTES
          ? 'blocks exceed the 16 KiB limit'
          : undefined,
      ),
    ),
  ),
});

export type BlocksData = typeof BlocksDataSchema.Type;

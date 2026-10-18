import { Schema } from 'effect';
import { IdSchema, IsoDateTimeSchema, struct } from './common';
import { MAX_ROWS, RatioSchema, ShortText, Text } from './blocks-numbers';

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

import { Schema } from 'effect';
import { IdSchema, IsoDateTimeSchema, struct } from './common';
import { NumberText, ShortText, Text } from './blocks-numbers';

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

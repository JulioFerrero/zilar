import { Schema } from 'effect';
import { IdSchema, IsoDateTimeSchema, JidSchema, struct } from './common';

const hasUniqueIds = (ids: readonly string[]): boolean => new Set(ids).size === ids.length;

export const PollOptionSchema = struct({
  id: IdSchema,
  label: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(100))),
});

export type PollOption = typeof PollOptionSchema.Type;

export const PollSchema = struct({
  id: IdSchema,
  question: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(300))),
  options: Schema.mutable(Schema.Array(PollOptionSchema)).pipe(
    Schema.check(
      Schema.isMinLength(2),
      Schema.isMaxLength(10),
      Schema.makeFilter((options) =>
        hasUniqueIds(options.map((option) => option.id))
          ? undefined
          : 'poll option ids must be unique',
      ),
    ),
  ),
  multiple: Schema.Boolean,
  closes_at: Schema.optional(IsoDateTimeSchema),
});

export type Poll = typeof PollSchema.Type;

export const PollVoteSchema = struct({
  poll_id: IdSchema,
  option_ids: Schema.mutable(Schema.Array(IdSchema)).pipe(
    Schema.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(10),
      Schema.makeFilter((ids) =>
        hasUniqueIds(ids) ? undefined : 'poll vote option ids must be unique',
      ),
    ),
  ),
  voter: JidSchema,
});

export type PollVote = typeof PollVoteSchema.Type;

import { Schema } from 'effect';
import { IdSchema, IsoDateTimeSchema, JidSchema, MoneySchema, isHttpUrl, struct } from './common';

export const ProgressSchema = struct({
  ai: JidSchema,
  task_id: Schema.optional(IdSchema),
  stage: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(100))),
  detail: Schema.optional(Schema.String.pipe(Schema.check(Schema.isMaxLength(500)))),
  percent: Schema.optional(
    Schema.Int.pipe(
      Schema.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(100)),
    ),
  ),
});

export type Progress = typeof ProgressSchema.Type;

const HttpUrlSchema = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value) => (isHttpUrl(value) ? undefined : 'must be an http(s) URL')),
  ),
);

export const PreviewSchema = struct({
  ai: JidSchema,
  url: HttpUrlSchema,
  label: Schema.optional(Schema.String.pipe(Schema.check(Schema.isMaxLength(100)))),
  expires_at: Schema.optional(IsoDateTimeSchema),
});

export type Preview = typeof PreviewSchema.Type;

export const CostTokensSchema = struct({
  input: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  output: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
});

export const CostSchema = struct({
  ai: JidSchema,
  room: Schema.optional(JidSchema),
  amount: MoneySchema,
  tokens: Schema.optional(CostTokensSchema),
});

export type Cost = typeof CostSchema.Type;

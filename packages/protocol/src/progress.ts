import { Schema } from 'effect';
import { IdSchema, IsoDateTimeSchema, JidSchema, MoneySchema, isHttpUrl, struct } from './common';

// T-1414: one step of the task card. Fixed stage labels only; never model text
// or tool output. The server appends these as the turn runs.
export const ProgressStepSchema = struct({
  id: Schema.String.pipe(Schema.check(Schema.isMaxLength(64))),
  label: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(80))),
  state: Schema.Literals(['planned', 'doing', 'done', 'failed']),
});

export type ProgressStep = typeof ProgressStepSchema.Type;

// T-1414: the task card. `stage` stays required and unchanged; every task-card
// field is optional, so an old client still renders the stage text and an old
// server simply omits them (the payload struct is open).
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
  title: Schema.optional(Schema.String.pipe(Schema.check(Schema.isMaxLength(100)))),
  steps: Schema.optional(
    Schema.mutable(Schema.Array(ProgressStepSchema)).pipe(Schema.check(Schema.isMaxLength(20))),
  ),
  started_at: Schema.optional(IsoDateTimeSchema),
  elapsed_ms: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))),
  summary: Schema.optional(Schema.String.pipe(Schema.check(Schema.isMaxLength(200)))),
  state: Schema.optional(Schema.Literals(['working', 'done', 'failed', 'stopped'])),
  can_stop: Schema.optional(Schema.Boolean),
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

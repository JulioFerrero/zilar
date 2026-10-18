import { Schema } from 'effect';
import { struct } from './common';

// `id` is the `routines` row id; `schedule` is the schedule in words (`describeSchedule`).
export const RoutinePostSchema = struct({
  id: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(64))),
  title: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(80))),
  schedule: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(80))),
});

export type RoutinePost = typeof RoutinePostSchema.Type;

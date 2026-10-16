import { Schema } from 'effect';
import { struct } from './common';

// T-1721: the routine header a message belongs to. A routine's one live
// message (and every XEP-0308 edit of it) carries this payload, so a client
// can draw the repeat icon, the routine title and the schedule, and bump the
// chat on each edit. `id` is the `routines` row id, `schedule` the schedule in
// words (`describeSchedule`, e.g. "every 5 minutes").
export const RoutinePostSchema = struct({
  id: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(64))),
  title: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(80))),
  schedule: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(80))),
});

export type RoutinePost = typeof RoutinePostSchema.Type;

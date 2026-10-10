// T-0104: routine service. A routine is a stored tool plus a schedule in
// one topic (T-0110 scope: `groupId` + `topicId`, or both null for the
// personal chat with the AI's owner), posting the tool's output as the AI.
// `createRoutine` is called by the T-0105 adapter after a human approved;
// this task exposes no HTTP route that creates a routine.
//
// Every query runs on the `effect/sql` client registered for this database
// (see `../effect/sql`). The exported functions stay `async` so routes and
// tests keep their shape during the transition.
//
// T-0984 size split: the limits, error, types and title schema live in
// `./schemas`, the reads and row to view mapping in `./queries`, and the
// mutations in `./support`. This path stays the barrel so importers do not
// change.
export {
  MAX_ROUTINES_PER_TOPIC,
  MAX_ROUTINE_TITLE_CHARS,
  MAX_ROUTINE_INPUT_BYTES,
  RoutineServiceError,
} from './schemas';
export type {
  RoutineStatus,
  RoutinePausedReason,
  RoutineLastStatus,
  RoutineRow,
  CreateRoutineInput,
  PublicRoutine,
  PauseRoutineResult,
  ResumeRoutineResult,
  DeleteRoutineResult,
} from './schemas';

export { getRoutine, listRoutinesForAi, listRoutinesForTopic } from './queries';

export {
  createRoutine,
  pauseRoutine,
  resumeRoutine,
  deleteRoutine,
  deleteRoutinesForAiInTopic,
  deleteRoutinesForAiInGroupEffect,
  deleteRoutinesForTool,
} from './support';

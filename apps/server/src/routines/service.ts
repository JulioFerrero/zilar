// A routine is a stored tool plus a schedule in one topic (`groupId` + `topicId`, or both null for the personal chat), posting as the AI.
// `createRoutine` is called after a human approved; this module exposes no creating HTTP route.
// Every query runs on the `effect/sql` client registered for this database; exported functions stay `async`.
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

export { createRoutine, pauseRoutine, resumeRoutine, deleteRoutine } from './support';

export {
  deleteRoutinesForAiInTopic,
  deleteRoutinesForAiInGroupEffect,
  deleteRoutinesForTool,
} from './deletes';

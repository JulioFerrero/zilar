// T-0104: production wiring for the routines scheduler. `index.ts` calls
// `buildRoutineScheduler` after the server is listening and stops the
// handle on shutdown, like the other timers. The scheduler starts only
// when `ROUTINES_ENABLED=true` **and** a tool runner is configured: with
// the flag on and no runner it logs one warning and stays off (the unit
// tests cover this builder, not `index.ts`).
import type { AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import type { ToolRunner } from '../tools/types';
import {
  createRoutineScheduler,
  type RoutineLogger,
  type RoutineSchedulerHandle,
} from './scheduler';

export type { RoutineSchedulerHandle };

export interface BuildRoutineSchedulerDeps {
  db: ServerDatabase;
  routinesEnabled: boolean;
  /** Absent = no runner (T-0105 wires the sandbox): the scheduler stays off. */
  toolRunner?: ToolRunner;
  /** Posts as the AI (`postToChat` via the `gatewayRef` closure). */
  post: (input: {
    aiId: string;
    groupId: string | null;
    topicId?: string;
    text: string;
  }) => Promise<boolean>;
  audit: AuditRecorder;
  logger: RoutineLogger;
}

// Returns a started handle, or null when the scheduler must stay off. The
// single warning covers the misconfigured case (flag on, no runner); the
// flag-off case is silent, like the other feature flags.
export function buildRoutineScheduler(
  deps: BuildRoutineSchedulerDeps,
): RoutineSchedulerHandle | null {
  if (!deps.routinesEnabled) {
    return null;
  }
  if (deps.toolRunner === undefined) {
    deps.logger.warn(
      {},
      'ROUTINES_ENABLED=true but no tool runner is configured; the routines scheduler stays off',
    );
    return null;
  }
  const handle = createRoutineScheduler({
    db: deps.db,
    runTool: deps.toolRunner,
    post: deps.post,
    audit: deps.audit,
    logger: deps.logger,
  });
  handle.start();
  return handle;
}

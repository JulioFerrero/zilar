// T-0104: production wiring for the routines scheduler. `index.ts` calls
// `buildRoutineScheduler` after the server is listening and stops the
// handle on shutdown, like the other timers. The scheduler starts only
// when `ROUTINES_ENABLED=true` **and** a tool runner is configured: with
// the flag on and no runner it logs one warning and stays off (the unit
// tests cover this builder, not `index.ts`).
import type { Payload } from '@zilar/protocol';
import type { AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import type { ToolRunner } from '../tools/types';
import type { ExecuteRoutinePorts } from './execute';
import type { PromptRunner } from './execute-prompt';
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
    payload?: Payload;
  }) => Promise<boolean>;
  /** Runs a prompt routine through the gateway (`runScheduledTurn`); absent
   * while the gateway is null, so the run is recorded `skipped`. */
  runPrompt?: PromptRunner;
  /** T-1880: corrects a linked alert card in the room (`correctInRoom`). */
  correctCard?: ExecuteRoutinePorts['correctCard'];
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
    ...(deps.runPrompt === undefined ? {} : { runPrompt: deps.runPrompt }),
    ...(deps.correctCard === undefined ? {} : { correctCard: deps.correctCard }),
    audit: deps.audit,
    logger: deps.logger,
  });
  handle.start();
  return handle;
}

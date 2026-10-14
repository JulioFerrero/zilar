// effect-plain: the Promise edge over the Hands client (an async iterable); the
// tool executor wraps each call in `Effect.promise`.
import type { AiComputerMode } from '@zilar/api-contract';
import {
  DeskError,
  DeskQueued,
  MAX_COMMAND_TIMEOUT_MS,
  MAX_DISK_BYTES,
  MAX_MEMORY_BYTES,
  MAX_PIDS,
  type DeskRef,
  type Hands,
} from '@zilar/desk';
import type { ServerDatabase } from '../../db/client';
import { machineUsableFor, resolveDeskForAi, type RunnerDeskSource } from '../../hands/resolve';
import type { ToolExecution, ValidToolCall } from '../reply';
import { TOOL_RESULT_MAX_CHARS } from '../tool-loop';
import { TOOL_STAGE_WAITING_FOR_COMPUTER } from '../tool-guide';
import { formatModelText, type GatewayLogger } from './contracts';
import { isDeskToolName, type DeskToolName } from '../tools';

// T-1409: runs one desk tool call against the cloud `Hands` client. The plan's
// per-jail ceilings are sent on the first `provision` of a turn (`packages/desk`
// enforces them host-side); the desk outlives the turn and a second `provision`
// for the same `DeskKey` returns the live jail, so re-provisioning each turn is
// idempotent (design §2.3).
const OWNER_PROJECT_ID = 'default';
const DESK_CPU_SHARES = 512;
const DESK_TASK_WALL_CLOCK_MS = 30 * 60_000;

/** The cloud desk client: a Hands plus the pinned image the sidecar runs. */
export interface DeskClient {
  readonly hands: Hands;
  readonly imageDigest: string;
}

/** The per-turn desk context: the AI's owner, so `provision` can set it, and
 * the client resolved for this turn (the cloud sidecar or the AI's runner). */
export interface DeskTurnContext {
  readonly ownerUserId: string;
  readonly client?: DeskClient;
}

export type DeskToolCallValid = Extract<ValidToolCall, { tool: DeskToolName }>;

/** Narrows a validated call to one of the seven desk tools. */
export function isDeskToolCall(call: ValidToolCall): call is DeskToolCallValid {
  return isDeskToolName(call.tool);
}

/** One desk call for a turn: the shared runner, or `null` when it offered none. */
export type DeskRunner = (call: DeskToolCallValid) => Promise<ToolExecution>;

interface DeskRunnerInput {
  hands: Hands;
  imageDigest: string;
  aiId: string;
  ownerUserId: string;
  logger: GatewayLogger;
}

// Fixed sentences per daemon error code (never raw host text). `DeskQueued` is
// the "queued (n ahead)" case and is never a hard failure.
const DESK_ERROR_TEXT: Record<string, string> = {
  not_provisioned: 'your computer is not ready yet',
  queue_full: 'your computer is busy; try again shortly',
  jail_unavailable: 'your computer is unavailable right now',
  timeout: 'the command timed out',
  output_too_large: 'the output was too large',
  path_escape: 'refused: that path is outside the workspace',
  host_blocked: 'refused: that host is blocked',
  tool_failed: 'the tool failed',
};

function errorText(error: DeskError): string {
  return DESK_ERROR_TEXT[error.code] ?? 'the tool failed';
}

/**
 * One desk runner per turn: provisions on the first call, then reuses the ref
 * for the rest of the turn. The returned promise always resolves with a short
 * tool result; a failure stays in the model's context.
 */
export function createDeskRunner(input: DeskRunnerInput): DeskRunner {
  let ref: DeskRef | null = null;
  return async function run(call) {
    if (ref === null) {
      try {
        ref = await input.hands.provision({
          key: { aiId: input.aiId, projectId: OWNER_PROJECT_ID },
          ownerUserId: input.ownerUserId,
          imageDigest: input.imageDigest,
          limits: {
            memoryBytes: MAX_MEMORY_BYTES,
            pids: MAX_PIDS,
            cpuShares: DESK_CPU_SHARES,
            diskBytes: MAX_DISK_BYTES,
            commandTimeoutMs: MAX_COMMAND_TIMEOUT_MS,
            taskWallClockMs: DESK_TASK_WALL_CLOCK_MS,
          },
        });
      } catch (error) {
        return provisionFailure(error, call, input);
      }
    }
    try {
      return await runExecute(input.hands, ref, call);
    } catch (error) {
      return executeFailure(error, call, input);
    }
  };
}

/** Creates the turn's desk runner, or `null` when the turn did not offer the tools. */
export function createTurnDeskRunner(
  turn: DeskTurnContext | undefined,
  aiId: string,
  logger: GatewayLogger,
): DeskRunner | null {
  if (turn?.client === undefined) {
    return null;
  }
  return createDeskRunner({
    hands: turn.client.hands,
    imageDigest: turn.client.imageDigest,
    aiId,
    ownerUserId: turn.ownerUserId,
    logger,
  });
}

/** T-1423: the stage shown while `runner` mode waits for an offline runner. */
export const TOOL_STAGE_WAITING_FOR_YOUR_COMPUTER = 'Waiting for your computer';

export interface TurnDeskDeps {
  readonly db: ServerDatabase;
  readonly desk?: DeskClient | undefined;
  readonly runnerDesk?: (() => RunnerDeskSource | null) | undefined;
}

export interface DeskTurnInput {
  readonly computerMode: AiComputerMode;
  readonly machineId: string | null;
  readonly owner: string;
}

/** The computer a turn runs on: the resolved client, or none. `waiting` marks
 * `runner` mode whose runner is offline (the card says so). */
export interface TurnDesk {
  readonly client?: DeskClient;
  readonly waiting: boolean;
}

/** Resolves the AI's computer for one turn. Called per turn, so a runner that
 * goes offline is seen at once; no hub and no desk env stays `{ waiting: false }`. */
export async function resolveTurnDesk(deps: TurnDeskDeps, input: DeskTurnInput): Promise<TurnDesk> {
  const cloud = deps.desk ?? null;
  const hub = deps.runnerDesk?.() ?? null;
  if (cloud === null && hub === null) {
    return { waiting: false };
  }
  const resolved = await resolveDeskForAi({
    computerMode: input.computerMode,
    machineId: input.machineId,
    ownerId: input.owner,
    cloud,
    runnerImage: cloud?.imageDigest ?? null,
    hub,
    isMachineUsable: machineUsableFor(deps.db),
  });
  if ('unavailable' in resolved) {
    return {
      waiting: input.computerMode === 'runner' && resolved.unavailable === 'offline',
    };
  }
  return {
    client: { hands: resolved.hands, imageDigest: resolved.imageDigest },
    waiting: false,
  };
}

/** Runs one desk call; an improvised call on a turn that offered none is refused. */
export function runDeskCall(
  runner: DeskRunner | null,
  call: DeskToolCallValid,
): Promise<ToolExecution> {
  if (runner === null) {
    return Promise.resolve({ content: 'invalid: unknown tool' });
  }
  return runner(call);
}

async function runExecute(
  hands: Hands,
  ref: DeskRef,
  call: DeskToolCallValid,
): Promise<ToolExecution> {
  let output = '';
  let exitCode = 0;
  let truncated = false;
  for await (const chunk of hands.execute(ref, { tool: call.tool, args: call.args })) {
    if (chunk.type === 'exit') {
      exitCode = chunk.code;
      truncated = chunk.truncated;
    } else {
      output += chunk.data;
    }
  }
  const capped =
    output.length > TOOL_RESULT_MAX_CHARS
      ? `${output.slice(0, TOOL_RESULT_MAX_CHARS)}\n(truncated)`
      : output;
  const status =
    exitCode === 0 ? 'done' : `exit code ${exitCode}${truncated ? ' (truncated)' : ''}`;
  if (capped === '') {
    return { content: status };
  }
  return { content: `${status}${formatModelText(capped)}` };
}

function provisionFailure(
  error: unknown,
  call: DeskToolCallValid,
  input: DeskRunnerInput,
): ToolExecution {
  if (error instanceof DeskQueued) {
    input.logger.info(
      { aiId: input.aiId, tool: call.tool, stage: TOOL_STAGE_WAITING_FOR_COMPUTER, queued: true },
      'AI desk tool queued',
    );
    return {
      content: `Your computer is busy; queued (${error.position} ahead). Try again shortly.`,
      stage: TOOL_STAGE_WAITING_FOR_COMPUTER,
    };
  }
  if (error instanceof DeskError) {
    input.logger.warn(
      { aiId: input.aiId, tool: call.tool, code: error.code },
      'AI desk provision refused',
    );
    return { content: errorText(error) };
  }
  input.logger.warn({ aiId: input.aiId, tool: call.tool }, 'AI desk provision failed');
  return { content: 'your computer is unavailable right now' };
}

function executeFailure(
  error: unknown,
  call: DeskToolCallValid,
  input: DeskRunnerInput,
): ToolExecution {
  if (error instanceof DeskError) {
    input.logger.info(
      { aiId: input.aiId, tool: call.tool, code: error.code, ok: false },
      'AI desk tool refused',
    );
    return { content: errorText(error) };
  }
  input.logger.warn({ aiId: input.aiId, tool: call.tool }, 'AI desk tool failed');
  return { content: 'the tool failed' };
}

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

// Runs one desk tool call against the cloud `Hands` client. The plan's per-jail
// ceilings are sent on the first `provision` of a turn (`packages/desk`
// enforces them host-side); a second `provision` for the same `DeskKey` returns
// the live jail, so re-provisioning each turn is idempotent.
const OWNER_PROJECT_ID = 'default';
const DESK_CPU_SHARES = 512;
const DESK_TASK_WALL_CLOCK_MS = 30 * 60_000;

/** The cloud desk client: a Hands plus the pinned image the sidecar runs. */
export interface DeskClient {
  readonly hands: Hands;
  readonly imageDigest: string;
  /** A runner computer's owner check, re-run before each runner call. */
  readonly isUsable?: () => Promise<boolean>;
}

/** The per-turn desk context: the AI's owner, so `provision` can set it, and
 * the client resolved for this turn (the cloud sidecar or the AI's runner). */
export interface DeskTurnContext {
  readonly ownerUserId: string;
  readonly client?: DeskClient;
  /** The turn's abort signal, so a stopped turn kills its jail call. */
  readonly signal?: AbortSignal;
}

export type DeskToolCallValid = Extract<ValidToolCall, { tool: DeskToolName }>;

export function isDeskToolCall(call: ValidToolCall): call is DeskToolCallValid {
  return isDeskToolName(call.tool);
}

export type DeskRunner = (call: DeskToolCallValid) => Promise<ToolExecution>;

interface DeskRunnerInput {
  hands: Hands;
  imageDigest: string;
  aiId: string;
  ownerUserId: string;
  logger: GatewayLogger;
  /** The turn's abort signal, forwarded to every `execute` call. */
  signal?: AbortSignal;
  /** Re-checked before each runner call; a revoke stops the next one. */
  isUsable?: () => Promise<boolean>;
}

const COMPUTER_DISCONNECTED = 'This computer was disconnected.';

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
 * One desk runner per turn: provisions on the first call, then reuses the ref.
 * The returned promise always resolves with a short tool result; a failure
 * stays in the model's context.
 */
export function createDeskRunner(input: DeskRunnerInput): DeskRunner {
  let ref: DeskRef | null = null;
  return async function run(call) {
    if (input.isUsable !== undefined && !(await input.isUsable())) {
      return { content: COMPUTER_DISCONNECTED };
    }
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
      return await runExecute(input.hands, ref, call, input.signal);
    } catch (error) {
      return executeFailure(error, call, input);
    }
  };
}

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
    ...(turn.signal === undefined ? {} : { signal: turn.signal }),
    ...(turn.client.isUsable === undefined ? {} : { isUsable: turn.client.isUsable }),
  });
}

/** The stage shown while `runner` mode waits for an offline runner. */
export const TOOL_STAGE_WAITING_FOR_YOUR_COMPUTER = 'Waiting for your computer';

export interface TurnDeskDeps {
  readonly db: ServerDatabase;
  /** The cached cloud probe; awaited once per turn. Absent means no cloud
   * computer at all. */
  readonly desk?: (() => Promise<DeskClient | null>) | undefined;
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
  // The cloud client is a cached probe, awaited once per turn. A not-ready
  // agent is simply "no cloud computer", never a hard failure.
  const cloud = (await deps.desk?.()) ?? null;
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
  const machineId = input.machineId;
  const isUsable =
    resolved.where === 'runner' && machineId !== null
      ? () => machineUsableFor(deps.db)(machineId, input.owner)
      : undefined;
  return {
    client: {
      hands: resolved.hands,
      imageDigest: resolved.imageDigest,
      ...(isUsable === undefined ? {} : { isUsable }),
    },
    waiting: false,
  };
}

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
  signal?: AbortSignal,
): Promise<ToolExecution> {
  let output = '';
  let exitCode = 0;
  let truncated = false;
  const capAbort = new AbortController();
  const streamSignal =
    signal === undefined ? capAbort.signal : AbortSignal.any([signal, capAbort.signal]);
  try {
    for await (const chunk of hands.execute(
      ref,
      { tool: call.tool, args: call.args },
      streamSignal,
    )) {
      if (chunk.type === 'exit') {
        exitCode = chunk.code;
        truncated = chunk.truncated;
        continue;
      }
      // Keep at most one char past the cap, then stop reading and cut the
      // stream, so an endless producer cannot grow the result.
      const room = TOOL_RESULT_MAX_CHARS + 1 - output.length;
      output += chunk.data.length > room ? chunk.data.slice(0, room) : chunk.data;
      if (output.length > TOOL_RESULT_MAX_CHARS) {
        truncated = true;
        capAbort.abort();
        break;
      }
    }
  } catch (error) {
    if (!capAbort.signal.aborted) {
      throw error;
    }
  } finally {
    capAbort.abort();
  }
  const capped =
    output.length > TOOL_RESULT_MAX_CHARS
      ? `${output.slice(0, TOOL_RESULT_MAX_CHARS)}\n(truncated)`
      : output;
  const status =
    exitCode === 0 ? 'done' : `exit code ${exitCode}${truncated ? ' (truncated)' : ''}`;
  if (capped === '') {
    return { content: status, exitCode };
  }
  return { content: `${status}${formatModelText(capped)}`, exitCode };
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
  // A stop landed mid-call; the abort is expected, not a tool failure.
  if (input.signal?.aborted === true) {
    return { content: 'the tool call was stopped' };
  }
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

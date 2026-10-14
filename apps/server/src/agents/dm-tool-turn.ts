// effect-plain: moved unchanged from apps/server/src/agents/reply.ts (size split)
import type { FetchLike } from '../ai/http';
import type { ModelTarget } from '../ai/providers';
import type { ChatUsage } from '../ai/model-client';
import type { DmTurnDeps, DmTurnOutcome } from './dm-turn';
import type { GroupTurnDeps } from './group-turn';
import { cutShortSuffix } from './replies';
import {
  failureLogFields,
  mapFailureToReply,
  redactError,
  runLoopRound,
  actionOfCall,
} from './tool-exec';
import {
  ChatCompletionError,
  TOOL_TURN_MAX_CALLS,
  TOOL_TURN_WALL_CLOCK_MS,
  TRANSIENT_FAILURE_REPLY,
  requestCompletion,
  type ExecuteToolCall,
  type ModelRequestMessage,
} from './tool-loop';
import { remainingTurnBudgetMs } from './turn-budget';
import type { ChatToolDefinition } from './tools';
import { byteLength, type TurnLog } from './log/append';

// T-0106: the one shared multi-round tool loop for DM and group turns. No
// copy: both turns call this, differing only in their executor (groups wrap
// it with the advertised-tools guard) and their final sender (DM sends
// plain text, groups wire `@Name` + `replyTo`). Round 1 always offers
// tools, exactly like the legacy first call did; every round that asks for
// tool calls has them executed and fed back, until a round answers in text
// or the caps stop the loop. Rules that hold on EVERY round:
// - `checkRoundGate` runs before each model call: an over-budget or
//   stopped AI runs no further round and sends nothing (the caller sends
//   the gate's fixed reply, like a model failure);
// - the wall clock (`TOOL_TURN_WALL_CLOCK_MS`) and the total call cap
//   (`TOOL_TURN_MAX_CALLS`) stop the loop; when the rounds run out, the
//   last model call is made WITHOUT tools so the AI must answer in text
//   (`maxRounds: 1` keeps the legacy shape instead — see below);
// - a round that repeats the previous round's calls exactly gets the
//   "already done" result without executing;
// - tool results are truncated to `TOOL_RESULT_MAX_CHARS` and still arrive
//   inside `<untrusted-tool-output>`;
// - only counts (rounds, tool calls, ms) reach the log, never content —
//   the loop logs one counts line per turn, even when it throws.
// Progress posts only happen on multi-round turns (`maxRounds > 1`): a
// legacy single-round turn finishes in two calls and stays byte for byte.
//
// `maxRounds: 1` (the default) keeps today's behaviour byte for byte:
// round 1 offers tools, executes, and the caller makes exactly one more
// follow-up call WITH tools, answered from its text alone.
export async function runToolLoop(input: {
  aiId: string;
  messages: ModelRequestMessage[];
  tools: ChatToolDefinition[];
  completionInput: {
    target: ModelTarget;
    fetchImpl?: FetchLike;
    timeoutMs?: number;
    secrets?: readonly string[];
    onDelta?: (textSoFar: string) => void;
    onUsage?: (usage: ChatUsage) => void;
    log?: TurnLog;
  };
  maxRounds: number;
  executeTool?: ExecuteToolCall;
  executeAdvertised?: ExecuteToolCall;
  logger: { warn: (fields: Record<string, unknown>, message: string) => void };
  turnLogger: { info: (fields: Record<string, unknown>, message: string) => void };
  secrets: string[];
  checkRoundGate?: () => Promise<{ limited: boolean; reply: string } | null>;
  turnStartMs: number;
  nowMs: () => number;
  reportProgress?: (stage: string) => Promise<string | null>;
  actionOf?: (tool: string, argsJson: string) => string | undefined;
  /** T-1426: the turn's session log for the tool-call rows. */
  log?: TurnLog;
}): Promise<{
  text: string | null;
  notices: string[];
  failure: { reply: string } | null;
  rounds: number;
  toolCalls: number;
  messages: ModelRequestMessage[];
}> {
  const startedAt = input.turnStartMs;
  let messages = input.messages;
  let rounds = 0;
  let executedCalls = 0;
  const notices: string[] = [];
  let previousSignature: string | null = null;
  let progressPosted = false;
  // Progress and the counts line both key off multi-round turns; a legacy
  // single-round turn reports nothing and stays byte for byte.
  const multiRound = input.maxRounds > 1;

  try {
    for (let round = 1; round <= input.maxRounds; round += 1) {
      if (input.nowMs() - startedAt >= TOOL_TURN_WALL_CLOCK_MS) {
        break;
      }
      if (input.checkRoundGate !== undefined) {
        const gate = await input.checkRoundGate();
        if (gate !== null && gate.limited) {
          return {
            text: null,
            notices,
            failure: { reply: gate.reply },
            rounds,
            toolCalls: executedCalls,
            messages,
          };
        }
      }
      rounds += 1;
      const lastRound = round >= input.maxRounds;
      // Round 1 always offers tools, exactly like the legacy first call.
      // When the rounds run out, the last model call is made without tools
      // so the AI must answer in text — except the legacy single-round
      // shape (`maxRounds: 1`), whose follow-up call carries tools and is
      // answered from its text alone.
      const lastCall = lastRound && round > 1;
      const result = await requestCompletion({
        ...input.completionInput,
        timeoutMs: remainingTurnBudgetMs(startedAt, input.nowMs),
        messages,
        ...(lastCall ? {} : { tools: input.tools }),
      });
      if (result.toolCalls.length === 0) {
        // An empty first reply is a model failure, exactly like the legacy
        // turn: the caller maps it to the honest failure text. A later text
        // answer with no text falls back instead, plus any earned notices.
        if (result.content === null) {
          if (rounds <= 1) {
            throw new ChatCompletionError(200, 'empty reply from the model');
          }
          return {
            text: TRANSIENT_FAILURE_REPLY,
            notices,
            failure: null,
            rounds,
            toolCalls: executedCalls,
            messages,
          };
        }
        return {
          text: result.content + cutShortSuffix(result.finishReason),
          notices,
          failure: null,
          rounds,
          toolCalls: executedCalls,
          messages,
        };
      }
      if (lastCall) {
        // No tools were offered on the last call, so anything the model
        // improvises is answered from its text alone.
        return {
          text:
            result.content === null
              ? TRANSIENT_FAILURE_REPLY
              : result.content + cutShortSuffix(result.finishReason),
          notices,
          failure: null,
          rounds,
          toolCalls: executedCalls,
          messages,
        };
      }
      const step = await runLoopRound({
        aiId: input.aiId,
        messages,
        result,
        previousSignature,
        executedCalls,
        ...(input.executeTool === undefined ? {} : { executeTool: input.executeTool }),
        ...(input.executeAdvertised === undefined ? {} : { executeTool: input.executeAdvertised }),
        logger: input.logger,
        secrets: input.secrets,
        ...(input.reportProgress === undefined || !multiRound
          ? {}
          : { reportProgress: input.reportProgress }),
        progressPosted,
        ...(input.actionOf === undefined ? {} : { actionOf: input.actionOf }),
        ...(input.log === undefined ? {} : { log: input.log }),
      });
      messages = step.messages;
      notices.push(...step.notices);
      previousSignature = step.previousSignature;
      executedCalls = step.executedCalls;
      progressPosted = step.progressPosted;
      if (executedCalls >= TOOL_TURN_MAX_CALLS) {
        break;
      }
    }
    return { text: null, notices, failure: null, rounds, toolCalls: executedCalls, messages };
  } finally {
    // One counts line per turn on every exit (text, failure, caps, throw):
    // ids and counts only, never content.
    input.turnLogger.info(
      {
        aiId: input.aiId,
        rounds,
        toolCalls: executedCalls,
        elapsedMs: input.nowMs() - startedAt,
      },
      'AI tool turn finished',
    );
  }
}

// The second half of a tool turn: every path below runs the shared
// `runToolLoop` — DM and group turns share one implementation, no copy.
// The turn only adapts: its own executor (`executeTool`), its own sender
// (DM sends plain text into the owner's DM), and the legacy single-round
// tail (a follow-up call WITH tools, answered from its text alone). Gates,
// clock, caps, dedupe, truncation, the tool-free last call and counts
// logging all live in the loop.
//
// `maxRounds: 1` (the default) keeps today's behaviour byte for byte:
// round 1 offers tools, executes, and the tail makes exactly one more
// follow-up call with tools. The failure path is unchanged: the persona
// lines ride along on the failure text.
export async function runToolTurn(
  deps: DmTurnDeps,
  completionInput: {
    target: ModelTarget;
    fetchImpl?: FetchLike;
    timeoutMs?: number;
    secrets?: readonly string[];
    onDelta?: (textSoFar: string) => void;
    onUsage?: (usage: ChatUsage) => void;
    log?: TurnLog;
  },
  secrets: string[],
  tools: ChatToolDefinition[],
): Promise<DmTurnOutcome> {
  const startedAt = deps.turnStartMs ?? (deps.nowMs ?? Date.now)();
  const nowMs = deps.nowMs ?? Date.now;
  const turnLogger = deps.turnLogger ?? { info: () => undefined };
  const maxRounds = deps.maxRounds ?? 1;
  let loop: {
    text: string | null;
    notices: string[];
    failure: { reply: string } | null;
    rounds: number;
    toolCalls: number;
    messages: ModelRequestMessage[];
  };
  try {
    loop = await runToolLoop({
      aiId: deps.aiId,
      messages: deps.messages,
      tools,
      completionInput,
      maxRounds,
      ...(deps.executeTool === undefined ? {} : { executeTool: deps.executeTool }),
      logger: deps.logger,
      turnLogger,
      secrets,
      ...(deps.checkRoundGate === undefined ? {} : { checkRoundGate: deps.checkRoundGate }),
      turnStartMs: startedAt,
      nowMs,
      ...(deps.reportProgress === undefined ? {} : { reportProgress: deps.reportProgress }),
      actionOf: (tool, argsJson) => actionOfCall(tool, argsJson),
      ...(deps.log === undefined ? {} : { log: deps.log }),
    });
  } catch (error) {
    // The loop throws only for an empty first reply or a failed model
    // call: the failure text goes out like any other model failure, with
    // no notices (none were earned yet).
    const failure = mapFailureToReply(error);
    deps.log?.append('error', failureLogFields(error));
    deps.logger.warn({ ...failureLogFields(error), aiId: deps.aiId }, 'AI reply failed');
    await finishProgressQuietly(deps, secrets, 'failed');
    try {
      await deps.sendMessage(deps.ownerJid, 'chat', failure);
    } catch (sendError) {
      deps.logger.warn(
        { err: redactError(sendError, secrets), aiId: deps.aiId },
        'AI failure reply could not be sent',
      );
      return { kind: 'failed', text: '' };
    }
    return { kind: 'failed', text: failure };
  }
  if (loop.failure !== null) {
    await finishProgressQuietly(deps, secrets, 'failed');
    const text = loop.failure.reply + loop.notices.join('');
    try {
      await deps.sendMessage(deps.ownerJid, 'chat', text);
    } catch (sendError) {
      deps.logger.warn(
        { err: redactError(sendError, secrets), aiId: deps.aiId },
        'AI failure reply could not be sent',
      );
      return { kind: 'failed', text: '' };
    }
    return { kind: 'failed', text };
  }
  if (loop.text === null) {
    // The caps stopped the loop with no text: one last call so the AI must
    // answer in text. The legacy single-round shape offers tools on that
    // call and answers from its text alone; longer turns go tool-free.
    // The gate runs first: a stop or budget trip before the last call sends
    // the gate's fixed reply instead of another model call.
    if (deps.checkRoundGate !== undefined) {
      const gate = await deps.checkRoundGate();
      if (gate !== null && gate.limited) {
        await finishProgressQuietly(deps, secrets, 'failed');
        const text = gate.reply + loop.notices.join('');
        try {
          await deps.sendMessage(deps.ownerJid, 'chat', text);
        } catch (sendError) {
          deps.logger.warn(
            { err: redactError(sendError, secrets), aiId: deps.aiId },
            'AI failure reply could not be sent',
          );
          return { kind: 'failed', text: '' };
        }
        return { kind: 'failed', text };
      }
    }
    let text: string;
    try {
      const last = await requestCompletion({
        ...completionInput,
        timeoutMs: remainingTurnBudgetMs(startedAt, nowMs),
        messages: loop.messages,
        ...(maxRounds <= 1 ? { tools } : {}),
      });
      text =
        last.content === null
          ? TRANSIENT_FAILURE_REPLY + loop.notices.join('')
          : last.content + cutShortSuffix(last.finishReason) + loop.notices.join('');
    } catch (error) {
      const failure = mapFailureToReply(error);
      deps.log?.append('error', failureLogFields(error));
      deps.logger.warn({ ...failureLogFields(error), aiId: deps.aiId }, 'AI reply failed');
      await finishProgressQuietly(deps, secrets, 'failed');
      const text = failure + loop.notices.join('');
      try {
        await deps.sendMessage(deps.ownerJid, 'chat', text);
      } catch (sendError) {
        deps.logger.warn(
          { err: redactError(sendError, secrets), aiId: deps.aiId },
          'AI failure reply could not be sent',
        );
        return { kind: 'failed', text: '' };
      }
      return { kind: 'failed', text };
    }
    await finishProgressQuietly(deps, secrets, 'done');
    return sendReply(deps, text);
  }

  await finishProgressQuietly(deps, secrets, 'done');
  return sendReply(deps, loop.text + loop.notices.join(''));
}

// T-1414: closes the turn's task card, best effort. A throw never fails the
// turn: it warns with the AI id only, never content.
export async function finishProgressQuietly(
  deps: DmTurnDeps | GroupTurnDeps,
  secrets: string[],
  state: 'done' | 'failed',
): Promise<void> {
  try {
    await deps.finishProgress?.(state);
  } catch (error) {
    deps.logger.warn(
      { aiId: deps.aiId, err: redactError(error, secrets) },
      'AI task card could not be finished',
    );
  }
}

async function sendReply(deps: DmTurnDeps, text: string): Promise<DmTurnOutcome> {
  const secrets = [deps.target.apiKey, ...(deps.secrets ?? [])];
  // The complete text goes out as a draft first, so the last `draft` carries
  // the final text before the XMPP message lands. A hook failure is a turn
  // failure, not a send failure, so it runs before the send's try.
  deps.beforeFinalSend?.(text);
  try {
    await deps.sendMessage(deps.ownerJid, 'chat', text);
  } catch (error) {
    deps.logger.warn(
      { err: redactError(error, secrets), aiId: deps.aiId },
      'AI reply could not be sent',
    );
    return { kind: 'failed', text: '' };
  }
  // T-1426: the answer went out. The session log stores its size only, never
  // the text.
  deps.log?.append('answer', { bytes: byteLength(text) });
  return { kind: 'replied', text };
}

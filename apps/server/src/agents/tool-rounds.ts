// effect-plain: moved unchanged from apps/server/src/agents/dm-tool-turn.ts (size split)
import type { FetchLike } from '../ai/http';
import type { ModelTarget } from '../ai/providers';
import type { ChatUsage } from '../ai/model-client';
import { cutShortSuffix } from './replies';
import { runLoopRound } from './tool-exec';
import {
  CHAT_TURN_CAPS,
  ChatCompletionError,
  TRANSIENT_FAILURE_REPLY,
  requestCompletion,
  type ExecuteToolCall,
  type ModelRequestMessage,
  type TurnCaps,
} from './tool-loop';
import { remainingTurnBudgetMs } from './turn-budget';
import type { ChatToolDefinition } from './tools';
import type { TurnLog } from './log/append';

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
// - the turn's caps (`caps`: the chat caps unless a computer turn passes its
//   own) stop the loop; when the rounds run out, the last model call is made
//   WITHOUT tools so the AI must answer in text
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
    /** T-1422: the turn's abort signal, forwarded to every model call. */
    signal?: AbortSignal;
  };
  maxRounds: number;
  /** T-1611: the turn's caps. Defaults to `CHAT_TURN_CAPS`; a turn with the
   * AI's computer on passes `COMPUTER_TURN_CAPS`. */
  caps?: TurnCaps;
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
  /** T-1761: true when any executed call posted into the room itself. */
  postedToRoom: boolean;
}> {
  const startedAt = input.turnStartMs;
  const caps = input.caps ?? CHAT_TURN_CAPS;
  let messages = input.messages;
  let rounds = 0;
  let executedCalls = 0;
  const notices: string[] = [];
  let previousSignature: string | null = null;
  let progressPosted = false;
  // Progress and the counts line both key off multi-round turns; a legacy
  // single-round turn reports nothing and stays byte for byte.
  const multiRound = input.maxRounds > 1;
  // T-1761: a call that posted into the room itself (a `blocks` card) sets
  // this flag. The group turn reads it and sends no echo reply. Both executor
  // seams are wrapped so the flag is captured from every executed call.
  let postedToRoom = false;
  const recordPosted = (exec: ExecuteToolCall | undefined): ExecuteToolCall | undefined =>
    exec === undefined
      ? undefined
      : async (call) => {
          const result = await exec(call);
          if (result.postedToRoom === true) {
            postedToRoom = true;
          }
          return result;
        };
  const executeTool = recordPosted(input.executeTool);
  const executeAdvertised = recordPosted(input.executeAdvertised);

  try {
    for (let round = 1; round <= input.maxRounds; round += 1) {
      // T-1422: a stop drops the loop before another round.
      if (input.completionInput.signal?.aborted === true) break;
      if (input.nowMs() - startedAt >= caps.wallClockMs) {
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
            postedToRoom,
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
        timeoutMs: remainingTurnBudgetMs(startedAt, input.nowMs, caps.wallClockMs),
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
            postedToRoom,
          };
        }
        return {
          text: result.content + cutShortSuffix(result.finishReason),
          notices,
          failure: null,
          rounds,
          toolCalls: executedCalls,
          messages,
          postedToRoom,
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
          postedToRoom,
        };
      }
      const step = await runLoopRound({
        aiId: input.aiId,
        messages,
        result,
        previousSignature,
        executedCalls,
        maxCalls: caps.maxCalls,
        ...(executeTool === undefined ? {} : { executeTool }),
        ...(executeAdvertised === undefined ? {} : { executeTool: executeAdvertised }),
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
      if (executedCalls >= caps.maxCalls) {
        break;
      }
    }
    return {
      text: null,
      notices,
      failure: null,
      rounds,
      toolCalls: executedCalls,
      messages,
      postedToRoom,
    };
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

// effect-plain: this module's public edge stays Promise-shaped.
import type { FetchLike } from '../ai/http';
import type { ModelTarget } from '../ai/providers';
import type { ChatUsage } from '../ai/model-client';
import { cutShortSuffix, TRANSIENT_FAILURE_REPLY } from './replies';
import { runLoopRound } from './tool-exec';
import {
  CHAT_TURN_CAPS,
  ChatCompletionError,
  requestCompletion,
  type ExecuteToolCall,
  type ModelRequestMessage,
  type TurnCaps,
} from './tool-loop';
import { remainingTurnBudgetMs } from './turn';
import type { ChatToolDefinition } from '../ai/model-client';
import type { TurnLog } from './log/append';

// The one shared multi-round tool loop for DM and group turns; the two differ
// only in their executor and final sender. `checkRoundGate` runs before each
// model call, tool results are truncated and wrapped as untrusted, and only
// counts (rounds, tool calls, ms) reach the log, never content. When the rounds
// run out the last call is made without tools so the AI must answer in text.
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
    signal?: AbortSignal;
  };
  maxRounds: number;
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
  log?: TurnLog;
}): Promise<{
  text: string | null;
  notices: string[];
  failure: { reply: string } | null;
  rounds: number;
  toolCalls: number;
  messages: ModelRequestMessage[];
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
  const multiRound = input.maxRounds > 1;
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
      // Round 1 always offers tools, exactly like the first call.
      // When the rounds run out, the last model call is made without tools
      // so the AI must answer in text — except the single-round
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
        // An empty first reply is a model failure, like the
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

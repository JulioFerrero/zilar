// effect-plain: the Promise edge over `ai/model-client`; every model call is an Effect inside `chat`.
import {
  ChatCompletionError,
  MODEL_CHAT_TIMEOUT_MS,
  chat,
  type ChatToolCall,
  type ChatUsage,
  type ModelCallResult,
  type ModelRequestMessage,
} from '../ai/model-client';
import type { FetchLike } from '../ai/http';
import { costOf, modelPricesFor } from '../ai/cost';
import type { ModelTarget } from '../ai/providers';
import type { TurnLog } from './log/append';
import {
  ASK_PEOPLE_TOOL,
  DELEGATE_TOOL,
  FETCH_MEDIA_TOOL,
  MEMORY_ZOOM_TOOL,
  POST_BLOCKS_TOOL,
  RECALL_TOOL,
  REMEMBER_TOOL,
  REQUEST_ACTION_TOOL,
  REVERT_PERSONA_TOOL,
  SAVE_TEXT_MEDIA_TOOL,
  TASK_STATUS_TOOL,
  UPDATE_PERSONA_TOOL,
  type ChatToolDefinition,
  type DeskToolName,
  type SaveTextMediaFormat,
} from './tools';

// Cap on every completion request, enforced in code from day one (§8.4).
export const REPLY_MAX_TOKENS = 4096;

export { ChatCompletionError, MODEL_CHAT_TIMEOUT_MS };
export type { ChatToolCall, ChatUsage, ModelRequestMessage, ModelTarget };

export * from './replies';

// A validated call the executor may run. Unknown tools and invalid arguments
// never reach this shape: they get `invalid: …` back instead.
export type ValidToolCall =
  | { id: string; tool: typeof UPDATE_PERSONA_TOOL; persona: string; summary: string }
  | { id: string; tool: typeof REVERT_PERSONA_TOOL }
  | {
      id: string;
      tool: typeof REQUEST_ACTION_TOOL;
      action: string;
      args: Record<string, unknown>;
    }
  | { id: string; tool: typeof RECALL_TOOL; query: string }
  | { id: string; tool: typeof MEMORY_ZOOM_TOOL; block: string }
  | { id: string; tool: typeof REMEMBER_TOOL; text: string }
  | {
      id: string;
      tool: typeof DELEGATE_TOOL;
      toAiId: string;
      objective: string;
      contextSummary?: string;
      acceptance?: string[];
      returnFormat?: string;
    }
  | { id: string; tool: typeof TASK_STATUS_TOOL; taskId: string }
  | { id: string; tool: typeof ASK_PEOPLE_TOOL; question: string; options: string[] }
  | {
      id: string;
      tool: typeof POST_BLOCKS_TOOL;
      text: string;
      title?: string;
      icon?: string;
      meta?: string;
      blocks: unknown[];
    }
  | {
      id: string;
      tool: typeof FETCH_MEDIA_TOOL;
      url: string;
      kind: 'image' | 'file';
      name?: string;
    }
  | {
      id: string;
      tool: typeof SAVE_TEXT_MEDIA_TOOL;
      name: string;
      format: SaveTextMediaFormat;
      content: string;
    }
  | { id: string; tool: DeskToolName; args: Record<string, unknown> };

export interface ToolExecution {
  // A short result for the model: "ok", "nothing to undo" or "invalid: …".
  content: string;
  // A fixed line for the owner's DM, present only when the persona changed.
  notice?: string;
  stage?: string;
  exitCode?: number;
  approvalId?: string;
  postedToRoom?: boolean;
}

export type ExecuteToolCall = (call: ValidToolCall) => Promise<ToolExecution>;

export interface CompleteChatInput {
  target: ModelTarget;
  messages: ModelRequestMessage[];
  tools?: ChatToolDefinition[];
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  /** Extra secrets to redact from every error (e.g. the master key). */
  secrets?: readonly string[];
  /** Called with the cumulative text every time the stream grows. */
  onDelta?: (textSoFar: string) => void;
  /** Called with the token counters when the provider reports them. */
  onUsage?: (usage: ChatUsage) => void;
  maxTokens?: number;
  log?: TurnLog;
  signal?: AbortSignal;
}

export type ChatCompletionResult = ModelCallResult;

export async function requestCompletion(input: CompleteChatInput): Promise<ChatCompletionResult> {
  const startedMs = Date.now();
  try {
    const result = await chat({
      target: input.target,
      messages: input.messages,
      maxTokens: input.maxTokens ?? REPLY_MAX_TOKENS,
      ...(input.tools === undefined ? {} : { tools: input.tools }),
      ...(input.fetchImpl === undefined ? {} : { fetchImpl: input.fetchImpl }),
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
      ...(input.secrets === undefined ? {} : { secrets: input.secrets }),
      ...(input.onDelta === undefined ? {} : { onDelta: input.onDelta }),
      ...(input.onUsage === undefined ? {} : { onUsage: input.onUsage }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    if (input.log !== undefined) {
      const provider = input.target.provider;
      const model = input.target.model;
      input.log.append(
        'model_call',
        {
          provider,
          model,
          input_tokens: result.usage.inputTokens,
          output_tokens: result.usage.outputTokens,
          cached_tokens: result.usage.cacheReadTokens,
          cache_write_tokens: result.usage.cacheWriteTokens,
          ...(modelPricesFor(provider, model) === null
            ? {}
            : {
                cost_usd: Number(costOf(provider, model, result.usage).toFixed(6)),
              }),
          ok: true,
        },
        Date.now() - startedMs,
      );
    }
    return result;
  } catch (error) {
    // The failure class rides the `error` row the turn writes; here only the
    // model identity, the duration and the outcome.
    input.log?.append(
      'model_call',
      { provider: input.target.provider, model: input.target.model, ok: false },
      Date.now() - startedMs,
    );
    throw error;
  }
}

export const TOOL_TURN_WALL_CLOCK_MS = 120_000;
export const TOOL_TURN_MAX_CALLS = 12;

export type TurnCaps = { maxCalls: number; wallClockMs: number };
export const CHAT_TURN_CAPS: TurnCaps = {
  maxCalls: TOOL_TURN_MAX_CALLS,
  wallClockMs: TOOL_TURN_WALL_CLOCK_MS,
};
export const COMPUTER_TURN_MAX_ROUNDS = 40;
export const COMPUTER_TURN_CAPS: TurnCaps = { maxCalls: 80, wallClockMs: 15 * 60_000 };
export const MODEL_CALL_MAX_MS = 300_000;

export const TOOL_RESULT_MAX_CHARS = 8 * 1024;

export const TOOL_REPEAT_RESULT = 'already done: this call ran in the previous round';

export const TOOL_CAPPED_RESULT = 'capped: turn call limit reached';

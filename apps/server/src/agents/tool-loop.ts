// effect-plain: the Promise edge over `ai/model-client`; every model call is an Effect inside `chat`.
// The model call the whole agent loop goes through. The transport is Effect AI
// (`ai/model-client.ts`); this module keeps the loop's own types and caps and
// exposes `requestCompletion` with the same shape every caller already uses.
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
  DELEGATE_TOOL,
  MEMORY_ZOOM_TOOL,
  RECALL_TOOL,
  REMEMBER_TOOL,
  REQUEST_ACTION_TOOL,
  REVERT_PERSONA_TOOL,
  TASK_STATUS_TOOL,
  UPDATE_PERSONA_TOOL,
  type ChatToolDefinition,
  type DeskToolName,
} from './tools';

// Cap on every completion request, enforced in code from day one (§8.4).
export const REPLY_MAX_TOKENS = 4096;

export { ChatCompletionError, MODEL_CHAT_TIMEOUT_MS };
export type { ChatToolCall, ChatUsage, ModelRequestMessage, ModelTarget };

// AI-3/AI-4: the reply texts live in `replies.ts`, re-exported here unchanged.
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
  // T-1409: the desk tools. `args` is the already-validated argument object;
  // the daemon validates it again.
  | { id: string; tool: DeskToolName; args: Record<string, unknown> };

export interface ToolExecution {
  // A short result for the model: "ok", "nothing to undo" or "invalid: …".
  content: string;
  // A fixed line for the owner's DM, present only when the persona changed.
  notice?: string;
  // T-1409: an updated progress stage to report after this call ran (for
  // example "Waiting for a computer" while the desk is queued). Optional: most
  // calls leave the round's stage as it was.
  stage?: string;
  // T-1426: the process exit code when the tool ran one (the desk tools), so
  // the session log can carry it. Absent for every other tool.
  exitCode?: number;
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
  /** T-1426: the turn's session log. A `model_call` row is appended for every
   * call (tokens, duration, cost when the catalog knows the model). Best
   * effort: a log failure never fails the call. */
  log?: TurnLog;
  /** T-1422: the turn's abort signal, threaded through to the model call. */
  signal?: AbortSignal;
}

export type ChatCompletionResult = ModelCallResult;

// One model call for one turn, authenticated as the AI with the owner's
// provider key (decrypted per call by the caller). Effect AI owns the retry,
// timeout, streaming and error mapping; this is the Promise edge. T-1426: the
// single choke point every model call passes, so it also appends the turn's
// `model_call` session-log row (tokens, duration, cost when known).
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

// T-0106: per-turn caps for the multi-round tool loop. The wall clock keeps
// one long turn from holding the pump forever; the call cap keeps a looping
// model from executing unbounded side effects. Both are fixed, not config:
// `AGENT_TOOL_MAX_ROUNDS` is the only knob.
export const TOOL_TURN_WALL_CLOCK_MS = 120_000;
export const TOOL_TURN_MAX_CALLS = 12;

// T-0106: each tool result fed back to the model is truncated to this many
// characters. Adapter summaries are already short; `modelText` (tool source,
// test output, fetched pages) can be 16 KiB, and several rounds of that
// would bloat the context. Still wrapped in `<untrusted-tool-output>`.
export const TOOL_RESULT_MAX_CHARS = 8 * 1024;

// T-0106: a round that asks for the same call with the same arguments as the
// previous round is answered with this, without executing again.
export const TOOL_REPEAT_RESULT = 'already done: this call ran in the previous round';

// T-0106: every call dropped by the per-turn call cap still gets a result,
// so no assistant `tool_calls` entry is left without a matching `tool`
// message. An unmatched tool call makes providers answer 400 on the next
// (and the final tool-free) model call, so capping must never corrupt the
// follow-up history.
export const TOOL_CAPPED_RESULT = 'capped: turn call limit reached';

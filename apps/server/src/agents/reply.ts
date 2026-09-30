import { z } from 'zod';
import type { ChatKind, SendMessageOptions } from '@galena/xmpp-core';
import { LitellmApiError, redactSecrets, type FetchLike } from '../ai/litellm-client';
import type { ChatCompletionMessage } from './context';
import { ChatStreamInterruptedError, consumeChatCompletionStream } from './stream';
import {
  PERSONA_TOOLS,
  REQUEST_ACTION_TOOL,
  REVERT_PERSONA_TOOL,
  UPDATE_PERSONA_TOOL,
  parseToolArguments,
  safeToolName,
  type ChatToolDefinition,
  type ParsedToolArguments,
} from './tools';
import { stageForToolCall } from './tool-guide';

// Cap on every completion request, enforced in code from day one (§8.4).
export const REPLY_MAX_TOKENS = 1024;

// How long one turn waits for LiteLLM before telling the owner to retry.
export const LITELLM_CHAT_TIMEOUT_MS = 90_000;

export const BUDGET_EXCEEDED_REPLY =
  "I've reached my spending limit for this period. You can raise it in My AIs.";
export const PROVIDER_KEY_REJECTED_REPLY =
  'My provider rejected the API key. Check it under Connections → Test.';
export const TRANSIENT_FAILURE_REPLY = "I couldn't reply just now. Please try again in a minute.";

// The daily-limit notice is fixed except for the formatted per-day cap, so it
// is a function rather than a constant. It goes out at most once per AI per
// chat per UTC day; further messages that day get no reply and no notice.
export function dailyLimitReply(perDayUsd: number): string {
  return `I've reached today's spending limit ($${perDayUsd.toFixed(2)}). I'll be back after 00:00 UTC.`;
}

// The 80% heads-ups go out after the AI's reply for the turn that crossed
// them, at most once per kind per AI per chat per UTC day. Fixed text except
// for the formatted spend and cap.
export function dailyWarningReply(todayUsd: number, perDayUsd: number): string {
  return `Heads up: I've used $${todayUsd.toFixed(2)} of my $${perDayUsd.toFixed(2)} daily limit. I'll pause for the day when it runs out.`;
}

export function monthlyWarningReply(windowUsd: number, perMonthUsd: number): string {
  return `Heads up: I've used $${windowUsd.toFixed(2)} of my $${perMonthUsd.toFixed(2)} limit for this period. You can raise it in My AIs.`;
}

// A failed `/chat/completions` call. The detail is redacted at construction:
// it never carries the virtual key, whatever LiteLLM echoed back.
export class ChatCompletionError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(status: number, detail: string) {
    super(
      status === 0
        ? `chat completions request failed: ${detail}`
        : `chat completions failed with HTTP ${status}: ${detail}`,
    );
    this.name = 'ChatCompletionError';
    this.status = status;
    this.detail = detail;
  }
}

// One raw tool call the model asked for, straight off the response.
export interface ChatToolCall {
  id: string;
  name: string;
  argsJson: string;
}

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
    };

export interface ToolExecution {
  // A short result for the model: "ok", "nothing to undo" or "invalid: …".
  content: string;
  // A fixed line for the owner's DM, present only when the persona changed.
  notice?: string;
}

export type ExecuteToolCall = (call: ValidToolCall) => Promise<ToolExecution>;

// A message on the wire. The context builder produces the system/user/
// assistant turns; the tool loop appends assistant `tool_calls` and `tool`
// results for the follow-up call.
export interface ModelRequestMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

const RawToolCallSchema = z.object({
  id: z.string(),
  function: z.object({ name: z.string(), arguments: z.string() }),
});

const ChatCompletionsResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z
          .object({
            content: z.string().nullable().optional(),
            tool_calls: z.array(RawToolCallSchema).optional(),
          })
          .optional(),
      }),
    )
    .min(1),
});

export interface CompleteChatInput {
  baseUrl: string;
  virtualKey: string;
  model: string;
  messages: ModelRequestMessage[];
  tools?: ChatToolDefinition[];
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  /** Extra secrets to redact from every error (e.g. the master key). */
  secrets?: readonly string[];
  /** Called with the cumulative text every time the stream grows. */
  onDelta?: (textSoFar: string) => void;
}

interface ChatCompletionResult {
  content: string | null;
  toolCalls: ChatToolCall[];
}

function errorDetail(body: unknown): string {
  if (typeof body === 'string') {
    return body === '' ? 'no response body' : body;
  }
  if (body !== null && typeof body === 'object') {
    const error = (body as { error?: unknown }).error;
    if (typeof error === 'string') {
      return error;
    }
    if (error !== null && typeof error === 'object') {
      const message = (error as { message?: unknown }).message;
      if (typeof message === 'string') {
        return message;
      }
    }
    try {
      return JSON.stringify(body);
    } catch {
      return 'unreadable response body';
    }
  }
  return 'no response body';
}

function hasErrorBody(body: unknown): boolean {
  if (body === null || typeof body !== 'object') {
    return false;
  }
  const error = (body as { error?: unknown }).error;
  return typeof error === 'string' || (error !== null && typeof error === 'object');
}

// One model call for one turn, authenticated as the AI with its own capped
// virtual key. Every call streams (`stream: true`): text deltas are reported
// through `onDelta` as they arrive, and the result has the same shape the
// tool loop already understands. Throws ChatCompletionError (redacted) on any
// failure. A stream that breaks midway or times out (the same per-call
// timeout, now covering the whole stream) counts as a network failure. If the
// provider ignores `stream` and answers plain JSON, that shape is parsed the
// way it always was.
async function requestCompletion(input: CompleteChatInput): Promise<ChatCompletionResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? LITELLM_CHAT_TIMEOUT_MS;
  const url = `${input.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const secrets = [input.virtualKey, ...(input.secrets ?? [])];

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${input.virtualKey}`,
      },
      body: JSON.stringify({
        model: input.model,
        messages: input.messages,
        max_tokens: REPLY_MAX_TOKENS,
        stream: true,
        ...(input.tools === undefined ? {} : { tools: input.tools, tool_choice: 'auto' }),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'network error';
    throw new ChatCompletionError(0, redactSecrets(message, secrets));
  }

  // HTTP errors surface before the stream starts and map exactly as before.
  if (!response.ok) {
    const text = await readBodyText(response);
    throw new ChatCompletionError(
      response.status,
      redactSecrets(errorDetail(parseBody(text)), secrets),
    );
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('text/event-stream')) {
    if (response.body === null) {
      throw new ChatCompletionError(0, 'the stream had no body');
    }
    try {
      const streamed = await consumeChatCompletionStream(response.body, input.onDelta);
      return {
        content: streamed.content,
        toolCalls: streamed.toolCalls.map((call) => ({
          id: call.id,
          name: call.name,
          argsJson: call.argsJson,
        })),
      };
    } catch (error) {
      if (error instanceof ChatStreamInterruptedError) {
        throw new ChatCompletionError(0, redactSecrets(error.message, secrets));
      }
      const message = error instanceof Error ? error.message : 'network error';
      throw new ChatCompletionError(0, redactSecrets(message, secrets));
    }
  }

  const text = await readBodyText(response);
  const body: unknown = parseBody(text);

  if (hasErrorBody(body)) {
    throw new ChatCompletionError(response.status, redactSecrets(errorDetail(body), secrets));
  }

  const parsed = ChatCompletionsResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new ChatCompletionError(200, 'unexpected response shape');
  }
  const message = parsed.data.choices[0]?.message;
  const content = message?.content?.trim() ?? '';
  return {
    content: content === '' ? null : content,
    toolCalls: (message?.tool_calls ?? []).map((call) => ({
      id: call.id,
      name: call.function.name,
      argsJson: call.function.arguments,
    })),
  };
}

async function readBodyText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    throw new ChatCompletionError(0, 'the response body could not be read');
  }
}

function parseBody(text: string): unknown {
  if (text === '') {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// The plain text call: no tools, so any tool_calls the model improvised are
// ignored and an empty reply is a failure.
export async function completeChat(input: CompleteChatInput): Promise<string> {
  const result = await requestCompletion(input);
  if (result.content === null) {
    throw new ChatCompletionError(200, 'empty reply from the model');
  }
  return result.content;
}

function statusAndDetail(error: unknown): { status: number; detail: string } {
  if (error instanceof ChatCompletionError) {
    return { status: error.status, detail: error.detail };
  }
  if (error instanceof LitellmApiError) {
    return { status: error.status, detail: error.message };
  }
  return { status: 0, detail: error instanceof Error ? error.message : String(error) };
}

// Maps any turn failure to the exact DM text. Never the raw provider body.
export function mapFailureToReply(error: unknown): string {
  const { status, detail } = statusAndDetail(error);
  if (status === 429 || /budget_exceeded/i.test(detail)) {
    return BUDGET_EXCEEDED_REPLY;
  }
  if (status === 401 || status === 403) {
    return PROVIDER_KEY_REJECTED_REPLY;
  }
  return TRANSIENT_FAILURE_REPLY;
}

export interface DmTurnDeps {
  aiId: string;
  ownerJid: string;
  messages: ChatCompletionMessage[];
  baseUrl: string;
  virtualKey: string;
  model: string;
  /** Runs one validated persona tool call against the AI's own row. */
  executeTool?: ExecuteToolCall;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  /** Receives the cumulative reply text while the model writes (drafts). */
  onDelta?: (textSoFar: string) => void;
  /** Called with the exact final reply text right before its XMPP send. Never
   * called for notices on their own or for failure texts. */
  beforeFinalSend?: (text: string) => void;
  sendMessage: (to: string, kind: ChatKind, text: string) => Promise<unknown>;
  sendTyping: (to: string, kind: ChatKind, state: 'composing' | 'paused') => void;
  logger: {
    warn: (fields: Record<string, unknown>, message: string) => void;
  };
  /** Extra secrets to redact from every log line (e.g. the master key). */
  secrets?: readonly string[];
  /** Tools to advertise to the model. Defaults to `PERSONA_TOOLS` (the
   * historical behaviour), so existing callers and tests stay unchanged.
   * When `request_action` is in play the agent gateway passes a list that
   * also includes the `request_action` tool definition. */
  tools?: ChatToolDefinition[];
  /** T-0106: how many tool rounds this turn may run. Defaults to 1:
   * first model call with tools, execute, exactly one follow-up call —
   * today's behaviour, byte for byte. The gateway passes
   * `AGENT_TOOL_MAX_ROUNDS` (6 when `TOOLS_ENABLED` is on). */
  maxRounds?: number;
  /** T-0106: a gate the turn checks before every model call. Null = the AI
   * may proceed (live, under budget, usage unavailable). Non-null with
   * `limited: true` = stop the loop and send the fixed reply. In
   * production the gateway wires the kill switch + budget check; tests
   * wire scripted gates. */
  checkRoundGate?: () => Promise<{ limited: boolean; reply: string } | null>;
  /** T-0106: wall-clock start of the turn (ms). Rounds stop when
   * `TOOL_TURN_WALL_CLOCK_MS` have passed. Defaults to `Date.now()`. */
  turnStartMs?: number;
  /** T-0106: `Date.now` seam for the wall-clock cap. Defaults to Date.now. */
  nowMs?: () => number;
  /** T-0106: posts one live progress message at the first tool round and
   * updates it at each round. Resolves with the progress message id when
   * one was posted (corrections target it); null when no progress message
   * exists (not posted yet, or posting failed). Best effort: a throw or a
   * null never fails the turn. */
  reportProgress?: (stage: string) => Promise<string | null>;
  /** T-0106: removes or replaces the live progress message once the final
   * text is sent. Best effort: a throw never fails the turn. */
  clearProgress?: () => Promise<void>;
  /** T-0106: counts logger. The loop logs only counts (rounds, tool
   * calls, ms), never content. Defaults to `deps.logger`. */
  turnLogger?: {
    info: (fields: Record<string, unknown>, message: string) => void;
  };
}

export type DmTurnOutcome = { kind: 'replied'; text: string } | { kind: 'failed'; text: string };

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

// Runs one turn: typing on, model call, reply into the DM, typing off. When
// the model asks for tools, each call is validated and executed, the results
// go back for exactly one follow-up call, and the reply carries the fixed
// persona lines. At most 2 model calls per turn: a second response that asks
// for tools again is answered from its text alone. A model failure posts the
// honest failure text instead — never the raw error. XMPP send failures are
// logged, never thrown: there is nobody left to tell.
export async function runDmTurn(deps: DmTurnDeps): Promise<DmTurnOutcome> {
  const secrets = [deps.virtualKey, ...(deps.secrets ?? [])];
  const tools = deps.tools ?? PERSONA_TOOLS;
  const completionInput = {
    baseUrl: deps.baseUrl,
    virtualKey: deps.virtualKey,
    model: deps.model,
    ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }),
    ...(deps.timeoutMs === undefined ? {} : { timeoutMs: deps.timeoutMs }),
    ...(deps.secrets === undefined ? {} : { secrets: deps.secrets }),
    ...(deps.onDelta === undefined ? {} : { onDelta: deps.onDelta }),
  };
  deps.sendTyping(deps.ownerJid, 'chat', 'composing');
  try {
    const first = await requestCompletion({
      ...completionInput,
      messages: deps.messages,
      tools,
    });
    if (first.toolCalls.length === 0) {
      if (first.content === null) {
        throw new ChatCompletionError(200, 'empty reply from the model');
      }
      return await sendReply(deps, first.content);
    }
    return await runToolTurn(deps, completionInput, first, secrets, tools);
  } catch (error) {
    const reply = mapFailureToReply(error);
    deps.logger.warn({ err: redactError(error, secrets), aiId: deps.aiId }, 'AI reply failed');
    try {
      await deps.sendMessage(deps.ownerJid, 'chat', reply);
    } catch (sendError) {
      deps.logger.warn(
        { err: redactError(sendError, secrets), aiId: deps.aiId },
        'AI failure reply could not be sent',
      );
      return { kind: 'failed', text: '' };
    }
    return { kind: 'failed', text: reply };
  } finally {
    deps.sendTyping(deps.ownerJid, 'chat', 'paused');
  }
}

async function sendReply(deps: DmTurnDeps, text: string): Promise<DmTurnOutcome> {
  const secrets = [deps.virtualKey, ...(deps.secrets ?? [])];
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
  return { kind: 'replied', text };
}

// Parses one raw tool call's `arguments`, runs the executor on it, and turns
// the result into a `tool` message plus an optional persona notice. Shared by
// the DM and the group tool loop (T-0098) so they run the exact same
// validation and redaction rules. A thrown executor becomes a
// `failed: could not save` message and the next call still runs.
async function executeOneToolCall(
  call: ChatToolCall,
  context: {
    aiId: string;
    executeTool?: ExecuteToolCall;
    logger: { warn: (fields: Record<string, unknown>, message: string) => void };
    secrets: readonly string[];
  },
): Promise<{ message: ModelRequestMessage; notice?: string }> {
  const parsed = parseToolArguments(call.name, call.argsJson);
  if (!parsed.ok) {
    // Never executed. The arguments stay out of the log entirely: only the
    // tool name travels with the AI id, never the persona text.
    context.logger.warn(
      { aiId: context.aiId, tool: safeToolName(call.name) },
      'AI tool call was not executed',
    );
    return {
      message: { role: 'tool', content: `invalid: ${parsed.reason}`, tool_call_id: call.id },
    };
  }
  if (context.executeTool === undefined) {
    context.logger.warn(
      { aiId: context.aiId, tool: safeToolName(call.name) },
      'AI tool call was not executed',
    );
    return {
      message: {
        role: 'tool',
        content: `invalid: unknown tool: ${safeToolName(call.name)}`,
        tool_call_id: call.id,
      },
    };
  }
  let execution: ToolExecution;
  try {
    execution = await context.executeTool(toCall(parsed, call.id));
  } catch (error) {
    // One call failing must not drop the others or the notices already
    // earned: the change (if any) stays, this call reports a failure, and
    // the loop continues with the remaining calls.
    context.logger.warn(
      {
        aiId: context.aiId,
        tool: safeToolName(call.name),
        ok: false,
        err: redactError(error, context.secrets),
      },
      'AI tool call failed',
    );
    return {
      message: { role: 'tool', content: 'failed: could not save', tool_call_id: call.id },
    };
  }
  return {
    message: { role: 'tool', content: execution.content, tool_call_id: call.id },
    ...(execution.notice === undefined ? {} : { notice: execution.notice }),
  };
}

// Runs every parsed tool call through the executor, in order. Returns the
// follow-up `tool` messages and the persona notices that ride along on the
// final text. Both the DM and the group tool loops call this so they share
// one validation + execution pipeline.
async function executeToolCalls(input: {
  toolCalls: ChatToolCall[];
  aiId: string;
  executeTool?: ExecuteToolCall;
  logger: { warn: (fields: Record<string, unknown>, message: string) => void };
  secrets: readonly string[];
}): Promise<{ toolMessages: ModelRequestMessage[]; notices: string[] }> {
  const toolMessages: ModelRequestMessage[] = [];
  const notices: string[] = [];
  for (const call of input.toolCalls) {
    const { message, notice } = await executeOneToolCall(call, {
      aiId: input.aiId,
      ...(input.executeTool === undefined ? {} : { executeTool: input.executeTool }),
      logger: input.logger,
      secrets: input.secrets,
    });
    toolMessages.push(message);
    if (notice !== undefined) {
      notices.push(notice);
    }
  }
  return { toolMessages, notices };
}

// Builds the messages array for the second model call: the original
// conversation, the assistant turn with its raw tool calls, and every
// collected tool result in order.
function followUpMessages(
  history: ModelRequestMessage[],
  first: ChatCompletionResult,
  toolMessages: ModelRequestMessage[],
): ModelRequestMessage[] {
  return [
    ...history,
    {
      role: 'assistant',
      content: first.content ?? '',
      tool_calls: first.toolCalls.map((call) => ({
        id: call.id,
        type: 'function' as const,
        function: { name: call.name, arguments: call.argsJson },
      })),
    },
    ...toolMessages,
  ];
}

// T-0106: truncates one executed tool result before it is fed back to the
// model. Summaries are already short; `modelText` inside
// `<untrusted-tool-output>` can be 16 KiB. The wrapper survives: only the
// inside is cut, so the model still sees labelled data, never instructions.
function truncateToolContent(content: string): string {
  if (content.length <= TOOL_RESULT_MAX_CHARS) {
    return content;
  }
  return `${content.slice(0, TOOL_RESULT_MAX_CHARS)}…`;
}

// T-0106: the per-round pipeline both loops share: dedupe repeated calls,
// report progress, execute (capped), truncate results, collect notices.
// Returns the follow-up messages for the next model call.
async function runLoopRound(input: {
  aiId: string;
  messages: ModelRequestMessage[];
  result: ChatCompletionResult;
  previousSignature: string | null;
  executedCalls: number;
  executeTool?: ExecuteToolCall;
  executeAdvertised?: ExecuteToolCall;
  logger: { warn: (fields: Record<string, unknown>, message: string) => void };
  secrets: string[];
  reportProgress?: (stage: string) => Promise<string | null>;
  progressPosted?: boolean;
  actionOf?: (tool: string, argsJson: string) => string | undefined;
}): Promise<{
  messages: ModelRequestMessage[];
  notices: string[];
  previousSignature: string;
  executedCalls: number;
  progressPosted: boolean;
}> {
  const signature = input.result.toolCalls
    .map((call) => `${call.name}\n${call.argsJson}`)
    .join('\n');
  if (input.previousSignature !== null && input.previousSignature === signature) {
    const repeated = input.result.toolCalls.map((call) => ({
      role: 'tool' as const,
      content: TOOL_REPEAT_RESULT,
      tool_call_id: call.id,
    }));
    return {
      messages: followUpMessages(input.messages, input.result, repeated),
      notices: [],
      previousSignature: signature,
      executedCalls: input.executedCalls,
      progressPosted: input.progressPosted ?? false,
    };
  }
  let progressPosted = input.progressPosted ?? false;
  if (input.reportProgress !== undefined) {
    const first = input.result.toolCalls[0];
    if (first !== undefined) {
      const stage = stageForToolCall(first.name, input.actionOf?.(first.name, first.argsJson));
      try {
        await input.reportProgress(stage);
        progressPosted = true;
      } catch (error) {
        input.logger.warn(
          { aiId: input.aiId, err: redactError(error, input.secrets) },
          progressPosted
            ? 'AI progress message could not be updated'
            : 'AI progress message could not be posted',
        );
      }
    }
  }
  const remaining = TOOL_TURN_MAX_CALLS - input.executedCalls;
  if (remaining <= 0) {
    return {
      messages: input.messages,
      notices: [],
      previousSignature: signature,
      executedCalls: input.executedCalls,
      progressPosted,
    };
  }
  const runnable = input.result.toolCalls.slice(0, remaining);
  const { toolMessages, notices } = await executeToolCalls({
    toolCalls: runnable,
    aiId: input.aiId,
    ...(input.executeAdvertised !== undefined
      ? { executeTool: input.executeAdvertised }
      : input.executeTool === undefined
        ? {}
        : { executeTool: input.executeTool }),
    logger: input.logger,
    secrets: input.secrets,
  });
  return {
    messages: followUpMessages(
      input.messages,
      input.result,
      toolMessages.map((message) => ({
        ...message,
        content: truncateToolContent(message.content),
      })),
    ),
    notices,
    previousSignature: signature,
    executedCalls: input.executedCalls + runnable.length,
    progressPosted,
  };
}

// T-0106: a standalone multi-round tool loop (used by the group turn and
// by future callers that start from the first model call). Round 1 is the
// first model call with tools; every round that asks for tool calls has
// them executed and fed back, until a round answers in text or the caps
// stop the loop. Rules that hold on EVERY round:
// - `checkRoundGate` runs before each model call: an over-budget or
//   stopped AI runs no further round and sends nothing (the caller sends
//   the gate's fixed reply, like a model failure);
// - the wall clock (`TOOL_TURN_WALL_CLOCK_MS`) and the total call cap
//   (`TOOL_TURN_MAX_CALLS`) stop the loop; when the rounds run out, the
//   last model call is made WITHOUT tools so the AI must answer in text;
// - a round that repeats the previous round's calls exactly gets the
//   "already done" result without executing;
// - tool results are truncated to `TOOL_RESULT_MAX_CHARS` and still arrive
//   inside `<untrusted-tool-output>`;
// - only counts (rounds, tool calls, ms) reach the log, never content.
export async function runToolLoop(input: {
  aiId: string;
  messages: ModelRequestMessage[];
  tools: ChatToolDefinition[];
  completionInput: {
    baseUrl: string;
    virtualKey: string;
    model: string;
    fetchImpl?: FetchLike;
    timeoutMs?: number;
    secrets?: readonly string[];
    onDelta?: (textSoFar: string) => void;
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
    const result = await requestCompletion({
      ...input.completionInput,
      messages,
      // When the rounds run out, the last model call is made without tools
      // so the AI must answer in text.
      ...(lastRound ? {} : { tools: input.tools }),
    });
    if (result.toolCalls.length === 0) {
      return {
        text: result.content,
        notices,
        failure: null,
        rounds,
        toolCalls: executedCalls,
        messages,
      };
    }
    if (lastRound) {
      // No tools were offered on the last call, so anything the model
      // improvises is answered from its text alone.
      return {
        text: result.content,
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
      ...(input.reportProgress === undefined ? {} : { reportProgress: input.reportProgress }),
      progressPosted,
      ...(input.actionOf === undefined ? {} : { actionOf: input.actionOf }),
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
}

// T-0106: runs the first round of the turn: the first model response is
// already in hand (`first`), so its calls execute and feed back through the
// shared per-round pipeline (dedupe, progress, execute, truncate). Returns
// the follow-up messages for the next model call plus the notices earned.
// With `maxRounds: 1` (the default) the caller makes exactly one follow-up
// call — today's behaviour, byte for byte. With more rounds the caller
// keeps looping through `runToolLoop` with the returned messages as its
// starting point.
async function runFirstRound(
  deps: DmTurnDeps,
  completionInput: {
    baseUrl: string;
    virtualKey: string;
    model: string;
    fetchImpl?: FetchLike;
    timeoutMs?: number;
    secrets?: readonly string[];
    onDelta?: (textSoFar: string) => void;
  },
  first: ChatCompletionResult,
  secrets: string[],
  startedAt: number,
): Promise<{
  messages: ModelRequestMessage[];
  notices: string[];
  failure: { reply: string } | null;
  rounds: number;
  toolCalls: number;
  previousSignature: string | null;
  progressPosted: boolean;
}> {
  void completionInput;
  void startedAt;
  const step = await runLoopRound({
    aiId: deps.aiId,
    messages: deps.messages,
    result: first,
    previousSignature: null,
    executedCalls: 0,
    ...(deps.executeTool === undefined ? {} : { executeTool: deps.executeTool }),
    logger: deps.logger,
    secrets,
    ...(deps.reportProgress === undefined ? {} : { reportProgress: deps.reportProgress }),
    progressPosted: false,
    actionOf: (tool, argsJson) => actionOfCall(tool, argsJson),
  });
  return {
    messages: step.messages,
    notices: step.notices,
    failure: null,
    rounds: 1,
    toolCalls: step.executedCalls,
    previousSignature: step.previousSignature,
    progressPosted: step.progressPosted,
  };
}

// T-0106: executes one round's tool calls and builds the follow-up messages.
// Shared by the first round and every later round so validation, truncation
// and notices run through one pipeline. Exported for the group turn's tests.
export async function runRoundCalls(
  deps: DmTurnDeps,
  result: ChatCompletionResult,
  secrets: string[],
): Promise<{
  messages: ModelRequestMessage[];
  notices: string[];
  failure: { reply: string } | null;
  rounds: number;
  toolCalls: number;
}> {
  const { toolMessages, notices } = await executeToolCalls({
    toolCalls: result.toolCalls,
    aiId: deps.aiId,
    ...(deps.executeTool === undefined ? {} : { executeTool: deps.executeTool }),
    logger: deps.logger,
    secrets,
  });
  return {
    messages: followUpMessages(
      deps.messages,
      result,
      toolMessages.map((message) => ({
        ...message,
        content: truncateToolContent(message.content),
      })),
    ),
    notices,
    failure: null,
    rounds: 1,
    toolCalls: result.toolCalls.length,
  };
}

// The second half of a tool turn: execute every call, feed the results back
// for exactly one more model call, then send the text plus any notices. The
// per-call execution is shared with groups through `executeToolCalls`. A
// second response that asks for tools again is answered from its text alone:
// those calls are ignored and there is never a third model call.
//
// T-0106: with `maxRounds` (default 1) the turn runs the shared multi-round
// loop instead. `maxRounds: 1` keeps today's behaviour byte for byte: the
// loop makes the first call with tools, executes, and makes exactly one
// follow-up call. The failure path is unchanged: the persona lines ride
// along on the failure text.
async function runToolTurn(
  deps: DmTurnDeps,
  completionInput: {
    baseUrl: string;
    virtualKey: string;
    model: string;
    fetchImpl?: FetchLike;
    timeoutMs?: number;
    secrets?: readonly string[];
    onDelta?: (textSoFar: string) => void;
  },
  first: ChatCompletionResult,
  secrets: string[],
  tools: ChatToolDefinition[],
): Promise<DmTurnOutcome> {
  const startedAt = deps.turnStartMs ?? (deps.nowMs ?? Date.now)();
  const nowMs = deps.nowMs ?? Date.now;
  const turnLogger = deps.turnLogger ?? { info: () => undefined };
  const maxRounds = deps.maxRounds ?? 1;
  // `maxRounds: 1` (the default) keeps today's behaviour byte for byte:
  // first call with tools, execute, exactly one follow-up call. More rounds
  // loop through the shared `runToolLoop` below. The gate runs before the
  // follow-up call too: a stop or budget trip between the two model calls
  // sends the gate's fixed reply instead of a second model call.
  if (maxRounds <= 1) {
    const { toolMessages, notices } = await executeToolCalls({
      toolCalls: first.toolCalls,
      aiId: deps.aiId,
      ...(deps.executeTool === undefined ? {} : { executeTool: deps.executeTool }),
      logger: deps.logger,
      secrets,
    });
    const elapsedMs = nowMs() - startedAt;
    turnLogger.info(
      { aiId: deps.aiId, rounds: 1, toolCalls: first.toolCalls.length, elapsedMs },
      'AI tool turn finished',
    );

    if (deps.checkRoundGate !== undefined) {
      const gate = await deps.checkRoundGate();
      if (gate !== null && gate.limited) {
        try {
          await deps.sendMessage(deps.ownerJid, 'chat', gate.reply);
        } catch (sendError) {
          deps.logger.warn(
            { err: redactError(sendError, secrets), aiId: deps.aiId },
            'AI failure reply could not be sent',
          );
          return { kind: 'failed', text: '' };
        }
        return { kind: 'failed', text: gate.reply };
      }
    }

    let text: string;
    try {
      const second = await requestCompletion({
        ...completionInput,
        messages: followUpMessages(deps.messages, first, toolMessages),
        tools,
      });
      // A second response that asks for tools again is answered from its text
      // alone: those calls are ignored and there is never a third model call.
      text = (second.content ?? TRANSIENT_FAILURE_REPLY) + notices.join('');
    } catch (error) {
      // The persona change from the first call stays, so the failure text says
      // so: the fixed persona lines ride along.
      const failure = mapFailureToReply(error);
      deps.logger.warn({ err: redactError(error, secrets), aiId: deps.aiId }, 'AI reply failed');
      const text = failure + notices.join('');
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
    return sendReply(deps, text);
  }

  const firstStep = await runFirstRound(deps, completionInput, first, secrets, startedAt);
  const loop = await runContinuedRounds({
    deps,
    completionInput,
    tools,
    secrets,
    startedAt,
    nowMs,
    turnLogger,
    maxRounds,
    firstStep,
  });
  const elapsedMs = nowMs() - startedAt;
  turnLogger.info(
    { aiId: deps.aiId, rounds: loop.rounds, toolCalls: loop.toolCalls, elapsedMs },
    'AI tool turn finished',
  );
  if (loop.failure !== null) {
    if (deps.clearProgress !== undefined) {
      await clearProgressQuietly(deps, secrets);
    }
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
    // The caps stopped the loop with no text: one last call without tools
    // so the AI must answer in text.
    let text: string;
    try {
      const last = await requestCompletion({
        ...completionInput,
        messages: loop.messages,
      });
      text = (last.content ?? TRANSIENT_FAILURE_REPLY) + loop.notices.join('');
    } catch (error) {
      const failure = mapFailureToReply(error);
      deps.logger.warn({ err: redactError(error, secrets), aiId: deps.aiId }, 'AI reply failed');
      if (deps.clearProgress !== undefined) {
        await clearProgressQuietly(deps, secrets);
      }
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
    if (deps.clearProgress !== undefined) {
      await clearProgressQuietly(deps, secrets);
    }
    return sendReply(deps, text);
  }

  if (deps.clearProgress !== undefined) {
    await clearProgressQuietly(deps, secrets);
  }
  return sendReply(deps, loop.text);
}

// T-0106: clears the live progress message, best effort. A throw never
// fails the turn: it warns with the AI id only, never content.
async function clearProgressQuietly(
  deps: DmTurnDeps | GroupTurnDeps,
  secrets: string[],
): Promise<void> {
  try {
    await deps.clearProgress?.();
  } catch (error) {
    deps.logger.warn(
      { aiId: deps.aiId, err: redactError(error, secrets) },
      'AI progress message could not be cleared',
    );
  }
}

// T-0106: runs rounds 2..N of a multi-round turn through the shared
// `runToolLoop`, starting from the first round's follow-up messages. Round 1
// already ran (its calls executed, its results fed back); the loop makes the
// second model call with tools and keeps going until a round answers in
// text or the caps stop it.
async function runContinuedRounds(input: {
  deps: DmTurnDeps;
  completionInput: {
    baseUrl: string;
    virtualKey: string;
    model: string;
    fetchImpl?: FetchLike;
    timeoutMs?: number;
    secrets?: readonly string[];
    onDelta?: (textSoFar: string) => void;
  };
  tools: ChatToolDefinition[];
  secrets: string[];
  startedAt: number;
  nowMs: () => number;
  turnLogger: { info: (fields: Record<string, unknown>, message: string) => void };
  maxRounds: number;
  firstStep: {
    messages: ModelRequestMessage[];
    notices: string[];
    failure: { reply: string } | null;
    rounds: number;
    toolCalls: number;
    previousSignature: string | null;
    progressPosted: boolean;
  };
}): Promise<{
  text: string | null;
  notices: string[];
  failure: { reply: string } | null;
  rounds: number;
  toolCalls: number;
  messages: ModelRequestMessage[];
}> {
  const { deps, completionInput, tools, secrets, startedAt, nowMs, turnLogger, maxRounds } = input;
  let messages = input.firstStep.messages;
  const notices = [...input.firstStep.notices];
  let rounds = input.firstStep.rounds;
  let executedCalls = input.firstStep.toolCalls;
  let previousSignature = input.firstStep.previousSignature;
  let progressPosted = input.firstStep.progressPosted;

  // The wall clock guards the whole turn: round 1 already ran above, so
  // the check lives inside the loop for rounds 2..N. A turn that starts
  // past the cap still runs round 1 (today's behaviour) and stops after.
  for (let round = 2; round <= maxRounds; round += 1) {
    if (nowMs() - startedAt >= TOOL_TURN_WALL_CLOCK_MS) {
      break;
    }
    if (deps.checkRoundGate !== undefined) {
      const gate = await deps.checkRoundGate();
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
    const lastRound = round >= maxRounds;
    let result: ChatCompletionResult;
    try {
      result = await requestCompletion({
        ...completionInput,
        messages,
        // When the rounds run out, the last model call is made without
        // tools so the AI must answer in text.
        ...(lastRound ? {} : { tools }),
      });
    } catch (error) {
      const failure = mapFailureToReply(error);
      deps.logger.warn({ err: redactError(error, secrets), aiId: deps.aiId }, 'AI reply failed');
      return {
        text: null,
        notices,
        failure: { reply: failure },
        rounds: rounds - 1,
        toolCalls: executedCalls,
        messages,
      };
    }
    if (result.toolCalls.length === 0) {
      return {
        text: result.content,
        notices,
        failure: null,
        rounds,
        toolCalls: executedCalls,
        messages,
      };
    }
    if (lastRound) {
      // No tools were offered on the last call, so anything the model
      // improvises is answered from its text alone.
      return {
        text: result.content,
        notices,
        failure: null,
        rounds,
        toolCalls: executedCalls,
        messages,
      };
    }
    const step = await runLoopRound({
      aiId: deps.aiId,
      messages,
      result,
      previousSignature,
      executedCalls,
      ...(deps.executeTool === undefined ? {} : { executeTool: deps.executeTool }),
      logger: deps.logger,
      secrets,
      ...(deps.reportProgress === undefined ? {} : { reportProgress: deps.reportProgress }),
      progressPosted,
      actionOf: (tool, argsJson) => actionOfCall(tool, argsJson),
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
  void turnLogger;
  return { text: null, notices, failure: null, rounds, toolCalls: executedCalls, messages };
}

// T-0106: reads the adapter name out of a `request_action` call's arguments
// for the progress stage lookup. Anything unparsable (or any other tool)
// yields undefined, and the stage falls back to the tool name's entry.
function actionOfCall(tool: string, argsJson: string): string | undefined {
  if (tool !== REQUEST_ACTION_TOOL) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(argsJson);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const action = (parsed as { action?: unknown }).action;
      if (typeof action === 'string' && action !== '') {
        return action;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

// Lifts a parsed `request_action` / `update_persona` / `revert_persona`
// shape into the `ValidToolCall` the executor understands. The call id
// comes from the wire; everything else is already validated by zod.
function toCall(parsed: ParsedToolArgumentsOk, id: string): ValidToolCall {
  if (parsed.tool === UPDATE_PERSONA_TOOL) {
    return {
      id,
      tool: UPDATE_PERSONA_TOOL,
      persona: parsed.persona,
      summary: parsed.summary,
    };
  }
  if (parsed.tool === REVERT_PERSONA_TOOL) {
    return { id, tool: REVERT_PERSONA_TOOL };
  }
  return {
    id,
    tool: REQUEST_ACTION_TOOL,
    action: parsed.action,
    args: parsed.args,
  };
}

// A narrowed view of `ParsedToolArguments` for the cases that have already
// been verified `ok: true`; the helper above only runs in that branch.
type ParsedToolArgumentsOk = Extract<ParsedToolArguments, { ok: true }>;

// Rebuilds the error with every secret redacted out of its message, so the
// logger (which prints `err.message` and `err.stack`) can never leak a key.
// Assert on `err.message` and `err.stack`, never on `JSON.stringify(err)`.
function redactError(error: unknown, secrets: readonly string[]): Error {
  if (error instanceof Error) {
    const redacted = new Error(redactSecrets(error.message, secrets));
    redacted.name = error.name;
    const stack = error.stack ?? '';
    const messageIndex = stack.indexOf(error.message);
    redacted.stack =
      messageIndex < 0
        ? redactSecrets(stack, secrets)
        : `${stack.slice(0, messageIndex)}${redactSecrets(error.message, secrets)}${redactSecrets(stack.slice(messageIndex + error.message.length), secrets)}`;
    return redacted;
  }
  return new Error(redactSecrets(String(error), secrets));
}

export interface GroupTurnDeps {
  aiId: string;
  /** Bare JID of the room the reply goes to. */
  roomJid: string;
  /** The room message that mentioned the AI; the reply points at it. */
  triggerId: string;
  /** Bare JID of the mentioning person, carried on the reply mention. */
  senderJid: string;
  /** Display name of the mentioner, prefixing the reply text. */
  senderName: string;
  messages: ChatCompletionMessage[];
  baseUrl: string;
  virtualKey: string;
  model: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  sendMessage: (
    to: string,
    kind: ChatKind,
    text: string,
    opts: SendMessageOptions,
  ) => Promise<unknown>;
  sendTyping: (to: string, kind: ChatKind, state: 'composing' | 'paused') => void;
  logger: {
    warn: (fields: Record<string, unknown>, message: string) => void;
  };
  /** Extra secrets to redact from every log line (e.g. the master key). */
  secrets?: readonly string[];
  /**
   * Tools to advertise to the model. Absent (or empty) = today's plain
   * `completeChat` path, unchanged. When present and the model asks for a
   * tool, each call is validated and executed through `executeTool`, the
   * results go back for exactly one follow-up call, and the final text is
   * sent into the room with the `@Name` prefix and the trigger's `replyTo`
   * (T-0098). Persona tools are never offered in a group turn: only the
   * `request_action` tool may be in this list.
   */
  tools?: ChatToolDefinition[];
  executeTool?: ExecuteToolCall;
  /** T-0106: how many tool rounds this turn may run. Defaults to 1:
   * first model call with tools, execute, exactly one follow-up call —
   * today's behaviour, byte for byte. The gateway passes
   * `AGENT_TOOL_MAX_ROUNDS` (6 when `TOOLS_ENABLED` is on). */
  maxRounds?: number;
  /** T-0106: checked before every model call (budget + kill switch). See
   * `DmTurnDeps.checkRoundGate`. */
  checkRoundGate?: () => Promise<{ limited: boolean; reply: string } | null>;
  /** T-0106: wall-clock start of the turn (ms). Defaults to `Date.now()`. */
  turnStartMs?: number;
  /** T-0106: `Date.now` seam for the wall-clock cap. Defaults to Date.now. */
  nowMs?: () => number;
  /** T-0106: posts/updates one live progress message. See
   * `DmTurnDeps.reportProgress`. */
  reportProgress?: (stage: string) => Promise<string | null>;
  /** T-0106: removes or replaces the live progress message. See
   * `DmTurnDeps.clearProgress`. */
  clearProgress?: () => Promise<void>;
  /** T-0106: counts logger. Defaults to a no-op (the group path has no
   * info logger today). */
  turnLogger?: {
    info: (fields: Record<string, unknown>, message: string) => void;
  };
}

// Runs one group turn: typing on, one model call (plain or tool loop),
// reply into the room, typing off. The plain path is today's behaviour:
// no tools advertised, and improvised tool calls the model sneaks in are
// answered `invalid: unknown tool` (T-0098: a plain member must never
// reach the action gateway). The tool path is the DM tool
// loop applied to a room: one model call with tools, parsed calls run
// through `executeTool`, one follow-up call, then the final text is sent
// with the `@Name` prefix and `replyTo` on the trigger. A model failure
// posts the honest failure text in the room (never the raw error). XMPP
// send failures are logged, never thrown.
export async function runGroupTurn(deps: GroupTurnDeps): Promise<DmTurnOutcome> {
  const secrets = [deps.virtualKey, ...(deps.secrets ?? [])];
  // The mention needs a non-empty name for its offsets: fall back to the
  // sender's JID when no display name is known.
  const name = deps.senderName.trim() === '' ? deps.senderJid : deps.senderName.trim();
  const wire = (text: string): { text: string; opts: SendMessageOptions } => ({
    text: `@${name} ${text}`,
    opts: {
      replyTo: { id: deps.triggerId },
      mentions: [{ jid: deps.senderJid.toLowerCase(), begin: 0, end: name.length + 1 }],
    },
  });
  const completionInput = {
    baseUrl: deps.baseUrl,
    virtualKey: deps.virtualKey,
    model: deps.model,
    ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }),
    ...(deps.timeoutMs === undefined ? {} : { timeoutMs: deps.timeoutMs }),
    ...(deps.secrets === undefined ? {} : { secrets: deps.secrets }),
  };
  deps.sendTyping(deps.roomJid, 'groupchat', 'composing');
  try {
    if (deps.tools !== undefined && deps.tools.length > 0 && deps.executeTool !== undefined) {
      return await runGroupToolTurn(deps, completionInput, secrets, wire);
    }
    const first = await requestCompletion({
      ...completionInput,
      messages: deps.messages,
    });
    if (first.toolCalls.length === 0) {
      if (first.content === null) {
        throw new ChatCompletionError(200, 'empty reply from the model');
      }
      return await sendGroupReply(deps, secrets, wire(first.content));
    }
    // No tools were advertised, so any tool call the model improvised is
    // invalid: answer `invalid: unknown tool` for each call and make one
    // follow-up call. `executeTool` is deliberately not invoked, so a
    // plain member can never reach the action gateway even when the model
    // tries. A follow-up with no text falls back to the honest failure
    // text, exactly like the tool loop.
    const { toolMessages } = await executeToolCalls({
      toolCalls: first.toolCalls,
      aiId: deps.aiId,
      logger: deps.logger,
      secrets,
    });
    const second = await requestCompletion({
      ...completionInput,
      messages: followUpMessages(deps.messages, first, toolMessages),
    });
    return await sendGroupReply(deps, secrets, wire(second.content ?? TRANSIENT_FAILURE_REPLY));
  } catch (error) {
    const reply = mapFailureToReply(error);
    deps.logger.warn({ err: redactError(error, secrets), aiId: deps.aiId }, 'AI reply failed');
    const outgoing = wire(reply);
    try {
      await deps.sendMessage(deps.roomJid, 'groupchat', outgoing.text, outgoing.opts);
    } catch (sendError) {
      deps.logger.warn(
        { err: redactError(sendError, secrets), aiId: deps.aiId },
        'AI failure reply could not be sent',
      );
      return { kind: 'failed', text: '' };
    }
    return { kind: 'failed', text: outgoing.text };
  } finally {
    deps.sendTyping(deps.roomJid, 'groupchat', 'paused');
  }
}

// The group variant of the DM tool loop. Same parse / execute / follow-up
// rules as `runToolTurn`; the only difference is the final send goes to
// the room with `@Name` and `replyTo` instead of to the owner's DM.
//
// T-0106: with `maxRounds` (default 1) the turn runs the shared
// multi-round `runToolLoop` instead. `maxRounds: 1` keeps today's behaviour
// byte for byte: first call with tools, execute, exactly one follow-up
// call. The plain-member guard is unchanged: only an advertised tool may
// run, through `executeAdvertised`.
async function runGroupToolTurn(
  deps: GroupTurnDeps,
  completionInput: {
    baseUrl: string;
    virtualKey: string;
    model: string;
    fetchImpl?: FetchLike;
    timeoutMs?: number;
    secrets?: readonly string[];
  },
  secrets: string[],
  wire: (text: string) => { text: string; opts: SendMessageOptions },
): Promise<DmTurnOutcome> {
  const tools = deps.tools ?? [];
  const maxRounds = deps.maxRounds ?? 1;
  // `maxRounds: 1` (the default) keeps today's behaviour byte for byte.
  if (maxRounds <= 1) {
    const first = await requestCompletion({
      ...completionInput,
      messages: deps.messages,
      tools,
    });
    if (first.toolCalls.length === 0) {
      if (first.content === null) {
        throw new ChatCompletionError(200, 'empty reply from the model');
      }
      return await sendGroupReply(deps, secrets, wire(first.content));
    }
    // Only a tool that was advertised may run: anything else the model
    // improvises (a persona tool, say) is answered `invalid: unknown tool`.
    const advertised = new Set(tools.map((tool) => tool.function.name));
    const execute = deps.executeTool;
    const executeAdvertised: ExecuteToolCall | undefined =
      execute === undefined
        ? undefined
        : (call) =>
            advertised.has(call.tool)
              ? execute(call)
              : Promise.resolve({ content: 'invalid: unknown tool' });
    const { toolMessages, notices } = await executeToolCalls({
      toolCalls: first.toolCalls,
      aiId: deps.aiId,
      ...(executeAdvertised === undefined ? {} : { executeTool: executeAdvertised }),
      logger: deps.logger,
      secrets,
    });
    let text: string;
    try {
      const second = await requestCompletion({
        ...completionInput,
        messages: followUpMessages(deps.messages, first, toolMessages),
        tools,
      });
      // A second response that asks for tools again is answered from its text
      // alone: those calls are ignored and there is never a third model call.
      text = (second.content ?? TRANSIENT_FAILURE_REPLY) + notices.join('');
    } catch (error) {
      // The persona change (or any other notice) from the first call stays,
      // so the failure text rides along with whatever was already earned.
      const failure = mapFailureToReply(error);
      deps.logger.warn({ err: redactError(error, secrets), aiId: deps.aiId }, 'AI reply failed');
      const text = failure + notices.join('');
      return await sendGroupReply(deps, secrets, wire(text), { failure: true });
    }
    return await sendGroupReply(deps, secrets, wire(text));
  }

  const startedAt = deps.turnStartMs ?? (deps.nowMs ?? Date.now)();
  const nowMs = deps.nowMs ?? Date.now;
  const turnLogger = deps.turnLogger ?? { info: () => undefined };
  const advertised = new Set(tools.map((tool) => tool.function.name));
  const execute = deps.executeTool;
  const executeAdvertised: ExecuteToolCall | undefined =
    execute === undefined
      ? undefined
      : (call) =>
          advertised.has(call.tool)
            ? execute(call)
            : Promise.resolve({ content: 'invalid: unknown tool' });
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
      ...(executeAdvertised === undefined ? {} : { executeTool: executeAdvertised }),
      logger: deps.logger,
      turnLogger,
      secrets,
      ...(deps.checkRoundGate === undefined ? {} : { checkRoundGate: deps.checkRoundGate }),
      turnStartMs: startedAt,
      nowMs,
      ...(deps.reportProgress === undefined ? {} : { reportProgress: deps.reportProgress }),
      actionOf: (tool, argsJson) => actionOfCall(tool, argsJson),
    });
  } catch (error) {
    const failure = mapFailureToReply(error);
    deps.logger.warn({ err: redactError(error, secrets), aiId: deps.aiId }, 'AI reply failed');
    return await sendGroupReply(deps, secrets, wire(failure), { failure: true });
  }
  const elapsedMs = nowMs() - startedAt;
  turnLogger.info(
    { aiId: deps.aiId, rounds: loop.rounds, toolCalls: loop.toolCalls, elapsedMs },
    'AI tool turn finished',
  );
  if (loop.failure !== null) {
    if (deps.clearProgress !== undefined) {
      await clearProgressQuietly(deps, secrets);
    }
    return await sendGroupReply(deps, secrets, wire(loop.failure.reply + loop.notices.join('')), {
      failure: true,
    });
  }
  if (loop.text === null) {
    // The caps stopped the loop with no text: one last call without tools
    // so the AI must answer in text.
    let text: string;
    try {
      const last = await requestCompletion({
        ...completionInput,
        messages: loop.messages,
      });
      text = (last.content ?? TRANSIENT_FAILURE_REPLY) + loop.notices.join('');
    } catch (error) {
      const failure = mapFailureToReply(error);
      deps.logger.warn({ err: redactError(error, secrets), aiId: deps.aiId }, 'AI reply failed');
      if (deps.clearProgress !== undefined) {
        await clearProgressQuietly(deps, secrets);
      }
      return await sendGroupReply(deps, secrets, wire(failure + loop.notices.join('')), {
        failure: true,
      });
    }
    if (deps.clearProgress !== undefined) {
      await clearProgressQuietly(deps, secrets);
    }
    return await sendGroupReply(deps, secrets, wire(text));
  }
  if (deps.clearProgress !== undefined) {
    await clearProgressQuietly(deps, secrets);
  }
  return await sendGroupReply(deps, secrets, wire(loop.text + loop.notices.join('')));
}

// Sends the text into the room and shapes the outcome. A failure flag is
// carried so the result mirrors the success / failure paths the DM tool
// loop returns (today's `runToolTurn` returns `{ kind: 'failed', text }`
// when the second call throws).
async function sendGroupReply(
  deps: GroupTurnDeps,
  secrets: string[],
  outgoing: { text: string; opts: SendMessageOptions },
  options: { failure: boolean } = { failure: false },
): Promise<DmTurnOutcome> {
  try {
    await deps.sendMessage(deps.roomJid, 'groupchat', outgoing.text, outgoing.opts);
  } catch (error) {
    deps.logger.warn(
      { err: redactError(error, secrets), aiId: deps.aiId },
      'AI group reply could not be sent',
    );
    return { kind: 'failed', text: '' };
  }
  return options.failure
    ? { kind: 'failed', text: outgoing.text }
    : { kind: 'replied', text: outgoing.text };
}

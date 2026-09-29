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
}

export type DmTurnOutcome = { kind: 'replied'; text: string } | { kind: 'failed'; text: string };

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

// The second half of a tool turn: execute every call, feed the results back
// for exactly one more model call, then send the text plus any notices. The
// per-call execution is shared with groups through `executeToolCalls`. A
// second response that asks for tools again is answered from its text alone:
// those calls are ignored and there is never a third model call.
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
  const { toolMessages, notices } = await executeToolCalls({
    toolCalls: first.toolCalls,
    aiId: deps.aiId,
    ...(deps.executeTool === undefined ? {} : { executeTool: deps.executeTool }),
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
  const { toolMessages, notices } = await executeToolCalls({
    toolCalls: first.toolCalls,
    aiId: deps.aiId,
    ...(deps.executeTool === undefined ? {} : { executeTool: deps.executeTool }),
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

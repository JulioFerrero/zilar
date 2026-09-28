import { z } from 'zod';
import type { ChatKind, SendMessageOptions } from '@galena/xmpp-core';
import { LitellmApiError, redactSecrets, type FetchLike } from '../ai/litellm-client';
import type { ChatCompletionMessage } from './context';
import { ChatStreamInterruptedError, consumeChatCompletionStream } from './stream';
import {
  PERSONA_TOOLS,
  REVERT_PERSONA_TOOL,
  UPDATE_PERSONA_TOOL,
  parseToolArguments,
  safeToolName,
  type ChatToolDefinition,
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
  | { id: string; tool: typeof REVERT_PERSONA_TOOL };

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
      tools: PERSONA_TOOLS,
    });
    if (first.toolCalls.length === 0) {
      if (first.content === null) {
        throw new ChatCompletionError(200, 'empty reply from the model');
      }
      return await sendReply(deps, first.content);
    }
    return await runToolTurn(deps, completionInput, first, secrets);
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

// The second half of a tool turn: execute every call, feed the results back
// for one more model call, then send the text plus the fixed persona lines.
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
): Promise<DmTurnOutcome> {
  const notices: string[] = [];
  const toolMessages: ModelRequestMessage[] = [];
  for (const call of first.toolCalls) {
    const parsed = parseToolArguments(call.name, call.argsJson);
    if (!parsed.ok) {
      // Never executed. The arguments stay out of the log entirely: only the
      // tool name travels with the AI id, never the persona text.
      deps.logger.warn(
        { aiId: deps.aiId, tool: safeToolName(call.name) },
        'AI tool call was not executed',
      );
      toolMessages.push({
        role: 'tool',
        content: `invalid: ${parsed.reason}`,
        tool_call_id: call.id,
      });
      continue;
    }
    if (deps.executeTool === undefined) {
      deps.logger.warn(
        { aiId: deps.aiId, tool: safeToolName(call.name) },
        'AI tool call was not executed',
      );
      toolMessages.push({
        role: 'tool',
        content: `invalid: unknown tool: ${safeToolName(call.name)}`,
        tool_call_id: call.id,
      });
      continue;
    }
    let execution: ToolExecution;
    try {
      execution = await deps.executeTool(
        parsed.tool === UPDATE_PERSONA_TOOL
          ? {
              id: call.id,
              tool: UPDATE_PERSONA_TOOL,
              persona: parsed.persona,
              summary: parsed.summary,
            }
          : { id: call.id, tool: REVERT_PERSONA_TOOL },
      );
    } catch (error) {
      // One call failing must not drop the others or the notices already
      // earned: the change (if any) stays, this call reports a failure, and
      // the loop continues with the remaining calls.
      deps.logger.warn(
        {
          aiId: deps.aiId,
          tool: safeToolName(call.name),
          ok: false,
          err: redactError(error, secrets),
        },
        'AI tool call failed',
      );
      toolMessages.push({
        role: 'tool',
        content: 'failed: could not save',
        tool_call_id: call.id,
      });
      continue;
    }
    if (execution.notice !== undefined) {
      notices.push(execution.notice);
    }
    toolMessages.push({ role: 'tool', content: execution.content, tool_call_id: call.id });
  }

  const followUp: ModelRequestMessage[] = [
    ...deps.messages,
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

  let text: string;
  try {
    const second = await requestCompletion({
      ...completionInput,
      messages: followUp,
      tools: PERSONA_TOOLS,
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
}

// Runs one group turn: typing on, one plain model call, reply into the room,
// typing off. No persona tools in groups: only the owner may reshape the AI,
// and only in the DM. The reply points at the triggering message and mentions
// the sender (`@Name text`, with the mention offsets on the `@Name` span). A
// model failure posts the same honest failure text DMs use, in the room —
// never the raw error. XMPP send failures are logged, never thrown.
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
  deps.sendTyping(deps.roomJid, 'groupchat', 'composing');
  try {
    const text = await completeChat({
      baseUrl: deps.baseUrl,
      virtualKey: deps.virtualKey,
      model: deps.model,
      messages: deps.messages,
      ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }),
      ...(deps.timeoutMs === undefined ? {} : { timeoutMs: deps.timeoutMs }),
      ...(deps.secrets === undefined ? {} : { secrets: deps.secrets }),
    });
    const outgoing = wire(text);
    try {
      await deps.sendMessage(deps.roomJid, 'groupchat', outgoing.text, outgoing.opts);
    } catch (error) {
      deps.logger.warn(
        { err: redactError(error, secrets), aiId: deps.aiId },
        'AI group reply could not be sent',
      );
      return { kind: 'failed', text: '' };
    }
    return { kind: 'replied', text: outgoing.text };
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

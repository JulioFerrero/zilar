import { z } from 'zod';
import type { ChatKind } from '@galena/xmpp-core';
import { LitellmApiError, redactSecrets, type FetchLike } from '../ai/litellm-client';
import type { ChatCompletionMessage } from './context';

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

const ChatCompletionsResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullable().optional() }).optional(),
      }),
    )
    .min(1),
});

export interface CompleteChatInput {
  baseUrl: string;
  virtualKey: string;
  model: string;
  messages: ChatCompletionMessage[];
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  /** Extra secrets to redact from every error (e.g. the master key). */
  secrets?: readonly string[];
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
// virtual key. Throws ChatCompletionError (redacted) on any failure.
export async function completeChat(input: CompleteChatInput): Promise<string> {
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
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'network error';
    throw new ChatCompletionError(0, redactSecrets(message, secrets));
  }

  const text = await response.text();
  let body: unknown = null;
  if (text !== '') {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!response.ok || hasErrorBody(body)) {
    throw new ChatCompletionError(response.status, redactSecrets(errorDetail(body), secrets));
  }

  const parsed = ChatCompletionsResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new ChatCompletionError(200, 'unexpected response shape');
  }
  const content = parsed.data.choices[0]?.message?.content?.trim() ?? '';
  if (content === '') {
    throw new ChatCompletionError(200, 'empty reply from the model');
  }
  return content;
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
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  sendMessage: (to: string, kind: ChatKind, text: string) => Promise<unknown>;
  sendTyping: (to: string, kind: ChatKind, state: 'composing' | 'paused') => void;
  logger: { warn: (fields: Record<string, unknown>, message: string) => void };
  /** Extra secrets to redact from every log line (e.g. the master key). */
  secrets?: readonly string[];
}

export type DmTurnOutcome = { kind: 'replied'; text: string } | { kind: 'failed'; text: string };

// Runs one turn: typing on, model call, reply into the DM, typing off. A model
// failure posts the honest failure text instead — never the raw error. XMPP
// send failures are logged, never thrown: there is nobody left to tell.
export async function runDmTurn(deps: DmTurnDeps): Promise<DmTurnOutcome> {
  const secrets = [deps.virtualKey, ...(deps.secrets ?? [])];
  deps.sendTyping(deps.ownerJid, 'chat', 'composing');
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

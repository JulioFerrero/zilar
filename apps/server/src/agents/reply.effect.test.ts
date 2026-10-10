import { describe, expect, it } from 'vitest';
import type { FetchLike } from '../ai/litellm-client';
import type { ChatCompletionMessage } from './context';
import { ChatCompletionError, completeChat } from './reply';
import { jsonResponse } from '../test-support/wait';

const VIRTUAL_KEY = 'sk-virtual-effect-turn-test-key-aaaa';
const MODEL = 'ai-abc-123';
const BASE_URL = 'http://litellm.test:4000';

const MESSAGES: ChatCompletionMessage[] = [
  { role: 'system', content: 'Be helpful.' },
  { role: 'user', content: 'hello' },
];

// An SSE body that emits a first delta and then never closes: the stream read
// hangs until the Effect deadline interrupts it.
function openSseResponse(): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"half"}}]}\n\n'));
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

async function complete(
  fetchImpl: FetchLike,
  timeoutMs?: number,
): Promise<string | ChatCompletionError> {
  return completeChat({
    baseUrl: BASE_URL,
    virtualKey: VIRTUAL_KEY,
    model: MODEL,
    messages: MESSAGES,
    fetchImpl,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  }).catch((cause: unknown) => cause as ChatCompletionError);
}

describe('requestCompletion on Effect', () => {
  it('aborts the fetch signal on a stream-read timeout without leaking the key', async () => {
    const captured: { signal: AbortSignal | null } = { signal: null };
    const fetchImpl: FetchLike = (_url, init) => {
      captured.signal = init.signal ?? null;
      return Promise.resolve(openSseResponse());
    };
    const error = await complete(fetchImpl, 30);
    expect(error).toBeInstanceOf(ChatCompletionError);
    expect((error as ChatCompletionError).status).toBe(0);
    expect((error as ChatCompletionError).message).not.toContain(VIRTUAL_KEY);
    expect(captured.signal?.aborted).toBe(true);
  });

  it('maps a non-OK provider error body to its status', async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve(jsonResponse({ error: { message: 'provider is down' } }, 503));
    const error = await complete(fetchImpl);
    expect(error).toBeInstanceOf(ChatCompletionError);
    expect((error as ChatCompletionError).status).toBe(503);
    expect((error as ChatCompletionError).message).toContain('provider is down');
  });

  it('maps an OK response that carries an error body to that status', async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve(jsonResponse({ error: 'provider exploded' }, 200));
    const error = await complete(fetchImpl);
    expect(error).toBeInstanceOf(ChatCompletionError);
    expect((error as ChatCompletionError).status).toBe(200);
    expect((error as ChatCompletionError).message).toContain('provider exploded');
  });

  it('parses a JSON response with extra unknown fields', async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve(
        jsonResponse({
          id: 'chatcmpl-1',
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'plain answer', extra: true },
              finish_reason: 'stop',
            },
          ],
          usage: { total_tokens: 3 },
        }),
      );
    const text = await complete(fetchImpl);
    expect(text).toBe('plain answer');
  });
});

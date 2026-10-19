import { AiError } from 'effect/ai';
import { describe, expect, it } from 'vitest';
import { mapFailureToReply } from '../agents/tool-exec';
import { PROVIDER_KEY_REJECTED_REPLY } from '../agents/replies';
import type { FetchLike } from './http';
import { ChatCompletionError, chat, chatErrorFromAiError } from './model-client';

const TARGET = {
  provider: 'deepseek' as const,
  apiKey: 'sk-model-client-test',
  model: 'deepseek-chat',
};

describe('chatErrorFromAiError', () => {
  it('maps a rejected key to its reply text', () => {
    const error = chatErrorFromAiError(
      AiError.make({
        module: 'test',
        method: 'chat',
        reason: new AiError.AuthenticationError({ kind: 'InvalidKey' }),
      }),
    );
    expect(error.status).toBe(401);
    expect(mapFailureToReply(error)).toBe(PROVIDER_KEY_REJECTED_REPLY);
  });
});

describe('chat', () => {
  it('does not retry a call that already streamed, even without onDelta', async () => {
    const encoder = new TextEncoder();
    let calls = 0;
    const fetchImpl: FetchLike = () => {
      calls += 1;
      let pulled = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulled += 1;
          if (pulled === 1) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  id: 'chatcmpl-1',
                  object: 'chat.completion.chunk',
                  created: 0,
                  model: 'deepseek-chat',
                  choices: [
                    { index: 0, delta: { content: 'partial answer' }, finish_reason: null },
                  ],
                })}\n\n`,
              ),
            );
            return;
          }
          // The stream drops after the delta, with no `finish` part.
          controller.error(new Error('connection dropped'));
        },
      });
      return Promise.resolve(
        new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
      );
    };

    await expect(
      chat({
        target: TARGET,
        messages: [{ role: 'user', content: 'hello' }],
        timeoutMs: 5_000,
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(ChatCompletionError);

    // One paid call: the delta already reached the provider, so the drop is
    // never retried.
    expect(calls).toBe(1);
  });

  it('gives the retry only what is left of the deadline', async () => {
    const timeoutMs = 6_000;
    const startedAt = Date.now();
    const callStarts: number[] = [];
    const fetchImpl: FetchLike = (_url, init) => {
      callStarts.push(Date.now());
      if (callStarts.length === 1) {
        return Promise.reject(new Error('connection refused'));
      }
      // The retry hangs: only the remaining deadline may stop it.
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    };

    await expect(
      chat({
        target: TARGET,
        messages: [{ role: 'user', content: 'hello' }],
        timeoutMs,
        fetchImpl,
      }),
    ).rejects.toMatchObject({ status: 0 });

    expect(callStarts).toHaveLength(2);
    const elapsed = Date.now() - startedAt;
    // The call ends at the deadline (one window), not at the deadline plus a
    // fresh full timeout on the retry.
    expect(elapsed).toBeGreaterThanOrEqual(5_000);
    expect(elapsed).toBeLessThan(timeoutMs + 1_000);
  });
});

import { AiError } from 'effect/ai';
import { describe, expect, it } from 'vitest';
import { mapFailureToReply } from '../agents/tool-exec';
import {
  PROVIDER_KEY_REJECTED_REPLY,
  RATE_LIMITED_REPLY,
  TRANSIENT_FAILURE_REPLY,
} from '../agents/replies';
import type { FetchLike } from './http';
import { ChatCompletionError, chat, chatErrorFromAiError } from './model-client';
import { toPrompt, toToolkit, type ModelRequestMessage } from './model-prompt';

const RECALL_TOOL = {
  type: 'function' as const,
  function: {
    name: 'recall',
    description: 'Search my memory.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
      additionalProperties: false,
    },
  },
};

const TARGET = {
  provider: 'deepseek' as const,
  apiKey: 'sk-model-client-test',
  model: 'deepseek-chat',
};

interface AnyPart {
  type: string;
  [key: string]: unknown;
}

// A decoded prompt message's parts, whatever its role.
function partsOf(message: { content: unknown }): ReadonlyArray<AnyPart> {
  return Array.isArray(message.content) ? (message.content as ReadonlyArray<AnyPart>) : [];
}

describe('toPrompt', () => {
  it('keeps the roles and turns assistant tool calls and tool results into parts', () => {
    const messages: ModelRequestMessage[] = [
      { role: 'system', content: 'system text' },
      { role: 'user', content: 'hello' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'recall', arguments: '{"query":"cats"}' },
          },
        ],
      },
      { role: 'tool', content: 'ok', tool_call_id: 'call-1' },
    ];

    const prompt = toPrompt(messages);
    expect(prompt.content.map((message) => message.role)).toEqual([
      'system',
      'user',
      'assistant',
      'tool',
    ]);

    const assistant = prompt.content[2];
    const call =
      assistant === undefined
        ? undefined
        : partsOf(assistant).find((part) => part.type === 'tool-call');
    expect(call).toBeDefined();
    expect(call?.name).toBe('recall');
    expect(call?.params).toEqual({ query: 'cats' });

    const tool = prompt.content[3];
    const result =
      tool === undefined ? undefined : partsOf(tool).find((part) => part.type === 'tool-result');
    expect(result?.name).toBe('recall');
    expect(result?.result).toBe('ok');
  });
});

describe('toToolkit', () => {
  it('exposes each definition under its own name, and nothing for an empty list', () => {
    const toolkit = toToolkit([RECALL_TOOL]);
    expect(toolkit === undefined ? undefined : Object.keys(toolkit.tools)).toEqual(['recall']);
    expect(toToolkit([])).toBeUndefined();
  });
});

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

  it('maps a rate limit to its reply text', () => {
    const error = chatErrorFromAiError(
      AiError.make({
        module: 'test',
        method: 'chat',
        reason: new AiError.RateLimitError({}),
      }),
    );
    expect(error.status).toBe(429);
    expect(mapFailureToReply(error)).toBe(RATE_LIMITED_REPLY);
  });

  it('keeps a 429 provider message in the detail instead of a fixed string', () => {
    const error = chatErrorFromAiError(
      AiError.make({
        module: 'test',
        method: 'chat',
        reason: new AiError.RateLimitError({
          http: {
            request: {
              method: 'POST',
              url: 'https://api.deepseek.com/chat/completions',
              urlParams: [],
              headers: {},
            },
            response: { status: 429, headers: {} },
            body: JSON.stringify({ error: { message: 'model deepseek-chat not found' } }),
          },
        }),
      }),
    );
    expect(error.status).toBe(429);
    expect(error.detail).toBe('model deepseek-chat not found');
  });

  it('maps a response-carrying unknown error to its real non-retryable status', () => {
    const error = chatErrorFromAiError(
      AiError.make({
        module: 'test',
        method: 'chat',
        reason: new AiError.UnknownError({
          description: 'payment required',
          http: {
            request: {
              method: 'POST',
              url: 'https://api.deepseek.com/chat/completions',
              urlParams: [],
              headers: {},
            },
            response: { status: 402, headers: {} },
            body: JSON.stringify({ error: { message: 'payment required' } }),
          },
        }),
      }),
    );
    expect(error.status).toBe(402);
    expect(mapFailureToReply(error)).toBe(TRANSIENT_FAILURE_REPLY);
  });
});

describe('chat', () => {
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

  it('never retries a malformed tool-args chunk and fails as a provider error', async () => {
    let calls = 0;
    const fetchImpl: FetchLike = () => {
      calls += 1;
      const body = [
        `data: ${JSON.stringify({
          id: 'chatcmpl-1',
          object: 'chat.completion.chunk',
          created: 0,
          model: 'deepseek-chat',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call-1',
                    type: 'function',
                    function: { name: 'recall', arguments: '{not json' },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        })}\n\n`,
        'data: [DONE]\n\n',
      ].join('');
      return Promise.resolve(
        new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
      );
    };

    await expect(
      chat({
        target: TARGET,
        messages: [{ role: 'user', content: 'hello' }],
        tools: [RECALL_TOOL],
        timeoutMs: 5_000,
        fetchImpl,
      }),
    ).rejects.toMatchObject({ status: 200 });

    // The bad chunk is an answer, not a transport hiccup: one call only.
    expect(calls).toBe(1);
  });

  it('does not retry an unmapped HTTP status and fails as a provider error', async () => {
    let calls = 0;
    const fetchImpl: FetchLike = () => {
      calls += 1;
      return Promise.resolve(
        new Response(JSON.stringify({ error: { message: 'payment required' } }), {
          status: 402,
          headers: { 'content-type': 'application/json' },
        }),
      );
    };

    await expect(
      chat({
        target: TARGET,
        messages: [{ role: 'user', content: 'hello' }],
        timeoutMs: 5_000,
        fetchImpl,
      }),
    ).rejects.toMatchObject({ status: 402 });

    // A real HTTP answer, not a transport hiccup: one call only.
    expect(calls).toBe(1);
  });
});

describe('chatErrorFromAiError for SDK-side failures', () => {
  it('maps a malformed chunk to a non-retryable status and the transient reply', () => {
    const reasons = [
      new AiError.ToolParameterValidationError({
        toolName: 'recall',
        description: 'Failed to securely JSON parse tool parameters',
      }),
      new AiError.InvalidOutputError({ description: 'unexpected response shape' }),
    ];
    for (const reason of reasons) {
      const error = chatErrorFromAiError(AiError.make({ module: 'test', method: 'chat', reason }));
      expect(error.status).toBe(200);
      expect(mapFailureToReply(error)).toBe(TRANSIENT_FAILURE_REPLY);
    }
  });
});

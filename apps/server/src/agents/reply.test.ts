import { describe, expect, it } from 'vitest';
import type { FetchLike } from '../ai/http';
import type { ModelTarget } from '../ai/providers';
import { runDmTurn } from './dm-turn';
import {
  CONTEXT_TOO_LONG_REPLY,
  MODEL_NOT_FOUND_REPLY,
  RATE_LIMITED_REPLY,
  BUDGET_EXCEEDED_REPLY,
  PROVIDER_KEY_REJECTED_REPLY,
  TRANSIENT_FAILURE_REPLY,
} from './replies';
// The barrel does not re-export `redactError` or `requestCompletion`;
// importing them here keeps this task to tests with no barrel change.
import { redactError, mapFailureToReply } from './tool-exec';
import { ChatCompletionError } from '../ai/model-client';
import {
  requestCompletion,
  TOOL_TURN_MAX_CALLS,
  type ExecuteToolCall,
  type ModelRequestMessage,
} from './tool-loop';
import { runToolLoop } from './tool-rounds';

const TARGET: ModelTarget = {
  provider: 'deepseek',
  apiKey: 'sk-virtual',
  model: 'test-model',
};

// The transport streams, so every fake answers with OpenAI-compatible SSE.
function sse(events: readonly string[]): Response {
  return new Response(events.join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function chunk(delta: Record<string, unknown>, finishReason: string | null): string {
  return `data: ${JSON.stringify({
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'test-model',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;
}

function usageLine(): string {
  return `data: ${JSON.stringify({
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'test-model',
    choices: [],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  })}\n\n`;
}

// One round that asks for one valid `recall` call.
function toolCallResponse(id: string, query: string): Response {
  return sse([
    chunk(
      {
        tool_calls: [
          {
            index: 0,
            id,
            type: 'function',
            function: { name: 'recall', arguments: JSON.stringify({ query }) },
          },
        ],
      },
      'tool_calls',
    ),
    usageLine(),
    'data: [DONE]\n\n',
  ]);
}

function textResponse(content: string): Response {
  return sse([chunk({ content }, null), chunk({}, 'stop'), usageLine(), 'data: [DONE]\n\n']);
}

const silentLogger = { warn: () => undefined };
const silentTurnLogger = { info: () => undefined };

describe('mapFailureToReply', () => {
  it('maps 429 to rate limited, the budget, the key, an unknown model and a long context to their own reply', () => {
    expect(mapFailureToReply(new ChatCompletionError(429, 'rate limited'))).toBe(
      RATE_LIMITED_REPLY,
    );
    expect(mapFailureToReply(new ChatCompletionError(400, 'error: budget_exceeded'))).toBe(
      BUDGET_EXCEEDED_REPLY,
    );
    expect(mapFailureToReply(new ChatCompletionError(400, 'Budget has been exceeded'))).toBe(
      BUDGET_EXCEEDED_REPLY,
    );
    expect(mapFailureToReply(new ChatCompletionError(401, 'invalid api key'))).toBe(
      PROVIDER_KEY_REJECTED_REPLY,
    );
    expect(mapFailureToReply(new ChatCompletionError(403, 'forbidden'))).toBe(
      PROVIDER_KEY_REJECTED_REPLY,
    );
    expect(mapFailureToReply(new ChatCompletionError(404, 'model not found'))).toBe(
      MODEL_NOT_FOUND_REPLY,
    );
    expect(mapFailureToReply(new ChatCompletionError(400, 'maximum context length exceeded'))).toBe(
      CONTEXT_TOO_LONG_REPLY,
    );
    expect(mapFailureToReply(new Error('socket closed'))).toBe(TRANSIENT_FAILURE_REPLY);
  });
});

describe('requestCompletion retry', () => {
  it('retries a 429 once and answers from the second request', async () => {
    let fetchCalls = 0;
    const fetchImpl: FetchLike = async () => {
      fetchCalls += 1;
      if (fetchCalls === 1) {
        return new Response(JSON.stringify({ error: { message: 'rate limited' } }), {
          status: 429,
          headers: { 'content-type': 'application/json' },
        });
      }
      return textResponse('after the retry');
    };

    const result = await requestCompletion({
      target: TARGET,
      messages: [{ role: 'user', content: 'hi' }],
      fetchImpl,
    });

    expect(result.content).toBe('after the retry');
    expect(fetchCalls).toBe(2);
  });

  it('times out a hung request once, with no budget left to retry it', async () => {
    let fetchCalls = 0;
    const fetchImpl: FetchLike = () => {
      fetchCalls += 1;
      return new Promise<Response>(() => undefined);
    };

    await expect(
      requestCompletion({
        target: TARGET,
        messages: [{ role: 'user', content: 'hi' }],
        fetchImpl,
        timeoutMs: 100,
      }),
    ).rejects.toThrow('the request timed out');
    expect(fetchCalls).toBe(1);
  });
});

describe('redactError', () => {
  it('removes a named secret from the message and the stack, and masks credential-shaped tokens', () => {
    const secret = 'provider-key-abcd1234';
    const redacted = redactError(new Error(`could not reach the gateway with ${secret} attached`), [
      secret,
    ]);
    expect(redacted.message).not.toContain(secret);
    expect(redacted.message).toContain('[redacted]');
    expect(redacted.stack ?? '').not.toContain(secret);

    const patternOnly = redactError(new Error('sent Bearer sk-live-abcdefghijklmnop'), []);
    expect(patternOnly.message).not.toContain('sk-live-abcdefghijklmnop');
    expect(patternOnly.message).toContain('sk-***');
  });
});

describe('runToolLoop caps and redaction', () => {
  it('stops after TOOL_TURN_MAX_CALLS tool executions even when every round asks for another call', async () => {
    let fetchCalls = 0;
    const fetchImpl: FetchLike = async () => {
      fetchCalls += 1;
      return toolCallResponse(`call-${fetchCalls}`, `query-${fetchCalls}`);
    };
    let executions = 0;
    const executeTool: ExecuteToolCall = async () => {
      executions += 1;
      return { content: 'ok' };
    };
    const messages: ModelRequestMessage[] = [{ role: 'user', content: 'hi' }];

    const result = await runToolLoop({
      aiId: 'ai-1',
      messages,
      tools: [],
      completionInput: {
        target: TARGET,
        fetchImpl,
      },
      maxRounds: TOOL_TURN_MAX_CALLS + 10,
      executeTool,
      logger: silentLogger,
      turnLogger: silentTurnLogger,
      secrets: [],
      turnStartMs: 1_000,
      nowMs: () => 1_000,
    });

    expect(executions).toBe(TOOL_TURN_MAX_CALLS);
    expect(result.toolCalls).toBe(TOOL_TURN_MAX_CALLS);
    expect(result.text).toBeNull();
    // Every executed call came from exactly one round; the cap breaks the loop
    // before another model call is made.
    expect(fetchCalls).toBe(TOOL_TURN_MAX_CALLS);
  });

  it('never puts a secret thrown by executeTool into a later request body or the log', async () => {
    const secret = 'sekret-value-1234';
    const bodies: string[] = [];
    const logged: string[] = [];
    let fetchCalls = 0;
    const fetchImpl: FetchLike = async (_input, init) => {
      fetchCalls += 1;
      bodies.push(String(init.body));
      if (fetchCalls === 1) {
        return toolCallResponse('call-1', 'lookup');
      }
      return textResponse('done');
    };
    const executeTool: ExecuteToolCall = async () => {
      throw new Error(`tool blew up with ${secret}`);
    };
    const logger = {
      warn: (fields: Record<string, unknown>) => {
        const err = fields.err;
        if (err instanceof Error) {
          logged.push(err.message);
          logged.push(err.stack ?? '');
        }
        logged.push(JSON.stringify(fields));
      },
    };
    const messages: ModelRequestMessage[] = [{ role: 'user', content: 'hi' }];

    const result = await runToolLoop({
      aiId: 'ai-1',
      messages,
      tools: [],
      completionInput: {
        target: TARGET,
        fetchImpl,
      },
      maxRounds: 2,
      executeTool,
      logger,
      turnLogger: silentTurnLogger,
      secrets: [secret],
      turnStartMs: 1_000,
      nowMs: () => 1_000,
    });

    expect(result.text).toBe('done');
    expect(bodies).toHaveLength(2);
    for (const body of bodies) {
      expect(body).not.toContain(secret);
    }
    for (const line of logged) {
      expect(line).not.toContain(secret);
    }
  });
});

describe('failure logs (AI-22)', () => {
  it('carries the failure kind and status, never the provider text', async () => {
    const providerText = 'invalid api key for request {"messages":[{"content":"secret prompt"}]}';
    const fetchImpl: FetchLike = async () =>
      new Response(JSON.stringify({ error: { message: providerText } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    const calls: Array<{ fields: Record<string, unknown>; message: string }> = [];

    await runDmTurn({
      aiId: 'ai-1',
      ownerJid: 'owner@zilar.localhost',
      messages: [{ role: 'user', content: 'hi' }],
      target: TARGET,
      fetchImpl,
      sendMessage: async () => undefined,
      sendTyping: () => undefined,
      logger: {
        warn: (fields, message) => {
          calls.push({ fields, message });
        },
      },
    });

    const failure = calls.find((call) => call.message === 'AI reply failed');
    expect(failure).toBeDefined();
    expect(failure?.fields.kind).toBe('key_rejected');
    expect(failure?.fields.status).toBe(401);
    // The provider's message (which quotes request content) never reaches a log.
    expect(JSON.stringify(calls)).not.toContain(providerText);
  });
});

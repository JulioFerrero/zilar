import { describe, expect, it } from 'vitest';
import type { FetchLike } from '../ai/litellm-client';
import {
  BUDGET_EXCEEDED_REPLY,
  ChatCompletionError,
  PROVIDER_KEY_REJECTED_REPLY,
  TOOL_TURN_MAX_CALLS,
  TRANSIENT_FAILURE_REPLY,
  mapFailureToReply,
  runToolLoop,
  type ExecuteToolCall,
  type ModelRequestMessage,
} from './reply';
// The barrel does not re-export `redactError`; importing it here keeps this
// task to a new test file with no source change.
import { redactError } from './tool-exec';

// A minimal `200 application/json` chat-completions answer. The loop accepts
// the plain-JSON shape as well as SSE, so the fakes need no stream plumbing.
function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

// One round that asks for one valid `recall` call.
function toolCallResponse(id: string, query: string): Response {
  return jsonResponse({
    choices: [
      {
        message: {
          tool_calls: [
            {
              id,
              function: { name: 'recall', arguments: JSON.stringify({ query }) },
            },
          ],
        },
      },
    ],
  });
}

function textResponse(content: string): Response {
  return jsonResponse({ choices: [{ message: { content } }] });
}

const silentLogger = { warn: () => undefined };
const silentTurnLogger = { info: () => undefined };

describe('mapFailureToReply', () => {
  it('maps 429 and budget_exceeded to the budget reply, 401/403 to the key reply, the rest to transient', () => {
    expect(mapFailureToReply(new ChatCompletionError(429, 'rate limited'))).toBe(
      BUDGET_EXCEEDED_REPLY,
    );
    expect(mapFailureToReply(new ChatCompletionError(400, 'error: budget_exceeded'))).toBe(
      BUDGET_EXCEEDED_REPLY,
    );
    expect(mapFailureToReply(new ChatCompletionError(401, 'invalid api key'))).toBe(
      PROVIDER_KEY_REJECTED_REPLY,
    );
    expect(mapFailureToReply(new ChatCompletionError(403, 'forbidden'))).toBe(
      PROVIDER_KEY_REJECTED_REPLY,
    );
    expect(mapFailureToReply(new Error('socket closed'))).toBe(TRANSIENT_FAILURE_REPLY);
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
        baseUrl: 'http://litellm.test',
        virtualKey: 'sk-virtual',
        model: 'test-model',
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
        baseUrl: 'http://litellm.test',
        virtualKey: 'sk-virtual',
        model: 'test-model',
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

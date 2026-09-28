import { describe, expect, it } from 'vitest';
import type { ChatKind } from '@galena/xmpp-core';
import type { FetchLike } from '../ai/litellm-client';
import type { ChatCompletionMessage } from './context';
import {
  BUDGET_EXCEEDED_REPLY,
  ChatCompletionError,
  completeChat,
  mapFailureToReply,
  PROVIDER_KEY_REJECTED_REPLY,
  REPLY_MAX_TOKENS,
  runDmTurn,
  TRANSIENT_FAILURE_REPLY,
  type ExecuteToolCall,
  type ValidToolCall,
} from './reply';
import { formatPersonaUpdatedLine } from './tools';

const VIRTUAL_KEY = 'sk-virtual-turn-test-key-aaaa';
const MASTER_KEY = 'test-master-key-0000000000000000000000';
const MODEL = 'ai-abc-123';
const BASE_URL = 'http://litellm.test:4000';
const OWNER_JID = 'julio@galena.localhost';

const MESSAGES: ChatCompletionMessage[] = [
  { role: 'system', content: 'Be helpful.' },
  { role: 'user', content: 'hello' },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function completionResponse(content: string): Response {
  return jsonResponse({ choices: [{ message: { content } }] });
}

interface Call {
  url: string;
  init: RequestInit;
}

function createFetch(handler: (call: Call) => Response | Promise<Response>): {
  fetchImpl: FetchLike;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = (url, init) => {
    const call = { url, init };
    calls.push(call);
    return Promise.resolve(handler(call));
  };
  return { fetchImpl, calls };
}

function headersOf(call: Call): Headers {
  return new Headers(call.init.headers);
}

function bodyOf(call: Call): Record<string, unknown> {
  return JSON.parse(String(call.init.body)) as Record<string, unknown>;
}

function captureLogger() {
  const calls: Array<{ fields: Record<string, unknown>; message: string }> = [];
  return {
    warn: (fields: Record<string, unknown>, message: string) => {
      calls.push({ fields, message });
    },
    calls,
  };
}

// JSON.stringify turns an Error into `{}`, so leak assertions must read the
// message and stack off the logged error itself.
function loggedText(calls: Array<{ fields: Record<string, unknown>; message: string }>): string {
  return calls
    .map((call) => {
      const err = call.fields['err'];
      const detail =
        err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : JSON.stringify(err);
      return `${call.message}\n${detail}`;
    })
    .join('\n');
}

function turnHarness(fetchImpl: FetchLike) {
  const logger = captureLogger();
  const sent: Array<{ to: string; kind: ChatKind; text: string }> = [];
  const typing: Array<{ state: 'composing' | 'paused' }> = [];
  const run = () =>
    runDmTurn({
      aiId: 'ai-1',
      ownerJid: OWNER_JID,
      messages: MESSAGES,
      baseUrl: BASE_URL,
      virtualKey: VIRTUAL_KEY,
      model: MODEL,
      fetchImpl,
      sendMessage: (to, kind, text) => {
        sent.push({ to, kind, text });
        return Promise.resolve({ id: 'm-1' });
      },
      sendTyping: (_to, _kind, state) => {
        typing.push({ state });
      },
      logger,
      secrets: [MASTER_KEY],
    });
  return { logger, sent, typing, run };
}

describe('completeChat', () => {
  it('posts the exact request shape with the virtual key', async () => {
    const { fetchImpl, calls } = createFetch(() => completionResponse('hi there'));
    const text = await completeChat({
      baseUrl: `${BASE_URL}/`,
      virtualKey: VIRTUAL_KEY,
      model: MODEL,
      messages: MESSAGES,
      fetchImpl,
    });
    expect(text).toBe('hi there');
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe(`${BASE_URL}/chat/completions`);
    expect(call.init.method).toBe('POST');
    expect(headersOf(call).get('authorization')).toBe(`Bearer ${VIRTUAL_KEY}`);
    expect(bodyOf(call)).toEqual({
      model: MODEL,
      messages: MESSAGES,
      max_tokens: REPLY_MAX_TOKENS,
    });
  });

  it('redacts the virtual key when the error body echoes it back', async () => {
    const { fetchImpl } = createFetch(() =>
      jsonResponse({ error: { message: `bad key ${VIRTUAL_KEY} master ${MASTER_KEY}` } }, 401),
    );
    const error = await completeChat({
      baseUrl: BASE_URL,
      virtualKey: VIRTUAL_KEY,
      model: MODEL,
      messages: MESSAGES,
      fetchImpl,
      secrets: [MASTER_KEY],
    }).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ChatCompletionError);
    const apiError = error as ChatCompletionError;
    expect(apiError.status).toBe(401);
    expect(apiError.message).not.toContain(VIRTUAL_KEY);
    expect(apiError.message).not.toContain(MASTER_KEY);
    expect(apiError.message).toContain('[redacted]');
  });

  it('redacts the key from a network failure', async () => {
    const fetchImpl: FetchLike = () =>
      Promise.reject(new Error(`socket hung up, key was ${VIRTUAL_KEY}`));
    const error = await completeChat({
      baseUrl: BASE_URL,
      virtualKey: VIRTUAL_KEY,
      model: MODEL,
      messages: MESSAGES,
      fetchImpl,
    }).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ChatCompletionError);
    expect((error as ChatCompletionError).status).toBe(0);
    expect((error as ChatCompletionError).message).not.toContain(VIRTUAL_KEY);
  });

  it('rejects an unexpected shape and an empty reply without echoing the body', async () => {
    for (const response of [jsonResponse({ unexpected: VIRTUAL_KEY }), completionResponse('   ')]) {
      const { fetchImpl } = createFetch(() => response);
      const error = await completeChat({
        baseUrl: BASE_URL,
        virtualKey: VIRTUAL_KEY,
        model: MODEL,
        messages: MESSAGES,
        fetchImpl,
      }).catch((cause: unknown) => cause);
      expect(error).toBeInstanceOf(ChatCompletionError);
      expect((error as ChatCompletionError).message).not.toContain(VIRTUAL_KEY);
    }
  });
});

describe('mapFailureToReply', () => {
  it('maps each row of the failure table to the exact DM text', () => {
    expect(mapFailureToReply(new ChatCompletionError(429, 'rate limited'))).toBe(
      BUDGET_EXCEEDED_REPLY,
    );
    expect(mapFailureToReply(new ChatCompletionError(400, 'budget_exceeded for the key'))).toBe(
      BUDGET_EXCEEDED_REPLY,
    );
    expect(mapFailureToReply(new ChatCompletionError(401, 'auth failed'))).toBe(
      PROVIDER_KEY_REJECTED_REPLY,
    );
    expect(mapFailureToReply(new ChatCompletionError(403, 'forbidden'))).toBe(
      PROVIDER_KEY_REJECTED_REPLY,
    );
    expect(mapFailureToReply(new ChatCompletionError(500, 'gateway exploded'))).toBe(
      TRANSIENT_FAILURE_REPLY,
    );
    expect(mapFailureToReply(new ChatCompletionError(0, 'socket hung up'))).toBe(
      TRANSIENT_FAILURE_REPLY,
    );
    expect(mapFailureToReply(new ChatCompletionError(200, 'unexpected response shape'))).toBe(
      TRANSIENT_FAILURE_REPLY,
    );
    expect(mapFailureToReply(new Error('something weird'))).toBe(TRANSIENT_FAILURE_REPLY);
  });
});

describe('runDmTurn', () => {
  it('sends the reply with composing then paused typing', async () => {
    const { fetchImpl, calls } = createFetch(() => completionResponse('hello, Julio'));
    const harness = turnHarness(fetchImpl);
    const outcome = await harness.run();
    expect(outcome).toEqual({ kind: 'replied', text: 'hello, Julio' });
    expect(harness.sent).toEqual([{ to: OWNER_JID, kind: 'chat', text: 'hello, Julio' }]);
    expect(harness.typing).toEqual([{ state: 'composing' }, { state: 'paused' }]);
    expect(bodyOf(calls[0]!).model).toBe(MODEL);
  });

  it('posts the budget text on 429 without leaking anything', async () => {
    const { fetchImpl } = createFetch(() =>
      jsonResponse({ error: { message: `over budget ${VIRTUAL_KEY}` } }, 429),
    );
    const harness = turnHarness(fetchImpl);
    const outcome = await harness.run();
    expect(outcome).toEqual({ kind: 'failed', text: BUDGET_EXCEEDED_REPLY });
    expect(harness.sent).toEqual([{ to: OWNER_JID, kind: 'chat', text: BUDGET_EXCEEDED_REPLY }]);
    expect(harness.typing).toEqual([{ state: 'composing' }, { state: 'paused' }]);
    const logged = loggedText(harness.logger.calls);
    expect(logged).not.toContain(VIRTUAL_KEY);
    expect(logged).not.toContain(MASTER_KEY);
    expect(JSON.stringify(harness.sent)).not.toContain(VIRTUAL_KEY);
  });

  it('posts the key-rejected text on 401 and 403', async () => {
    for (const status of [401, 403]) {
      const { fetchImpl } = createFetch(() =>
        jsonResponse({ error: { message: 'provider says no' } }, status),
      );
      const harness = turnHarness(fetchImpl);
      const outcome = await harness.run();
      expect(outcome).toEqual({ kind: 'failed', text: PROVIDER_KEY_REJECTED_REPLY });
      expect(harness.sent[0]?.text).toBe(PROVIDER_KEY_REJECTED_REPLY);
    }
  });

  it('posts the transient text on 5xx, network errors and surprises', async () => {
    const cases: FetchLike[] = [
      (_url, _init) => Promise.resolve(jsonResponse({ error: 'boom' }, 500)),
      () => Promise.reject(new Error('connection reset')),
      (_url, _init) => Promise.resolve(jsonResponse({ choices: [] }, 200)),
    ];
    for (const fetchImpl of cases) {
      const harness = turnHarness(fetchImpl);
      const outcome = await harness.run();
      expect(outcome).toEqual({ kind: 'failed', text: TRANSIENT_FAILURE_REPLY });
      expect(harness.sent[0]?.text).toBe(TRANSIENT_FAILURE_REPLY);
    }
  });

  it('proves the leak assertion bites: an unredacted error would fail it', async () => {
    const { fetchImpl } = createFetch(() =>
      jsonResponse({ error: { message: `leaked ${VIRTUAL_KEY}` } }, 500),
    );
    const harness = turnHarness(fetchImpl);
    await harness.run();
    // The harness redacts, so this passes; if redaction regressed, the raw key
    // would appear in err.message and this would fail.
    const raw = harness.logger.calls
      .map((call) => {
        const err = call.fields['err'];
        return `${call.message}\n${err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : ''}`;
      })
      .join('\n');
    expect(raw).not.toContain(VIRTUAL_KEY);
    expect(raw).toContain('AI reply failed');
  });

  it('logs but never throws when the DM send itself fails', async () => {
    const { fetchImpl } = createFetch(() => completionResponse('hi'));
    const logger = captureLogger();
    const outcome = await runDmTurn({
      aiId: 'ai-1',
      ownerJid: OWNER_JID,
      messages: MESSAGES,
      baseUrl: BASE_URL,
      virtualKey: VIRTUAL_KEY,
      model: MODEL,
      fetchImpl,
      sendMessage: () => Promise.reject(new Error('xmpp is down')),
      sendTyping: () => undefined,
      logger,
    });
    expect(outcome).toEqual({ kind: 'failed', text: '' });
    expect(logger.calls).toHaveLength(1);
  });
});

describe('runDmTurn with tools', () => {
  const UPDATE_ARGS = {
    persona: 'Answer in Spanish and keep it short.',
    summary: 'Spanish answers',
  };

  function toolCallResponse(
    calls: Array<{ id: string; name: string; args: unknown }>,
    content: string | null = null,
  ): Response {
    return jsonResponse({
      choices: [
        {
          message: {
            content,
            tool_calls: calls.map((call) => ({
              id: call.id,
              type: 'function',
              function: { name: call.name, arguments: JSON.stringify(call.args) },
            })),
          },
        },
      ],
    });
  }

  function rawArgsResponse(args: string, name = 'update_persona'): Response {
    return jsonResponse({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [{ id: 'call-1', type: 'function', function: { name, arguments: args } }],
          },
        },
      ],
    });
  }

  function scriptedFetch(responses: Response[]): { fetchImpl: FetchLike; calls: Call[] } {
    const calls: Call[] = [];
    let index = 0;
    const fetchImpl: FetchLike = (url, init) => {
      calls.push({ url, init });
      const response = responses[Math.min(index, responses.length - 1)]!;
      index += 1;
      return Promise.resolve(response.clone());
    };
    return { fetchImpl, calls };
  }

  function toolHarness(
    fetchImpl: FetchLike,
    executeTool?: ExecuteToolCall,
  ): {
    logger: ReturnType<typeof captureLogger>;
    sent: Array<{ to: string; kind: ChatKind; text: string }>;
    executed: ValidToolCall[];
    run: () => Promise<{ kind: string; text: string }>;
  } {
    const logger = captureLogger();
    const sent: Array<{ to: string; kind: ChatKind; text: string }> = [];
    const executed: ValidToolCall[] = [];
    const run = () =>
      runDmTurn({
        aiId: 'ai-1',
        ownerJid: OWNER_JID,
        messages: MESSAGES,
        baseUrl: BASE_URL,
        virtualKey: VIRTUAL_KEY,
        model: MODEL,
        executeTool:
          executeTool ??
          (async (call) => {
            executed.push(call);
            return { content: 'ok', notice: formatPersonaUpdatedLine(UPDATE_ARGS.summary) };
          }),
        fetchImpl,
        sendMessage: (to, kind, text) => {
          sent.push({ to, kind, text });
          return Promise.resolve({ id: `m-${sent.length}` });
        },
        sendTyping: () => undefined,
        logger,
        secrets: [MASTER_KEY],
      });
    return { logger, sent, executed, run };
  }

  it('sends tools with tool_choice auto on the turn', async () => {
    const { fetchImpl, calls } = scriptedFetch([
      toolCallResponse([{ id: 'call-1', name: 'update_persona', args: UPDATE_ARGS }]),
      completionResponse('vale, lo haré'),
    ]);
    const harness = toolHarness(fetchImpl);
    await harness.run();
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      const body = bodyOf(call) as Record<string, unknown> & {
        tools: Array<{ function: { name: string } }>;
        tool_choice: string;
      };
      expect(body.tool_choice).toBe('auto');
      expect(body.tools.map((tool) => tool.function.name).sort()).toEqual([
        'revert_persona',
        'update_persona',
      ]);
      expect(body.max_tokens).toBe(REPLY_MAX_TOKENS);
    }
  });

  it('runs update_persona in exactly 2 calls and appends the exact line', async () => {
    const { fetchImpl, calls } = scriptedFetch([
      toolCallResponse([{ id: 'call-1', name: 'update_persona', args: UPDATE_ARGS }]),
      completionResponse('vale, lo haré'),
    ]);
    const harness = toolHarness(fetchImpl);
    const outcome = await harness.run();
    expect(outcome).toEqual({
      kind: 'replied',
      text: 'vale, lo haré\n\n✏️ Persona updated: Spanish answers. Say "undo" to revert.',
    });
    expect(calls).toHaveLength(2);
    expect(harness.executed).toEqual([
      {
        id: 'call-1',
        tool: 'update_persona',
        persona: UPDATE_ARGS.persona,
        summary: UPDATE_ARGS.summary,
      },
    ]);

    const second = bodyOf(calls[1]!) as unknown as {
      messages: Array<{
        role: string;
        content: string;
        tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
        tool_call_id?: string;
      }>;
    };
    const assistant = second.messages.find((message) => message.tool_calls !== undefined);
    expect(assistant?.tool_calls).toEqual([
      {
        id: 'call-1',
        type: 'function',
        function: { name: 'update_persona', arguments: JSON.stringify(UPDATE_ARGS) },
      },
    ]);
    const toolMessage = second.messages.find((message) => message.role === 'tool');
    expect(toolMessage).toMatchObject({ content: 'ok', tool_call_id: 'call-1' });
    expect(harness.sent).toHaveLength(1);
  });

  it('sends invalid back for bad arguments, logs with the ai id, executes nothing', async () => {
    const persona = 'persona text that must never appear in a log 12345';
    const { fetchImpl, calls } = scriptedFetch([
      rawArgsResponse(JSON.stringify({ persona })),
      completionResponse('noted'),
    ]);
    const harness = toolHarness(fetchImpl);
    const outcome = await harness.run();
    expect(outcome.kind).toBe('replied');
    expect(harness.executed).toHaveLength(0);

    const second = bodyOf(calls[1]!) as unknown as {
      messages: Array<{ role: string; content: string }>;
    };
    const toolMessage = second.messages.find((message) => message.role === 'tool');
    expect(toolMessage?.content.startsWith('invalid:')).toBe(true);

    const logged = loggedText(harness.logger.calls);
    expect(harness.logger.calls.some((call) => call.fields['aiId'] === 'ai-1')).toBe(true);
    expect(JSON.stringify(harness.logger.calls)).not.toContain(persona);
    expect(logged).not.toContain(persona);
    expect(logged).not.toContain(VIRTUAL_KEY);
    expect(logged).not.toContain(MASTER_KEY);
  });

  it('never executes an unknown tool', async () => {
    const { fetchImpl, calls } = scriptedFetch([
      rawArgsResponse('{}', 'self_destruct'),
      completionResponse('noted'),
    ]);
    const harness = toolHarness(fetchImpl);
    await harness.run();
    expect(harness.executed).toHaveLength(0);
    const second = bodyOf(calls[1]!) as unknown as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(second.messages.find((message) => message.role === 'tool')?.content).toMatch(
      /^invalid: /,
    );
  });

  it('ignores tools the second response asks for: still 2 calls', async () => {
    const { fetchImpl, calls } = scriptedFetch([
      toolCallResponse([{ id: 'call-1', name: 'update_persona', args: UPDATE_ARGS }]),
      toolCallResponse(
        [{ id: 'call-2', name: 'update_persona', args: UPDATE_ARGS }],
        'final answer',
      ),
    ]);
    const harness = toolHarness(fetchImpl);
    const outcome = await harness.run();
    expect(calls).toHaveLength(2);
    expect(harness.executed).toHaveLength(1);
    expect(outcome.text.startsWith('final answer')).toBe(true);
  });

  it('uses the fallback text when the second response has no text', async () => {
    const { fetchImpl } = scriptedFetch([
      toolCallResponse([{ id: 'call-1', name: 'update_persona', args: UPDATE_ARGS }]),
      jsonResponse({ choices: [{ message: { content: null } }] }),
    ]);
    const harness = toolHarness(fetchImpl);
    const outcome = await harness.run();
    expect(outcome.text).toBe(
      `${TRANSIENT_FAILURE_REPLY}\n\n✏️ Persona updated: Spanish answers. Say "undo" to revert.`,
    );
  });

  it('keeps the persona change on a second-call 429 and says so', async () => {
    const { fetchImpl } = scriptedFetch([
      toolCallResponse([{ id: 'call-1', name: 'update_persona', args: UPDATE_ARGS }]),
      jsonResponse({ error: { message: 'over budget' } }, 429),
    ]);
    const harness = toolHarness(fetchImpl);
    const outcome = await harness.run();
    expect(outcome).toEqual({
      kind: 'failed',
      text: `${BUDGET_EXCEEDED_REPLY}\n\n✏️ Persona updated: Spanish answers. Say "undo" to revert.`,
    });
    expect(harness.executed).toHaveLength(1);
    const logged = loggedText(harness.logger.calls);
    expect(logged).not.toContain(VIRTUAL_KEY);
    expect(logged).not.toContain(MASTER_KEY);
  });

  it('keeps going when one tool call throws: first change stays, failed result, 2 calls', async () => {
    const first = { persona: 'Primera persona, en español.', summary: 'First change' };
    const second = { persona: 'Segunda persona, en español.', summary: 'Second change' };
    const { fetchImpl, calls } = scriptedFetch([
      toolCallResponse([
        { id: 'call-1', name: 'update_persona', args: first },
        { id: 'call-2', name: 'update_persona', args: second },
      ]),
      completionResponse('done'),
    ]);
    const store = new Map<string, string>();
    const executeTool: ExecuteToolCall = async (call) => {
      if (call.tool !== 'update_persona') {
        throw new Error('unreachable in this test');
      }
      if (call.id === 'call-2') {
        throw new Error(`the database is down, key was ${VIRTUAL_KEY}`);
      }
      store.set('persona', call.persona);
      return { content: 'ok', notice: formatPersonaUpdatedLine(call.summary) };
    };
    const harness = toolHarness(fetchImpl, executeTool);
    const outcome = await harness.run();

    expect(calls).toHaveLength(2);
    expect(store.get('persona')).toBe(first.persona);
    const secondRequest = bodyOf(calls[1]!) as unknown as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(
      secondRequest.messages.filter((message) => message.role === 'tool').map((m) => m.content),
    ).toEqual(['ok', 'failed: could not save']);
    expect(outcome).toEqual({
      kind: 'replied',
      text: 'done\n\n✏️ Persona updated: First change. Say "undo" to revert.',
    });

    const failure = harness.logger.calls.find((call) => call.fields['ok'] === false);
    expect(failure?.fields['aiId']).toBe('ai-1');
    expect(failure?.fields['tool']).toBe('update_persona');
    const logged = loggedText(harness.logger.calls);
    expect(logged).not.toContain(VIRTUAL_KEY);
    expect(logged).not.toContain(MASTER_KEY);
    expect(logged).not.toContain(first.persona);
    expect(logged).not.toContain(second.persona);
  });
});

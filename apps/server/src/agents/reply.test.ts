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
} from './reply';

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

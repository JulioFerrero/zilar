import { describe, expect, it, vi } from 'vitest';

import { AiMemoryApiError, createAiMemoryApi } from './ai-memory-api';

const CHAT = 'ai-a-1@zilar.test';
const AI = 'a-1';
const MEMORY = {
  facts: [
    { id: 'fact-1', text: 'Julio prefers short answers.' },
    { id: 'fact-2', text: 'The launch is on Friday.' },
  ],
  lines: ['#0-15 Summary: the team agreed on the launch plan and pricing.'],
  canChange: true,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('createAiMemoryApi', () => {
  it('GETs the memory with chat and ai and the bearer header', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(MEMORY));
    const api = createAiMemoryApi(
      async () => 'session-token',
      fetchImpl as unknown as typeof fetch,
    );

    await expect(api.getMemory(CHAT, AI)).resolves.toEqual(MEMORY);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`http://127.0.0.1:3188/api/ai-memory?chat=ai-a-1%40zilar.test&ai=a-1`);
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer session-token');
    expect(init.method).toBe('GET');
  });

  it('DELETEs a fact at the encoded path with the chat and ai params', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }));
    const api = createAiMemoryApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.forgetFact(CHAT, AI, 'fact/1 2')).resolves.toBeUndefined();

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      'http://127.0.0.1:3188/api/ai-memory/facts/fact%2F1%202?chat=ai-a-1%40zilar.test&ai=a-1',
    );
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer t');
    expect(init.method).toBe('DELETE');
  });

  it('POSTs clear with the chat and ai JSON body', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }));
    const api = createAiMemoryApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.clear(CHAT, AI)).resolves.toBeUndefined();

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/ai-memory/clear');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer t');
    expect(JSON.parse(String(init.body))).toEqual({ chat: CHAT, ai: AI });
  });

  it('throws invalid_response when a fact does not parse', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ ...MEMORY, facts: [{ id: 42, text: 'no' }] }),
    );
    const api = createAiMemoryApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.getMemory(CHAT, AI)).rejects.toMatchObject({
      status: 200,
      code: 'invalid_response',
    });
  });

  it('throws invalid_response when canChange is not a boolean', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ...MEMORY, canChange: 'yes' }));
    const api = createAiMemoryApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.getMemory(CHAT, AI)).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('throws an AiMemoryApiError with the server code on HTTP errors', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { code: 'forbidden', message: 'Not your AI' } }, 403),
    );
    const api = createAiMemoryApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.getMemory(CHAT, AI)).rejects.toBeInstanceOf(AiMemoryApiError);
    await expect(api.getMemory(CHAT, AI)).rejects.toMatchObject({
      status: 403,
      code: 'forbidden',
    });
  });

  it('throws unauthorized when there is no session token', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(MEMORY));
    const api = createAiMemoryApi(async () => undefined, fetchImpl as unknown as typeof fetch);

    await expect(api.getMemory(CHAT, AI)).rejects.toMatchObject({
      status: 401,
      code: 'unauthorized',
    });
    await expect(api.forgetFact(CHAT, AI, 'fact-1')).rejects.toMatchObject({
      code: 'unauthorized',
    });
    await expect(api.clear(CHAT, AI)).rejects.toMatchObject({ code: 'unauthorized' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

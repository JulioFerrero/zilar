import { describe, expect, it, vi } from 'vitest';

import { createToolsApi } from './tools-api';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('createToolsApi effect pipeline errors', () => {
  it('reports a fetch throw as network_error', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('down');
    });
    const api = createToolsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.listAiTools('ai-1')).rejects.toMatchObject({
      status: 0,
      code: 'network_error',
      message: 'Could not reach the server',
    });
  });

  it('falls back per field on a non-JSON error body', async () => {
    const fetchImpl = vi.fn(async () => new Response('not json', { status: 500 }));
    const api = createToolsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.listAiRoutines('ai-1')).rejects.toMatchObject({
      status: 500,
      code: 'request_failed',
      message: 'Request failed (500)',
    });
  });

  it('keeps a valid message when the error code is malformed', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { code: 42, message: 'Too many runs' } }, 429),
    );
    const api = createToolsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.runToolNow('tool-1')).rejects.toMatchObject({
      status: 429,
      code: 'request_failed',
      message: 'Too many runs',
    });
  });

  it('throws unauthorized without a session and invalid_response on a bad row', async () => {
    const offline = createToolsApi(async () => undefined, vi.fn() as unknown as typeof fetch);
    await expect(offline.listAiTools('ai-1')).rejects.toMatchObject({
      status: 401,
      code: 'unauthorized',
    });

    const bad = createToolsApi(
      async () => 't',
      vi.fn(async () => jsonResponse([{ id: 'x' }])) as unknown as typeof fetch,
    );
    await expect(bad.listAiTools('ai-1')).rejects.toMatchObject({
      status: 200,
      code: 'invalid_response',
    });
  });
});

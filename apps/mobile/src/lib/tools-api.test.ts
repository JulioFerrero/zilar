import { describe, expect, it, vi } from 'vitest';

import { ToolsApiError, createToolsApi, type Routine, type ToolListItem } from './tools-api';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const TOOL: ToolListItem = {
  id: 'tool-1',
  aiId: 'ai-1',
  groupId: null,
  topicId: null,
  name: 'Morning briefing',
  description: 'Fetches the overnight headlines.',
  currentVersion: 3,
  hosts: ['news.example.com'],
  approvedHosts: ['news.example.com'],
  lastRunStatus: 'ok',
  updatedAt: '2026-10-03T10:00:00.000Z',
  scope: 'personal',
};

const ROUTINE: Routine = {
  id: 'routine-1',
  aiId: 'ai-1',
  groupId: null,
  topicId: null,
  toolId: 'tool-1',
  title: 'Weekday briefing',
  toolName: 'Morning briefing',
  schedule: { kind: 'interval', everyMinutes: 360 },
  status: 'active',
  pausedReason: null,
  nextRunAt: '2026-10-04T09:00:00.000Z',
  lastRunAt: '2026-10-03T09:00:00.000Z',
  lastStatus: 'ok',
  approvedHosts: [],
  scope: 'personal',
};

describe('createToolsApi', () => {
  it('GETs the AI tools with the bearer header and URL-encodes the id', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([TOOL]));
    const api = createToolsApi(async () => 'session-token', fetchImpl as unknown as typeof fetch);

    await expect(api.listAiTools('ai/with spaces')).resolves.toEqual([TOOL]);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/ais/ai%2Fwith%20spaces/tools');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer session-token');
    expect(init.method).toBe('GET');
  });

  it('GETs the AI routines with the bearer header', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([ROUTINE]));
    const api = createToolsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.listAiRoutines('ai-1')).resolves.toEqual([ROUTINE]);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/ais/ai-1/routines');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer t');
    expect(init.method).toBe('GET');
  });

  it('parses tool items without the optional approvedHosts and scope', async () => {
    const { approvedHosts, scope, ...required } = TOOL;
    void approvedHosts;
    void scope;
    const fetchImpl = vi.fn(async () => jsonResponse([required]));
    const api = createToolsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.listAiTools('ai-1')).resolves.toEqual([required]);
  });

  it('throws invalid_response when one tool item does not parse', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([TOOL, { ...TOOL, name: 42 }]));
    const api = createToolsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.listAiTools('ai-1')).rejects.toMatchObject({
      status: 200,
      code: 'invalid_response',
    });
  });

  it('throws invalid_response when one routine item does not parse', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([{ ...ROUTINE, status: 'running' }]));
    const api = createToolsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.listAiRoutines('ai-1')).rejects.toMatchObject({
      status: 200,
      code: 'invalid_response',
    });
  });

  it('throws a ToolsApiError with status 404 for a missing AI', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { code: 'not_found', message: 'AI not found' } }, 404),
    );
    const api = createToolsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.listAiTools('ai-gone')).rejects.toBeInstanceOf(ToolsApiError);
    await expect(api.listAiTools('ai-gone')).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    });
    await expect(api.listAiRoutines('ai-gone')).rejects.toMatchObject({ status: 404 });
  });

  it('POSTs a routine pause and parses the routine it returns', async () => {
    const paused = { ...ROUTINE, status: 'paused', pausedReason: 'user' } as Routine;
    const fetchImpl = vi.fn(async () => jsonResponse(paused));
    const api = createToolsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.pauseRoutine('routine 1')).resolves.toEqual(paused);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/routines/routine%201/pause');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer t');
    expect(init.method).toBe('POST');
  });

  it('POSTs a routine resume and parses the routine it returns', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(ROUTINE));
    const api = createToolsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.resumeRoutine('routine-1')).resolves.toEqual(ROUTINE);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/routines/routine-1/resume');
    expect(init.method).toBe('POST');
  });

  it('throws invalid_response when a paused routine does not parse', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ...ROUTINE, status: 'running' }));
    const api = createToolsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.pauseRoutine('routine-1')).rejects.toMatchObject({
      status: 200,
      code: 'invalid_response',
    });
  });

  it('carries the needs_approval code of a refused resume', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        { error: { code: 'needs_approval', message: 'The routine needs re-approval' } },
        409,
      ),
    );
    const api = createToolsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.resumeRoutine('routine-1')).rejects.toMatchObject({
      status: 409,
      code: 'needs_approval',
    });
  });

  it('DELETEs a routine and accepts the empty 204', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const api = createToolsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.deleteRoutine('routine 1')).resolves.toBeUndefined();

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/routines/routine%201');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer t');
    expect(init.method).toBe('DELETE');
  });

  it('throws unauthorized for a routine write without a session', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(ROUTINE));
    const api = createToolsApi(async () => undefined, fetchImpl as unknown as typeof fetch);

    await expect(api.pauseRoutine('routine-1')).rejects.toMatchObject({
      status: 401,
      code: 'unauthorized',
    });
    await expect(api.deleteRoutine('routine-1')).rejects.toMatchObject({ status: 401 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from 'vitest';

import { createMockToolsApi } from '@/mock/tools';
import { ToolsApiError, createToolsApi, type Routine, type ToolListItem } from './tools-api';
import { jsonResponse } from '@/test/wait';

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

  it('GETs the tool detail with the bearer header and URL-encodes the id', async () => {
    const detail = { ...TOOL, source: 'export async function run() {}' };
    const fetchImpl = vi.fn(async () => jsonResponse(detail));
    const api = createToolsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.getTool('tool/1')).resolves.toEqual(detail);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/tools/tool%2F1');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer t');
    expect(init.method).toBe('GET');
  });

  it('GETs versions, one version and runs with the bearer header', async () => {
    const version = {
      id: 'tool-1-v3',
      toolId: 'tool-1',
      version: 3,
      message: 'Summarize',
      hosts: ['news.example.com'],
      createdBy: 'julio',
      createdAt: '2026-10-03T10:00:00.000Z',
    };
    const run = {
      id: 'run-1',
      toolId: 'tool-1',
      version: 3,
      trigger: 'manual',
      status: 'ok',
      errorKind: null,
      durationMs: 120,
      fetchCount: 1,
      outputText: 'headlines',
      createdAt: '2026-10-03T09:00:00.000Z',
    };
    const apiFor = (
      body: unknown,
    ): { api: ReturnType<typeof createToolsApi>; fetchImpl: ReturnType<typeof vi.fn> } => {
      const fetchImpl = vi.fn(async () => jsonResponse(body));
      return {
        api: createToolsApi(async () => 't', fetchImpl as unknown as typeof fetch),
        fetchImpl,
      };
    };

    const listed = apiFor([version]);
    await expect(listed.api.listToolVersions('tool 1')).resolves.toEqual([version]);
    expect((listed.fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe(
      'http://127.0.0.1:3188/api/tools/tool%201/versions',
    );

    const one = apiFor({ ...version, source: 'code' });
    await expect(one.api.getToolVersion('tool-1', 3)).resolves.toEqual({
      ...version,
      source: 'code',
    });
    expect((one.fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe(
      'http://127.0.0.1:3188/api/tools/tool-1/versions/3',
    );

    const runs = apiFor([run]);
    await expect(runs.api.listToolRuns('tool-1')).resolves.toEqual([run]);
    expect((runs.fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe(
      'http://127.0.0.1:3188/api/tools/tool-1/runs',
    );
  });

  it('throws invalid_response when one version or run item does not parse', async () => {
    const badVersion = vi.fn(async () =>
      jsonResponse([{ id: 'v', toolId: 'tool-1', version: 'three' }]),
    );
    const badRun = vi.fn(async () => jsonResponse([{ id: 'r', status: 'running' }]));
    const forFetch = (fetchImpl: ReturnType<typeof vi.fn>): ReturnType<typeof createToolsApi> =>
      createToolsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(forFetch(badVersion).listToolVersions('tool-1')).rejects.toMatchObject({
      status: 200,
      code: 'invalid_response',
    });
    await expect(forFetch(badRun).listToolRuns('tool-1')).rejects.toMatchObject({
      status: 200,
      code: 'invalid_response',
    });
  });

  it('keeps the 404 status for a missing tool detail', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { code: 'not_found', message: 'Tool not found' } }, 404),
    );
    const api = createToolsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.getTool('tool-gone')).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    });
    await expect(api.listToolVersions('tool-gone')).rejects.toMatchObject({ status: 404 });
  });

  it('POSTs a revert with the version and parses the tool version', async () => {
    const reverted = {
      id: 'tool-1-v4',
      toolId: 'tool-1',
      version: 4,
      message: 'Revert to v2',
      hosts: ['news.example.com'],
      createdBy: 'julio',
      createdAt: '2026-10-04T10:00:00.000Z',
    };
    const fetchImpl = vi.fn(async () => jsonResponse(reverted));
    const api = createToolsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.revertTool('tool/1', 2)).resolves.toEqual(reverted);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/tools/tool%2F1/revert');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer t');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ version: 2 }));
  });

  it('POSTs a run without a body input for empty input and parses the ok result', async () => {
    const result = {
      ok: true,
      output: { text: 'headlines' },
      logs: '',
      durationMs: 120,
      fetchCount: 1,
    };
    const fetchImpl = vi.fn(async () => jsonResponse(result));
    const api = createToolsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.runToolNow('tool-1')).resolves.toEqual(result);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/tools/tool-1/run');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer t');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({}));
  });

  it('POSTs a run with the input and parses the failed result', async () => {
    const result = {
      ok: false,
      error: { kind: 'timeout', message: 'The tool took too long.' },
      logs: 'started',
      durationMs: 5000,
      fetchCount: 0,
    };
    const fetchImpl = vi.fn(async () => jsonResponse(result));
    const api = createToolsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.runToolNow('tool-1', { city: 'Madrid' })).resolves.toEqual(result);

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.body).toBe(JSON.stringify({ input: { city: 'Madrid' } }));
  });

  it('throws invalid_response when the run result does not parse', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true, output: { text: 42 } }));
    const api = createToolsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.runToolNow('tool-1')).rejects.toMatchObject({
      status: 200,
      code: 'invalid_response',
    });
  });

  it('keeps the 429 status and code of a rate-limited run', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { code: 'rate_limited', message: 'Too many runs' } }, 429),
    );
    const api = createToolsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.runToolNow('tool-1')).rejects.toMatchObject({
      status: 429,
      code: 'rate_limited',
    });
  });

  it('DELETEs a tool and accepts the empty 204', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const api = createToolsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.deleteTool('tool 1')).resolves.toBeUndefined();

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/tools/tool%201');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer t');
    expect(init.method).toBe('DELETE');
  });
});

describe('createMockToolsApi deleteTool', () => {
  it('keeps mock run ids unique after a delete shrinks the run list', async () => {
    const api = createMockToolsApi();
    await api.runToolNow('tool-2');
    await api.runToolNow('tool-2');
    await api.deleteTool('tool-1');
    await api.runToolNow('tool-2');
    await api.runToolNow('tool-2');
    const runs = await api.listToolRuns('tool-2');
    expect(runs).toHaveLength(4);
    expect(new Set(runs.map((run) => run.id)).size).toBe(4);
  });
  it('drops the tool, its versions and its runs so later reads answer 404', async () => {
    const api = createMockToolsApi();
    await api.deleteTool('tool-1');
    await expect(api.getTool('tool-1')).rejects.toMatchObject({ status: 404 });
    await expect(api.listToolVersions('tool-1')).rejects.toMatchObject({ status: 404 });
    await expect(api.getToolVersion('tool-1', 3)).rejects.toMatchObject({ status: 404 });
    await expect(api.listToolRuns('tool-1')).rejects.toMatchObject({ status: 404 });
  });
});

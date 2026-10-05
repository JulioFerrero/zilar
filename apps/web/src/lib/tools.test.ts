import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/mock/gate', () => ({
  isMockApiEnabled: vi.fn(() => false),
}));

import {
  deleteRoutine,
  deleteTool,
  getToolDetail,
  getToolVersion,
  listAiRoutines,
  listAiToolDetails,
  listGroupRoutines,
  listGroupToolDetails,
  listToolRuns,
  listToolVersions,
  listTopicToolDetails,
  pauseRoutine,
  resumeRoutine,
  revertTool,
  runToolNow,
} from '@/lib/tools';
import { ApiError } from '@/lib/api';
import { isMockApiEnabled } from '@/mock/gate';

const mockEnabled = vi.mocked(isMockApiEnabled);

function jsonResponse(status: number, body: unknown): Response {
  if (status === 204) {
    return new Response(null, { status });
  }
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
  mockEnabled.mockReturnValue(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const tool = {
  id: 'tool-1',
  aiId: 'ai-1',
  groupId: 'g-1',
  topicId: 't-1',
  name: 'prices',
  description: 'Fetches prices.',
  currentVersion: 2,
  hosts: ['example.com'],
  approvedHosts: ['example.com'],
  lastRunStatus: 'ok',
  updatedAt: '2026-09-30T10:00:00.000Z',
};

const routine = {
  id: 'r-1',
  title: 'Morning prices',
  toolName: 'prices',
  schedule: { kind: 'interval', everyMinutes: 1440 },
  status: 'active',
  pausedReason: null,
  nextRunAt: '2026-10-01T09:00:00.000Z',
  lastRunAt: null,
  lastStatus: null,
  approvedHosts: [],
};

describe('tools api (T-0107)', () => {
  it('listTopicToolDetails hits GET /api/topics/:id/tools', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, [tool]));
    vi.stubGlobal('fetch', fetchMock);

    const tools = await listTopicToolDetails('t-1');
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe('prices');
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('/api/topics/t-1/tools');
  });

  it('lists group and AI tools and parses approved hosts as optional', async () => {
    const withoutApproved = { ...tool };
    delete (withoutApproved as Record<string, unknown>).approvedHosts;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, [tool]))
      .mockResolvedValueOnce(jsonResponse(200, [withoutApproved]));
    vi.stubGlobal('fetch', fetchMock);

    expect((await listGroupToolDetails('g-1'))[0]?.approvedHosts).toEqual(['example.com']);
    expect((await listAiToolDetails('ai-1'))[0]?.approvedHosts).toBeUndefined();
  });

  it('reads the detail, versions, one version and runs', async () => {
    const detail = { ...tool, source: 'export function run() {}' };
    const version = {
      id: 'v-1',
      toolId: 'tool-1',
      version: 1,
      message: 'First',
      hosts: [],
      createdBy: 'u-you',
      createdAt: '2026-09-29T10:00:00.000Z',
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, detail))
      .mockResolvedValueOnce(jsonResponse(200, [version]))
      .mockResolvedValueOnce(jsonResponse(200, { ...version, source: 'old source' }))
      .mockResolvedValueOnce(
        jsonResponse(200, [
          { ...toolRun(), status: 'ok' },
          { ...toolRun(), status: 'error' },
        ]),
      );
    vi.stubGlobal('fetch', fetchMock);

    expect((await getToolDetail('tool-1')).source).toContain('export function');
    expect((await listToolVersions('tool-1'))[0]?.message).toBe('First');
    expect((await getToolVersion('tool-1', 1)).source).toBe('old source');
    expect(await listToolRuns('tool-1')).toHaveLength(2);
  });

  it('reverts with POST, runs with POST and deletes with DELETE', async () => {
    const version = {
      id: 'v-3',
      toolId: 'tool-1',
      version: 3,
      message: 'Revert to v1',
      hosts: [],
      createdBy: 'u-you',
      createdAt: '2026-09-30T10:00:00.000Z',
    };
    const result = {
      ok: true,
      output: { text: 'gold 100' },
      logs: '',
      durationMs: 12,
      fetchCount: 1,
    };
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith('/revert')) {
        return jsonResponse(200, version);
      }
      if (String(url).endsWith('/run')) {
        return jsonResponse(200, result);
      }
      return jsonResponse(204, null);
    });
    vi.stubGlobal('fetch', fetchMock);

    const reverted = await revertTool('tool-1', 1);
    expect(reverted.version).toBe(3);
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ version: 1 });

    const ran = await runToolNow('tool-1', { city: 'Madrid' });
    expect(ran.ok).toBe(true);
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({ input: { city: 'Madrid' } });

    await deleteTool('tool-1');
    expect(calls[2]?.init?.method).toBe('DELETE');
  });

  it('maps 404 and network failures to ApiError', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(404, { error: { code: 'not_found', message: 'Tool not found' } }),
      )
      .mockRejectedValueOnce(new Error('down'));
    vi.stubGlobal('fetch', fetchMock);

    const missing = await getToolDetail('nope').catch((error: unknown) => error);
    expect(missing).toBeInstanceOf(ApiError);
    expect((missing as ApiError).status).toBe(404);

    const down = await listToolRuns('tool-1').catch((error: unknown) => error);
    expect(down).toBeInstanceOf(ApiError);
    expect((down as ApiError).code).toBe('network_error');
  });

  it('rejects an unexpected payload as invalid_response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { wrong: true }));
    vi.stubGlobal('fetch', fetchMock);

    const error = await listTopicToolDetails('t-1').catch((error: unknown) => error);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('invalid_response');
  });
});

function toolRun(): Record<string, unknown> {
  return {
    id: 'run-1',
    toolId: 'tool-1',
    version: 2,
    trigger: 'manual',
    errorKind: null,
    durationMs: 10,
    fetchCount: 0,
    outputText: 'ok',
    createdAt: '2026-09-30T10:00:00.000Z',
  };
}

describe('routines api (T-0107)', () => {
  it('lists AI and group routines with plain-words schedules', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, [routine]))
      .mockResolvedValueOnce(jsonResponse(200, []));
    vi.stubGlobal('fetch', fetchMock);

    const mine = await listAiRoutines('ai-1');
    expect(mine).toHaveLength(1);
    expect(mine[0]?.title).toBe('Morning prices');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/ais/ai-1/routines');
    expect(await listGroupRoutines('g-1')).toEqual([]);
  });

  it('pauses and resumes with POST and deletes with DELETE', async () => {
    const paused = { ...routine, status: 'paused', pausedReason: 'user' };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, paused))
      .mockResolvedValueOnce(jsonResponse(200, routine))
      .mockResolvedValueOnce(jsonResponse(204, null));
    vi.stubGlobal('fetch', fetchMock);

    expect((await pauseRoutine('r-1')).status).toBe('paused');
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('POST');
    expect((await resumeRoutine('r-1')).status).toBe('active');
    await deleteRoutine('r-1');
    expect(fetchMock.mock.calls[2]?.[1]?.method).toBe('DELETE');
  });

  it('surfaces the 409 needs_approval code on resume', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(409, { error: { code: 'needs_approval', message: 'Needs re-approval' } }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const error = await resumeRoutine('r-1').catch((error: unknown) => error);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('needs_approval');
  });
});

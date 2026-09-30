import { describe, expect, it } from 'vitest';
import { mockRequest, resetMockApi, setMockDelay } from './api';

setMockDelay(0);

async function call(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: unknown }> {
  const response = await mockRequest(path, init, { delayMs: 0 });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

const get = (path: string): Promise<{ status: number; body: unknown }> => call(path);
const post = (path: string, payload: unknown): Promise<{ status: number; body: unknown }> =>
  call(path, { method: 'POST', body: JSON.stringify(payload) });
const del = (path: string): Promise<{ status: number; body: unknown }> =>
  call(path, { method: 'DELETE' });

describe('mock tools and routines API (T-0107)', () => {
  it('seeds one AI, two tools with two versions each, and two routines', async () => {
    resetMockApi();
    const tools = await get('/topics/t-devteam-bug/tools');
    expect(tools.status).toBe(200);
    const rows = tools.body as { name: string; currentVersion: number; hosts: string[] }[];
    expect(rows.map((row) => row.name)).toEqual(['prices']);
    expect(rows[0]?.currentVersion).toBe(2);

    const versions = await get('/tools/tool-mock-prices/versions');
    expect(versions.status).toBe(200);
    expect((versions.body as unknown[]).length).toBe(2);

    const routines = await get('/groups/g-devteam/routines');
    expect(routines.status).toBe(200);
    const titles = (routines.body as { title: string; status: string }[]).map((row) => ({
      title: row.title,
      status: row.status,
    }));
    expect(titles).toContainEqual({ title: 'Morning prices', status: 'active' });
    expect(titles).toContainEqual({ title: 'Standup notes', status: 'paused' });

    const aiRoutines = await get('/ais/dev-1/routines');
    expect(aiRoutines.status).toBe(200);
    expect((aiRoutines.body as unknown[]).length).toBe(2);
  });

  it('reads the detail, one version and runs, then runs the tool', async () => {
    resetMockApi();
    const detail = await get('/tools/tool-mock-prices');
    expect(detail.status).toBe(200);
    expect((detail.body as { source: string }).source).toContain('fetchPrices');
    expect((detail.body as { approvedHosts: string[] }).approvedHosts).toEqual(['api.example.com']);

    const old = await get('/tools/tool-mock-prices/versions/1');
    expect(old.status).toBe(200);
    expect((old.body as { source: string }).source).toContain('["gold"]');

    const runs = await get('/tools/tool-mock-prices/runs');
    expect(runs.status).toBe(200);
    expect((runs.body as unknown[]).length).toBe(2);

    const ran = await post('/tools/tool-mock-prices/run', {});
    expect(ran.status).toBe(200);
    expect((ran.body as { ok: boolean }).ok).toBe(true);
  });

  it('reverts (new version), pauses, resumes and deletes', async () => {
    resetMockApi();
    const reverted = await post('/tools/tool-mock-prices/revert', { version: 1 });
    expect(reverted.status).toBe(200);
    expect((reverted.body as { version: number }).version).toBe(3);

    const paused = await post('/routines/routine-mock-morning/pause', {});
    expect(paused.status).toBe(200);
    expect((paused.body as { status: string }).status).toBe('paused');

    const resumed = await post('/routines/routine-mock-standup/resume', {});
    expect(resumed.status).toBe(200);
    expect((resumed.body as { status: string }).status).toBe('active');

    const deletedRoutine = await del('/routines/routine-mock-standup');
    expect(deletedRoutine.status).toBe(204);

    const deletedTool = await del('/tools/tool-mock-notes');
    expect(deletedTool.status).toBe(204);
    expect((await get('/tools/tool-mock-notes')).status).toBe(404);
  });

  it('404s unknown ids like the server', async () => {
    resetMockApi();
    expect((await get('/tools/no-such-tool')).status).toBe(404);
    expect((await get('/tools/tool-mock-prices/versions/9')).status).toBe(404);
    expect((await post('/routines/no-such-routine/pause', {})).status).toBe(404);
    expect((await del('/routines/no-such-routine')).status).toBe(404);
  });
});

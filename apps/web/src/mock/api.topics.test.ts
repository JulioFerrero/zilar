import { describe, expect, it } from 'vitest';
import { mockRequest, resetMockApi, setMockDelay } from './api';

setMockDelay(0);

async function get(path: string): Promise<{ status: number; body: unknown }> {
  const response = await mockRequest(path, {}, { delayMs: 0 });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

async function post(path: string, payload: unknown): Promise<{ status: number; body: unknown }> {
  const response = await mockRequest(
    path,
    { method: 'POST', body: JSON.stringify(payload) },
    { delayMs: 0 },
  );
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

async function patch(path: string, payload: unknown): Promise<{ status: number; body: unknown }> {
  const response = await mockRequest(
    path,
    { method: 'PATCH', body: JSON.stringify(payload) },
    { delayMs: 0 },
  );
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

describe('mock topics API (T-0111)', () => {
  it('lists the Dev team topics with the General chat id', async () => {
    resetMockApi();
    const { status, body } = await get('/groups/g-devteam/topics');
    expect(status).toBe(200);
    const topics = (body as { topics: { id: string; chatJid: string; isGeneral: boolean }[] })
      .topics;
    expect(topics.length).toBe(7);
    expect(topics.find((topic) => topic.isGeneral)?.chatJid).toBe('c-devteam');
  });

  it('creates, patches and archives a topic in memory', async () => {
    resetMockApi();
    const created = await post('/groups/g-devteam/topics', {
      name: 'Fresh bug',
      kind: 'bug',
      visibility: 'private',
    });
    expect(created.status).toBe(201);
    const createdBody = created.body as { id: string; chatJid: string; visibility: string };
    expect(createdBody.visibility).toBe('private');

    const patched = await patch(`/topics/${createdBody.id}`, { status: 'done' });
    expect(patched.status).toBe(200);
    expect((patched.body as { status: string }).status).toBe('done');

    const archived = await post(`/topics/${createdBody.id}/archive`, {});
    expect(archived.status).toBe(200);
    const listed = await get('/groups/g-devteam/topics');
    const ids = (listed.body as { topics: { id: string }[] }).topics.map((topic) => topic.id);
    expect(ids).not.toContain(createdBody.id);
  });

  it('requires confirmation for private -> public', async () => {
    resetMockApi();
    const created = await post('/groups/g-devteam/topics', {
      name: 'Secret',
      visibility: 'private',
    });
    const id = (created.body as { id: string }).id;
    const refused = await patch(`/topics/${id}`, { visibility: 'public' });
    expect(refused.status).toBe(400);
    const confirmed = await patch(`/topics/${id}`, {
      visibility: 'public',
      confirmExposeHistory: true,
    });
    expect(confirmed.status).toBe(200);
    expect((confirmed.body as { visibility: string }).visibility).toBe('public');
  });

  it('adds and removes members and AIs', async () => {
    resetMockApi();
    const created = await post('/groups/g-devteam/topics', {
      name: 'Secret',
      visibility: 'private',
    });
    const id = (created.body as { id: string }).id;

    const added = await post(`/topics/${id}/members`, { userId: 'u-luis' });
    expect(added.status).toBe(200);
    const members = await get(`/topics/${id}/members`);
    const memberIds = (members.body as { members: { userId: string }[] }).members.map(
      (member) => member.userId,
    );
    expect(memberIds).toContain('u-luis');

    const addedAi = await post(`/topics/${id}/ais`, { aiId: 'dev-1' });
    expect(addedAi.status).toBe(200);
    const ais = await get(`/topics/${id}/ais`);
    expect((ais.body as { ais: { id: string }[] }).ais).toEqual([{ id: 'dev-1', name: 'Dev-1' }]);
  });

  it('answers 404 for an archived topic', async () => {
    resetMockApi();
    const { status } = await get('/topics/no-such-topic');
    expect(status).toBe(404);
  });

  it('serves an empty tools list per topic', async () => {
    resetMockApi();
    const { status, body } = await get('/topics/t-devteam-bug/tools');
    expect(status).toBe(200);
    expect(body).toEqual([]);
  });
});

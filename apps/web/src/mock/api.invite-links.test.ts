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

async function remove(path: string): Promise<{ status: number; body: unknown }> {
  const response = await mockRequest(path, { method: 'DELETE' }, { delayMs: 0 });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

describe('mock invite links API (T-0115)', () => {
  it('creates a link, lists it without the token, and revokes it', async () => {
    resetMockApi();
    const created = await post('/groups/g-devteam/invite-links', {
      label: 'Friends',
      maxUses: 2,
    });
    expect(created.status).toBe(201);
    const createdBody = created.body as { id: string; token: string; url: string };
    expect(createdBody.token).toMatch(/^[0-9a-f]{64}$/);
    expect(createdBody.url).toBe(`http://localhost:5173/j/${createdBody.token}`);

    const listed = await get('/groups/g-devteam/invite-links');
    expect(listed.status).toBe(200);
    const links = (listed.body as { links: { id: string; tokenHint: string }[] }).links;
    expect(links).toHaveLength(1);
    expect(links[0]?.tokenHint).toBe(createdBody.token.slice(-4));
    expect(JSON.stringify(listed.body)).not.toContain(createdBody.token);

    const revoked = await remove(`/groups/g-devteam/invite-links/${createdBody.id}`);
    expect(revoked.status).toBe(204);
    const relisted = await get('/groups/g-devteam/invite-links');
    const relinks = (relisted.body as { links: { revoked: boolean }[] }).links;
    expect(relinks[0]?.revoked).toBe(true);

    // Idempotent: revoking twice is still 204.
    expect((await remove(`/groups/g-devteam/invite-links/${createdBody.id}`)).status).toBe(204);
  });

  it('caps active links at 10', async () => {
    resetMockApi();
    for (let index = 0; index < 10; index += 1) {
      expect((await post('/groups/g-devteam/invite-links', {})).status).toBe(201);
    }
    expect((await post('/groups/g-devteam/invite-links', {})).status).toBe(409);
  });

  it('previews and joins as the existing member', async () => {
    resetMockApi();
    const created = await post('/groups/g-devteam/invite-links', {});
    const token = (created.body as { token: string }).token;

    const preview = await get(`/join/${token}`);
    expect(preview.status).toBe(200);
    const previewBody = preview.body as {
      groupTitle: string;
      memberCount: number;
      alreadyMember: boolean;
      groupId?: string;
    };
    expect(previewBody.groupTitle).toBe('Dev team');
    expect(previewBody.alreadyMember).toBe(true);
    expect(previewBody.groupId).toBe('g-devteam');

    const joined = await post(`/join/${token}`, {});
    expect(joined.status).toBe(200);
    expect((joined.body as { alreadyMember: boolean }).alreadyMember).toBe(true);
  });

  it('404s unknown and revoked tokens with invalid_link', async () => {
    resetMockApi();
    const missing = await get(`/join/${'b'.repeat(64)}`);
    expect(missing.status).toBe(404);
    expect((missing.body as { error: { code: string } }).error.code).toBe('invalid_link');

    const created = await post('/groups/g-devteam/invite-links', {});
    const createdBody = created.body as { id: string; token: string };
    await remove(`/groups/g-devteam/invite-links/${createdBody.id}`);
    const revoked = await get(`/join/${createdBody.token}`);
    expect(revoked.status).toBe(404);
    expect((revoked.body as { error: { code: string } }).error.code).toBe('invalid_link');
  });
});

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

  it('rejects out-of-bounds create options like the server (400, never silent)', async () => {
    // Fix 7: the mock used to ignore the upper bounds (`expiresInHours`
    // 8760, `maxUses` 10000). Values above them now 400 `invalid_request`.
    resetMockApi();
    expect((await post('/groups/g-devteam/invite-links', { expiresInHours: 8761 })).status).toBe(
      400,
    );
    expect((await post('/groups/g-devteam/invite-links', { maxUses: 10001 })).status).toBe(400);
    expect(
      (
        (await post('/groups/g-devteam/invite-links', { maxUses: 10001 })).body as {
          error: { code: string };
        }
      ).error.code,
    ).toBe('invalid_request');
    // ...while the bounds themselves still create.
    const edge = await post('/groups/g-devteam/invite-links', {
      expiresInHours: 8760,
      maxUses: 10000,
    });
    expect(edge.status).toBe(201);
  });

  it('answers 409 group_full and 429 rate_limited on join like the server', async () => {
    // Fix 7: the mock join never answered 409 or 429, so the join page's
    // `full` state was unreachable in mock mode.
    resetMockApi();
    const created = await post('/groups/g-devteam/invite-links', {});
    const token = (created.body as { token: string }).token;
    // 20 attempts pass the per-link window; the 21st is rate limited.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      expect((await post(`/join/${token}`, {})).status).toBe(200);
    }
    const limited = await post(`/join/${token}`, {});
    expect(limited.status).toBe(429);
    expect((limited.body as { error: { code: string } }).error.code).toBe('rate_limited');
  });

  it('answers 409 group_full for a group at the member cap, without consuming a use', async () => {
    // Like the server (`MAX_GROUP_MEMBERS`, 50): the cap is checked before
    // the claim, so a full group 409s and the link keeps its uses.
    resetMockApi();
    const { mockGroupDetails } = await import('./groups');
    const members = Array.from({ length: 50 }, (_, index) => ({
      userId: `u-full-${index}`,
      name: `Full ${index}`,
      role: 'member' as const,
    }));
    mockGroupDetails['c-full'] = {
      id: 'g-full',
      title: 'Packed group',
      createdBy: 'u-full-0',
      members,
      ais: [],
    };
    try {
      const created = await post('/groups/g-full/invite-links', {});
      expect(created.status).toBe(201);
      const token = (created.body as { token: string }).token;
      const preview = await get(`/join/${token}`);
      expect(preview.status).toBe(200);
      expect((preview.body as { alreadyMember: boolean }).alreadyMember).toBe(false);
      const joined = await post(`/join/${token}`, {});
      expect(joined.status).toBe(409);
      expect((joined.body as { error: { code: string } }).error.code).toBe('group_full');
      const listed = await get('/groups/g-full/invite-links');
      const links = (listed.body as { links: { uses: number }[] }).links;
      expect(links[0]?.uses).toBe(0);
    } finally {
      delete mockGroupDetails['c-full'];
    }
  });

  it('lets an existing member re-join a full group (alreadyMember skips the cap)', async () => {
    // T-0141: the server answers `alreadyMember` before the cap check, so a
    // member of a 50-member group rejoins with 200, not 409, and consumes
    // no use. Fails without the `alreadyMember` guard (409).
    resetMockApi();
    const { mockGroupDetails } = await import('./groups');
    const members = Array.from({ length: 49 }, (_, index) => ({
      userId: `u-full-${index}`,
      name: `Full ${index}`,
      role: 'member' as const,
    }));
    mockGroupDetails['c-full'] = {
      id: 'g-full',
      title: 'Packed group',
      createdBy: 'u-full-0',
      members: [...members, { userId: 'u-you', name: 'You', role: 'member' as const }],
      ais: [],
    };
    try {
      const created = await post('/groups/g-full/invite-links', {});
      expect(created.status).toBe(201);
      const token = (created.body as { token: string }).token;
      const joined = await post(`/join/${token}`, {});
      expect(joined.status).toBe(200);
      expect((joined.body as { alreadyMember: boolean }).alreadyMember).toBe(true);
      const listed = await get('/groups/g-full/invite-links');
      const links = (listed.body as { links: { uses: number }[] }).links;
      expect(links[0]?.uses).toBe(0);
    } finally {
      delete mockGroupDetails['c-full'];
    }
  });
});

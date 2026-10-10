import { describe, expect, it, vi } from 'vitest';

import { createGroupsApi, GroupsApiError } from './groups-api';
import { jsonResponse } from '@/test/wait';

// The group detail the server answers (the derived client decodes the whole
// detail, not just the id).
function detail(id: string): Record<string, unknown> {
  return { id, title: 'Team', createdBy: 'u-owner', members: [], ais: [] };
}

describe('createGroupsApi (T-0144)', () => {
  it('creates a channel with kind channel and the trimmed description', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(detail('g-1'), 201));
    const api = createGroupsApi(async () => 'session-token', fetchImpl as unknown as typeof fetch);

    await expect(
      api.createChannel({ title: 'Releases', description: '  Notes  ' }),
    ).resolves.toEqual({ id: 'g-1' });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/groups');
    expect(JSON.parse(init.body as string)).toEqual({
      title: 'Releases',
      kind: 'channel',
      description: 'Notes',
    });
  });

  it('omits a blank description so the server clears it to null', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(detail('g-1'), 201));
    const api = createGroupsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await api.createChannel({ title: 'Releases', description: '   ' });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ title: 'Releases', kind: 'channel' });
  });

  it('lists the members slice and flips a role through the role route', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/members')) {
        return jsonResponse({
          members: [{ userId: 'u-a', name: 'Ana', role: 'admin', roles: [] }],
        });
      }
      return jsonResponse(detail('g-1'));
    });
    const api = createGroupsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.listGroupMembers('g-1')).resolves.toEqual([
      { userId: 'u-a', name: 'Ana', role: 'admin', roles: [] },
    ]);
    await api.changeGroupMemberRole('g-1', 'u-luis', 'admin');
    const [roleUrl, roleInit] = fetchImpl.mock.calls[1] as unknown as [string, RequestInit];
    expect(roleUrl).toBe('http://127.0.0.1:3188/api/groups/g-1/members/u-luis/role');
    expect(roleInit.method).toBe('PUT');
    expect(JSON.parse(roleInit.body as string)).toEqual({ role: 'admin' });
  });

  it('removes a member through the member route', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(detail('g-1')));
    const api = createGroupsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await api.removeGroupMember('g-1', 'u-luis');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/groups/g-1/members/u-luis');
    expect(init.method).toBe('DELETE');
  });

  it('maps the last-admin guard to its code, without the token in text', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { code: 'channel_needs_admin', message: 'last admin' } }, 409),
    );
    const api = createGroupsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    const failure = await api.changeGroupMemberRole('g-1', 'u-a', 'member').then(
      () => 'resolved',
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(GroupsApiError);
    expect(failure).toMatchObject({ status: 409, code: 'channel_needs_admin' });
  });

  it('rejects a malformed members slice instead of rendering half of it', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ members: [{ userId: 'u-a' }] }));
    const api = createGroupsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.listGroupMembers('g-1')).rejects.toMatchObject({ code: 'invalid_response' });
  });
});

describe('createGroupsApi createGroup (T-0214)', () => {
  it('posts the title with the member ids and no kind, then parses the id', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(detail('g-9'), 201));
    const api = createGroupsApi(async () => 'session-token', fetchImpl as unknown as typeof fetch);

    await expect(
      api.createGroup({ title: 'Weekend club', memberIds: ['u-ana', 'u-luis'] }),
    ).resolves.toEqual({ id: 'g-9' });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/groups');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      title: 'Weekend club',
      memberIds: ['u-ana', 'u-luis'],
    });
  });

  it('rejects a malformed answer instead of opening a nameless group', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }));
    const api = createGroupsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.createGroup({ title: 'Weekend club', memberIds: [] })).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });
});

describe('createGroupsApi public creates (T-0228)', () => {
  it('sends visibility public with the handle for a public channel', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(detail('g-2'), 201));
    const api = createGroupsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await api.createChannel({ title: 'Releases', visibility: 'public', handle: 'hiking_club' });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      title: 'Releases',
      kind: 'channel',
      visibility: 'public',
      handle: 'hiking_club',
    });
  });

  it('sends neither visibility nor handle for a private channel', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(detail('g-2'), 201));
    const api = createGroupsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await api.createChannel({ title: 'Releases', description: 'Notes' });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      title: 'Releases',
      kind: 'channel',
      description: 'Notes',
    });
  });

  it('sends visibility public with the handle for a public group', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(detail('g-9'), 201));
    const api = createGroupsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await api.createGroup({
      title: 'Weekend club',
      memberIds: ['u-ana'],
      visibility: 'public',
      handle: 'hiking_club',
    });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      title: 'Weekend club',
      memberIds: ['u-ana'],
      visibility: 'public',
      handle: 'hiking_club',
    });
  });

  it('sends neither visibility nor handle for a private group', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(detail('g-9'), 201));
    const api = createGroupsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await api.createGroup({ title: 'Weekend club', memberIds: ['u-ana'] });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      title: 'Weekend club',
      memberIds: ['u-ana'],
    });
  });
});

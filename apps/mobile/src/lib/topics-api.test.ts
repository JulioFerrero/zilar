import { describe, expect, it, vi } from 'vitest';

import {
  chatEntryTopics,
  createTopicsApi,
  glyphForTopicName,
  parseTopic,
  parseTopicKind,
  parseTopicStatus,
  parseTopicVisibility,
  TopicsApiError,
} from './topics-api';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function topicRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 't-1',
    groupId: 'g1',
    name: 'Checkout bug',
    glyph: 'B',
    chatJid: 't-1@rooms.zilar.test',
    visibility: 'public',
    kind: 'bug',
    status: 'in_progress',
    owner: { kind: 'ai', id: 'dev-1', name: 'Dev-1' },
    linkUrl: 'https://example.com/reviews/42',
    linkLabel: 'PR #42',
    isGeneral: false,
    archived: false,
    memberCount: 6,
    ais: [{ id: 'dev-1', name: 'Dev-1' }],
    ...overrides,
  };
}

describe('parseTopic', () => {
  it('parses a valid topic row', () => {
    expect(parseTopic(topicRow())).toMatchObject({
      id: 't-1',
      groupId: 'g1',
      name: 'Checkout bug',
      kind: 'bug',
      status: 'in_progress',
      visibility: 'public',
      isGeneral: false,
      owner: { kind: 'ai', id: 'dev-1', name: 'Dev-1' },
    });
  });

  it('parses a null owner and null link', () => {
    const topic = parseTopic(topicRow({ owner: null, linkUrl: null, linkLabel: null }));
    expect(topic?.owner).toBeNull();
    expect(topic?.linkUrl).toBeNull();
  });

  it('rejects rows with missing fields', () => {
    expect(parseTopic({})).toBeNull();
    expect(parseTopic(topicRow({ chatJid: undefined }))).toBeNull();
    expect(parseTopic(topicRow({ owner: { kind: 'user' } }))).toBeNull();
    expect(parseTopic(topicRow({ linkUrl: 42 }))).toBeNull();
    expect(parseTopic(topicRow({ ais: [{ id: 'dev-1' }] }))).toBeNull();
  });

  it('falls back safely on unknown enum values', () => {
    const topic = parseTopic(topicRow({ kind: 'epic', status: 'shipped' }));
    expect(topic?.kind).toBe('chat');
    expect(topic?.status).toBe('open');
  });

  it('treats an unknown visibility as private, never leaking', () => {
    expect(parseTopic(topicRow({ visibility: 'group' }))?.visibility).toBe('private');
    expect(parseTopicVisibility(undefined)).toBe('private');
  });

  it('parses kinds, statuses and visibilities', () => {
    expect(parseTopicKind('routine')).toBe('routine');
    expect(parseTopicKind('epic')).toBe('chat');
    expect(parseTopicStatus('blocked')).toBe('blocked');
    expect(parseTopicStatus('shipped')).toBe('open');
    expect(parseTopicVisibility('public')).toBe('public');
  });

  it('parses attached roles and the approver role', () => {
    const topic = parseTopic(
      topicRow({
        roles: [{ id: 'role-designers', name: 'Designers', memberCount: 2 }],
        approverRole: { id: 'role-designers', name: 'Designers' },
      }),
    );
    expect(topic?.roles).toEqual([{ id: 'role-designers', name: 'Designers', memberCount: 2 }]);
    expect(topic?.approverRole).toEqual({ id: 'role-designers', name: 'Designers' });
  });

  it('treats absent roles as none, for older servers', () => {
    const row = topicRow();
    delete row['roles'];
    delete row['approverRole'];
    const topic = parseTopic(row);
    expect(topic?.roles).toEqual([]);
    expect(topic?.approverRole).toBeNull();
  });

  it('rejects malformed role entries', () => {
    expect(parseTopic(topicRow({ roles: [{ id: 'r1' }] }))).toBeNull();
    expect(parseTopic(topicRow({ roles: 'nope' }))).toBeNull();
    expect(parseTopic(topicRow({ approverRole: { id: 'r1' } }))).toBeNull();
  });
});

describe('chatEntryTopics', () => {
  it('keeps valid topics and drops malformed ones', () => {
    expect(chatEntryTopics({ topics: [topicRow(), { nope: true }] })).toHaveLength(1);
  });

  it('is empty for an older server without topics', () => {
    expect(chatEntryTopics({ kind: 'group' })).toEqual([]);
    expect(chatEntryTopics({ topics: 'nope' })).toEqual([]);
  });
});

describe('createTopicsApi', () => {
  function apiFor(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) {
    return createTopicsApi(
      async () => 'session-token',
      fetchImpl as unknown as typeof fetch,
      'http://127.0.0.1:3188',
    );
  }

  function switchApiFor(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) {
    return apiFor(fetchImpl);
  }

  it('lists, creates, patches, archives and reads members and AIs', async () => {
    const calls: string[] = [];
    const api = apiFor(async (url, init) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.endsWith('/members') && (init?.method ?? 'GET') === 'GET') {
        return jsonResponse({ members: [{ userId: 'u-ana', name: 'Ana' }] });
      }
      if (url.endsWith('/ais') && (init?.method ?? 'GET') === 'GET') {
        return jsonResponse({ ais: [{ id: 'dev-1', name: 'Dev-1' }] });
      }
      return jsonResponse(topicRow());
    });

    await expect(api.createTopic('g1', { name: 'Checkout bug' })).resolves.toMatchObject({
      id: 't-1',
    });
    await expect(api.getTopic('t-1')).resolves.toMatchObject({ id: 't-1' });
    await expect(api.patchTopic('t-1', { status: 'done' })).resolves.toMatchObject({ id: 't-1' });
    await expect(api.archiveTopic('t-1')).resolves.toMatchObject({ id: 't-1' });
    await expect(api.listTopicMembers('t-1')).resolves.toEqual([{ userId: 'u-ana', name: 'Ana' }]);
    await expect(api.addTopicMember('t-1', 'u-ana')).resolves.toMatchObject({ id: 't-1' });
    await expect(api.removeTopicMember('t-1', 'u-ana')).resolves.toMatchObject({ id: 't-1' });
    await expect(api.listTopicAis('t-1')).resolves.toEqual([{ id: 'dev-1', name: 'Dev-1' }]);
    await expect(api.addTopicAi('t-1', 'dev-1')).resolves.toMatchObject({ id: 't-1' });
    await expect(api.removeTopicAi('t-1', 'dev-1')).resolves.toMatchObject({ id: 't-1' });

    const switchApi = switchApiFor(async () => jsonResponse({ membersCanCreateTopics: true }));
    await expect(switchApi.setMembersCanCreateTopics('g1', true)).resolves.toBe(true);

    expect(calls).toContain('POST http://127.0.0.1:3188/api/groups/g1/topics');
    expect(calls).toContain('GET http://127.0.0.1:3188/api/topics/t-1');
    expect(calls).toContain('PATCH http://127.0.0.1:3188/api/topics/t-1');
    expect(calls).toContain('POST http://127.0.0.1:3188/api/topics/t-1/archive');
    expect(calls).toContain('GET http://127.0.0.1:3188/api/topics/t-1/members');
    expect(calls).toContain('POST http://127.0.0.1:3188/api/topics/t-1/members');
    expect(calls).toContain('DELETE http://127.0.0.1:3188/api/topics/t-1/members/u-ana');
    expect(calls).toContain('GET http://127.0.0.1:3188/api/topics/t-1/ais');
    expect(calls).toContain('POST http://127.0.0.1:3188/api/topics/t-1/ais');
    expect(calls).toContain('DELETE http://127.0.0.1:3188/api/topics/t-1/ais/dev-1');
  });

  it('replaces a private topic roles with one PUT', async () => {
    let seenBody: unknown;
    const calls: string[] = [];
    const api = apiFor(async (url, init) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      seenBody = JSON.parse((init?.body as string) ?? '{}');
      return jsonResponse(
        topicRow({
          roles: [{ id: 'role-designers', name: 'Designers', memberCount: 2 }],
          approverRole: { id: 'role-designers', name: 'Designers' },
        }),
      );
    });

    const topic = await api.setTopicRoles('t-1', {
      roleIds: ['role-designers'],
      approverRoleId: 'role-designers',
    });

    expect(calls).toContain('PUT http://127.0.0.1:3188/api/topics/t-1/roles');
    expect(seenBody).toEqual({ roleIds: ['role-designers'], approverRoleId: 'role-designers' });
    expect(topic.roles).toEqual([{ id: 'role-designers', name: 'Designers', memberCount: 2 }]);
    expect(topic.approverRole).toEqual({ id: 'role-designers', name: 'Designers' });
  });

  it('throws a typed error on a failed request', async () => {
    const api = apiFor(async () =>
      jsonResponse({ error: { code: 'not_found', message: 'Topic not found' } }, 404),
    );
    await expect(api.getTopic('missing')).rejects.toBeInstanceOf(TopicsApiError);
    await expect(api.getTopic('missing')).rejects.toMatchObject({ status: 404, code: 'not_found' });
  });

  it('rejects an unexpected response shape', async () => {
    const api = apiFor(async () => jsonResponse({ nope: true }));
    await expect(api.getTopic('t-1')).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('fails before the network when there is no session', async () => {
    const fetchImpl = vi.fn();
    const api = createTopicsApi(
      async () => undefined,
      fetchImpl as unknown as typeof fetch,
      'http://127.0.0.1:3188',
    );
    await expect(api.getTopic('t-1')).rejects.toMatchObject({ status: 401 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('glyphForTopicName', () => {
  it('uses the first letter uppercased', () => {
    expect(glyphForTopicName('checkout bug')).toBe('C');
    expect(glyphForTopicName('')).toBe('G');
  });
});

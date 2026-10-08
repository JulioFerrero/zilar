import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Schema } from 'effect';

vi.mock('@/mock/gate', () => ({
  isMockApiEnabled: vi.fn(() => false),
}));

import { ApiError } from '@/lib/api';
import {
  addTopicAi,
  addTopicMember,
  archiveTopic,
  chatEntryTopics,
  createTopic,
  getTopic,
  listGroupTopics,
  listTopicAis,
  listTopicMembers,
  listTopicTools,
  patchTopic,
  removeTopicAi,
  removeTopicMember,
  setMembersCanCreateTopics,
  topicSchema,
} from '@/lib/api';
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

function topicFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 't-1',
    groupId: 'g-1',
    name: 'General',
    glyph: 'G',
    chatJid: 'general@rooms.zilar.test',
    visibility: 'public',
    kind: 'chat',
    status: 'open',
    owner: null,
    linkUrl: null,
    linkLabel: null,
    isGeneral: true,
    archived: false,
    memberCount: 4,
    ais: [],
    ...overrides,
  };
}

describe('topics API (T-0111)', () => {
  it('topicSchema parses a server-shaped topic', () => {
    const parsed = Schema.decodeUnknownSync(topicSchema)(topicFixture());
    expect(parsed.name).toBe('General');
    expect(parsed.ais).toEqual([]);
  });

  it('topicSchema rejects an unknown visibility', () => {
    expect(Schema.is(topicSchema)({ ...topicFixture(), visibility: 'secret' })).toBe(false);
  });

  it('chatEntryTopics validates each topic and drops malformed ones', () => {
    const entry = {
      kind: 'group' as const,
      chatJid: 'general@rooms.zilar.test',
      title: 'Team',
      groupId: 'g-1',
      memberCount: 4,
      role: 'member' as const,
      topics: [topicFixture(), { ...topicFixture(), visibility: 'secret' }, 42],
    };
    const topics = chatEntryTopics(entry);
    expect(topics).toHaveLength(1);
    expect(topics[0]?.id).toBe('t-1');
  });

  it('chatEntryTopics is empty for a group without topics (older server)', () => {
    const entry = {
      kind: 'group' as const,
      chatJid: 'team@rooms.zilar.test',
      title: 'Team',
      groupId: 'g-1',
      memberCount: 3,
      role: 'member' as const,
    };
    expect(chatEntryTopics(entry)).toEqual([]);
  });

  it('listGroupTopics hits GET /api/groups/:id/topics', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { topics: [topicFixture()] }));
    vi.stubGlobal('fetch', fetchMock);

    const topics = await listGroupTopics('g/1');
    expect(topics).toHaveLength(1);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('/api/groups/g%2F1/topics');
  });

  it('createTopic POSTs the body and parses the created topic', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, topicFixture({ id: 't-2' })));
    vi.stubGlobal('fetch', fetchMock);

    const topic = await createTopic('g-1', { name: 'Bug', kind: 'bug', visibility: 'private' });
    expect(topic.id).toBe('t-2');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/groups/g-1/topics');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      name: 'Bug',
      kind: 'bug',
      visibility: 'private',
    });
  });

  it('getTopic URL-encodes the id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, topicFixture()));
    vi.stubGlobal('fetch', fetchMock);

    await getTopic('t/1');
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('/api/topics/t%2F1');
  });

  it('patchTopic PATCHes the strip fields', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, topicFixture({ status: 'in_progress' })));
    vi.stubGlobal('fetch', fetchMock);

    const topic = await patchTopic('t-1', { status: 'in_progress' });
    expect(topic.status).toBe('in_progress');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/topics/t-1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ status: 'in_progress' });
  });

  it('archiveTopic POSTs to /topics/:id/archive', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, topicFixture({ archived: true })));
    vi.stubGlobal('fetch', fetchMock);

    const topic = await archiveTopic('t-1');
    expect(topic.archived).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/topics/t-1/archive');
    expect(init.method).toBe('POST');
  });

  it('a 404 on a topic the viewer may not see surfaces as ApiError not_found', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(404, { error: { code: 'not_found', message: 'Topic not found' } }),
        ),
    );
    await expect(getTopic('t-hidden')).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    } satisfies Partial<ApiError>);
  });

  it('listTopicMembers unwraps the members list', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { members: [{ userId: 'u-1', name: 'Ana' }] }));
    vi.stubGlobal('fetch', fetchMock);

    const members = await listTopicMembers('t-1');
    expect(members).toEqual([{ userId: 'u-1', name: 'Ana' }]);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('/api/topics/t-1/members');
  });

  it('addTopicMember POSTs the userId', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, topicFixture()));
    vi.stubGlobal('fetch', fetchMock);

    await addTopicMember('t-1', 'u-2');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/topics/t-1/members');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ userId: 'u-2' });
  });

  it('removeTopicMember DELETEs the member URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, topicFixture()));
    vi.stubGlobal('fetch', fetchMock);

    await removeTopicMember('t-1', 'u-2');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/topics/t-1/members/u-2');
    expect(init.method).toBe('DELETE');
  });

  it('listTopicAis unwraps the AI list', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { ais: [{ id: 'ai-1', name: 'Dev-1' }] }));
    vi.stubGlobal('fetch', fetchMock);

    const ais = await listTopicAis('t-1');
    expect(ais).toEqual([{ id: 'ai-1', name: 'Dev-1' }]);
  });

  it('addTopicAi POSTs the aiId', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, topicFixture()));
    vi.stubGlobal('fetch', fetchMock);

    await addTopicAi('t-1', 'ai-1');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/topics/t-1/ais');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ aiId: 'ai-1' });
  });

  it('removeTopicAi DELETEs the AI URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, topicFixture()));
    vi.stubGlobal('fetch', fetchMock);

    await removeTopicAi('t-1', 'ai-1');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/topics/t-1/ais/ai-1');
    expect(init.method).toBe('DELETE');
  });

  it('setMembersCanCreateTopics PATCHes the group', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        id: 'g-1',
        title: 'Team',
        createdBy: 'u-1',
        membersCanCreateTopics: true,
        members: [],
        ais: [],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const group = await setMembersCanCreateTopics('g-1', true);
    expect(group.membersCanCreateTopics).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/groups/g-1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ membersCanCreateTopics: true });
  });

  it('listTopicTools hits GET /api/topics/:id/tools', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, []));
    vi.stubGlobal('fetch', fetchMock);

    await listTopicTools('t-1');
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('/api/topics/t-1/tools');
  });
});

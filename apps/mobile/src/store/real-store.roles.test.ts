import type { ChatApi, ChatEntry } from '../lib/chat-api';
import { describeRolesError, ROLE_GONE_MESSAGE, ROLE_LOAD_FAILED_MESSAGE } from '../lib/roles';
import type { CustomGroupRole, RolesApi } from '../lib/roles-api';
import type { TopicsApi } from '../lib/topics-api';
import { describe, expect, it, vi } from 'vitest';

import { createRealChatStore, type AppStateLike, type RealStoreDeps } from './real-store';

function fakeAppState(): AppStateLike {
  return { current: () => 'active', subscribe: () => () => {} };
}

function topicRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 't-hiring',
    groupId: 'g1',
    name: 'Hiring: frontend role',
    glyph: 'H',
    chatJid: 't-hiring@rooms.galena.test',
    visibility: 'private',
    kind: 'task',
    status: 'blocked',
    owner: null,
    linkUrl: null,
    linkLabel: null,
    isGeneral: false,
    archived: false,
    memberCount: 2,
    ais: [],
    roles: [],
    approverRole: null,
    ...overrides,
  };
}

function generalRow(): Record<string, unknown> {
  return {
    ...topicRow(),
    id: 't-g',
    name: 'General',
    glyph: 'G',
    chatJid: 'general@rooms.galena.test',
    visibility: 'public',
    kind: 'chat',
    status: 'open',
    isGeneral: true,
    memberCount: 6,
  };
}

function groupEntry(): ChatEntry {
  return {
    kind: 'group',
    chatJid: 'general@rooms.galena.test',
    title: 'Dev team',
    groupId: 'g1',
    memberCount: 6,
    role: 'member',
    topics: [generalRow(), topicRow()],
  } as unknown as ChatEntry;
}

function roleRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'role-designers',
    name: 'Designers',
    members: [
      { userId: 'u-me', name: 'Me' },
      { userId: 'u-ana', name: 'Ana' },
    ],
    ...overrides,
  };
}

function fakeApi(): ChatApi {
  return {
    getMe: vi.fn(async () => ({
      id: 'u-me',
      email: 'me@galena.test',
      name: 'Me',
      jid: 'me@galena.test',
    })),
    getChats: vi.fn(async () => [groupEntry()]),
    getContacts: vi.fn(async () => []),
    getGroup: vi.fn(async () => ({
      id: 'g1',
      title: 'Dev team',
      createdBy: 'u-me',
      members: [
        { userId: 'u-me', name: 'Me', role: 'owner' as const, roles: [] },
        { userId: 'u-ana', name: 'Ana', role: 'admin' as const, roles: [] },
      ],
      ais: [],
    })),
    getXmppToken: vi.fn(async () => ({
      jid: 'me@galena.test',
      token: 'tok',
      expiresAt: '2026-09-28T12:05:00Z',
      service: 'ws://x',
      domain: 'galena.test',
      mucDomain: 'rooms.galena.test',
    })),
  };
}

function fakeCore(): unknown {
  return {
    status: () => 'online',
    connect: async () => {},
    disconnect: async () => {},
    joinRoom: async () => {},
    occupants: () => [],
    sendMessage: async () => ({ id: 'srv-1' }),
    sendReactions: async () => {},
    sendCorrection: async () => ({ id: 'srv-c' }),
    sendRetraction: async () => {},
    loadHistory: async () => ({ messages: [], complete: true, first: undefined }),
    sendTyping: () => {},
    markDisplayed: () => {},
    on: () => () => {},
  };
}

function fakeRoles(): RolesApi & { bodies: unknown[] } {
  const bodies: unknown[] = [];
  const store: { roles: Record<string, unknown>[] } = {
    roles: [roleRow(), roleRow({ id: 'role-devs', name: 'Devs', members: [] })],
  };
  const api = {
    bodies,
    listGroupRoles: vi.fn(async () => store.roles.map((entry) => ({ ...entry }))),
    createGroupRole: vi.fn(async (_groupId: string, name: string) => {
      const created = roleRow({ id: 'role-new', name, members: [] });
      store.roles.push(created);
      return created;
    }),
    renameGroupRole: vi.fn(async (_groupId: string, roleId: string, name: string) => {
      const role = store.roles.find((entry) => entry['id'] === roleId);
      if (role === undefined) {
        throw new Error('missing');
      }
      role['name'] = name;
      return role;
    }),
    deleteGroupRole: vi.fn(async (_groupId: string, roleId: string) => {
      store.roles = store.roles.filter((entry) => entry['id'] !== roleId);
    }),
    setGroupRoleMembers: vi.fn(async (_groupId: string, roleId: string, userIds: string[]) => {
      bodies.push({ userIds });
      const role = store.roles.find((entry) => entry['id'] === roleId);
      if (role === undefined) {
        throw new Error('missing');
      }
      role['members'] = userIds.map((userId) => ({ userId, name: userId }));
      return role;
    }),
  };
  return api as unknown as RolesApi & { bodies: unknown[] };
}

function fakeTopics(): TopicsApi & { bodies: unknown[] } {
  const bodies: unknown[] = [];
  let current = topicRow({
    roles: [{ id: 'role-designers', name: 'Designers', memberCount: 2 }],
    approverRole: null,
  });
  const api = {
    bodies,
    createTopic: vi.fn(async (id: string) => topicRow({ id })),
    getTopic: vi.fn(async () => current),
    patchTopic: vi.fn(async (id: string, input: Record<string, unknown>) => {
      current = topicRow({
        ...current,
        ...(input['visibility'] === undefined ? {} : { visibility: input['visibility'] }),
        // Going public clears roles server-side.
        ...(input['visibility'] === 'public'
          ? { roles: [], approverRole: null }
          : { roles: current['roles'], approverRole: current['approverRole'] }),
      });
      return current;
    }),
    archiveTopic: vi.fn(async (id: string) => topicRow({ id, archived: true })),
    listTopicMembers: vi.fn(async () => []),
    addTopicMember: vi.fn(async (id: string) => topicRow({ id })),
    removeTopicMember: vi.fn(async (id: string) => topicRow({ id })),
    listTopicAis: vi.fn(async () => []),
    addTopicAi: vi.fn(async (id: string) => topicRow({ id })),
    removeTopicAi: vi.fn(async (id: string) => topicRow({ id })),
    setTopicRoles: vi.fn(
      async (_id: string, input: { roleIds: string[]; approverRoleId: string | null }) => {
        bodies.push(input);
        current = topicRow({
          ...current,
          roles: input.roleIds.map((id) => ({ id, name: id, memberCount: 1 })),
          approverRole:
            input.approverRoleId === null
              ? null
              : { id: input.approverRoleId, name: input.approverRoleId },
        });
        return current;
      },
    ),
    setMembersCanCreateTopics: vi.fn(async () => true),
  };
  return api as unknown as TopicsApi & { bodies: unknown[] };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function setup(deps: Partial<RealStoreDeps> = {}) {
  const api = fakeApi();
  const roles = fakeRoles();
  const topics = fakeTopics();
  const store = createRealChatStore({
    api,
    topicsApi: topics,
    rolesApi: roles,
    appState: fakeAppState(),
    openDrafts: () => () => {},
    createXmpp: () => fakeCore() as never,
    ...deps,
  });
  return { store, api, roles, topics };
}

describe('real store group roles (T-0137)', () => {
  it('loads the roles by group id and publishes them to selectors', async () => {
    const { store, roles } = setup();
    store.getState().start();
    await flush();

    expect(store.getState().groupRoles('g1')).toBeUndefined();
    await store.getState().refreshGroupRoles('g1');
    expect(vi.mocked(roles.listGroupRoles)).toHaveBeenCalledWith('g1');
    expect(
      store
        .getState()
        .groupRoles('g1')
        ?.map((entry) => entry.name),
    ).toEqual(['Designers', 'Devs']);
    // A chat id is NOT the group key.
    expect(store.getState().groupRoles('t-hiring@rooms.galena.test')).toBeUndefined();
  });

  it('maps the first roles load failure through describeRolesError load', async () => {
    // The group screen's mount load used a hardcoded generic line; it now
    // calls `describeRolesError(error, 'load')` like every retry, so a 404
    // on first load reads as gone (refreshable) rather than denied.
    const { store, roles } = setup();
    store.getState().start();
    await flush();
    vi.mocked(roles.listGroupRoles).mockRejectedValueOnce(
      Object.assign(new Error('not here'), { status: 404, code: 'not_found' }),
    );
    const first = await store
      .getState()
      .refreshGroupRoles('g1')
      .then(
        () => 'resolved',
        (error: unknown) => error,
      );
    expect(first).not.toBe('resolved');
    expect(describeRolesError(first, 'load')).toBe(ROLE_GONE_MESSAGE);

    vi.mocked(roles.listGroupRoles).mockRejectedValueOnce(new Error('offline'));
    const generic = await store
      .getState()
      .refreshGroupRoles('g1')
      .then(
        () => 'resolved',
        (error: unknown) => error,
      );
    expect(describeRolesError(generic, 'load')).toBe(ROLE_LOAD_FAILED_MESSAGE);
  });

  it('creates, renames and deletes roles in the group id directly', async () => {
    const { store, roles } = setup();
    store.getState().start();
    await flush();
    await store.getState().refreshGroupRoles('g1');

    const created = await store.getState().createGroupRole('g1', 'QA');
    expect(created).toMatchObject({ id: 'role-new', name: 'QA' });
    expect(vi.mocked(roles.createGroupRole)).toHaveBeenCalledWith('g1', 'QA');
    expect(store.getState().groupRoles('g1')).toHaveLength(3);

    const renamed = await store.getState().renameGroupRole('g1', 'role-new', 'Quality');
    expect(renamed.name).toBe('Quality');

    await store.getState().deleteGroupRole('g1', 'role-new');
    expect(
      store
        .getState()
        .groupRoles('g1')
        ?.some((entry) => entry.id === 'role-new'),
    ).toBe(false);
  });

  it('writes roles for a group with zero loaded topic rows', async () => {
    // The group screen passes its route param straight through, so an empty
    // group (no chat rows loaded, e.g. fresh boot before the chat list
    // arrives) can still manage roles. Regression test for the
    // chat-row-routed write path, which threw "not available yet" here.
    const { store, api, roles } = setup();
    vi.mocked(api.getChats).mockResolvedValue([]);
    store.getState().start();
    await flush();
    expect(store.getState().chats).toEqual([]);

    const created = await store.getState().createGroupRole('g1', 'QA');
    expect(created).toMatchObject({ id: 'role-new', name: 'QA' });
    expect(vi.mocked(roles.createGroupRole)).toHaveBeenCalledWith('g1', 'QA');

    const assigned = (await store
      .getState()
      .setGroupRoleMembers('g1', 'role-designers', ['u-me'])) as CustomGroupRole;
    expect(assigned.members).toEqual([{ userId: 'u-me', name: 'u-me' }]);

    await store.getState().deleteGroupRole('g1', 'role-designers');
    expect(vi.mocked(roles.deleteGroupRole)).toHaveBeenCalledWith('g1', 'role-designers');
  });

  it('sends the full desired member list on assignment', async () => {
    const { store, roles } = setup();
    store.getState().start();
    await flush();
    await store.getState().refreshGroupRoles('g1');

    const updated = (await store
      .getState()
      .setGroupRoleMembers('g1', 'role-designers', ['u-me'])) as CustomGroupRole;
    expect(updated.members).toEqual([{ userId: 'u-me', name: 'u-me' }]);
    expect(roles.bodies).toEqual([{ userIds: ['u-me'] }]);
    expect(
      store
        .getState()
        .groupRoles('g1')
        ?.find((entry) => entry.id === 'role-designers')?.members,
    ).toEqual([{ userId: 'u-me', name: 'u-me' }]);
  });
});

describe('real store topic roles (T-0137)', () => {
  it('loads the attached roles and approver role for the sheet', async () => {
    const { store, topics } = setup();
    store.getState().start();
    await flush();

    expect(store.getState().topicRoles('t-hiring@rooms.galena.test')).toBeUndefined();
    await store.getState().refreshTopicRoles('t-hiring@rooms.galena.test');
    expect(vi.mocked(topics.getTopic)).toHaveBeenCalledWith('t-hiring');
    expect(store.getState().topicRoles('t-hiring@rooms.galena.test')).toEqual({
      roles: [{ id: 'role-designers', name: 'Designers', memberCount: 2 }],
      approverRole: null,
    });
  });

  it('replaces the topic roles with one PUT and refreshes the row', async () => {
    const { store, topics } = setup();
    store.getState().start();
    await flush();

    await store.getState().setTopicRoles('t-hiring@rooms.galena.test', {
      roleIds: ['role-designers', 'role-devs'],
      approverRoleId: 'role-designers',
    });
    expect(topics.bodies).toEqual([
      { roleIds: ['role-designers', 'role-devs'], approverRoleId: 'role-designers' },
    ]);
    expect(store.getState().topicRoles('t-hiring@rooms.galena.test')).toEqual({
      roles: [
        { id: 'role-designers', name: 'role-designers', memberCount: 1 },
        { id: 'role-devs', name: 'role-devs', memberCount: 1 },
      ],
      approverRole: { id: 'role-designers', name: 'role-designers' },
    });
  });

  it('leaves no roles in the store after the private-to-public flip', async () => {
    const { store, api } = setup();
    store.getState().start();
    await flush();
    await store.getState().refreshTopicRoles('t-hiring@rooms.galena.test');
    expect(store.getState().topicRoles('t-hiring@rooms.galena.test')?.roles).toHaveLength(1);

    // The server truth after the flip: the topic reads public with no roles.
    const publicEntry = {
      kind: 'group',
      chatJid: 'general@rooms.galena.test',
      title: 'Dev team',
      groupId: 'g1',
      memberCount: 6,
      role: 'member',
      topics: [generalRow(), topicRow({ visibility: 'public', roles: [], approverRole: null })],
    } as unknown as ChatEntry;
    vi.mocked(api.getChats).mockResolvedValue([publicEntry]);
    await store.getState().patchTopic('t-hiring@rooms.galena.test', { visibility: 'public' });

    // The patch response is the server truth: no roles, no approver.
    expect(store.getState().topicRoles('t-hiring@rooms.galena.test')).toEqual({
      roles: [],
      approverRole: null,
    });
    expect(
      store.getState().chats.find((chat) => chat.id === 't-hiring@rooms.galena.test')?.topic
        ?.visibility,
    ).toBe('public');
  });

  it('surfaces a 403 write so the screen can map it to the neutral line', async () => {
    const { store, topics } = setup();
    store.getState().start();
    await flush();
    vi.mocked(topics.setTopicRoles).mockRejectedValueOnce(
      Object.assign(new Error('Only group owners...'), { status: 403, code: 'forbidden' }),
    );

    await expect(
      store.getState().setTopicRoles('t-hiring@rooms.galena.test', {
        roleIds: [],
        approverRoleId: null,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});

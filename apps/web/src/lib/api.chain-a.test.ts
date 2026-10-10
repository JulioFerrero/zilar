// The chain A groups (T-0892) over the derived contract client: the fetch stub
// sees the same relative path, lowercase header record and string body the
// hand-written requests sent.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/mock/gate', () => ({
  isMockApiEnabled: vi.fn(() => false),
}));

import {
  addGroupAi,
  ApiError,
  changeGroupMemberRole,
  createChatFolder,
  createGroup,
  createGroupRole,
  createTopic,
  deleteChatFolder,
  deleteGroupRole,
  getChatBackgroundDefault,
  addTopicAi,
  getGroup,
  getTopic,
  joinPublicGroup,
  listTopicMembers,
  patchTopic,
  removeTopicMember,
  setTopicRoles,
  listChatFolders,
  listGroupMembers,
  listGroupRoles,
  patchChatFolder,
  removeGroupAi,
  removeGroupMember,
  renameGroupRole,
  reorderChatFolders,
  setGroupBackground,
  setGroupListener,
  setGroupRoleMembers,
  listChatPrefs,
  putChatBackgroundDefault,
  putChatPref,
} from '@/lib/api';
import { isMockApiEnabled } from '@/mock/gate';

const mockEnabled = vi.mocked(isMockApiEnabled);

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

function stubFetch(response: () => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => response());
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  mockEnabled.mockReturnValue(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('chat prefs over the contract client', () => {
  const PREF = {
    chatJid: 'ana@zilar.test',
    mutedUntil: null,
    archived: true,
    pinnedAt: null,
    backgroundPreset: null,
    backgroundImageId: null,
    backgroundDim: null,
    updatedAt: '2026-10-09T10:00:00.000Z',
  };
  const NONE = { backgroundPreset: null, backgroundImageId: null, backgroundDim: null };

  it('lists the rows and ignores the default background', async () => {
    const fetchMock = stubFetch(() =>
      jsonResponse(200, { prefs: [PREF], defaultBackground: NONE }),
    );

    expect(await listChatPrefs()).toEqual([PREF]);
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/chat-prefs');
  });

  it('puts a pref to an encoded path with a JSON string body, and maps { prefs: null } to null', async () => {
    const fetchMock = stubFetch(() => jsonResponse(200, PREF));

    expect(await putChatPref('ana@zilar.test', { archived: true })).toEqual(PREF);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/chat-prefs/ana%40zilar.test');
    expect(init).toMatchObject({ method: 'PUT', headers: { 'content-type': 'application/json' } });
    expect(JSON.parse(init!.body as string)).toEqual({ archived: true });

    stubFetch(() => jsonResponse(200, { prefs: null }));
    expect(await putChatPref('ana@zilar.test', { archived: false })).toBeNull();
  });

  it('reads and writes the default background', async () => {
    const choice = { backgroundPreset: 'gold', backgroundImageId: null, backgroundDim: null };
    const fetchMock = stubFetch(() => jsonResponse(200, { defaultBackground: choice }));

    expect(await getChatBackgroundDefault()).toEqual(choice);
    expect(await putChatBackgroundDefault(choice)).toEqual(choice);
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe('/api/chat-background');
    expect(JSON.parse(init!.body as string)).toEqual(choice);
  });

  it('rejects an unknown preset before any request and surfaces a server error', async () => {
    const fetchMock = stubFetch(() =>
      jsonResponse(404, { error: { code: 'not_found', message: 'Chat not found' } }),
    );

    await expect(
      putChatBackgroundDefault({
        backgroundPreset: 'neon',
        backgroundImageId: null,
        backgroundDim: null,
      }),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_request' });
    expect(fetchMock).not.toHaveBeenCalled();

    const error = await putChatPref('x@zilar.test', { archived: true }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, code: 'not_found' });
  });
});

describe('chat folders over the contract client', () => {
  const FOLDER = {
    id: 'f-1',
    name: 'Work',
    icon: 'briefcase',
    position: 0,
    includeTypes: ['dm'],
    includeChats: [],
    excludeChats: [],
    excludeMuted: false,
    excludeRead: false,
  };

  it('lists, creates with a trimmed name and reads the 201 row', async () => {
    const fetchMock = stubFetch(() => jsonResponse(200, { folders: [FOLDER] }));
    expect(await listChatFolders()).toEqual([FOLDER]);

    fetchMock.mockImplementation(async () => jsonResponse(201, { folder: FOLDER }));
    const created = await createChatFolder({ name: ' Work ', icon: 'briefcase' });
    expect(created).toEqual(FOLDER);
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe('/api/chat-folders');
    expect(init).toMatchObject({ method: 'POST', headers: { 'content-type': 'application/json' } });
    expect(JSON.parse(init!.body as string)).toEqual({
      name: 'Work',
      icon: 'briefcase',
    });
  });

  it('patches, reorders and deletes by path', async () => {
    const fetchMock = stubFetch(() => jsonResponse(200, { folder: FOLDER }));
    expect(await patchChatFolder('f/1', { name: 'Work', excludeRead: undefined })).toEqual(FOLDER);
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/chat-folders/f%2F1');
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({ name: 'Work' });

    fetchMock.mockImplementation(async () => jsonResponse(200, { folders: [FOLDER] }));
    expect(await reorderChatFolders(['f-1'])).toEqual([FOLDER]);
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({ method: 'PUT' });

    fetchMock.mockImplementation(async () => jsonResponse(200, { deleted: true }));
    await expect(deleteChatFolder('f-1')).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[2]![1]).toMatchObject({ method: 'DELETE' });
  });

  it('drops an unreadable row from the list but fails a bad write answer', async () => {
    stubFetch(() =>
      jsonResponse(200, { folders: [FOLDER, { ...FOLDER, id: 'f-2', icon: 'rocket' }] }),
    );
    expect((await listChatFolders()).map((folder) => folder.id)).toEqual(['f-1']);

    stubFetch(() => jsonResponse(201, { folder: { ...FOLDER, icon: 'rocket' } }));
    await expect(createChatFolder({ name: 'X', icon: 'folder' })).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });
});

describe('group roles over the contract client', () => {
  const ROLE = { id: 'r-1', name: 'Designers', members: [{ userId: 'u-1', name: 'Ana' }] };

  it('lists, creates with a trimmed name and renames by path', async () => {
    const fetchMock = stubFetch(() => jsonResponse(200, { roles: [ROLE] }));
    expect(await listGroupRoles('g/1')).toEqual([ROLE]);
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/groups/g%2F1/roles');

    fetchMock.mockImplementation(async () => jsonResponse(201, ROLE));
    expect(await createGroupRole('g-1', '  Designers ')).toEqual(ROLE);
    const [, createInit] = fetchMock.mock.calls[1]!;
    expect(createInit).toMatchObject({ method: 'POST' });
    expect(JSON.parse(createInit!.body as string)).toEqual({ name: 'Designers' });

    fetchMock.mockImplementation(async () => jsonResponse(200, ROLE));
    await renameGroupRole('g-1', 'r 1', 'Artists');
    expect(fetchMock.mock.calls[2]![0]).toBe('/api/groups/g-1/roles/r%201');
    expect(fetchMock.mock.calls[2]![1]).toMatchObject({ method: 'PATCH' });
  });

  it('replaces the holders and deletes with a 204', async () => {
    const fetchMock = stubFetch(() => jsonResponse(200, ROLE));
    expect(await setGroupRoleMembers('g-1', 'r-1', ['u-1'])).toEqual(ROLE);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/groups/g-1/roles/r-1/members');
    expect(init).toMatchObject({ method: 'PUT' });
    expect(JSON.parse(init!.body as string)).toEqual({ userIds: ['u-1'] });

    fetchMock.mockImplementation(async () => new Response(null, { status: 204 }));
    await expect(deleteGroupRole('g-1', 'r-1')).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({ method: 'DELETE' });
  });

  it('surfaces a refused write as the shared ApiError', async () => {
    stubFetch(() => jsonResponse(403, { error: { code: 'forbidden', message: 'Owners only' } }));
    const error = await deleteGroupRole('g-1', 'r-1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 403, code: 'forbidden', message: 'Owners only' });
  });
});

describe('groups over the contract client', () => {
  const DETAIL = {
    id: 'g-1',
    title: 'Team',
    createdBy: 'u-1',
    createdAt: '2026-10-09T10:00:00.000Z',
    membersCanCreateTopics: false,
    kind: 'group',
    description: null,
    visibility: 'private',
    handle: null,
    background: { backgroundPreset: null, backgroundImageId: null, backgroundDim: null },
    listener: { enabled: false, eagerness: 'normal', available: false },
    members: [{ userId: 'u-1', name: 'Ana', role: 'owner', roles: [] }],
    ais: [],
  };

  it('creates with trimmed text and the default member list, and reads the 201 detail', async () => {
    const fetchMock = stubFetch(() => jsonResponse(201, DETAIL));

    const created = await createGroup({
      title: ' Team ',
      memberIds: [],
      kind: 'channel',
      description: ' News ',
    });
    expect(created.id).toBe('g-1');
    expect(created.createdAt).toBeInstanceOf(Date);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/groups');
    expect(JSON.parse(init!.body as string)).toEqual({
      title: 'Team',
      memberIds: [],
      kind: 'channel',
      description: 'News',
    });
  });

  it('reads, adds and removes an AI, and removes a member by path', async () => {
    const fetchMock = stubFetch(() => jsonResponse(200, DETAIL));
    await getGroup('g/1');
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/groups/g%2F1');

    await addGroupAi('g-1', 'ai-1');
    expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string)).toEqual({ aiId: 'ai-1' });

    await removeGroupAi('g-1', 'ai 1');
    expect(fetchMock.mock.calls[2]![0]).toBe('/api/groups/g-1/ais/ai%201');
    expect(fetchMock.mock.calls[2]![1]).toMatchObject({ method: 'DELETE' });

    await removeGroupMember('g-1', 'u-2');
    expect(fetchMock.mock.calls[3]![0]).toBe('/api/groups/g-1/members/u-2');
  });

  it('patches only the fields that are set and maps the role and join calls', async () => {
    const fetchMock = stubFetch(() => jsonResponse(200, DETAIL));
    await setGroupListener('g-1', { listenerEnabled: true });
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: 'PATCH' });
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({
      listenerEnabled: true,
    });

    await setGroupBackground('g-1', {
      backgroundPreset: 'gold',
      backgroundImageId: null,
      backgroundDim: null,
    });
    expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string)).toEqual({
      background: { backgroundPreset: 'gold', backgroundImageId: null, backgroundDim: null },
    });

    await changeGroupMemberRole('g-1', 'u-2', 'admin');
    expect(fetchMock.mock.calls[2]![0]).toBe('/api/groups/g-1/members/u-2/role');
    expect(fetchMock.mock.calls[2]![1]).toMatchObject({ method: 'PUT' });

    fetchMock.mockImplementation(async () =>
      jsonResponse(200, { groupId: 'g-1', alreadyMember: true }),
    );
    expect(await joinPublicGroup('g-1')).toEqual({ groupId: 'g-1', alreadyMember: true });
    expect(fetchMock.mock.calls[3]![1]).toMatchObject({ method: 'POST' });
  });

  it('lists the members and rejects an unknown preset before sending', async () => {
    const fetchMock = stubFetch(() => jsonResponse(200, { members: DETAIL.members }));
    expect(await listGroupMembers('g-1')).toEqual(DETAIL.members);

    await expect(
      setGroupBackground('g-1', {
        backgroundPreset: 'neon',
        backgroundImageId: null,
        backgroundDim: null,
      }),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_request' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('topics over the contract client', () => {
  const TOPIC = {
    id: 't-1',
    groupId: 'g-1',
    name: 'Checkout bug',
    glyph: 'B',
    chatJid: 't-1@rooms.zilar.test',
    visibility: 'public',
    kind: 'bug',
    status: 'open',
    owner: null,
    linkUrl: null,
    linkLabel: null,
    isGeneral: false,
    archived: false,
    memberCount: 3,
    ais: [],
  };

  it('creates with trimmed text, drops unset fields and reads the 201 row', async () => {
    const fetchMock = stubFetch(() => jsonResponse(201, TOPIC));

    const created = await createTopic('g-1', {
      name: ' Checkout bug ',
      kind: 'bug',
      linkUrl: ' https://example.com/pr/42 ',
      linkLabel: ' PR #42 ',
      owner: null,
    });
    expect(created.id).toBe('t-1');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/groups/g-1/topics');
    expect(JSON.parse(init!.body as string)).toEqual({
      name: 'Checkout bug',
      kind: 'bug',
      linkUrl: 'https://example.com/pr/42',
      linkLabel: 'PR #42',
      owner: null,
    });
  });

  it('reads an unknown kind, status and visibility as chat, open and private', async () => {
    stubFetch(() =>
      jsonResponse(200, { ...TOPIC, kind: 'epic', status: 'shipped', visibility: 'group' }),
    );
    expect(await getTopic('t-1')).toMatchObject({
      kind: 'chat',
      status: 'open',
      visibility: 'private',
    });
  });

  it('patches, manages members and AIs, and sets roles by path', async () => {
    const fetchMock = stubFetch(() => jsonResponse(200, TOPIC));
    await patchTopic('t-1', { status: 'done' });
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({ status: 'done' });
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: 'PATCH' });

    await removeTopicMember('t-1', 'u 2');
    expect(fetchMock.mock.calls[1]![0]).toBe('/api/topics/t-1/members/u%202');
    await addTopicAi('t-1', 'ai-1');
    expect(JSON.parse(fetchMock.mock.calls[2]![1]!.body as string)).toEqual({ aiId: 'ai-1' });
    await setTopicRoles('t-1', { roleIds: ['r-1'], approverRoleId: null });
    expect(fetchMock.mock.calls[3]![1]).toMatchObject({ method: 'PUT' });
    expect(JSON.parse(fetchMock.mock.calls[3]![1]!.body as string)).toEqual({
      roleIds: ['r-1'],
      approverRoleId: null,
    });

    fetchMock.mockImplementation(async () =>
      jsonResponse(200, { members: [{ userId: 'u-1', name: 'Ana' }] }),
    );
    expect(await listTopicMembers('t-1')).toEqual([{ userId: 'u-1', name: 'Ana' }]);
  });

  it('rejects a non-https link before sending', async () => {
    const fetchMock = stubFetch(() => jsonResponse(201, TOPIC));
    await expect(
      createTopic('g-1', { name: 'X', linkUrl: 'http://x.example.com', linkLabel: 'X' }),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_request' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

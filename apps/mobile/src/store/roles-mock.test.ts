import { describe, expect, it } from 'vitest';

import { createChatStore } from './chat-store';

describe('mock mode group roles (T-0137)', () => {
  it('seeds the Designers and Devs roles with holders', () => {
    const store = createChatStore();
    expect(store.getState().groupRoles('g-devteam')).toMatchObject([
      {
        id: 'role-designers',
        name: 'Designers',
        members: [
          { userId: 'me', name: 'You' },
          { userId: 'ana', name: 'Ana' },
        ],
      },
      { id: 'role-devs', name: 'Devs' },
    ]);
    expect(store.getState().groupRoles('g-nope')).toBeUndefined();
  });

  it('creates, renames, assigns and deletes roles in memory', async () => {
    const store = createChatStore();
    const state = () => store.getState();

    const created = await state().createGroupRole('g-devteam', 'QA');
    expect(created).toMatchObject({ name: 'QA', members: [] });
    expect(state().groupRoles('g-devteam')).toHaveLength(3);

    const renamed = await state().renameGroupRole('g-devteam', created.id, 'Quality');
    expect(renamed.name).toBe('Quality');

    const assigned = await state().setGroupRoleMembers('g-devteam', created.id, ['luis']);
    expect(assigned.members).toEqual([{ userId: 'luis', name: 'Luis' }]);

    await state().deleteGroupRole('g-devteam', created.id);
    expect(
      state()
        .groupRoles('g-devteam')
        ?.some((role) => role.id === created.id),
    ).toBe(false);
  });

  it('rejects role writes for an unknown group', async () => {
    const store = createChatStore();
    await expect(store.getState().createGroupRole('g-nope', 'QA')).rejects.toThrow(
      'This group is not available yet.',
    );
  });

  it('seeds the hiring topic with Designers and the UI topic approver', () => {
    const store = createChatStore();
    expect(store.getState().topicRoles('t-devteam-hiring')).toMatchObject({
      roles: [{ id: 'role-designers', name: 'Designers', memberCount: 2 }],
      approverRole: null,
    });
    expect(store.getState().topicRoles('t-devteam-ui')).toMatchObject({
      roles: [],
      approverRole: { id: 'role-designers', name: 'Designers' },
    });
  });

  it('attaches roles and picks the approver in mock mode', async () => {
    const store = createChatStore();
    const state = () => store.getState();

    await state().setTopicRoles('t-devteam-hiring', {
      roleIds: ['role-designers', 'role-devs'],
      approverRoleId: 'role-designers',
    });
    expect(state().topicRoles('t-devteam-hiring')).toMatchObject({
      roles: [
        { id: 'role-designers', memberCount: 2 },
        { id: 'role-devs', memberCount: 2 },
      ],
      approverRole: { id: 'role-designers', name: 'Designers' },
    });
  });

  it('allows an approver role that is not attached, like the server', async () => {
    // `setTopicRoles` on the server only requires the approver role to
    // belong to the topic's group (`topics/service.ts`), not to be attached.
    // The mock matches: no rejection for an unattached group role.
    const store = createChatStore();
    const state = () => store.getState();

    await state().setTopicRoles('t-devteam-hiring', {
      roleIds: [],
      approverRoleId: 'role-devs',
    });
    expect(state().topicRoles('t-devteam-hiring')).toMatchObject({
      roles: [],
      approverRole: { id: 'role-devs', name: 'Devs' },
    });
  });

  it('refuses roles on public topics in mock mode', async () => {
    const store = createChatStore();
    await expect(
      store.getState().setTopicRoles('t-devteam-bug', { roleIds: [], approverRoleId: null }),
    ).rejects.toThrow('Only private topics have roles.');
  });

  it('clears the roles on the private-to-public flip in mock mode', async () => {
    const store = createChatStore();
    const state = () => store.getState();
    expect(state().topicRoles('t-devteam-hiring')?.roles).toHaveLength(1);

    await state().patchTopic('t-devteam-hiring', { visibility: 'public' });

    expect(state().topicRoles('t-devteam-hiring')).toEqual({ roles: [], approverRole: null });
  });
});

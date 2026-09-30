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

    const created = await state().createGroupRole('dev-team', 'QA');
    expect(created).toMatchObject({ name: 'QA', members: [] });
    expect(state().groupRoles('g-devteam')).toHaveLength(3);

    const renamed = await state().renameGroupRole('dev-team', created.id, 'Quality');
    expect(renamed.name).toBe('Quality');

    const assigned = await state().setGroupRoleMembers('dev-team', created.id, ['luis']);
    expect(assigned.members).toEqual([{ userId: 'luis', name: 'Luis' }]);

    await state().deleteGroupRole('dev-team', created.id);
    expect(
      state()
        .groupRoles('g-devteam')
        ?.some((role) => role.id === created.id),
    ).toBe(false);
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

import type { ChatSummary } from '@zilar/chat-core';
import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import {
  changeGroup,
  changeTopic,
  createGroupChannel,
  createInvite,
  createTopic,
  joinPublicGroup,
  leaveChannel,
  leaveTopic,
  topicIdFor,
  type GroupActionStore,
} from './group-actions';
import type { TopicRowStore } from './groups';
import { testCtx } from './test-ctx';

const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.runPromise(effect as Effect.Effect<A, E, never>);

function groupRow(chatId: string, topicId: string, isGeneral = false): ChatSummary {
  return {
    id: chatId,
    kind: 'group',
    title: chatId,
    unread: 0,
    groupId: 'g1',
    topic: {
      id: topicId,
      glyph: 'G',
      kind: 'chat',
      status: 'open',
      visibility: 'public',
      isGeneral,
      archived: false,
      owner: null,
      linkUrl: null,
      linkLabel: null,
    },
  } as unknown as ChatSummary;
}

function topicStore(rows: ChatSummary[] = []): TopicRowStore {
  return {
    getChats: async () => [],
    summariesFor: () => rows,
    rememberGroupIds: () => {},
    prefRows: () => [],
    now: () => new Date(0),
  };
}

const store = (rows: ChatSummary[] = []): GroupActionStore => ({
  groupIdFor: () => 'g1',
  rows: topicStore(rows),
});

const GENERAL = 'general@rooms.zilar.test';

describe('topicIdFor (core)', () => {
  it('resolves the topic and group ids of a chat', async () => {
    const { ctx } = testCtx({ state: { chats: [groupRow(GENERAL, 't-general')] } });

    expect(await run(topicIdFor(ctx, store(), GENERAL))).toEqual({
      topicId: 't-general',
      groupId: 'g1',
    });
  });

  it('fails for a chat that is not a topic', async () => {
    const { ctx } = testCtx({ state: { chats: [] } });

    await expect(run(topicIdFor(ctx, store(), GENERAL))).rejects.toThrow(
      'This topic is not available yet.',
    );
  });
});

describe('changeTopic (core)', () => {
  it('calls the route with the chat topic id and repaints the row', async () => {
    const live = groupRow(GENERAL, 't-general');
    const { ctx, state } = testCtx({ state: { chats: [live] } });
    const call = vi.fn(async (topicId: string) => ({ id: topicId, archived: true }));

    await run(changeTopic(ctx, store([live]), GENERAL, call));

    expect(call).toHaveBeenCalledWith('t-general');
    // The archived response drops the row (R17).
    expect(state().chats).toEqual([]);
  });

  it('runs the before hook on the server response', async () => {
    const live = groupRow(GENERAL, 't-general');
    const { ctx } = testCtx({ state: { chats: [live] } });
    const before = vi.fn();

    await run(changeTopic(ctx, store([live]), GENERAL, async () => ({ id: 't-general' }), before));

    expect(before).toHaveBeenCalledWith({ id: 't-general' });
  });
});

describe('createTopic (core)', () => {
  const created = (overrides: Record<string, unknown> = {}) => ({ id: 't-new', ...overrides });

  it('creates, repaints, joins the room and returns the row id', async () => {
    const row = groupRow('new-topic@rooms.zilar.test', 't-new');
    const { ctx } = testCtx({ state: { chats: [row] } });
    const apply = vi.fn(() => Effect.void);
    const joinRoom = vi.fn(() => Effect.void);
    const create = vi.fn(async () => created());

    const id = await run(
      createTopic(
        ctx,
        {
          groupIdFor: () => 'g1',
          requireRow: true,
          fallbackRowId: () => 'fallback',
          apply,
          joinRoom,
        },
        GENERAL,
        create,
      ),
    );

    expect(create).toHaveBeenCalledWith('g1');
    expect(apply).toHaveBeenCalledWith({ id: 't-new' });
    expect(id).toBe('new-topic@rooms.zilar.test');
    expect(joinRoom).toHaveBeenCalledWith('new-topic@rooms.zilar.test');
  });

  it('falls back to the response chat JID when the row is missing (mobile)', async () => {
    const { ctx } = testCtx({ state: { chats: [groupRow(GENERAL, 't-general')] } });
    const joinRoom = vi.fn(() => Effect.void);

    const id = await run(
      createTopic(
        ctx,
        {
          groupIdFor: () => 'g1',
          requireRow: false,
          fallbackRowId: () => 'new-topic@rooms.zilar.test',
          apply: () => Effect.void,
          joinRoom,
        },
        GENERAL,
        async () => created(),
      ),
    );

    expect(id).toBe('new-topic@rooms.zilar.test');
    expect(joinRoom).toHaveBeenCalledWith('new-topic@rooms.zilar.test');
  });

  it('fails when the new topic is not in the list (web)', async () => {
    const { ctx } = testCtx({ state: { chats: [groupRow(GENERAL, 't-general')] } });

    await expect(
      run(
        createTopic(
          ctx,
          {
            groupIdFor: () => 'g1',
            requireRow: true,
            fallbackRowId: () => 'fallback',
            apply: () => Effect.void,
            joinRoom: () => Effect.void,
          },
          GENERAL,
          async () => created(),
        ),
      ),
    ).rejects.toThrow('the new topic did not appear in the chat list');
  });

  it('fails when the chat has no group', async () => {
    const { ctx } = testCtx({ state: { chats: [] } });

    await expect(
      run(
        createTopic(
          ctx,
          {
            groupIdFor: () => undefined,
            requireRow: false,
            fallbackRowId: () => 'fallback',
            apply: () => Effect.void,
            joinRoom: () => Effect.void,
          },
          GENERAL,
          async () => created(),
        ),
      ),
    ).rejects.toThrow('This group is not available yet.');
  });
});

describe('leaveTopic (core)', () => {
  const notFound = { status: 404 };

  it('swallows a 404 once the topic left the list (web)', async () => {
    const live = groupRow(GENERAL, 't-general');
    const { ctx } = testCtx({ state: { chats: [live] } });
    const refreshChats = vi.fn(() => Effect.void);

    await run(
      leaveTopic(
        ctx,
        {
          groupIdFor: () => 'g1',
          currentUserId: () => 'u-me',
          removeMember: () => Effect.fail(notFound),
        },
        {
          isNotFound: () => true,
          refreshTopicRow: () => Effect.succeed(true),
          refreshChats,
        },
        GENERAL,
      ),
    );

    expect(refreshChats).toHaveBeenCalled();
  });

  it('rethrows a failure that is not a gone topic', async () => {
    const live = groupRow(GENERAL, 't-general');
    const { ctx } = testCtx({ state: { chats: [live] } });
    const refreshTopicRow = vi.fn(() => Effect.succeed(false));

    await expect(
      run(
        leaveTopic(
          ctx,
          {
            groupIdFor: () => 'g1',
            currentUserId: () => 'u-me',
            removeMember: () => Effect.fail(new Error('not a member')),
          },
          {
            isNotFound: () => false,
            refreshTopicRow,
            refreshChats: () => Effect.void,
          },
          GENERAL,
        ),
      ),
    ).rejects.toThrow('not a member');

    expect(refreshTopicRow).not.toHaveBeenCalled();
  });

  it('fails before removing when no user is signed in', async () => {
    const { ctx } = testCtx({ state: { chats: [] } });
    const removeMember = vi.fn(() => Effect.void);

    await expect(
      run(
        leaveTopic(
          ctx,
          { groupIdFor: () => 'g1', currentUserId: () => undefined, removeMember },
          {
            isNotFound: () => true,
            refreshTopicRow: () => Effect.succeed(true),
            refreshChats: () => Effect.void,
          },
          GENERAL,
        ),
      ),
    ).rejects.toThrow('This topic is not available yet.');

    expect(removeMember).not.toHaveBeenCalled();
  });
});

describe('leaveChannel (core)', () => {
  it('removes the caller through the route and refreshes the list', async () => {
    const removeMember = vi.fn(() => Effect.void);
    const refreshList = vi.fn(() => Effect.void);

    await run(
      leaveChannel(
        { groupIdFor: () => 'g1', currentUserId: () => 'u-me', removeMember },
        refreshList(),
        GENERAL,
      ),
    );

    expect(removeMember).toHaveBeenCalledWith('g1', 'u-me');
    expect(refreshList).toHaveBeenCalled();
  });

  it('fails before removing when the group is unknown', async () => {
    const removeMember = vi.fn(() => Effect.void);

    await expect(
      run(
        leaveChannel(
          { groupIdFor: () => undefined, currentUserId: () => 'u-me', removeMember },
          Effect.void,
          GENERAL,
        ),
      ),
    ).rejects.toThrow('This channel is not available yet.');

    expect(removeMember).not.toHaveBeenCalled();
  });

  it('fails before removing when no user is signed in', async () => {
    const removeMember = vi.fn(() => Effect.void);

    await expect(
      run(
        leaveChannel(
          { groupIdFor: () => 'g1', currentUserId: () => undefined, removeMember },
          Effect.void,
          GENERAL,
        ),
      ),
    ).rejects.toThrow('This channel is not available yet.');

    expect(removeMember).not.toHaveBeenCalled();
  });
});

describe('changeGroup (core)', () => {
  it('resolves the group, applies the detail and refreshes the list', async () => {
    const call = vi.fn(async () => ({ id: 'g1' }));
    const applyDetail = vi.fn();
    const refreshList = vi.fn(() => Effect.void);

    await run(
      changeGroup(
        {
          resolve: () => ({ groupId: 'g1', domain: 'zilar.test' }),
          applyDetail,
          refreshList,
        },
        GENERAL,
        'This group is not available yet.',
        call,
        true,
      ),
    );

    expect(call).toHaveBeenCalledWith('g1');
    expect(applyDetail).toHaveBeenCalledWith(GENERAL, { id: 'g1' }, 'zilar.test');
    expect(refreshList).toHaveBeenCalled();
  });

  it('reloads the detail instead of applying a response and skips the list', async () => {
    const reloadDetail = vi.fn(() => Effect.void);
    const refreshList = vi.fn(() => Effect.void);

    await run(
      changeGroup<void>(
        {
          resolve: () => ({ groupId: 'g1', domain: '' }),
          applyDetail: () => {},
          reloadDetail,
          refreshList,
        },
        GENERAL,
        'This channel is not available yet.',
        async () => {},
        false,
      ),
    );

    expect(reloadDetail).toHaveBeenCalledWith('g1');
    expect(refreshList).not.toHaveBeenCalled();
  });

  it('fails when the group cannot be resolved', async () => {
    const call = vi.fn(async () => ({ id: 'g1' }));

    await expect(
      run(
        changeGroup(
          { resolve: () => undefined, applyDetail: () => {}, refreshList: () => Effect.void },
          GENERAL,
          'This group is not available yet.',
          call,
          false,
        ),
      ),
    ).rejects.toThrow('This group is not available yet.');

    expect(call).not.toHaveBeenCalled();
  });
});

describe('createGroupChannel (core)', () => {
  it('creates, locates the row, opens it and answers the result', async () => {
    const open = vi.fn(() => Effect.void);

    const id = await run(
      createGroupChannel(
        {
          create: async () => ({ id: 'g2' }),
          refreshAndLocate: () => Effect.succeed('g2@rooms.zilar.test'),
          open,
          requireRow: true,
          result: (chatJid) => chatJid ?? '',
        },
        'the new group did not appear in the chat list',
      ),
    );

    expect(open).toHaveBeenCalledWith('g2@rooms.zilar.test');
    expect(id).toBe('g2@rooms.zilar.test');
  });

  it('answers the group id and opens nothing (mobile)', async () => {
    const open = vi.fn(() => Effect.void);

    const id = await run(
      createGroupChannel(
        {
          create: async () => ({ id: 'g2' }),
          refreshAndLocate: () => Effect.succeed(undefined),
          open,
          requireRow: false,
          result: (_chatJid, detail) => detail.id,
        },
        'the new group did not appear in the chat list',
      ),
    );

    expect(open).not.toHaveBeenCalled();
    expect(id).toBe('g2');
  });

  it('fails when the new row is missing and requireRow is true (web)', async () => {
    await expect(
      run(
        createGroupChannel(
          {
            create: async () => ({ id: 'g2' }),
            refreshAndLocate: () => Effect.succeed(undefined),
            requireRow: true,
            result: (chatJid) => chatJid ?? '',
          },
          'the new group did not appear in the chat list',
        ),
      ),
    ).rejects.toThrow('the new group did not appear in the chat list');
  });
});

describe('joinPublicGroup (core)', () => {
  it('joins and answers the General chat id', async () => {
    const general = groupRow(GENERAL, 't-general', true);
    const { ctx } = testCtx({ state: { chats: [general] } });
    const join = vi.fn(async () => {});
    const refreshList = vi.fn(() => Effect.void);

    const id = await run(joinPublicGroup(ctx, { join, refreshList }, 'g1'));

    expect(join).toHaveBeenCalledWith('g1');
    expect(refreshList).toHaveBeenCalled();
    expect(id).toBe(GENERAL);
  });
});

describe('createInvite (core)', () => {
  it('answers the invite url', async () => {
    const create = vi.fn(async () => ({ url: 'https://x/invite/c' }));

    expect(await run(createInvite(create))).toBe('https://x/invite/c');
  });
});

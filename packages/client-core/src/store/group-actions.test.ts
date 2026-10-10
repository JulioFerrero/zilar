import type { ChatSummary } from '@zilar/chat-core';
import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import {
  changeTopic,
  createTopic,
  leaveTopic,
  topicIdFor,
  type GroupActionStore,
} from './group-actions';
import type { TopicRowStore } from './groups';
import { testCtx } from './test-ctx';

const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.runPromise(effect as Effect.Effect<A, E, never>);

function groupRow(chatId: string, topicId: string): ChatSummary {
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
      isGeneral: false,
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

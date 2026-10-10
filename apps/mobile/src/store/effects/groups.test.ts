import { createFakeXmppCore } from '@zilar/xmpp-core/testing';
import { describe, expect, it, vi } from 'vitest';

import type { ChatApi } from '../../lib/chat-api';
import { createRealChatStore } from '../real-store';
import { fakeApi } from '../test-support';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function groupApi(getGroup: ChatApi['getGroup']): ChatApi {
  return fakeApi({ getGroup }) as unknown as ChatApi;
}

describe('groups on the effect fibers', () => {
  it('serves two callers of ensureGroupDetail with one GET and bumps the revision', async () => {
    const getGroup = vi.fn(async () => ({ id: 'g1', members: [], ais: [] }));
    const store = createRealChatStore({
      api: groupApi(getGroup as unknown as ChatApi['getGroup']),
      createXmpp: () => createFakeXmppCore(),
    });
    store.getState().start();
    await flush();
    const before = store.getState().groupDetailsRevision;

    store.getState().ensureGroupDetail('g1');
    store.getState().ensureGroupDetail('g1');
    await flush();
    expect(getGroup).toHaveBeenCalledTimes(1);
    expect(store.getState().groupDetailsRevision).toBe(before + 1);
    expect(store.getState().groupDetail('g1')).toBeDefined();

    store.getState().ensureGroupDetail('g1');
    await flush();
    expect(getGroup).toHaveBeenCalledTimes(1);
    store.getState().stop();
  });

  it('a failed detail load stays silent and can be retried', async () => {
    const getGroup = vi
      .fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue({ id: 'g1', members: [], ais: [] });
    const store = createRealChatStore({
      api: groupApi(getGroup as unknown as ChatApi['getGroup']),
      createXmpp: () => createFakeXmppCore(),
    });
    store.getState().start();
    await flush();

    store.getState().ensureGroupDetail('g1');
    await flush();
    expect(store.getState().groupDetail('g1')).toBeUndefined();

    store.getState().refreshGroupDetail('g1');
    await flush();
    expect(store.getState().groupDetail('g1')).toBeDefined();
    store.getState().stop();
  });

  it('rejects a topic action for a chat that is not a topic', async () => {
    const store = createRealChatStore({
      api: groupApi(vi.fn() as unknown as ChatApi['getGroup']),
      createXmpp: () => createFakeXmppCore(),
    });
    store.getState().start();
    await flush();
    await expect(store.getState().listTopicMembers('nope@zilar.test')).rejects.toThrow(
      'This topic is not available yet.',
    );
    store.getState().stop();
  });
});

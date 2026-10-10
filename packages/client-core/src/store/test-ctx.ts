// A core context over a plain in-memory state, for the core's own tests. The
// ledger is the real one; the XMPP core and the app hooks are spies.
import type { ChatSummary } from '@zilar/chat-core';
import type { XmppCore } from '@zilar/xmpp-core';
import { Context } from 'effect';
import { vi } from 'vitest';
import type { CoreActionError, CoreCtx, CoreSet, CoreState } from './ctx';
import { createMessageLedger } from './ledger';
import { makeLifetime } from './lifetime';
import { testCorePorts, type CorePorts } from './ports';

export const ME = 'me@zilar.test';
export const ANA = 'ana@zilar.test';
export const TEAM = 'team@rooms.zilar.test';
export const NOW = new Date('2026-09-28T12:00:00Z');

export const dm: ChatSummary = { id: ANA, kind: 'dm', title: 'Ana', unread: 0 } as ChatSummary;
export const team: ChatSummary = {
  id: TEAM,
  kind: 'group',
  title: 'Team',
  unread: 0,
  memberCount: 3,
} as ChatSummary;

export type TestState = CoreState & { actionError?: CoreActionError | undefined };

export function testCtx(
  options: {
    core?: Partial<XmppCore>;
    ports?: Partial<CorePorts>;
    state?: Partial<CoreState>;
  } = {},
) {
  let state: TestState = {
    messagesByChat: {},
    chats: [dm, team],
    edits: {},
    reactions: {},
    contacts: [{ jid: ANA, name: 'Ana' }],
    me: { jid: ME },
    currentUserId: 'u-me',
    activeChatId: undefined,
    typing: {},
    drafts: {},
    finishedDraftMessages: {},
    ...options.state,
  };
  const set: CoreSet = (update) => {
    const patch = typeof update === 'function' ? update(state) : update;
    state = { ...state, ...patch };
  };
  const fx = {
    syncBadge: vi.fn(),
    dismissChatNotifications: vi.fn(),
    loadGroupMembers: vi.fn(),
    finishDraftTurn: vi.fn(),
    forgetRetryBytes: vi.fn(),
  };
  const core = {
    markDisplayed: vi.fn(),
    sendTyping: vi.fn(),
    sendReactions: vi.fn(async () => {}),
    sendCorrection: vi.fn(async () => ({ id: 'edit-1' })),
    sendRetraction: vi.fn(async () => {}),
    ...options.core,
  } as unknown as XmppCore;
  const rt = makeLifetime(Context.empty());
  const ctx: CoreCtx = {
    get: () => state,
    set,
    ports: testCorePorts({ now: () => NOW, ...options.ports }),
    rt,
    k: createMessageLedger({
      get: () => state,
      set,
      memberName: () => undefined,
      occupantNick: () => undefined,
      mediaToken: () => undefined,
    }),
    fx,
    core,
    lastRead: {},
    lastReadUserId: 'u-me',
    pendingOutgoing: new Map(),
  };
  return { ctx, fx, core, rt, state: () => state };
}

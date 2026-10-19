// Shared fakes for the store tests. Not imported by app code.
import { vi } from 'vitest';

import type { ChatEntry } from '../lib/chat-api';
import type { AppStateLike } from './real-store';

/** An app that stays in the foreground and never changes state. */
export function fakeAppState(): AppStateLike {
  return { current: () => 'active', subscribe: () => () => {} };
}

function baseApi() {
  return {
    getMe: vi.fn(async () => ({
      id: 'u-me',
      email: 'me@zilar.test',
      name: 'Me',
      jid: 'me@zilar.test',
    })),
    getChats: vi.fn(async (): Promise<ChatEntry[]> => []),
    getContacts: vi.fn(async () => []),
    getGroup: vi.fn(async () => ({
      id: 'g1',
      title: 'Dev team',
      createdBy: 'u-me',
      members: [],
      ais: [],
    })),
    getXmppToken: vi.fn(async () => ({
      jid: 'me@zilar.test',
      token: 'tok',
      expiresAt: '2026-09-28T12:05:00Z',
      service: 'ws://x',
      domain: 'zilar.test',
      mucDomain: 'rooms.zilar.test',
    })),
  };
}

/**
 * The chat API a booted store needs: me, an empty chat list, no contacts, one
 * group and an XMPP token. `overrides` replace single methods and keep their
 * own mock types.
 */
export function fakeApi<O extends object = object>(
  overrides: O = {} as O,
): Omit<ReturnType<typeof baseApi>, keyof O> & O {
  return { ...baseApi(), ...overrides };
}

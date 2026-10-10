// @vitest-environment jsdom
import type { ChatSummary } from '@zilar/chat-core';
import { createRequire } from 'node:module';
import { act, createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SearchApi, SearchItem } from '@/lib/search-api';
import { waitForAct } from '@/test/wait';

import { MessageSearchList } from './message-search-list';

// A router throw after the jump landed is a defect, not a typed failure: the
// search list must still show the miss notice instead of leaving the user on
// a spinner. The typed-failure cases live in `message-search-list.test.tsx`.
const { holder } = vi.hoisted(() => ({
  holder: {
    push: vi.fn(),
    openAtMessage: vi.fn(),
  },
}));

const HIT: SearchItem = {
  chatJid: 'ana',
  messageId: 'm-9',
  senderName: 'Ana',
  at: '2026-09-28T12:00:00Z',
  snippet: 'the terrace',
  marks: [[4, 11]],
};

vi.mock('expo-router', () => ({
  useRouter: () => ({ push: holder.push }),
}));

vi.mock('@/store/chat-store-provider', () => ({
  useChatStore: (selector: (state: unknown) => unknown) =>
    selector({
      chats: [{ id: 'ana', title: 'Ana' } as ChatSummary],
      openAtMessage: holder.openAtMessage,
    }),
}));

vi.mock('./use-message-search', () => ({
  useMessageSearch: () => ({ status: 'ready', items: [HIT] }),
}));

vi.mock('./search-snippet', () => ({
  SearchHitLine: ({ item }: { item: SearchItem }) => createElement('span', null, item.snippet),
}));

vi.mock('@/components/chat/avatar', () => ({ Avatar: () => null }));
vi.mock('@/components/chat/load-error', () => ({ LoadError: () => null }));
vi.mock('@/lib/colors', () => ({ ACCENT: '#ededed' }));

vi.mock('@/components/ui/text', () => ({
  Text: ({ children }: { children?: ReactNode }) => createElement('span', null, children),
}));

vi.mock('react-native', () => ({
  ActivityIndicator: () => null,
  Pressable: ({
    children,
    onPress,
    accessibilityLabel,
  }: {
    children?: ReactNode;
    onPress?: () => void;
    accessibilityLabel?: string;
  }) =>
    createElement(
      'button',
      { type: 'button', 'aria-label': accessibilityLabel, onClick: onPress },
      children,
    ),
  ScrollView: ({ children }: { children?: ReactNode }) => createElement('div', null, children),
  View: ({ children }: { children?: ReactNode }) => createElement('div', null, children),
}));

const nodeRequire = createRequire(import.meta.url);
const { createRoot } = nodeRequire('react-dom/client') as {
  createRoot: (container: Element) => { render(node: ReactNode): void; unmount(): void };
};

let cleanup: (() => void) | undefined;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  holder.push.mockReset();
  holder.openAtMessage.mockReset();
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

describe('MessageSearchList jump defects', () => {
  it('shows the miss notice when the router throws after the jump landed', async () => {
    holder.openAtMessage.mockResolvedValue({ id: 'm-9' });
    holder.push.mockImplementation(() => {
      throw new Error('router down');
    });
    const onNotFound = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() =>
      root.render(
        createElement(MessageSearchList, {
          searchApi: {} as SearchApi,
          query: 'terrace',
          onNotFound,
        }),
      ),
    );
    cleanup = () => {
      act(() => root.unmount());
      container.remove();
    };

    const hit = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Open message from Ana in Ana"]',
    );
    act(() => hit?.click());
    await waitForAct(() => {
      expect(onNotFound).toHaveBeenCalledWith('ana');
    });

    expect(holder.push).toHaveBeenCalledTimes(1);
  });
});

// @vitest-environment jsdom
import type { ChatSummary } from '@zilar/chat-core';
import { createRequire } from 'node:module';
import { act, createElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SearchApi, SearchItem } from '@/lib/search-api';

import { MessageSearchList } from './message-search-list';

const { holder } = vi.hoisted(() => ({
  holder: {
    view: { status: 'idle' } as unknown,
    push: vi.fn(),
    openAtMessage: vi.fn(),
    chats: [] as unknown[],
  },
}));

vi.mock('expo-router', () => ({
  useRouter: () => ({ push: holder.push }),
}));

vi.mock('@/store/chat-store-provider', () => ({
  useChatStore: (selector: (state: unknown) => unknown) =>
    selector({ chats: holder.chats, openAtMessage: holder.openAtMessage }),
}));

vi.mock('./use-message-search', () => ({
  useMessageSearch: () => holder.view,
}));

vi.mock('./search-snippet', async () => {
  const { createElement: create } = await import('react');
  return {
    SearchHitLine: ({ item }: { item: SearchItem }) => create('span', null, item.snippet),
  };
});

vi.mock('@/components/chat/avatar', () => ({
  Avatar: () => null,
}));

vi.mock('@/components/chat/load-error', async () => {
  const { createElement: create } = await import('react');
  return {
    LoadError: ({ message, onRetry }: { message: string; onRetry: () => void }) =>
      create('div', null, [
        create('span', { key: 'message' }, message),
        create(
          'button',
          { key: 'retry', type: 'button', 'aria-label': 'Retry', onClick: onRetry },
          'Retry',
        ),
      ]),
  };
});

vi.mock('@/components/ui/text', async () => {
  const { createElement: create } = await import('react');
  return {
    Text: ({ children }: { children?: ReactNode }) => create('span', null, children),
  };
});

vi.mock('@/lib/colors', () => ({
  ACCENT: { dark: '#ededed', light: '#ededed' },
}));

vi.mock('react-native', async () => {
  const { createElement: create } = await import('react');
  return {
    ActivityIndicator: () => create('span', null, 'spinner'),
    Pressable: ({
      children,
      onPress,
      accessibilityLabel,
    }: {
      children?: ReactNode;
      onPress?: () => void;
      accessibilityLabel?: string;
    }) =>
      create(
        'button',
        { type: 'button', 'aria-label': accessibilityLabel, onClick: onPress },
        children,
      ),
    ScrollView: ({ children }: { children?: ReactNode }) => create('div', null, children),
    View: ({
      children,
      accessibilityLabel,
    }: {
      children?: ReactNode;
      accessibilityLabel?: string;
    }) => create('div', { 'aria-label': accessibilityLabel }, children),
  };
});

const nodeRequire = createRequire(import.meta.url);
const { createRoot } = nodeRequire('react-dom/client') as {
  createRoot: (container: Element) => { render(node: ReactNode): void; unmount(): void };
};

function hit(chatJid: string, messageId: string, senderName = 'Ana'): SearchItem {
  return {
    chatJid,
    messageId,
    senderName,
    at: '2026-09-28T12:00:00Z',
    snippet: 'the terrace',
    marks: [[4, 11]],
  };
}

function chat(id: string, title: string, extra: Record<string, unknown> = {}): ChatSummary {
  return { id, title, ...extra } as ChatSummary;
}

const searchApi = {} as SearchApi;

let container: HTMLDivElement;
let unmount: (() => void) | undefined;

function mount(element: ReactElement): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(element));
  unmount = () => {
    act(() => root.unmount());
    container.remove();
  };
}

// Lets the jump promise and its follow-up settle, inside act.
async function settle(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 10; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

function render(onNotFound = vi.fn()): void {
  mount(createElement(MessageSearchList, { searchApi, query: 'terrace', onNotFound }));
}

function click(label: string, index = 0): void {
  const target = container.querySelectorAll<HTMLButtonElement>(`button[aria-label="${label}"]`)[
    index
  ];
  if (target === undefined) {
    throw new Error(`no button ${label}`);
  }
  act(() => target.click());
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  holder.push.mockReset();
  holder.openAtMessage.mockReset();
  holder.chats = [chat('ana', 'Ana')];
  holder.view = { status: 'idle' };
});

afterEach(() => {
  unmount?.();
  unmount = undefined;
});

describe('MessageSearchList', () => {
  it('renders nothing while idle or when search is unavailable', () => {
    holder.view = { status: 'idle' };
    render();
    expect(container.innerHTML).toBe('');

    holder.view = { status: 'unavailable' };
    unmount?.();
    render();
    expect(container.innerHTML).toBe('');
  });

  it('shows the searching line while the request runs', () => {
    holder.view = { status: 'loading' };
    render();
    expect(container.querySelector('[aria-label="Searching messages"]')).not.toBeNull();
    expect(container.textContent).toContain('Searching…');
  });

  it('shows the error with a Retry that asks again', () => {
    const retry = vi.fn();
    holder.view = {
      status: 'error',
      message: "Couldn't search messages",
      rateLimited: false,
      retry,
    };
    render();
    expect(container.textContent).toContain("Couldn't search messages");

    click('Retry');
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('says so when a search has no messages', () => {
    holder.view = { status: 'ready', items: [] };
    render();
    expect(container.textContent).toContain('No messages found');
  });

  it('groups hits by chat and opens the chat at the message on tap', async () => {
    holder.openAtMessage.mockResolvedValue({ id: 'm-1' });
    holder.view = { status: 'ready', items: [hit('ana', 'm-1'), hit('ana', 'm-2')] };
    render();
    expect(container.textContent).toContain('the terrace');

    click('Open message from Ana in Ana');
    await settle();

    expect(holder.openAtMessage).toHaveBeenCalledWith('ana', 'm-1');
    expect(holder.push).toHaveBeenCalledWith({ pathname: '/chat/[id]', params: { id: 'ana' } });
  });

  it('shows Group › Topic for a topic hit', () => {
    holder.chats = [chat('ana', 'General', { topic: { id: 't-1' }, groupTitle: 'Dev team' })];
    holder.view = { status: 'ready', items: [hit('ana', 'm-1')] };
    render();
    expect(
      container.querySelector('[aria-label="Open message from Ana in Dev team › General"]'),
    ).not.toBeNull();
  });

  it('opens the chat with the not-found notice when the jump gives up', async () => {
    const onNotFound = vi.fn();
    holder.openAtMessage.mockRejectedValue(new Error('message_not_found'));
    holder.view = { status: 'ready', items: [hit('ana', 'm-9')] };
    render(onNotFound);

    click('Open message from Ana in Ana');
    await settle();

    expect(holder.push).toHaveBeenCalledWith({
      pathname: '/chat/[id]',
      params: { id: 'ana', notFound: '1' },
    });
    expect(onNotFound).toHaveBeenCalledWith('ana');
  });

  it('shows the miss notice for an unexpected jump failure instead of a spinner', async () => {
    const onNotFound = vi.fn();
    holder.openAtMessage.mockRejectedValue(new TypeError('boom'));
    holder.view = { status: 'ready', items: [hit('ana', 'm-9')] };
    render(onNotFound);

    click('Open message from Ana in Ana');
    await settle();

    expect(onNotFound).toHaveBeenCalledWith('ana');
    expect(holder.push).not.toHaveBeenCalled();
  });

  it('shows a page error with a Retry for more messages', () => {
    const retry = vi.fn();
    holder.view = {
      status: 'ready',
      items: [hit('ana', 'm-1')],
      nextBefore: '1758988200000000',
      pageError: { message: "Couldn't load more messages", retry },
    };
    render();
    expect(container.textContent).toContain("Couldn't load more messages");

    click('Retry loading more messages');
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import type { ChatFolder } from '@zilar/chat-core';
import { renderApp } from '@/test/renderApp';

const ALL_TITLES = [
  'Ana',
  // T-0111: the "Dev team" group now renders as a header with its mockup
  // topics nested underneath (General keeps the old chat id).
  'Dev team',
  'General',
  'Checkout button hidden on Safari',
  'New pricing page',
  'Daily standup',
  'Release 2.4 notes',
  'Hiring: frontend role',
  'Ideas',
  'Viernes 🍻',
  'Dev AI',
  'Marta',
  'Familia',
  'QA squad',
  'Luis',
  'Marketing AI',
  'Gym buddies',
  'Product',
];

describe('ChatList', () => {
  it('renders every mock chat with its title', () => {
    renderApp('/');
    for (const title of ALL_TITLES) {
      expect(screen.getByText(title)).toBeTruthy();
    }
  });

  it('renders previews, unread badges, mute icons and AI badges', () => {
    renderApp('/');
    expect(screen.getByText('See you tonight ❤️')).toBeTruthy();
    expect(screen.getAllByText('Tests pass. Merge?').length).toBeGreaterThan(0);
    expect(screen.getAllByText('You:').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('2 unread')).toBeTruthy();
    expect(screen.getByLabelText('5 unread')).toBeTruthy();
    expect(screen.getAllByLabelText('Muted')).toHaveLength(2);
    expect(screen.getAllByText('AI')).toHaveLength(2);
  });

  it('filters chats by folder', () => {
    // T-0237: folders come from the server now; seed the store with the
    // Personal/AIs/Work set the old hard-coded tabs provided. The Work
    // folder names the work chat ids explicitly.
    const { store } = renderApp('/');
    const folder = (
      id: string,
      name: string,
      includeTypes: ChatFolder['includeTypes'],
      includeChats: string[] = [],
    ): ChatFolder => ({
      id,
      name,
      icon: 'folder',
      position: 0,
      includeTypes,
      includeChats,
      excludeChats: [],
      excludeMuted: false,
      excludeRead: false,
    });
    act(() => {
      store
        .getState()
        .setFolders([
          folder('f-personal', 'Personal', ['dm']),
          folder('f-ais', 'AIs', ['ai']),
          folder(
            'f-work',
            'Work',
            [],
            [
              'c-acme',
              'c-devteam',
              'c-devai',
              'c-qa',
              'c-product',
              'c-devteam-bug',
              'c-devteam-ui',
              'c-devteam-standup',
              'c-devteam-release',
              'c-devteam-hiring',
              'c-devteam-ideas',
            ],
          ),
        ]);
    });

    fireEvent.click(screen.getByRole('tab', { name: /AIs/ }));
    expect(screen.getByText('Dev AI')).toBeTruthy();
    expect(screen.getByText('Marketing AI')).toBeTruthy();
    expect(screen.queryByText('Ana')).toBeNull();
    expect(screen.queryByText('Dev team')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: /Personal/ }));
    expect(screen.getByText('Ana')).toBeTruthy();
    expect(screen.queryByText('Dev team')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: /Work/ }));
    expect(screen.getByText('Dev team')).toBeTruthy();
    expect(screen.queryByText('Ana')).toBeNull();
  });

  it('filters chats by search query', () => {
    renderApp('/');
    const input = screen.getByLabelText('Search chats');

    fireEvent.change(input, { target: { value: 'ana' } });
    expect(screen.getByText('Ana')).toBeTruthy();
    expect(screen.queryByText('Dev team')).toBeNull();

    fireEvent.change(input, { target: { value: 'viernes' } });
    expect(screen.getByText('Viernes 🍻')).toBeTruthy();
    expect(screen.queryByText('Ana')).toBeNull();

    // T-0111: searching a topic name keeps its group header.
    fireEvent.change(input, { target: { value: 'hiring' } });
    expect(screen.getByText('Dev team')).toBeTruthy();
    expect(screen.getByText('Hiring: frontend role')).toBeTruthy();
    expect(screen.queryByText('Ideas')).toBeNull();
  });

  it('focuses the search field with Ctrl/Cmd+K', () => {
    renderApp('/');
    const input = screen.getByLabelText('Search chats');
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(document.activeElement).toBe(input);
  });

  it('shows the connecting bar only when connecting takes a while', async () => {
    vi.useFakeTimers();
    try {
      renderApp('/', { status: 'connecting' });
      // A fast connect never paints the bar.
      expect(screen.queryByText('Connecting…')).toBeNull();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });
      expect(screen.getByText('Connecting…')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the waiting-for-network bar when offline for a while', async () => {
    vi.useFakeTimers();
    try {
      renderApp('/', { status: 'offline' });
      expect(screen.queryByText('Waiting for network…')).toBeNull();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });
      expect(screen.getByText('Waiting for network…')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows skeletons and no empty state while chats load', () => {
    renderApp('/', { chats: [], chatsState: 'loading' });

    expect(screen.queryByText('No chats here yet')).toBeNull();
    expect(screen.getByRole('status', { name: 'Loading chats' })).toBeTruthy();
  });

  it('shows the empty state only once ready and empty', () => {
    renderApp('/', { chats: [], chatsState: 'ready' });

    expect(screen.getByText('No chats here yet')).toBeTruthy();
  });

  it('shows an error with Retry when chats fail to load', () => {
    const { store } = renderApp('/', { chats: [], chatsState: 'error' });

    expect(screen.getByText("Couldn't load chats")).toBeTruthy();
    const retry = screen.getByRole('button', { name: 'Retry' });
    const onRetry = vi.fn();
    store.setState({ retryChats: onRetry });
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('keeps loaded chats with an inline error bar when a refresh fails', async () => {
    const { store } = renderApp('/');
    store.setState({ chatsState: 'error' });

    expect(screen.getByText('Ana')).toBeTruthy();
    expect(await screen.findByText("Couldn't load chats")).toBeTruthy();
    expect(screen.queryByText('No chats here yet')).toBeNull();
    expect(screen.queryByRole('status', { name: 'Loading chats' })).toBeNull();
    const onRetry = vi.fn();
    store.setState({ retryChats: onRetry });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('keeps the loaded rows while a retry is in flight and clears the bar on success', async () => {
    const { store } = renderApp('/');
    store.setState({ chatsState: 'error' });
    expect(await screen.findByText("Couldn't load chats")).toBeTruthy();

    // The mock store's retryChats is a no-op; mirror the real store, whose
    // retry sets `loading`, so the pending state can be observed.
    store.setState({ retryChats: () => store.setState({ chatsState: 'loading' }) });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(screen.getByText('Ana')).toBeTruthy();
    expect(screen.queryByRole('status', { name: 'Loading chats' })).toBeNull();
    const pending = screen.getByRole('button', { name: /Retrying/ }) as HTMLButtonElement;
    expect(pending.disabled).toBe(true);
    expect(pending.getAttribute('aria-busy')).toBe('true');

    act(() => store.setState({ chatsState: 'ready' }));
    expect(screen.queryByText("Couldn't load chats")).toBeNull();
    expect(screen.queryByRole('button', { name: /Retrying/ })).toBeNull();
  });

  it('gives the retry spinner a reduced-motion opt-out', async () => {
    const { store } = renderApp('/');
    store.setState({ chatsState: 'error' });
    expect(await screen.findByText("Couldn't load chats")).toBeTruthy();

    store.setState({ retryChats: () => store.setState({ chatsState: 'loading' }) });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    const pending = screen.getByRole('button', { name: /Retrying/ });
    const spinner = pending.querySelector('svg');
    expect(spinner?.classList.contains('animate-spin')).toBe(true);
    expect(spinner?.classList.contains('motion-reduce:animate-none')).toBe(true);
  });

  it('shows skeletons when a list that never loaded is retried', async () => {
    const { store } = renderApp('/', { chats: [], chatsState: 'error' });
    expect(await screen.findByText("Couldn't load chats")).toBeTruthy();

    store.setState({ retryChats: () => store.setState({ chatsState: 'loading' }) });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(screen.getByRole('status', { name: 'Loading chats' })).toBeTruthy();
    expect(screen.queryByText("Couldn't load chats")).toBeNull();
  });

  it('drops the pending button once the retry settles, so a later load cannot leave it stuck', async () => {
    const { store } = renderApp('/');
    store.setState({ chatsState: 'error' });
    expect(await screen.findByText("Couldn't load chats")).toBeTruthy();

    store.setState({ retryChats: () => store.setState({ chatsState: 'loading' }) });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(screen.getByRole('button', { name: /Retrying/ })).toBeTruthy();

    // The retry fails again: the bar settles back to a plain, enabled Retry.
    act(() => store.setState({ chatsState: 'error' }));
    const settled = screen.getByRole('button', { name: 'Retry' }) as HTMLButtonElement;
    expect(settled.disabled).toBe(false);
    expect(settled.getAttribute('aria-busy')).toBeNull();

    // A later background load with rows on screen must not bring the pending
    // state back; the rows stay and no stuck spinner is left behind.
    act(() => store.setState({ chatsState: 'loading' }));
    expect(screen.getByText('Ana')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Retrying/ })).toBeNull();
    expect(screen.queryByRole('status', { name: 'Loading chats' })).toBeNull();
  });

  it('navigates to the Machines page from the menu', async () => {
    renderApp('/');
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Machines' }));
    expect(await screen.findByText('Machines')).toBeTruthy();
  });

  it('closes the main menu on Escape and returns focus to the trigger', () => {
    renderApp('/');
    const trigger = screen.getByRole('button', { name: 'Open menu' });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole('menu', { name: 'Main menu' })).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('menu', { name: 'Main menu' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('navigates to the Chat folders page from the menu', async () => {
    renderApp('/');
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Chat folders' }));
    expect(await screen.findByText('Chat folders')).toBeTruthy();
  });

  it('navigates to the Blocked people page from the menu', () => {
    renderApp('/');
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Blocked people' }));
    expect(screen.getByText('Blocked people')).toBeTruthy();
  });

  it('does not call the approvals list before the menu opens', () => {
    let fetchCalls = 0;
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/approvals') {
        fetchCalls += 1;
        return Promise.resolve(
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      renderApp('/');
      expect(fetchCalls).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('shows the pending approval count when the list returns pending entries', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/approvals') {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                id: 'apr-1',
                aiId: 'ai-dev-1',
                groupId: null,
                action: 'merge_pull_request',
                summary: 'a',
                details: null,
                argsHash: 'a'.repeat(64),
                worstCase: null,
                requestedBy: 'dev-1@ai.zilar.test',
                status: 'pending',
                decidedAt: null,
                note: null,
                expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
                createdAt: new Date().toISOString(),
              },
              {
                id: 'apr-2',
                aiId: 'ai-dev-1',
                groupId: null,
                action: 'merge_pull_request',
                summary: 'b',
                details: null,
                argsHash: 'b'.repeat(64),
                worstCase: null,
                requestedBy: 'dev-1@ai.zilar.test',
                status: 'pending',
                decidedAt: null,
                note: null,
                expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
                createdAt: new Date().toISOString(),
              },
              {
                id: 'apr-3',
                aiId: 'ai-dev-1',
                groupId: null,
                action: 'merge_pull_request',
                summary: 'c',
                details: null,
                argsHash: 'c'.repeat(64),
                worstCase: null,
                requestedBy: 'dev-1@ai.zilar.test',
                status: 'pending',
                decidedAt: null,
                note: null,
                expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
                createdAt: new Date().toISOString(),
              },
            ]),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      renderApp('/');
      fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
      expect(await screen.findByLabelText('3 pending approvals')).toBeTruthy();
      expect(screen.getByLabelText('3 pending approvals')).toBeTruthy();
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it('caps the badge at 9+ for ten or more pending entries', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const entries = Array.from({ length: 10 }, (_, index) => ({
      id: `apr-${index}`,
      aiId: 'ai-dev-1',
      groupId: null,
      action: 'merge_pull_request',
      summary: 'a',
      details: null,
      argsHash: 'a'.repeat(64),
      worstCase: null,
      requestedBy: 'dev-1@ai.zilar.test',
      status: 'pending' as const,
      decidedAt: null,
      note: null,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      createdAt: new Date().toISOString(),
    }));
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/approvals') {
        return Promise.resolve(
          new Response(JSON.stringify(entries), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      renderApp('/');
      fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
      expect(await screen.findByLabelText('9+ pending approvals')).toBeTruthy();
      expect(screen.getByText('9+')).toBeTruthy();
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it('hides the badge when the list is empty', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/approvals') {
        return Promise.resolve(
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      renderApp('/');
      fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.queryByLabelText(/pending approvals/)).toBeNull();
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it('starts the install prompt inside the click, before any await', async () => {
    renderApp('/');
    const prompt = vi.fn(() => Promise.resolve());
    const installEvent = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt,
      userChoice: Promise.resolve({ outcome: 'accepted', platform: '' }),
    });
    act(() => {
      window.dispatchEvent(installEvent);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Install app' }));
    // No await or flush before this: the prompt must already be running.
    expect(prompt).toHaveBeenCalledTimes(1);
    await act(async () => {});
  });
});

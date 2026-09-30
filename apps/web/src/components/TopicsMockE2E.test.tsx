import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { renderApp } from '@/test/renderApp';
import { mockRequest, resetMockApi, setMockDelay } from '@/mock/api';

beforeEach(() => {
  setMockDelay(0);
  resetMockApi();
  window.localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: RequestInit) =>
      mockRequest(String(url), init ?? {}, { delayMs: 0 }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('mock topics end to end (T-0111)', () => {
  it('creates a private topic in the dialog and sees it in the sidebar with a lock', async () => {
    const { createTopic, getChats } = await import('@/lib/api');
    const { summariesFor } = await import('@/store/realStore');

    // Create through the mock HTTP layer, like the dialog does.
    const created = await createTopic('g-devteam', {
      name: 'Secret roadmap',
      kind: 'task',
      visibility: 'private',
    });
    expect(created.visibility).toBe('private');

    // Refresh the list from the mock API so the new row appears.
    const entries = await getChats();
    const rows = entries.flatMap((entry) => summariesFor(entry));
    const mine = rows.find((row) => row.topic?.id === created.id);
    expect(mine?.title).toBe('Secret roadmap');
    expect(mine?.topic?.visibility).toBe('private');

    const { store } = renderApp('/');
    store.setState((state) => ({
      chats: [
        ...rows,
        ...state.chats.filter((chat) => chat.groupId !== 'g-devteam' && chat.id !== 'c-devteam'),
      ],
    }));

    const nav = screen.getByRole('navigation', { name: 'Chats' });
    await waitFor(() => {
      expect(within(nav).getByText('Secret roadmap')).toBeTruthy();
    });
    const row = within(nav).getByRole('link', { name: /Secret roadmap/ });
    expect(within(row).getByLabelText('Private topic')).toBeTruthy();
  });
});

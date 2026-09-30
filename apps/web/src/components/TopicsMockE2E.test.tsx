import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
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
    // Mock-mode create goes through the in-memory HTTP layer and folds the
    // new row into the painted list (T-0130), so the dialog path works
    // without stubbing the store.
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'New topic' }));
    fireEvent.change(screen.getByLabelText('Topic name'), {
      target: { value: 'Dialog roadmap' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create topic' }));
    const nav = screen.getByRole('navigation', { name: 'Chats' });
    await waitFor(() => {
      expect(within(nav).getByText('Dialog roadmap')).toBeTruthy();
    });
    expect(store.getState().chats.some((chat) => chat.title === 'Dialog roadmap')).toBe(true);
  });

  it('changes a strip status in mock mode', async () => {
    renderApp('/c/c-devteam-ui');
    const strip = screen.getByLabelText('Topic details');
    fireEvent.click(within(strip).getByLabelText('Status: Open. Change status'));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Done' }));
    // The mock PATCH answers in memory and the row updates at once; no
    // inline error appears.
    await waitFor(() => {
      expect(within(strip).getByLabelText('Status: Done. Change status')).toBeTruthy();
    });
    expect(screen.queryByText('Could not save. Try again.')).toBeNull();
  });

  it('leaves the dead topic after the kebab archive in mock mode', async () => {
    const { store } = renderApp('/c/c-devteam-ui', {
      groupInfos: {
        'c-devteam-ui': {
          id: 'g-devteam',
          title: 'Dev team',
          createdBy: 'u-you',
          members: [{ userId: 'u-you', name: 'You', role: 'owner' }],
          ais: [],
        },
      },
    });
    // The archived row must disappear at once (no waiting for the poll).
    fireEvent.click(screen.getByRole('button', { name: 'Chat menu' }));
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'Archive topic New pricing page for everyone' }),
    );
    await waitFor(() => {
      expect(store.getState().chats.some((chat) => chat.id === 'c-devteam-ui')).toBe(false);
    });
    // And the open view follows to General — with no "no longer available"
    // notice, since the archive was deliberate (finding 4).
    await waitFor(() => {
      expect(store.getState().activeChatId).toBe('c-devteam');
    });
    expect(store.getState().topicNotice).toBeUndefined();
  });

  it('shows a visible error when the kebab archive fails', async () => {
    // Fix 4: the failure used to sit on a `hidden` element, so the user
    // saw nothing. The alert must be visible (no `hidden` class) while the
    // user stays on the topic.
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) =>
      mockRequest(String(url), init ?? {}, { delayMs: 0 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const baseImpl = fetchMock.getMockImplementation();
    if (baseImpl === undefined) {
      throw new Error('expected the mock fetch implementation');
    }
    fetchMock.mockImplementation((url: unknown, init?: RequestInit) => {
      const raw = String(url);
      if (raw.includes('/topics/t-devteam-ui') && init?.method === 'PATCH') {
        return Promise.resolve(
          new Response(JSON.stringify({ error: { code: 'forbidden', message: 'no' } }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return baseImpl(url, init);
    });
    const { store } = renderApp('/c/c-devteam-ui', {
      groupInfos: {
        'c-devteam-ui': {
          id: 'g-devteam',
          title: 'Dev team',
          createdBy: 'u-you',
          members: [{ userId: 'u-you', name: 'You', role: 'owner' }],
          ais: [],
        },
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Chat menu' }));
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'Archive topic New pricing page for everyone' }),
    );
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Could not archive the topic.');
    expect(alert.className).not.toContain('hidden');
    // Still on the topic: the row survives and the view stays open.
    expect(store.getState().chats.some((chat) => chat.id === 'c-devteam-ui')).toBe(true);
    expect(store.getState().activeChatId).toBe('c-devteam-ui');
  });
});

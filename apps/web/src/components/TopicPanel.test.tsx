import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ApiError } from '@/lib/api';
import { renderApp } from '@/test/renderApp';
import { mockRequest, resetMockApi, setMockDelay } from '@/mock/api';

beforeEach(() => {
  setMockDelay(0);
  resetMockApi();
  window.localStorage.clear();
  // The panel reads members/AIs/tools/rules through the api client (fetch);
  // the mock store does not serve them, so route fetch to the mock API.
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

describe('Topic panel (T-0111)', () => {
  it('opens from the kebab Topic info with visibility, members and AIs', async () => {
    renderApp('/c/c-devteam-hiring');
    fireEvent.click(screen.getByRole('button', { name: 'Chat menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Topic info' }));
    const dialog = screen.getByRole('dialog', { name: 'Hiring: frontend role topic info' });
    expect(within(dialog).getByText('Private topic')).toBeTruthy();
    expect(await within(dialog).findByText('You')).toBeTruthy();
    expect(within(dialog).getByText('Ana')).toBeTruthy();
  });

  it('shows "All N members" for a public topic', async () => {
    renderApp('/c/c-devteam-ui');
    fireEvent.click(screen.getByRole('button', { name: 'Chat menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Topic info' }));
    const dialog = screen.getByRole('dialog', { name: 'New pricing page topic info' });
    expect(within(dialog).getAllByText(/All 4 members/).length).toBeGreaterThan(0);
    expect(await within(dialog).findByText('No AIs in this topic yet.')).toBeTruthy();
  });

  it('shows the bug topic AI with its owner', async () => {
    renderApp('/c/c-devteam-bug');
    fireEvent.click(screen.getByRole('button', { name: 'Chat menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Topic info' }));
    const dialog = screen.getByRole('dialog', { name: /topic info/ });
    expect(await within(dialog).findByText('Dev-1')).toBeTruthy();
    expect(within(dialog).getByText('Added by you')).toBeTruthy();
  });

  it('confirms private -> public with the history warning', async () => {
    renderApp('/c/c-devteam-hiring');
    fireEvent.click(screen.getByRole('button', { name: 'Chat menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Topic info' }));
    const dialog = screen.getByRole('dialog', { name: /topic info/ });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Make public' }));
    expect(screen.getByRole('dialog', { name: 'Make this topic public?' })).toBeTruthy();
    expect(screen.getByText(/will be able to read the whole history/)).toBeTruthy();
    const confirmButtons = screen.getAllByRole('button', { name: 'Make public' });
    const confirm = confirmButtons[confirmButtons.length - 1];
    if (confirm === undefined) {
      throw new Error('expected a Make public confirm button');
    }
    fireEvent.click(confirm);
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Make this topic public?' })).toBeNull();
    });
  });

  it('closes with Escape', () => {
    renderApp('/c/c-devteam-ui');
    fireEvent.click(screen.getByRole('button', { name: 'Chat menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Topic info' }));
    expect(screen.getByRole('dialog', { name: /topic info/ })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: /topic info/ })).toBeNull();
  });
});

describe('Group panel topic switch (T-0111)', () => {
  it('shows the members-can-create-topics switch to the owner', () => {
    // A legacy group without topics (older server shape) still opens the
    // group panel with the switch.
    renderApp('/c/c-qa?panel=group');
    expect(screen.getByRole('switch', { name: 'Members can create topics' })).toBeTruthy();
  });
});

describe('topic member removal errors (T-0130)', () => {
  // The panel removes through the store only (ONE DELETE). The stubs below
  // fail the member-removal endpoint like the server does: a 403 or a
  // network failure keeps the user in the topic with the inline error; a
  // 404 re-checks the row — alive means stay, gone means navigate away.
  function stubRemoveMember(status: 403 | 404 | 'network'): void {
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
      const withoutBase = raw.includes('/api/')
        ? raw.slice(raw.indexOf('/api/') + 4)
        : raw.replace('/api', '');
      const path = withoutBase.startsWith('/') ? withoutBase : `/${withoutBase}`;
      if (path === '/topics/t-devteam-hiring/members/u-ana' && init?.method === 'DELETE') {
        if (status === 'network') {
          throw new ApiError(0, 'network_error', 'Could not reach the server');
        }
        if (status === 404) {
          return Promise.resolve(
            new Response(JSON.stringify({ error: { code: 'not_found', message: 'gone' } }), {
              status: 404,
              headers: { 'Content-Type': 'application/json' },
            }),
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({ error: { code: 'forbidden', message: 'Only a manager can remove' } }),
            { status: 403, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      }
      return baseImpl(url, init);
    });
  }

  function openHiringPanel(): void {
    renderApp('/c/c-devteam-hiring');
    fireEvent.click(screen.getByRole('button', { name: 'Chat menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Topic info' }));
    expect(screen.getByRole('dialog', { name: /topic info/ })).toBeTruthy();
  }

  // The mock user owns the Dev team group, so the panel shows Remove for
  // every other member; "You" has no Remove button.
  function openHiringPanelWithStore(): {
    dialog: HTMLElement;
    store: ReturnType<typeof renderApp>['store'];
  } {
    const { store } = renderApp('/c/c-devteam-hiring');
    fireEvent.click(screen.getByRole('button', { name: 'Chat menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Topic info' }));
    const dialog = screen.getByRole('dialog', { name: /topic info/ });
    return { dialog, store };
  }

  function removeAna(dialog: HTMLElement): void {
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove Ana from the topic' }));
  }

  it('keeps the user in the topic with an inline error on a network failure', async () => {
    // The DELETE itself throws (unreachable server): the panel never
    // reaches the row re-check and reports the failure inline, staying
    // exactly where the user was.
    stubRemoveMember('network');
    const { dialog } = openHiringPanelWithStore();
    expect(await within(dialog).findByText('Ana')).toBeTruthy();
    removeAna(dialog);
    expect(await within(dialog).findByText('Could not reach the server')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: /topic info/ })).toBeTruthy();
  });

  it('navigates away when the row re-check finds the topic gone', async () => {
    // The DELETE 404s and the refreshed list no longer has the hiring row
    // (last member removed → archived): the panel navigates to `/` and
    // closes. The mock store's `refreshTopicRow` checks the local list, so
    // drop the row after opening the panel to simulate the archived server
    // truth the re-check would read.
    stubRemoveMember(404);
    const { dialog, store } = openHiringPanelWithStore();
    expect(await within(dialog).findByText('Ana')).toBeTruthy();
    store.setState((state) => ({
      chats: state.chats.filter((chat) => chat.id !== 'c-devteam-hiring'),
    }));
    removeAna(dialog);
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /topic info/ })).toBeNull();
    });
  });

  it('keeps the user in the topic with an inline error on a 403', async () => {
    stubRemoveMember(403);
    const { dialog } = openHiringPanelWithStore();
    expect(await within(dialog).findByText('Ana')).toBeTruthy();
    removeAna(dialog);
    // The panel stays open and reports the failure inline; the chat view
    // behind it is still the hiring topic.
    expect(await within(dialog).findByText('Only a manager can remove')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: /topic info/ })).toBeTruthy();
  });

  it('stays on a live topic when the removal 404s but the row is still there', async () => {
    // A 404 for a non-member (stale list, double click) must not read as
    // "the topic is gone": the row re-check finds the topic alive, so the
    // panel reloads the members and stays open with no inline error.
    stubRemoveMember(404);
    const { dialog } = openHiringPanelWithStore();
    expect(await within(dialog).findByText('Ana')).toBeTruthy();
    removeAna(dialog);
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /topic info/ })).toBeTruthy();
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('stays on a live topic when the removal removes Ana but the topic lives on', async () => {
    // Renamed from the overclaiming "leaves when the last member is removed
    // and the topic is gone": removing Ana from the 2-member hiring topic
    // does NOT archive it (per the mock + server rules), so this proves
    // the panel stays open with her row gone — not a redirect.
    openHiringPanel();
    const dialog = screen.getByRole('dialog', { name: /topic info/ });
    expect(await within(dialog).findByText('Ana')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove Ana from the topic' }));
    // Ana is really gone from the strict mock: her row disappears on
    // reload while the panel stays open (you are still in the topic).
    await waitFor(() => {
      expect(within(dialog).queryByText('Ana')).toBeNull();
    });
    expect(screen.getByRole('dialog', { name: /topic info/ })).toBeTruthy();
  });
});

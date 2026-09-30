import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
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
  // The panel removes through the api client (fetch) first, then the store.
  // Stubbing the DELETE to fail exercises the panel branch without touching
  // the store: a 403 keeps the user in the topic with the inline error,
  // while a 404 (the topic is gone) navigates away.
  function stubRemoveMember(status: number): void {
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
  it('keeps the user in the topic with an inline error on a 403', async () => {
    stubRemoveMember(403);
    openHiringPanel();
    const dialog = screen.getByRole('dialog', { name: /topic info/ });
    expect(await within(dialog).findByText('Ana')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove Ana from the topic' }));
    // The panel stays open and reports the failure inline; the chat view
    // behind it is still the hiring topic.
    expect(await within(dialog).findByText('Only a manager can remove')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: /topic info/ })).toBeTruthy();
  });

  it('moves the user away on a 404 (the topic is gone)', async () => {
    stubRemoveMember(404);
    openHiringPanel();
    const dialog = screen.getByRole('dialog', { name: /topic info/ });
    expect(await within(dialog).findByText('Ana')).toBeTruthy();
    // The stubbed DELETE answers 404, so the panel takes the archived path
    // (close + navigate away) instead of the inline-error path: the dialog
    // closes and no inline error appears anywhere.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove Ana from the topic' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /topic info/ })).toBeNull();
    });
  });
});

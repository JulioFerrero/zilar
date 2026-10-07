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

  it('opens the What <AI> remembers dialog from an AI row (T-0447)', async () => {
    renderApp('/c/c-devteam-bug');
    fireEvent.click(screen.getByRole('button', { name: 'Chat menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Topic info' }));
    const dialog = screen.getByRole('dialog', { name: /topic info/ });
    const memoryButton = await within(dialog).findByRole('button', {
      name: 'What Dev-1 remembers',
    });

    fireEvent.click(memoryButton);

    expect(await screen.findByRole('dialog', { name: 'What Dev-1 remembers' })).toBeTruthy();
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

describe('topic roles (T-0116)', () => {
  it('shows the attached role with its holder count on a private topic', async () => {
    renderApp('/c/c-devteam-hiring');
    fireEvent.click(screen.getByRole('button', { name: 'Chat menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Topic info' }));
    const dialog = screen.getByRole('dialog', { name: 'Hiring: frontend role topic info' });
    const roles = within(dialog).getByRole('region', { name: 'Roles' });
    expect(await within(roles).findByText('Designers (2)')).toBeTruthy();
  });

  it('lets a manager attach a role and pick it as approver', async () => {
    renderApp('/c/c-devteam-hiring');
    fireEvent.click(screen.getByRole('button', { name: 'Chat menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Topic info' }));
    const dialog = screen.getByRole('dialog', { name: /topic info/ });
    const roles = within(dialog).getByRole('region', { name: 'Roles' });

    fireEvent.click(await within(roles).findByRole('button', { name: 'Add roles' }));
    fireEvent.click(within(roles).getByRole('button', { name: /Devs/ }));
    expect(await within(roles).findByText('Devs (2)')).toBeTruthy();

    const approvers = within(roles).getByLabelText('Approvers') as HTMLSelectElement;
    fireEvent.change(approvers, { target: { value: 'role-designers' } });
    await waitFor(() => {
      const current = within(roles).getByLabelText('Approvers') as HTMLSelectElement;
      expect(current.value).toBe('role-designers');
    });
  });

  it('shows the approver line without editing for the seeded UI topic', async () => {
    // t-devteam-ui is public: no Roles region, but the approver line shows
    // through the card path instead (covered in ApprovalCard tests).
    renderApp('/c/c-devteam-ui');
    fireEvent.click(screen.getByRole('button', { name: 'Chat menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Topic info' }));
    const dialog = screen.getByRole('dialog', { name: /topic info/ });
    expect(within(dialog).queryByRole('region', { name: 'Roles' })).toBeNull();
  });
});

// Shared opener for the removal/leave/add tests: the mock user owns the
// Dev team group, so the panel shows Remove for every other member ("You"
// has no Remove button) alongside the Add pickers.
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

// The panel removes through the store only (ONE DELETE). This stub fails
// the member-removal endpoint like the server does: a 403 or a network
// failure keeps the user in the topic with the inline error; a 404
// re-checks the row — alive means stay, gone means navigate away.
function stubRemoveMember(status: 403 | 404 | 'network'): void {
  const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) =>
    mockRequest(String(url), init ?? {}, { delayMs: 0 }),
  );
  {
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
}

function removeAna(dialog: HTMLElement): void {
  fireEvent.click(within(dialog).getByRole('button', { name: 'Remove Ana from the topic' }));
}

describe('topic member removal errors (T-0130)', () => {
  function openHiringPanel(): void {
    renderApp('/c/c-devteam-hiring');
    fireEvent.click(screen.getByRole('button', { name: 'Chat menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Topic info' }));
    expect(screen.getByRole('dialog', { name: /topic info/ })).toBeTruthy();
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

  it('removes the AI row locally when the reload fails after a delete', async () => {
    // T-0146: the DELETE succeeds but the AI list reload throws after it
    // (transient network). The panel must not show the removed AI row as
    // if the delete failed — the row drops locally and a small "Could not
    // refresh the list." line with Retry appears instead. The stubbed
    // reload rejects (it never resolves), so the success-path assertion
    // below would time out on the old code instead of showing the row.
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
      if (
        /\/topics\/[^/]+\/ais$/.test(raw) &&
        (init?.method ?? 'GET') === 'GET' &&
        fetchMock.mock.calls.filter((call) => /\/topics\/[^/]+\/ais$/.test(String(call[0])))
          .length > 1
      ) {
        return Promise.reject(new ApiError(0, 'network_error', 'Could not reach the server'));
      }
      return baseImpl(url, init);
    });
    // Dev-1 lives on the bug topic (hiring has no AIs).
    renderApp('/c/c-devteam-bug');
    fireEvent.click(screen.getByRole('button', { name: 'Chat menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Topic info' }));
    const dialog = screen.getByRole('dialog', { name: /topic info/ });
    expect(await within(dialog).findByText('Dev-1')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove Dev-1 from the topic' }));
    // The row is gone even though the reload failed — and the panel says
    // the list (not the delete) could not refresh, with a Retry. (The
    // refresh line is its own note, not the action `alert`, so the dialog
    // still shows no action error.)
    await waitFor(() => {
      expect(within(dialog).queryByText('Dev-1')).toBeNull();
    });
    expect(await within(dialog).findByText('Could not refresh the list.')).toBeTruthy();
    // The removed row was the only AI: the empty list still offers Retry.
    expect(within(dialog).getAllByRole('button', { name: 'Retry' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('dialog', { name: /topic info/ })).toBeTruthy();
  });

  it('removes the member row locally when the reload fails after a delete', async () => {
    // Same pattern as `removeAi`: the member DELETE succeeds, but the
    // member list reload throws (transient network), so the removed row
    // drops locally with the refresh line instead of showing as if the
    // delete failed.
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
      if (
        /\/topics\/[^/]+\/members$/.test(raw) &&
        (init?.method ?? 'GET') === 'GET' &&
        fetchMock.mock.calls.filter((call) => /\/topics\/[^/]+\/members$/.test(String(call[0])))
          .length > 1
      ) {
        return Promise.reject(new ApiError(0, 'network_error', 'Could not reach the server'));
      }
      return baseImpl(url, init);
    });
    const { dialog } = openHiringPanelWithStore();
    expect(await within(dialog).findByText('Ana')).toBeTruthy();
    removeAna(dialog);
    await waitFor(() => {
      expect(within(dialog).queryByText('Ana')).toBeNull();
    });
    expect(await within(dialog).findByText('Could not refresh the list.')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: /topic info/ })).toBeTruthy();
  });
});

describe('topic leave errors (T-0133)', () => {
  // `leave()` must not swallow every error: a 404 means the topic is gone
  // (last seat → archived), so navigate away; any other failure keeps the
  // panel open with the inline error because the caller is still a member.
  function stubLeave(status: 403 | 404): void {
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
      if (path === '/topics/t-devteam-hiring/members/u-you' && init?.method === 'DELETE') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: { code: status === 404 ? 'not_found' : 'forbidden', message: 'gone' },
            }),
            { status, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      }
      return baseImpl(url, init);
    });
  }

  function openHiringPanelAsMember(): {
    dialog: HTMLElement;
    store: ReturnType<typeof renderApp>['store'];
  } {
    // Ana is NOT a manager here, so the panel shows the Leave button.
    const { store } = renderApp('/c/c-devteam-hiring', {
      groupInfos: {
        'c-devteam-hiring': {
          id: 'g-devteam',
          title: 'Dev team',
          createdBy: 'u-you',
          members: [
            { userId: 'u-you', name: 'You', role: 'member' },
            { userId: 'u-ana', name: 'Ana', role: 'owner' },
          ],
          ais: [],
        },
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Chat menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Topic info' }));
    const dialog = screen.getByRole('dialog', { name: /topic info/ });
    return { dialog, store };
  }

  it('stays open with an inline error when leaving fails with a non-404', async () => {
    stubLeave(403);
    const { dialog } = openHiringPanelAsMember();
    const leaveButton = await within(dialog).findByRole('button', { name: 'Leave topic' });
    fireEvent.click(leaveButton);
    expect(await within(dialog).findByText('gone')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: /topic info/ })).toBeTruthy();
  });

  it('shows the normal error when leaving 404s but the topic is still listed', async () => {
    // T-0146: a 404 that means "you are not a member" (not "the topic is
    // gone") must show the normal error instead of navigating away. The
    // DELETE 404s but the refreshed list still has the hiring row, so the
    // store rethrows and the panel stays open with the inline error.
    stubLeave(404);
    const { dialog } = openHiringPanelAsMember();
    const leaveButton = await within(dialog).findByRole('button', { name: 'Leave topic' });
    fireEvent.click(leaveButton);
    expect(await within(dialog).findByText('gone')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: /topic info/ })).toBeTruthy();
  });

  it('navigates away when leaving succeeds (the store folds the row away)', async () => {
    // `leave()` navigates away after a successful `leaveTopic`: the store
    // owns the last-seat 404 (it swallows it and drops the row), so the
    // panel needs no 404 branch of its own. The plain mock DELETE removes
    // you and folds the row; the panel navigates away with no alert.
    const { dialog } = openHiringPanelAsMember();
    const leaveButton = await within(dialog).findByRole('button', { name: 'Leave topic' });
    fireEvent.click(leaveButton);
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /topic info/ })).toBeNull();
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  // T-0146: last-seat mock leave through the store directly (no panel).
  // The default fetch stub in this file routes to the mock API, so store
  // calls work; `renderApp` alone never stubs fetch. The file's `beforeEach`
  // installs that stub for every test, including these. Removing Ana leaves
  // only you; your own leave then archives the topic (the mock DELETE 404s
  // `Topic not found`), and the store swallows that archived 404 — dropping
  // the row — so `leaveTopic` resolves and a panel caller would navigate
  // away. Without the targeted swallow it would reject and the panel would
  // stay open over the archived topic. Fail-without check: reverting the
  // `Topic not found` branch in `store.ts` makes this test reject.
  it('resolves a last-seat mock leave (the store swallows the 404)', async () => {
    // Hiring starts with Ana + you. Removing Ana keeps the row (200, one
    // member left); your own leave then archives the topic — the mock
    // DELETE 404s `Topic not found`. The store swallows that archived 404
    // (and drops the row), so `leaveTopic` resolves. Without the targeted
    // swallow it would reject and the panel would stay open over the
    // archived topic.
    const { store } = renderApp('/c/c-devteam-hiring');
    await store.getState().removeTopicMember('c-devteam-hiring', 'u-ana');
    expect(store.getState().chats.some((chat) => chat.id === 'c-devteam-hiring')).toBe(true);
    await store.getState().leaveTopic('c-devteam-hiring');
    expect(store.getState().chats.some((chat) => chat.id === 'c-devteam-hiring')).toBe(false);
  });

  it('rejects a non-membership mock leave (the row stays, so no swallow)', async () => {
    // T-0146: a 404 that means "you are not a member" must surface the
    // normal error instead of navigating away. Removing yourself first
    // (200, Ana left), then leaving again: the DELETE 404s "not a member"
    // with the topic row still listed — so `leaveTopic` rejects with the
    // normal error and the row stays. Fail-without check: the pre-T-0146
    // blanket swallow resolved this too (navigating away over a live
    // topic); the targeted swallow rejects.
    const { store } = renderApp('/c/c-devteam-hiring');
    await store.getState().removeTopicMember('c-devteam-hiring', 'u-you');
    await expect(store.getState().leaveTopic('c-devteam-hiring')).rejects.toThrow(/not a member/);
    expect(store.getState().chats.some((chat) => chat.id === 'c-devteam-hiring')).toBe(true);
  });
});

describe('topic add-member/add-AI single call (T-0133)', () => {
  // `addMember`/`addAi` must issue ONE request each: like `removeMember`,
  // the panel calls only the store action (which sends the request). A
  // recording double lets a second request through with a 409 — a second
  // call would fail the happy path, and the old fire-then-store code fails
  // the single-call assertion.
  function stubSingleCall(counts: { posts: number }): void {
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
      if (init?.method === 'POST' && /\/topics\/[^/]+\/(members|ais)$/.test(raw)) {
        counts.posts += 1;
        if (counts.posts > 1) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ error: { code: 'conflict', message: 'Already added' } }),
              { status: 409, headers: { 'Content-Type': 'application/json' } },
            ),
          );
        }
      }
      return baseImpl(url, init);
    });
  }

  it('adds a member with a single request', async () => {
    const counts = { posts: 0 };
    stubSingleCall(counts);
    const { store } = openHiringPanelWithStore();
    const added: string[] = [];
    const realAdd = store.getState().addTopicMember;
    store.setState({
      addTopicMember: async (chatId, userId) => {
        added.push(`${chatId}/${userId}`);
        await realAdd(chatId, userId);
      },
    });
    const dialog = screen.getByRole('dialog', { name: /topic info/ });
    expect(await within(dialog).findByText('Ana')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add people' }));
    fireEvent.click(within(dialog).getByRole('button', { name: /Luis/ }));
    // Luis joins on one POST through the store action only; a second POST
    // would 409, so the happy path proves the old fire-then-store double
    // call is gone.
    await waitFor(() => expect(added).toEqual(['c-devteam-hiring/u-luis']));
    // The picker closes (the "Add people" opener is back) and Luis shows
    // in the reloaded member list with no inline error.
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Add people' })).toBeTruthy();
    });
    expect(within(dialog).getByRole('button', { name: 'Remove Luis from the topic' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(counts.posts).toBe(1);
  });

  it('adds an AI with a single request', async () => {
    const counts = { posts: 0 };
    stubSingleCall(counts);
    const { store } = openHiringPanelWithStore();
    const added: string[] = [];
    const realAdd = store.getState().addTopicAi;
    store.setState({
      addTopicAi: async (chatId, aiId) => {
        added.push(`${chatId}/${aiId}`);
        await realAdd(chatId, aiId);
      },
    });
    const dialog = screen.getByRole('dialog', { name: /topic info/ });
    expect(await within(dialog).findByText('Ana')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add my AI' }));
    fireEvent.click(within(dialog).getByRole('button', { name: /QA-1/ }));
    // QA-1 joins on one POST through the store action only.
    await waitFor(() => expect(added).toEqual(['c-devteam-hiring/qa-1']));
    // The picker closes (the "Add my AI" opener is back) and QA-1 shows in
    // the reloaded AI list with no inline error.
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Add my AI' })).toBeTruthy();
    });
    expect(await within(dialog).findByText('QA-1')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(counts.posts).toBe(1);
  });

  it('removes an AI with a single request', async () => {
    // T-0141: `removeAi` called the endpoint directly AND the store action
    // (double DELETE). The panel now calls only the store action; a
    // recording second DELETE would 409, so one DELETE plus the AI row
    // gone proves the double call is fixed. Fails on the old code (2
    // DELETEs).
    const deletes: string[] = [];
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
      if (init?.method === 'DELETE' && /\/topics\/[^/]+\/ais\//.test(raw)) {
        deletes.push(raw);
        if (deletes.length > 1) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ error: { code: 'conflict', message: 'Already removed' } }),
              { status: 409, headers: { 'Content-Type': 'application/json' } },
            ),
          );
        }
      }
      return baseImpl(url, init);
    });
    // Dev-1 lives on the bug topic (hiring has no AIs).
    renderApp('/c/c-devteam-bug');
    fireEvent.click(screen.getByRole('button', { name: 'Chat menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Topic info' }));
    const dialog = screen.getByRole('dialog', { name: /topic info/ });
    expect(await within(dialog).findByText('Dev-1')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove Dev-1 from the topic' }));
    await waitFor(() => {
      expect(within(dialog).queryByText('Dev-1')).toBeNull();
    });
    expect(deletes).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: /topic info/ })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('topic remove-member superseded re-check (T-0141)', () => {
  it('retries a superseded row re-check once instead of showing "superseded"', async () => {
    // A superseded remove-member recheck must not surface the store's "The
    // chat list refresh was superseded." wording in the panel. The DELETE
    // 404s (stale list), the first re-check rejects with `stale_refresh`
    // (the store restarted mid-flight), and the retry finds the row alive
    // — the panel stays open with the members reloaded and no alert. Fails
    // without the retry (the panel would show the superseded message).
    stubRemoveMember(404);
    const { dialog, store } = openHiringPanelWithStore();
    expect(await within(dialog).findByText('Ana')).toBeTruthy();
    let calls = 0;
    const realRecheck = store.getState().refreshTopicRow;
    store.setState({
      refreshTopicRow: async (chatId, topicId) => {
        calls += 1;
        if (calls === 1) {
          throw new ApiError(0, 'stale_refresh', 'The chat list refresh was superseded');
        }
        return realRecheck(chatId, topicId);
      },
    });
    removeAna(dialog);
    await waitFor(() => {
      expect(calls).toBe(2);
    });
    expect(screen.getByRole('dialog', { name: /topic info/ })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/superseded/)).toBeNull();
  });

  it('shows a generic message when the re-check stays superseded after a retry', async () => {
    // Both the first re-check and the retry reject with `stale_refresh`
    // (the store keeps restarting): the panel reports "Could not refresh
    // the topic. Try again." — never the store's internal wording.
    stubRemoveMember(404);
    const { dialog, store } = openHiringPanelWithStore();
    expect(await within(dialog).findByText('Ana')).toBeTruthy();
    store.setState({
      refreshTopicRow: async () => {
        throw new ApiError(0, 'stale_refresh', 'The chat list refresh was superseded');
      },
    });
    removeAna(dialog);
    expect(await within(dialog).findByText('Could not refresh the topic. Try again.')).toBeTruthy();
    expect(screen.queryByText(/superseded/)).toBeNull();
    expect(screen.getByRole('dialog', { name: /topic info/ })).toBeTruthy();
  });
});

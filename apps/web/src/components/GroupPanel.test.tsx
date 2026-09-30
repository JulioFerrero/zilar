import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ChatSummary } from '@galena/chat-core';
import { AuthProvider, type AuthState } from '@/auth/AuthProvider';
import type { GroupDetail, PublicAi } from '@/lib/api';
import { ChatStoreProvider } from '@/store/ChatStoreProvider';
import { createChatStore, type ChatStoreSeed } from '@/store/store';
import { GroupPanel } from './GroupPanel';

const auth: AuthState = {
  status: 'authenticated',
  user: { id: 'u-you', name: 'You', email: 'you@galena.test' },
  refetch: async () => {},
};

const chat: ChatSummary = {
  id: 'c-devteam',
  title: 'Dev team',
  kind: 'group',
  isAI: false,
  space: 'work',
  unread: 0,
  muted: false,
  memberCount: 6,
};

const devAi: GroupDetail['ais'][number] = {
  aiId: 'dev-1',
  jid: 'ai-dev-1@galena.test',
  name: 'Dev-1',
  ownerId: 'u-you',
};

function detail(overrides: Partial<GroupDetail> = {}): GroupDetail {
  return {
    id: 'g-devteam',
    title: 'Dev team',
    createdBy: 'u-you',
    members: [
      { userId: 'u-you', name: 'You', role: 'owner' },
      { userId: 'u-ana', name: 'Ana', role: 'member' },
    ],
    ais: [],
    ...overrides,
  };
}

function myAi(id: string, name: string): PublicAi {
  return {
    id,
    name,
    template: 'custom',
    persona: 'A helpful assistant.',
    model: 'gpt-4o',
    jid: `ai-${id}@galena.test`,
    status: 'active',
    providerConnectionId: 'conn-1',
    limits: { perDayUsd: 2, perMonthUsd: 20 },
    createdAt: '2026-09-20T10:00:00.000Z',
  };
}

function seedWith(seed: ChatStoreSeed = {}): ChatStoreSeed {
  return { groupInfos: { 'c-devteam': detail() }, ownedAis: [], ...seed };
}

// T-0086: the panel now mounts an Activity section for owners / admins, so
// the suite needs a fetch stub for `/audit` calls. Plain members never
// trigger a fetch (the section is not rendered), so the member-only tests
// pass `auditEntries: 'no-stub'` and skip the fetch stub; the rest of the
// suite stubs `/audit` so a manager's section renders without errors.
type AuditAnswer = unknown[] | 'no-stub';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

function stubAudit(entries: unknown[]): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (url: unknown) => {
    const target = String(url);
    // T-0115: the invite-links section fires alongside Activity for
    // managers — answer an empty list so the panel renders without a second
    // alert in tests that do not care about links.
    if (target.includes('/invite-links')) {
      return jsonResponse(200, { links: [] });
    }
    if (target.includes('/audit')) {
      return jsonResponse(200, { entries, next: null });
    }
    // T-0100: the rules section fires alongside Activity for managers.
    if (target.includes('/approval-rules')) {
      return jsonResponse(200, []);
    }
    // T-0116: the panel loads the group's roles on mount; the older tests
    // answer an empty list so the Roles section stays quiet.
    if (target.includes('/roles')) {
      return jsonResponse(200, { roles: [] });
    }
    return jsonResponse(404, { error: { code: 'not_found', message: 'unexpected' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderStore(store: ReturnType<typeof createChatStore>, onClose = vi.fn()) {
  render(
    <AuthProvider value={auth}>
      <ChatStoreProvider store={store}>
        <GroupPanel chat={chat} onClose={onClose} />
      </ChatStoreProvider>
    </AuthProvider>,
  );
  return onClose;
}

function setup(seed: ChatStoreSeed = {}, auditEntries: AuditAnswer = []) {
  const store = createChatStore(seedWith(seed));
  if (auditEntries !== 'no-stub') {
    stubAudit(auditEntries);
  }
  const onClose = renderStore(store);
  return { store, onClose };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GroupPanel', () => {
  it('lists the members and the AIs with their owner', () => {
    setup({ groupInfos: { 'c-devteam': detail({ ais: [devAi] }) } });

    const members = within(screen.getByRole('region', { name: 'Members' }));
    expect(members.getByText('You')).toBeTruthy();
    expect(members.getByText('Ana')).toBeTruthy();
    expect(members.getByText('owner')).toBeTruthy();

    const ais = within(screen.getByRole('region', { name: 'AIs' }));
    expect(ais.getByText('Dev-1')).toBeTruthy();
    expect(ais.getByText('AI')).toBeTruthy();
    expect(ais.getByText('Added by You')).toBeTruthy();
  });

  it('shows Add my AI for an owner with an eligible AI', async () => {
    setup({
      groupInfos: { 'c-devteam': detail({ ais: [devAi] }) },
      ownedAis: [myAi('dev-1', 'Dev-1'), myAi('marketing', 'Marketing AI')],
    });

    expect(await screen.findByRole('button', { name: 'Add my AI' })).toBeTruthy();
  });

  it('hides Add my AI for a member', async () => {
    setup(
      {
        groupInfos: {
          'c-devteam': detail({
            members: [
              { userId: 'u-ana', name: 'Ana', role: 'owner' },
              { userId: 'u-you', name: 'You', role: 'member' },
            ],
            ais: [devAi],
          }),
        },
        ownedAis: [myAi('marketing', 'Marketing AI')],
      },
      'no-stub',
    );

    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Members' }).textContent).toContain('Ana'),
    );
    expect(screen.queryByRole('button', { name: 'Add my AI' })).toBeNull();
  });

  it('hides Add my AI when no owned AI is eligible', async () => {
    setup({
      groupInfos: { 'c-devteam': detail({ ais: [devAi] }) },
      ownedAis: [myAi('dev-1', 'Dev-1')],
    });

    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'AIs' }).textContent).toContain('Dev-1'),
    );
    expect(screen.queryByRole('button', { name: 'Add my AI' })).toBeNull();
  });

  it('adds an AI through the store and shows it', async () => {
    const store = createChatStore(
      seedWith({
        groupInfos: { 'c-devteam': detail() },
        ownedAis: [myAi('marketing', 'Marketing AI')],
      }),
    );
    const addGroupAi = vi.fn(store.getState().addGroupAi);
    store.setState({ addGroupAi });
    renderStore(store);

    fireEvent.click(await screen.findByRole('button', { name: 'Add my AI' }));
    fireEvent.click(screen.getByRole('button', { name: /Marketing AI/ }));

    await waitFor(() => expect(addGroupAi).toHaveBeenCalledWith('c-devteam', 'marketing'));
    expect(await screen.findByText('Marketing AI')).toBeTruthy();
    const ais = within(screen.getByRole('region', { name: 'AIs' }));
    expect(ais.getByText('Marketing AI')).toBeTruthy();
  });

  it('removes an AI after a two-step confirm', async () => {
    const store = createChatStore(
      seedWith({ groupInfos: { 'c-devteam': detail({ ais: [devAi] }) } }),
    );
    const removeGroupAi = vi.fn(store.getState().removeGroupAi);
    store.setState({ removeGroupAi });
    renderStore(store);

    fireEvent.click(screen.getByRole('button', { name: 'Remove Dev-1 from the group' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm removing Dev-1' }));

    await waitFor(() => expect(removeGroupAi).toHaveBeenCalledWith('c-devteam', 'dev-1'));
    await waitFor(() => expect(screen.queryByText('Dev-1')).toBeNull());
    expect(screen.getByText('No AIs in this group yet.')).toBeTruthy();
  });

  it('shows an inline error when an add fails, keeping the AI out', async () => {
    const store = createChatStore(
      seedWith({
        groupInfos: { 'c-devteam': detail() },
        ownedAis: [myAi('marketing', 'Marketing AI')],
      }),
    );
    // T-0086: the Activity section fires a `/audit` request when the panel
    // mounts for a manager, so the test stubs fetch to keep that path quiet
    // (the shared stub also answers `/invite-links` with an empty list).
    stubAudit([]);
    store.setState({
      addGroupAi: async () => {
        throw new Error('The server is down');
      },
    });
    renderStore(store);

    fireEvent.click(await screen.findByRole('button', { name: 'Add my AI' }));
    fireEvent.click(screen.getByRole('button', { name: /Marketing AI/ }));

    expect((await screen.findByRole('alert')).textContent).toBe('The server is down');
    expect(store.getState().groupInfo('c-devteam')?.ais).toHaveLength(0);
  });

  it('closes on Escape', () => {
    const { onClose } = setup();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // T-0116: custom group roles. Managers see the Roles section (create,
  // rename, delete, assign); everyone sees the chips next to member names.
  describe('group roles (T-0116)', () => {
    const roles = [
      {
        id: 'role-designers',
        name: 'Designers',
        members: [{ userId: 'u-ana', name: 'Ana' }],
      },
    ];

    function stubRoles(): ReturnType<typeof vi.fn> {
      const fetchMock = vi.fn(async (url: unknown, init?: unknown) => {
        const target = String(url);
        if (target.includes('/audit')) {
          return jsonResponse(200, { entries: [], next: null });
        }
        if (target.includes('/approval-rules')) {
          return jsonResponse(200, []);
        }
        if (target.includes('/roles') && (init as RequestInit | undefined)?.method === 'POST') {
          const body = JSON.parse(String((init as RequestInit).body ?? '{}')) as {
            name: string;
          };
          return jsonResponse(201, { id: 'role-new', name: body.name, members: [] });
        }
        if (target.includes('/roles')) {
          return jsonResponse(200, { roles });
        }
        return jsonResponse(404, { error: { code: 'not_found', message: 'unexpected' } });
      });
      vi.stubGlobal('fetch', fetchMock);
      return fetchMock;
    }

    it('shows role chips next to member names for everyone', async () => {
      const store = createChatStore(seedWith({}));
      stubRoles();
      renderStore(store);

      const members = within(screen.getByRole('region', { name: 'Members' }));
      await waitFor(() => expect(members.getByText('Designers')).toBeTruthy());
    });

    it('shows the Roles section for a manager and creates a role', async () => {
      const store = createChatStore(seedWith({}));
      const fetchMock = stubRoles();
      renderStore(store);

      const section = await screen.findByRole('region', { name: 'Roles' });
      expect(within(section).getByText(/Designers/)).toBeTruthy();

      fireEvent.change(screen.getByLabelText('New role name'), {
        target: { value: 'Devs' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Add role' }));

      await waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith(
          '/api/groups/g-devteam/roles',
          expect.objectContaining({ method: 'POST' }),
        ),
      );
    });

    it('hides the Roles section for a plain member but keeps the chips', async () => {
      const store = createChatStore(
        seedWith({
          groupInfos: {
            'c-devteam': detail({
              members: [
                { userId: 'u-you', name: 'You', role: 'member' },
                { userId: 'u-ana', name: 'Ana', role: 'owner' },
              ],
            }),
          },
        }),
      );
      stubRoles();
      renderStore(store);

      const members = within(screen.getByRole('region', { name: 'Members' }));
      await waitFor(() => expect(members.getByText('Designers')).toBeTruthy());
      expect(screen.queryByRole('region', { name: 'Roles' })).toBeNull();
    });

    it('renders the Roles and invite-links sections side by side for a manager', async () => {
      // The T-0115 merge kept both sections: roles answer here, links
      // answer empty, and both regions paint without errors.
      const store = createChatStore(seedWith({}));
      const fetchMock = vi.fn(async (url: unknown) => {
        const target = String(url);
        if (target.includes('/invite-links')) {
          return jsonResponse(200, { links: [] });
        }
        if (target.includes('/audit')) {
          return jsonResponse(200, { entries: [], next: null });
        }
        if (target.includes('/approval-rules')) {
          return jsonResponse(200, []);
        }
        if (target.includes('/roles')) {
          return jsonResponse(200, { roles: [] });
        }
        return jsonResponse(404, { error: { code: 'not_found', message: 'unexpected' } });
      });
      vi.stubGlobal('fetch', fetchMock);
      renderStore(store);

      expect(await screen.findByRole('region', { name: 'Roles' })).toBeTruthy();
      expect(screen.getByRole('region', { name: 'Invite links' })).toBeTruthy();
    });
  });

  // T-0086: the room activity section is the same ActivitySection the AI
  // panel mounts, fed by `?groupId=…` instead of `?aiId=…`. The rules:
  // owners and admins see it, plain members don't (and no request fires for
  // them), and any failure of the section is caught inside the component so
  // the rest of the panel stays interactive.
  describe('room activity (T-0086)', () => {
    it('renders the Activity heading for an owner and fetches once with groupId', async () => {
      const fetchMock = stubAudit([
        {
          id: 'audit-1',
          at: new Date(Date.now() - 3 * 60_000).toISOString(),
          aiId: 'dev-1',
          groupId: 'g-devteam',
          action: 'approval.decided',
          subjectId: 'apr-100',
          argsHash: 'c'.repeat(64),
          cost: null,
          result: 'ok',
          detail: { decision: 'approve_once' },
          actorUserId: 'u-you',
        },
      ]);

      const store = createChatStore(
        seedWith({
          groupInfos: {
            'c-devteam': detail({
              members: [
                { userId: 'u-you', name: 'You', role: 'owner' },
                { userId: 'u-ana', name: 'Ana', role: 'admin' },
              ],
            }),
          },
        }),
      );
      renderStore(store);

      expect(await screen.findByRole('heading', { name: 'Activity' })).toBeTruthy();
      expect(await screen.findByText('A request was approved')).toBeTruthy();

      const auditCalls = fetchMock.mock.calls.filter((call: unknown[]) =>
        String(call[0]).includes('/audit'),
      );
      expect(auditCalls).toHaveLength(1);
      expect(String(auditCalls[0]?.[0])).toBe('/api/audit?groupId=g-devteam&limit=20');
    });

    it('renders the Activity heading for an admin and fetches once', async () => {
      const fetchMock = stubAudit([]);

      const store = createChatStore(
        seedWith({
          groupInfos: {
            'c-devteam': detail({
              members: [
                { userId: 'u-luis', name: 'Luis', role: 'owner' },
                { userId: 'u-you', name: 'You', role: 'admin' },
              ],
            }),
          },
        }),
      );
      renderStore(store);

      expect(await screen.findByRole('heading', { name: 'Activity' })).toBeTruthy();

      const auditCalls = fetchMock.mock.calls.filter((call: unknown[]) =>
        String(call[0]).includes('/audit'),
      );
      expect(auditCalls).toHaveLength(1);
    });

    it('hides the section for a plain member and makes no audit request', async () => {
      const fetchMock = vi.fn(async () => jsonResponse(200, { entries: [], next: null }));
      vi.stubGlobal('fetch', fetchMock);

      const store = createChatStore(
        seedWith({
          groupInfos: {
            'c-devteam': detail({
              members: [
                { userId: 'u-ana', name: 'Ana', role: 'owner' },
                { userId: 'u-you', name: 'You', role: 'member' },
              ],
            }),
          },
        }),
      );
      renderStore(store);

      await waitFor(() =>
        expect(screen.getByRole('region', { name: 'Members' }).textContent).toContain('Ana'),
      );
      expect(screen.queryByRole('heading', { name: 'Activity' })).toBeNull();
      const auditCalls = (fetchMock.mock.calls as unknown[][]).filter((call) =>
        String(call[0]).includes('/audit'),
      );
      expect(auditCalls).toHaveLength(0);
    });

    it('a failing audit request leaves the rest of the panel intact', async () => {
      const fetchMock = vi.fn(async (url: unknown) => {
        const target = String(url);
        if (target.includes('/invite-links')) {
          return jsonResponse(200, { links: [] });
        }
        if (target.includes('/audit')) {
          return jsonResponse(500, {
            error: { code: 'server_error', message: 'audit unavailable' },
          });
        }
        if (target.includes('/approval-rules')) {
          return jsonResponse(200, []);
        }
        // T-0116: the Roles section loads quietly alongside Activity.
        if (target.includes('/roles')) {
          return jsonResponse(200, { roles: [] });
        }
        return jsonResponse(404, { error: { code: 'not_found', message: 'unexpected' } });
      });
      vi.stubGlobal('fetch', fetchMock);

      const store = createChatStore(seedWith());
      renderStore(store);

      // The inline error from the audit section appears, but the rest of
      // the panel — Members, AIs, the header — is still there.
      expect(await screen.findByRole('heading', { name: 'Activity' })).toBeTruthy();
      expect(await screen.findByRole('alert')).toBeTruthy();
      expect(screen.getByRole('region', { name: 'Members' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Close group panel' })).toBeTruthy();

      const auditCalls = fetchMock.mock.calls.filter((call: unknown[]) =>
        String(call[0]).includes('/audit'),
      );
      expect(auditCalls).toHaveLength(1);
    });
  });

  // T-0100: the standing rules section. Owners and admins see it (fetched
  // once with the group's id); plain members don't (no request fires).
  describe('always allowed rules (T-0100)', () => {
    function stubRules(rules: unknown[]): ReturnType<typeof vi.fn> {
      const fetchMock = vi.fn(async (url: unknown) => {
        const target = String(url);
        if (target.includes('/invite-links')) {
          return jsonResponse(200, { links: [] });
        }
        if (target.includes('/audit')) {
          return jsonResponse(200, { entries: [], next: null });
        }
        if (target.includes('/approval-rules')) {
          return jsonResponse(200, rules);
        }
        return jsonResponse(404, { error: { code: 'not_found', message: 'unexpected' } });
      });
      vi.stubGlobal('fetch', fetchMock);
      return fetchMock;
    }

    it('renders the section for an owner and fetches once with the group id', async () => {
      const fetchMock = stubRules([
        {
          id: 'rule-1',
          action: 'merge_pull_request',
          scope: 'group',
          groupId: 'g-devteam',
          createdAt: '2026-09-29T10:00:00.000Z',
          createdBy: 'u-you',
        },
      ]);

      const store = createChatStore(seedWith());
      renderStore(store);

      expect(await screen.findByRole('heading', { name: 'Always allowed' })).toBeTruthy();
      expect(await screen.findByText('merge_pull_request')).toBeTruthy();

      const ruleCalls = fetchMock.mock.calls.filter((call: unknown[]) =>
        String(call[0]).includes('/approval-rules'),
      );
      expect(ruleCalls).toHaveLength(1);
      expect(String(ruleCalls[0]?.[0])).toBe('/api/groups/g-devteam/approval-rules');
    });

    it('hides the section for a plain member and makes no rules request', async () => {
      const fetchMock = vi.fn(async (url: unknown) => {
        const target = String(url);
        if (target.includes('/audit')) {
          return jsonResponse(200, { entries: [], next: null });
        }
        return jsonResponse(200, { entries: [], next: null });
      });
      vi.stubGlobal('fetch', fetchMock);

      const store = createChatStore(
        seedWith({
          groupInfos: {
            'c-devteam': detail({
              members: [
                { userId: 'u-ana', name: 'Ana', role: 'owner' },
                { userId: 'u-you', name: 'You', role: 'member' },
              ],
            }),
          },
        }),
      );
      renderStore(store);

      await waitFor(() =>
        expect(screen.getByRole('region', { name: 'Members' }).textContent).toContain('Ana'),
      );
      expect(screen.queryByRole('heading', { name: 'Always allowed' })).toBeNull();
      const ruleCalls = (fetchMock.mock.calls as unknown[][]).filter((call) =>
        String(call[0]).includes('/approval-rules'),
      );
      expect(ruleCalls).toHaveLength(0);
    });
  });
});

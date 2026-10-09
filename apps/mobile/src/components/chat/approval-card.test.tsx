// @vitest-environment jsdom
import type { ApprovalRequest } from '@zilar/protocol';
import { createRequire } from 'node:module';
import { act, createElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApprovalsApiError, type ApprovalsApi, type PublicApproval } from '@/lib/approvals-api';

import { ApprovalCard } from './approval-card';

// The card reads its API through `useApprovalsApi`; each test sets the fake.
const { apiHolder } = vi.hoisted(() => ({ apiHolder: { api: null as unknown } }));

vi.mock('@/components/chat/use-approvals-api', () => ({
  useApprovalsApi: () => ({ api: apiHolder.api, mock: false }),
}));

vi.mock('react-native', async () => {
  const { createElement: create } = await import('react');
  return {
    View: ({ children }: { children?: ReactNode }) => create('div', null, children),
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
  };
});

vi.mock('@/components/ui/text', async () => {
  const { createElement: create } = await import('react');
  return {
    Text: ({ children }: { children?: ReactNode }) => create('span', null, children),
  };
});

vi.mock('@/components/ui/button', async () => {
  const { createElement: create } = await import('react');
  return {
    Button: ({
      children,
      onPress,
      disabled,
      accessibilityLabel,
    }: {
      children?: ReactNode;
      onPress?: () => void;
      disabled?: boolean;
      accessibilityLabel?: string;
    }) =>
      create(
        'button',
        { type: 'button', disabled, 'aria-label': accessibilityLabel, onClick: onPress },
        children,
      ),
  };
});

vi.mock('@/components/ui/use-key-press', () => ({
  useKeyPress: () => ({ pressed: false, reduceMotion: false, setPressed: () => {} }),
}));

const nodeRequire = createRequire(import.meta.url);
const { createRoot } = nodeRequire('react-dom/client') as {
  createRoot: (container: Element) => { render(node: ReactNode): void; unmount(): void };
};

const REQUEST: ApprovalRequest = {
  id: 'apr-1',
  room: 'dev-ai@zilar.chat',
  ai: 'dev-ai@zilar.chat',
  action: 'Rotate the staging API token',
  summary: 'The staging token leaked in a CI log.',
  details: 'Rotate and update the CI secret.',
  args_hash: '8f14e45fceea167a5a36dedd4bea2543c9f4d5a7b0c1e2d3f4a5b6c7d8e9f0a1',
  worst_case_cost: { currency: 'EUR', amount: 0.02 },
  requested_by: 'me@zilar.chat',
  expires_at: '2026-09-28T03:00:00.000Z',
};

const PENDING: PublicApproval = {
  id: 'apr-1',
  aiId: 'ai-dev-1',
  groupId: null,
  action: 'Rotate the staging API token',
  summary: 'The staging token leaked in a CI log.',
  details: 'Rotate and update the CI secret.',
  argsHash: REQUEST.args_hash,
  worstCase: { currency: 'EUR', amount: 0.02 },
  requestedBy: 'me@zilar.chat',
  status: 'pending',
  decidedAt: null,
  note: null,
  expiresAt: '2026-09-28T03:00:00.000Z',
  createdAt: '2026-09-28T02:00:00.000Z',
};

function decided(status: PublicApproval['status']): PublicApproval {
  return { ...PENDING, status, decidedAt: '2026-09-28T02:05:00.000Z' };
}

function fakeApi(overrides: Partial<ApprovalsApi>): ApprovalsApi {
  const unused = (): Promise<never> => Promise.reject(new Error('not stubbed'));
  return {
    getApproval: unused,
    decideApproval: unused,
    listApprovals: unused,
    listAiApprovalRules: unused,
    listGroupApprovalRules: unused,
    revokeApprovalRule: unused,
    ...overrides,
  };
}

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

// Lets promises and Effect fibers settle: several macrotasks, inside act.
async function settle(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 10; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

function button(label: string): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
}

function click(label: string): void {
  const target = button(label);
  if (target === null) {
    throw new Error(`no button ${label}`);
  }
  act(() => target.click());
}

async function renderCard(api: ApprovalsApi): Promise<void> {
  apiHolder.api = api;
  mount(createElement(ApprovalCard, { data: REQUEST }));
  await settle();
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  unmount?.();
  unmount = undefined;
});

describe('ApprovalCard', () => {
  it('shows the request, then Approve and Deny for a pending decision', async () => {
    await renderCard(fakeApi({ getApproval: async () => PENDING }));

    expect(container.textContent).toContain('Rotate the staging API token');
    expect(container.textContent).toContain('The staging token leaked in a CI log.');
    expect(container.textContent).toContain('Max cost: EUR 0.02');
    expect(button('Approve')).not.toBeNull();
    expect(button('Deny')).not.toBeNull();
  });

  it('shows a placeholder and no buttons until the first answer arrives', async () => {
    apiHolder.api = fakeApi({ getApproval: () => new Promise<PublicApproval>(() => {}) });
    mount(createElement(ApprovalCard, { data: REQUEST }));
    await settle();

    expect(button('Approve')).toBeNull();
    expect(container.textContent).not.toContain('Waiting for a decision');
    expect(container.textContent).not.toContain('Could not load');
  });

  it('shows the decided status after Approve succeeds and drops the buttons', async () => {
    const decideApproval = vi.fn(async () => decided('approved_once'));
    await renderCard(fakeApi({ getApproval: async () => PENDING, decideApproval }));

    click('Approve');
    await settle();

    expect(decideApproval).toHaveBeenCalledWith('apr-1', 'approve_once');
    expect(container.textContent).toContain('Approved');
    expect(button('Approve')).toBeNull();
    expect(button('Deny')).toBeNull();
  });

  it('disables both buttons and shows Denying while the deny call is in flight', async () => {
    const decideApproval = vi.fn(() => new Promise<PublicApproval>(() => {}));
    await renderCard(fakeApi({ getApproval: async () => PENDING, decideApproval }));

    click('Deny');
    await settle();

    expect(container.textContent).toContain('Denying');
    expect(button('Deny')?.disabled).toBe(true);
    expect(button('Approve')?.disabled).toBe(true);
  });

  it('shows the failure message inline and keeps the buttons for a retry', async () => {
    const decideApproval = vi.fn(async () => {
      throw new ApprovalsApiError(500, 'server_error', 'Could not save the decision');
    });
    await renderCard(fakeApi({ getApproval: async () => PENDING, decideApproval }));

    click('Deny');
    await settle();

    expect(container.textContent).toContain('Could not save the decision');
    expect(button('Deny')?.disabled).toBe(false);
    expect(button('Approve')).not.toBeNull();
  });

  it('reloads the card after a stale decision and shows the server state', async () => {
    const getApproval = vi
      .fn<() => Promise<PublicApproval>>()
      .mockResolvedValueOnce(PENDING)
      .mockResolvedValueOnce(decided('denied'));
    const decideApproval = vi.fn(async () => {
      throw new ApprovalsApiError(409, 'not_pending', 'Already decided');
    });
    await renderCard(fakeApi({ getApproval, decideApproval }));

    click('Approve');
    await settle();

    expect(getApproval).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('Denied');
    expect(button('Approve')).toBeNull();
  });

  it('shows the load error with a Retry that loads the card again', async () => {
    const getApproval = vi
      .fn<() => Promise<PublicApproval>>()
      .mockRejectedValueOnce(new ApprovalsApiError(500, 'server_error', 'Down'))
      .mockResolvedValueOnce(PENDING);
    await renderCard(fakeApi({ getApproval }));

    expect(container.textContent).toContain('Could not load the decision state');
    expect(button('Approve')).toBeNull();

    click('Retry');
    await settle();

    expect(getApproval).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain('Could not load the decision state');
    expect(button('Approve')).not.toBeNull();
  });

  it('says it is waiting, with no buttons, when the viewer may not decide (404)', async () => {
    await renderCard(
      fakeApi({
        getApproval: async () => {
          throw new ApprovalsApiError(404, 'not_found', 'Not found');
        },
      }),
    );

    expect(container.textContent).toContain('Waiting for a decision');
    expect(container.textContent).not.toContain('Could not load');
    expect(button('Approve')).toBeNull();
  });
});

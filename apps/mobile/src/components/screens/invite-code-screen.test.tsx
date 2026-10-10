// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { act, createElement, type ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import InviteRoute from '@/app/invite/[code]';
import { waitForAct as waitFor } from '@/test/wait';

// The invite route is rendered with its native pieces mocked as DOM
// elements. `react-dom/client` ships no bundled types, so it is loaded
// through a typed require handle (same as `use-action.test.tsx`).
const nodeRequire = createRequire(import.meta.url);
const { createRoot } = nodeRequire('react-dom/client') as {
  createRoot: (container: Element) => { render(node: ReactNode): void; unmount(): void };
};

const h = vi.hoisted(() => ({
  checkInvite: vi.fn(),
  params: { code: 'abc123' as string | undefined },
}));

vi.mock('expo-router', () => ({ useLocalSearchParams: () => h.params }));
vi.mock('expo-linear-gradient', () => ({ LinearGradient: () => null }));
vi.mock('react-native', async () => {
  const { createElement: el } = await import('react');
  return { View: ({ children }: { children?: ReactNode }) => el('div', null, children) };
});
vi.mock('react-native-safe-area-context', async () => {
  const { createElement: el } = await import('react');
  return {
    SafeAreaView: ({ children }: { children?: ReactNode }) => el('div', null, children),
  };
});
vi.mock('@/auth/AuthFlow', async () => {
  const { createElement: el } = await import('react');
  return {
    AuthFlow: ({ inviteCode, heading }: { inviteCode?: string; heading?: string }) =>
      el('div', { 'data-invite': inviteCode }, `AuthFlow ${heading}`),
  };
});
vi.mock('@/components/ui/text', async () => {
  const { createElement: el } = await import('react');
  return { Text: ({ children }: { children?: ReactNode }) => el('span', null, children) };
});
vi.mock('@/lib/auth', () => ({ API_URL: 'https://api.test' }));
vi.mock('@/lib/auth-api', () => ({ checkInvite: h.checkInvite }));

let container: HTMLDivElement;
let unmount: () => void;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  h.checkInvite.mockReset();
  h.params.code = 'abc123';
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  unmount();
  container.remove();
});

const mount = async (): Promise<void> => {
  const root = createRoot(container);
  unmount = () => act(() => root.unmount());
  await act(async () => root.render(createElement(InviteRoute)));
};

const text = (): string => container.textContent ?? '';

const INVALID_BODY =
  'This invite link has expired or was already used. Ask your friend for a new one.';

describe('Invite route (zilar://invite/<code>)', () => {
  it('shows the checking message, then the sign-up flow for a valid invite', async () => {
    let finish: (valid: boolean) => void = () => {};
    h.checkInvite.mockReturnValue(
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
    );
    await mount();
    expect(text()).toContain('Checking your invite…');
    await act(async () => finish(true));
    await waitFor(() => expect(text()).toContain("AuthFlow You're invited to Zilar"));
    expect(h.checkInvite).toHaveBeenCalledWith('https://api.test', 'abc123');
    expect(container.querySelector('[data-invite]')?.getAttribute('data-invite')).toBe('abc123');
  });

  it('shows the invalid message when the code is not valid', async () => {
    h.checkInvite.mockResolvedValue(false);
    await mount();
    await waitFor(() => expect(text()).toContain('Invite not valid'));
    expect(text()).toContain(INVALID_BODY);
  });

  it('shows the invalid message when the check fails', async () => {
    h.checkInvite.mockRejectedValue(new Error('network down'));
    await mount();
    await waitFor(() => expect(text()).toContain('Invite not valid'));
    expect(text()).toContain(INVALID_BODY);
    expect(text()).not.toContain('network down');
  });

  it('is invalid at once without a code and never calls the server', async () => {
    h.params.code = undefined;
    await mount();
    expect(text()).toContain('Invite not valid');
    expect(text()).toContain(INVALID_BODY);
    expect(h.checkInvite).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { act, createElement, type ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProfileApiError } from '@/lib/profile-api';
import HandleRoute from '@/app/welcome/handle';

// The post-sign-up handle step is rendered with its native pieces mocked as
// DOM elements. `react-dom/client` ships no bundled types, so it is loaded
// through a typed require handle (same as `use-action.test.tsx`).
const nodeRequire = createRequire(import.meta.url);
const { createRoot } = nodeRequire('react-dom/client') as {
  createRoot: (container: Element) => { render(node: ReactNode): void; unmount(): void };
};

const h = vi.hoisted(() => ({
  api: { checkHandle: vi.fn(), claimHandle: vi.fn() },
  router: { replace: vi.fn() },
  params: { from: undefined as string | undefined },
  me: { name: 'Ada Lovelace', email: 'ada@example.com' } as {
    name: string;
    email: string;
  } | null,
}));

vi.mock('expo-router', () => ({
  useLocalSearchParams: () => h.params,
  useRouter: () => h.router,
}));
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
vi.mock('@/auth/RequireAuth', () => ({
  RequireUser: ({ children }: { children?: ReactNode }) => children,
}));
vi.mock('@/auth/session', () => ({
  useAuthStore: (select: (state: { me: unknown }) => unknown) => select({ me: h.me }),
}));
vi.mock('@/components/settings/use-profile-api', () => ({
  useProfileApi: () => ({ api: h.api, scenario: null }),
}));
vi.mock('@/components/ui/text', async () => {
  const { createElement: el } = await import('react');
  return { Text: ({ children }: { children?: ReactNode }) => el('span', null, children) };
});
vi.mock('@/components/ui/button', async () => {
  const { createElement: el } = await import('react');
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
    }) => el('button', { onClick: onPress, disabled, 'aria-label': accessibilityLabel }, children),
  };
});
vi.mock('@/components/ui/text-field', async () => {
  const { createElement: el } = await import('react');
  return {
    TextField: ({
      value,
      onChangeText,
      editable,
      accessibilityLabel,
    }: {
      value: string;
      onChangeText: (value: string) => void;
      editable?: boolean;
      accessibilityLabel?: string;
    }) =>
      el('input', {
        value,
        readOnly: editable === false,
        'aria-label': accessibilityLabel,
        onChange: (event: { target: { value: string } }) => onChangeText(event.target.value),
      }),
  };
});

let container: HTMLDivElement;
let unmount: () => void;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  h.api.checkHandle.mockReset();
  h.api.claimHandle.mockReset();
  h.router.replace.mockReset();
  h.params.from = undefined;
  h.me = { name: 'Ada Lovelace', email: 'ada@example.com' };
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
  await act(async () => root.render(createElement(HandleRoute)));
};

const waitFor = async (check: () => void, timeout = 3000): Promise<void> => {
  const started = Date.now();
  for (;;) {
    try {
      check();
      return;
    } catch (error) {
      if (Date.now() - started > timeout) {
        throw error;
      }
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
    }
  }
};

const labelled = (label: string): HTMLElement => {
  const found = container.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (found === null) {
    throw new Error(`No element labelled ${label}`);
  }
  return found;
};

const press = (label: string): Promise<void> => act(async () => labelled(label).click());

const typeHandle = async (value: string): Promise<void> => {
  const input = labelled('Username') as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const text = (): string => container.textContent ?? '';

const wait = (ms: number): Promise<void> =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

describe('Welcome handle step', () => {
  it('fills the suggestion from the profile and checks it after the debounce', async () => {
    h.api.checkHandle.mockResolvedValue({ available: true });
    await mount();
    const suggestion = (labelled('Username') as HTMLInputElement).value;
    expect(suggestion).not.toBe('');
    expect(h.api.checkHandle).not.toHaveBeenCalled();
    await waitFor(() => expect(text()).toContain(`@${suggestion} is available`));
    expect(h.api.checkHandle).toHaveBeenCalledWith(suggestion);
  });

  it('starts empty without a profile and does not check an empty handle', async () => {
    h.me = null;
    await mount();
    expect((labelled('Username') as HTMLInputElement).value).toBe('');
    await wait(450);
    expect(h.api.checkHandle).not.toHaveBeenCalled();
  });

  it('checks only the last typed value once typing stops', async () => {
    h.api.checkHandle.mockResolvedValue({ available: true });
    await mount();
    await typeHandle('grace');
    await typeHandle('grace_h');
    await waitFor(() => expect(text()).toContain('@grace_h is available'));
    expect(h.api.checkHandle).toHaveBeenCalledTimes(1);
    expect(h.api.checkHandle).toHaveBeenCalledWith('grace_h');
  });

  it('drops a pending check when the field is cleared', async () => {
    h.api.checkHandle.mockResolvedValue({ available: true });
    await mount();
    await typeHandle('grace');
    await typeHandle('');
    await wait(450);
    expect(h.api.checkHandle).not.toHaveBeenCalled();
    expect(text()).not.toContain('is available');
  });

  it('shows why a handle is not available', async () => {
    h.api.checkHandle.mockResolvedValue({ available: false, reason: 'reserved' });
    await mount();
    await typeHandle('admin');
    await waitFor(() => expect(text()).toContain('That username is reserved. Try another.'));
  });

  it('shows the rate limit line when the check is rate limited', async () => {
    h.api.checkHandle.mockRejectedValue(new ProfileApiError(429, 'rate_limited', 'slow'));
    await mount();
    await typeHandle('grace');
    await waitFor(() => expect(text()).toContain('Too many checks — wait a little and try again.'));
  });

  it('stays quiet when the check fails for another reason', async () => {
    h.api.checkHandle.mockRejectedValue(new Error('boom'));
    await mount();
    await typeHandle('grace');
    await waitFor(() => expect(h.api.checkHandle).toHaveBeenCalledWith('grace'));
    await wait(50);
    expect(text()).not.toContain('boom');
    expect(text()).not.toContain('available');
  });

  it('asks for a username when Continue is pressed with an empty field', async () => {
    h.me = null;
    await mount();
    await press('Continue');
    expect(text()).toContain('Choose a username');
    expect(h.api.claimHandle).not.toHaveBeenCalled();
  });

  it('claims the handle and moves on to the safe target', async () => {
    h.api.checkHandle.mockResolvedValue({ available: true });
    h.api.claimHandle.mockResolvedValue(undefined);
    h.params.from = '/join/abc';
    await mount();
    await typeHandle(' grace ');
    await press('Continue');
    await waitFor(() => expect(h.router.replace).toHaveBeenCalledWith('/join/abc'));
    expect(h.api.claimHandle).toHaveBeenCalledWith('grace');
  });

  it('falls back to the chats list when the target is not a path', async () => {
    h.api.checkHandle.mockResolvedValue({ available: true });
    h.api.claimHandle.mockResolvedValue(undefined);
    h.params.from = 'https://evil.example';
    await mount();
    await press('Continue');
    await waitFor(() => expect(h.router.replace).toHaveBeenCalledWith('/'));
  });

  it('disables the form while the claim runs and ignores a second press', async () => {
    h.api.checkHandle.mockResolvedValue({ available: true });
    let finish: () => void = () => {};
    h.api.claimHandle.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    await mount();
    await press('Continue');
    expect((labelled('Continue') as HTMLButtonElement).disabled).toBe(true);
    expect((labelled('Skip for now') as HTMLButtonElement).disabled).toBe(true);
    expect((labelled('Username') as HTMLInputElement).readOnly).toBe(true);
    await press('Continue');
    expect(h.api.claimHandle).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    await waitFor(() => expect(h.router.replace).toHaveBeenCalledTimes(1));
  });

  it('shows a friendly line when the handle was just taken and frees the form', async () => {
    h.api.checkHandle.mockResolvedValue({ available: true });
    h.api.claimHandle.mockRejectedValueOnce(new ProfileApiError(409, 'handle_taken', 'raw'));
    await mount();
    await press('Continue');
    await waitFor(() => expect(text()).toContain('That username was just taken. Try another.'));
    expect(text()).not.toContain('raw');
    expect((labelled('Continue') as HTMLButtonElement).disabled).toBe(false);
    expect(h.router.replace).not.toHaveBeenCalled();
    h.api.claimHandle.mockResolvedValue(undefined);
    await press('Continue');
    await waitFor(() => expect(h.router.replace).toHaveBeenCalledTimes(1));
    expect(text()).not.toContain('just taken');
  });

  it('shows a fixed line for an unknown claim failure', async () => {
    h.api.checkHandle.mockResolvedValue({ available: true });
    h.api.claimHandle.mockRejectedValue(new Error('db down'));
    await mount();
    await press('Continue');
    await waitFor(() => expect(text()).toContain('Could not save your username. Try again.'));
    expect(text()).not.toContain('db down');
  });

  it('skips to the target without claiming', async () => {
    h.params.from = '/chat/1';
    await mount();
    await press('Skip for now');
    expect(h.router.replace).toHaveBeenCalledWith('/chat/1');
    expect(h.api.claimHandle).not.toHaveBeenCalled();
  });
});

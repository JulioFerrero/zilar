// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { act, createElement, type ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// `react-dom/client` ships no bundled types and mobile has no testing library,
// so load it through a typed require handle (the `use-action.test.tsx` pattern).
const nodeRequire = createRequire(import.meta.url);
const { createRoot } = nodeRequire('react-dom/client') as {
  createRoot: (container: Element) => { render(node: ReactNode): void; unmount(): void };
};

const mocks = vi.hoisted(() => ({
  replace: vi.fn<(href: string) => void>(),
  params: { value: {} as { from?: string } },
  me: { value: null as { name: string } | null },
  setName: vi.fn<(name: string) => Promise<{ ok: boolean; error?: { code?: string } }>>(),
}));

vi.mock('expo-linear-gradient', () => ({ LinearGradient: () => null }));

vi.mock('expo-router', () => ({
  useLocalSearchParams: () => mocks.params.value,
  useRouter: () => ({ replace: mocks.replace }),
}));

vi.mock('react-native', () => ({ View: 'div' }));

vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'div' }));

vi.mock('@/components/ui/text', () => ({
  Text: ({ children, accessibilityRole }: { children?: ReactNode; accessibilityRole?: string }) =>
    createElement('span', { 'data-role': accessibilityRole }, children),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    disabled,
    onPress,
    accessibilityLabel,
  }: {
    children?: ReactNode;
    disabled?: boolean;
    onPress?: () => void;
    accessibilityLabel?: string;
  }) =>
    createElement(
      'button',
      { 'aria-label': accessibilityLabel, disabled: disabled === true, onClick: onPress },
      children,
    ),
}));

vi.mock('@/components/ui/text-field', () => ({
  TextField: ({
    value,
    editable,
    onChangeText,
    accessibilityLabel,
  }: {
    value?: string;
    editable?: boolean;
    onChangeText?: (text: string) => void;
    accessibilityLabel?: string;
  }) =>
    createElement('input', {
      'aria-label': accessibilityLabel,
      value,
      readOnly: editable === false,
      onChange: (event: { target: { value: string } }) => onChangeText?.(event.target.value),
    }),
}));

vi.mock('./session', () => ({
  useAuthStore: (select: (state: unknown) => unknown) =>
    select({ me: mocks.me.value, setName: mocks.setName }),
}));

import { settle as flush, flushTasks } from '@/test/wait';
import { NameForm } from './NameForm';

const mounted: Array<() => void> = [];

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  mocks.replace.mockReset();
  mocks.setName.mockReset();
  mocks.params.value = {};
  mocks.me.value = null;
});

afterEach(() => {
  while (mounted.length > 0) {
    mounted.pop()?.();
  }
});

function mount(): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(createElement(NameForm)));
  mounted.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return container;
}

const input = (container: HTMLElement): HTMLInputElement => {
  const found = container.querySelector('input');
  if (found === null) {
    throw new Error('No name input');
  }
  return found;
};

const button = (container: HTMLElement): HTMLButtonElement => {
  const found = container.querySelector('button');
  if (found === null) {
    throw new Error('No continue button');
  }
  return found;
};

const alertText = (container: HTMLElement): string | undefined =>
  container.querySelector('[data-role="alert"]')?.textContent ?? undefined;

function type(container: HTMLElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input(container), value);
    input(container).dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const press = (container: HTMLElement): void => {
  act(() => button(container).click());
};

describe('NameForm', () => {
  it('asks for the name and starts with the saved one', () => {
    mocks.me.value = { name: 'Ada' };

    const container = mount();

    expect(container.textContent).toContain('What should we call you?');
    expect(container.textContent).toContain('Your friends will see this name.');
    expect(input(container).value).toBe('Ada');
    expect(button(container).disabled).toBe(false);
    expect(alertText(container)).toBeUndefined();
  });

  it('starts empty when the profile has no name yet', () => {
    expect(input(mount()).value).toBe('');
  });

  it('asks for a name when the field is blank and saves nothing', async () => {
    const container = mount();
    type(container, '   ');

    press(container);
    await flush();

    expect(alertText(container)).toBe('Enter your name');
    expect(mocks.setName).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('saves the trimmed name and moves on to the handle step', async () => {
    mocks.setName.mockResolvedValue({ ok: true });
    const container = mount();
    type(container, '  Ada Lovelace  ');

    press(container);
    await flush();

    expect(mocks.setName).toHaveBeenCalledWith('Ada Lovelace');
    expect(mocks.replace).toHaveBeenCalledWith('/welcome/handle');
    expect(alertText(container)).toBeUndefined();
  });

  it('returns to the page in `from` instead of the handle step', async () => {
    mocks.setName.mockResolvedValue({ ok: true });
    mocks.params.value = { from: '/join/abc' };
    const container = mount();
    type(container, 'Ada');

    press(container);
    await flush();

    expect(mocks.replace).toHaveBeenCalledTimes(1);
    expect(mocks.replace).toHaveBeenCalledWith('/join/abc');
  });

  it('ignores a `from` that is not an in-app path', async () => {
    mocks.setName.mockResolvedValue({ ok: true });
    mocks.params.value = { from: 'https://evil.example' };
    const container = mount();
    type(container, 'Ada');

    press(container);
    await flush();

    expect(mocks.replace).toHaveBeenCalledWith('/welcome/handle');
  });

  it('shows a fixed sentence when saving fails and stays on the page', async () => {
    mocks.setName.mockResolvedValue({ ok: false, error: { code: 'request_failed' } });
    const container = mount();
    type(container, 'Ada');

    press(container);
    await flush();

    expect(alertText(container)).toBe('Could not save your name. Try again.');
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(button(container).disabled).toBe(false);
  });

  it('locks the form while the name is being saved', async () => {
    let finish: (value: { ok: boolean }) => void = () => undefined;
    mocks.setName.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const container = mount();
    type(container, 'Ada');

    press(container);
    await flush();

    expect(button(container).disabled).toBe(true);
    expect(input(container).readOnly).toBe(true);
    expect(mocks.setName).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish({ ok: true });
      await flushTasks();
    });

    expect(button(container).disabled).toBe(false);
    expect(mocks.replace).toHaveBeenCalledWith('/welcome/handle');
  });

  it('clears an earlier error when the name is sent again', async () => {
    mocks.setName.mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true });
    const container = mount();
    type(container, 'Ada');
    press(container);
    await flush();
    expect(alertText(container)).toBe('Could not save your name. Try again.');

    press(container);
    await flush();

    expect(alertText(container)).toBeUndefined();
    expect(mocks.setName).toHaveBeenCalledTimes(2);
    expect(mocks.replace).toHaveBeenCalledWith('/welcome/handle');
  });
});

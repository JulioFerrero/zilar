// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { act, createElement, type ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import ConnectionsScreen from '@/app/settings/connections';
import { ConnectionsApiError, type ProviderConnection } from '@/lib/connections-api';

// `react-dom/client` ships no bundled types and mobile has no testing library,
// so the screen renders through a typed require handle (the media-sheet and
// use-action test pattern). Native primitives are DOM stand-ins: a Pressable
// press becomes a click, a TextField becomes an input.
const nodeRequire = createRequire(import.meta.url);
const { createRoot } = nodeRequire('react-dom/client') as {
  createRoot: (container: Element) => { render(node: ReactNode): void; unmount(): void };
};

const api = vi.hoisted(() => ({
  listConnections: vi.fn(),
  createConnection: vi.fn(),
  testConnection: vi.fn(),
  deleteConnection: vi.fn(),
}));

vi.mock('expo-router', async () => {
  const { useEffect } = await import('react');
  return {
    useFocusEffect: (effect: () => void) => {
      useEffect(effect, [effect]);
    },
    useRouter: () => ({ back: () => {}, push: () => {} }),
  };
});

vi.mock('react-native', async () => {
  const { createElement } = await import('react');
  return {
    Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options['ios'] },
    Pressable: (props: {
      onPress: () => void;
      accessibilityRole?: string;
      accessibilityLabel?: string;
      accessibilityState?: { selected?: boolean };
      children?: ReactNode;
    }) =>
      createElement(
        'button',
        {
          type: 'button',
          role: props.accessibilityRole,
          'aria-label': props.accessibilityLabel,
          'aria-checked': props.accessibilityState?.selected,
          onClick: () => props.onPress(),
        },
        props.children,
      ),
    ScrollView: (props: { children?: ReactNode }) => createElement('div', null, props.children),
    View: (props: { children?: ReactNode }) => createElement('div', null, props.children),
  };
});

vi.mock('react-native-safe-area-context', async () => {
  const { createElement } = await import('react');
  return {
    SafeAreaView: (props: { children?: ReactNode }) => createElement('div', null, props.children),
  };
});

vi.mock('lucide-react-native', () => ({
  ChevronLeft: () => null,
  Eye: () => null,
  EyeOff: () => null,
  KeyRound: () => null,
  Plus: () => null,
  Trash2: () => null,
  X: () => null,
  Zap: () => null,
}));

vi.mock('@/auth/RequireAuth', () => ({
  RequireAuth: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('@/components/ui/icon-button', async () => {
  const { createElement } = await import('react');
  return {
    IconButton: (props: { label: string; onPress: () => void; children?: ReactNode }) =>
      createElement(
        'button',
        { type: 'button', 'aria-label': props.label, onClick: () => props.onPress() },
        props.children,
      ),
  };
});

vi.mock('@/components/ui/button', async () => {
  const { createElement } = await import('react');
  return {
    Button: (props: {
      accessibilityLabel?: string;
      disabled?: boolean;
      onPress: () => void;
      children?: ReactNode;
    }) =>
      createElement(
        'button',
        {
          type: 'button',
          'aria-label': props.accessibilityLabel,
          disabled: props.disabled === true,
          onClick: () => props.onPress(),
        },
        props.children,
      ),
  };
});

vi.mock('@/components/ui/card', async () => {
  const { createElement } = await import('react');
  return {
    Card: (props: { children?: ReactNode }) => createElement('div', null, props.children),
    SectionLabel: (props: { children?: ReactNode }) => createElement('h2', null, props.children),
  };
});

vi.mock('@/components/ui/state-message', async () => {
  const { createElement } = await import('react');
  return {
    StateMessage: (props: {
      title: string;
      action?: { label: string; accessibilityLabel?: string; onPress: () => void };
    }) =>
      createElement(
        'div',
        null,
        createElement('p', null, props.title),
        props.action
          ? createElement(
              'button',
              {
                type: 'button',
                'aria-label': props.action.accessibilityLabel ?? props.action.label,
                onClick: () => props.action?.onPress(),
              },
              props.action.label,
            )
          : null,
      ),
  };
});

vi.mock('@/components/ui/text', async () => {
  const { createElement } = await import('react');
  return {
    Text: (props: { accessibilityRole?: string; children?: ReactNode }) =>
      createElement('span', { role: props.accessibilityRole }, props.children),
  };
});

vi.mock('@/components/ui/text-field', async () => {
  const { createElement } = await import('react');
  return {
    TextField: (props: {
      value: string;
      onChangeText: (value: string) => void;
      accessibilityLabel?: string;
      secureTextEntry?: boolean;
      editable?: boolean;
      placeholder?: string;
    }) =>
      createElement('input', {
        value: props.value,
        'aria-label': props.accessibilityLabel,
        type: props.secureTextEntry === true ? 'password' : 'text',
        disabled: props.editable === false,
        placeholder: props.placeholder,
        onChange: (event: { target: { value: string } }) => props.onChangeText(event.target.value),
      }),
  };
});

vi.mock('@/components/connections/use-connections-api', () => ({
  useConnectionsApi: () => ({ api, scenario: null }),
}));

vi.mock('@/lib/auth', () => ({
  API_URL: 'http://127.0.0.1:3188',
}));

vi.mock('@/lib/colors', () => ({
  ICON: '#d4d4d4',
}));

const OPENAI: ProviderConnection = {
  id: 'conn-openai',
  provider: 'openai',
  label: 'Work',
  status: 'active',
  createdAt: '2026-10-03T10:00:00.000Z',
};

const ANTHROPIC: ProviderConnection = {
  id: 'conn-anthropic',
  provider: 'anthropic',
  label: null,
  status: 'active',
  createdAt: '2026-10-04T10:00:00.000Z',
};

const mounted: Array<() => void> = [];

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  vi.clearAllMocks();
  while (mounted.length > 0) {
    mounted.pop()?.();
  }
});

async function settle(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function mount(): Promise<HTMLDivElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  await act(async () => {
    root.render(createElement(ConnectionsScreen));
  });
  await settle();
  return container;
}

function find(container: HTMLElement, label: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (element === null) {
    throw new Error(`no element labelled "${label}"`);
  }
  return element;
}

function has(container: HTMLElement, label: string): boolean {
  return container.querySelector(`[aria-label="${label}"]`) !== null;
}

async function click(element: HTMLElement): Promise<void> {
  act(() => {
    element.click();
  });
  await settle();
}

async function typeInto(input: HTMLElement, text: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
}

describe('Settings → Connections screen', () => {
  it('lists each connection with its provider, status and label', async () => {
    api.listConnections.mockResolvedValue([OPENAI]);
    const container = await mount();
    expect(container.textContent).toContain('OpenAI');
    expect(container.textContent).toContain('active');
    expect(container.textContent).toContain('Work');
    expect(has(container, 'Test OpenAI key')).toBe(true);
    expect(has(container, 'Remove OpenAI connection')).toBe(true);
  });

  it('shows the empty state with an add action when there are no connections', async () => {
    api.listConnections.mockResolvedValue([]);
    const container = await mount();
    expect(container.textContent).toContain('No provider connections yet.');
    expect(has(container, 'Add a connection')).toBe(true);
  });

  it('shows the load failure sentence and retries the load', async () => {
    api.listConnections
      .mockRejectedValueOnce(new ConnectionsApiError(503, 'connections_unavailable', 'raw'))
      .mockResolvedValueOnce([]);
    const container = await mount();
    expect(container.textContent).toContain('Connections are not set up on this server.');
    await click(find(container, 'Retry loading connections'));
    expect(api.listConnections).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('No provider connections yet.');
  });

  it('marks a key that works after a successful test', async () => {
    api.listConnections.mockResolvedValue([OPENAI]);
    api.testConnection.mockResolvedValue({ ok: true });
    const container = await mount();
    await click(find(container, 'Test OpenAI key'));
    expect(api.testConnection).toHaveBeenCalledWith('conn-openai');
    expect(container.textContent).toContain('Key works');
  });

  it('shows the rejected sentence, then the failed-test sentence', async () => {
    api.listConnections.mockResolvedValue([OPENAI]);
    api.testConnection.mockResolvedValueOnce({ ok: false }).mockRejectedValueOnce(new Error('x'));
    const container = await mount();
    await click(find(container, 'Test OpenAI key'));
    expect(container.textContent).toContain('The key was rejected.');
    await click(find(container, 'Test OpenAI key'));
    expect(container.textContent).toContain('Could not test the key.');
    expect(container.textContent).not.toContain('Key works');
  });

  it('removes a connection after the confirm step', async () => {
    api.listConnections.mockResolvedValue([OPENAI]);
    api.deleteConnection.mockResolvedValue(undefined);
    const container = await mount();
    await click(find(container, 'Remove OpenAI connection'));
    expect(container.textContent).toContain('Remove OpenAI?');
    await click(find(container, 'Confirm remove'));
    expect(api.deleteConnection).toHaveBeenCalledWith('conn-openai');
    expect(has(container, 'Test OpenAI key')).toBe(false);
    expect(container.textContent).toContain('No provider connections yet.');
  });

  it('keeps the confirm step and shows the server sentence when a removal fails', async () => {
    api.listConnections.mockResolvedValue([OPENAI]);
    api.deleteConnection.mockRejectedValue(
      new ConnectionsApiError(409, 'connection_in_use', 'raw'),
    );
    const container = await mount();
    await click(find(container, 'Remove OpenAI connection'));
    await click(find(container, 'Confirm remove'));
    expect(container.textContent).toContain(
      'An AI still uses this connection. Switch the AI first.',
    );
    expect(container.textContent).toContain('Remove OpenAI?');
    expect(has(container, 'Confirm remove')).toBe(true);
  });

  it('adds a connection with the chosen provider and label, then lists it first', async () => {
    api.listConnections.mockResolvedValue([OPENAI]);
    api.createConnection.mockResolvedValue(ANTHROPIC);
    const container = await mount();
    await click(find(container, 'Add a connection'));
    await click(find(container, 'Anthropic'));
    await typeInto(find(container, 'API key'), 'sk-test-123');
    await typeInto(find(container, 'Label'), ' Lab ');
    await click(find(container, 'Save the connection'));
    expect(api.createConnection).toHaveBeenCalledWith({
      provider: 'anthropic',
      key: 'sk-test-123',
      label: 'Lab',
    });
    expect(container.textContent).not.toContain('New connection');
    expect(container.textContent?.indexOf('Anthropic')).toBeLessThan(
      container.textContent?.indexOf('OpenAI') ?? -1,
    );
  });

  it('asks for a key first, and keeps the typed key when the save fails', async () => {
    api.listConnections.mockResolvedValue([]);
    api.createConnection.mockRejectedValue(new ConnectionsApiError(429, 'rate_limited', 'raw'));
    const container = await mount();
    await click(find(container, 'Add a connection'));
    await click(find(container, 'Save the connection'));
    expect(container.textContent).toContain('Paste your API key.');
    expect(api.createConnection).not.toHaveBeenCalled();
    await typeInto(find(container, 'API key'), 'sk-test-123');
    await click(find(container, 'Save the connection'));
    expect(container.textContent).toContain('Too many requests. Try again in a few minutes.');
    expect((find(container, 'API key') as HTMLInputElement).value).toBe('sk-test-123');
  });
});

// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { act, createElement, type ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import CreateAiScreen from '@/app/ais/new';
import { AisApiError, type Connection } from '@/lib/ais-api';

// The route is rendered for real in jsdom, so its effects, state and the
// wizard steps all run. Only the native primitives, the picker components and
// the API hook are replaced. `react-dom/client` ships no types here, so it is
// loaded through a typed require handle (the `media-sheet.test.tsx` pattern).
const nodeRequire = createRequire(import.meta.url);
const { createRoot } = nodeRequire('react-dom/client') as {
  createRoot: (container: Element) => { render(node: ReactNode): void; unmount(): void };
};

const mocks = vi.hoisted(() => ({
  router: { back: vi.fn(), push: vi.fn(), replace: vi.fn() },
  api: { listConnections: vi.fn(), createAi: vi.fn() },
}));

vi.mock('expo-router', () => ({ useRouter: () => mocks.router }));

vi.mock('nativewind', () => ({ useColorScheme: () => ({ colorScheme: 'dark' }) }));

vi.mock('react-native', () => ({
  KeyboardAvoidingView: 'div',
  Platform: { OS: 'ios' },
  View: 'div',
}));

vi.mock('lucide-react-native', () => ({ Plus: 'svg', Zap: 'svg' }));

vi.mock('@/components/ais/require-ais-auth', () => ({
  RequireAisAuth: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('@/components/ais/use-ais-api', () => ({
  useAisApi: () => ({ api: mocks.api, scenario: null }),
}));

vi.mock('@/components/ais/screen-shell', async () => {
  const { createElement: h } = await import('react');
  return {
    AisScreenShell: ({
      title,
      subtitle,
      footer,
      children,
    }: {
      title: string;
      subtitle?: string;
      footer?: ReactNode;
      children?: ReactNode;
    }) =>
      h(
        'div',
        null,
        h('h1', null, title),
        subtitle === undefined ? null : h('p', null, subtitle),
        children,
        footer,
      ),
  };
});

vi.mock('@/components/ais/wizard-steps', () => ({ WizardSteps: () => null }));

vi.mock('@/components/ais/limits-fields', async () => {
  const { createElement: h } = await import('react');
  return {
    LimitsFields: ({
      day,
      month,
      onDayChange,
      onMonthChange,
    }: {
      day: string;
      month: string;
      onDayChange: (value: string) => void;
      onMonthChange: (value: string) => void;
    }) =>
      h(
        'div',
        null,
        h('input', {
          'aria-label': 'Per day',
          value: day,
          onChange: (event: { target: { value: string } }) => onDayChange(event.target.value),
        }),
        h('input', {
          'aria-label': 'Per month',
          value: month,
          onChange: (event: { target: { value: string } }) => onMonthChange(event.target.value),
        }),
      ),
  };
});

vi.mock('@/components/ais/model-picker', async () => {
  const { createElement: h } = await import('react');
  return {
    ModelPicker: ({ value, onChange }: { value: string; onChange: (value: string) => void }) =>
      h('input', {
        'aria-label': 'Model',
        value,
        onChange: (event: { target: { value: string } }) => onChange(event.target.value),
      }),
  };
});

vi.mock('@/components/ais/provider-picker', async () => {
  const { createElement: h } = await import('react');
  return {
    ProviderPicker: ({
      connections,
      onChange,
    }: {
      connections: Connection[];
      onChange: (id: string) => void;
    }) =>
      h(
        'div',
        null,
        connections.map((connection) =>
          h(
            'button',
            { key: connection.id, type: 'button', onClick: () => onChange(connection.id) },
            connection.id,
          ),
        ),
      ),
  };
});

vi.mock('@/components/ais/template-cards', async () => {
  const { createElement: h } = await import('react');
  return {
    TemplateCards: ({ onChange }: { onChange: (template: string) => void }) =>
      h(
        'div',
        null,
        ['dev', 'marketing', 'fun', 'custom'].map((template) =>
          h(
            'button',
            { key: template, type: 'button', onClick: () => onChange(template) },
            template,
          ),
        ),
      ),
  };
});

vi.mock('@/components/ui/button', async () => {
  const { createElement: h } = await import('react');
  return {
    Button: ({
      children,
      disabled,
      onPress,
    }: {
      children?: ReactNode;
      disabled?: boolean;
      onPress?: () => void;
    }) => h('button', { type: 'button', disabled, onClick: () => onPress?.() }, children),
  };
});

vi.mock('@/components/ui/state-message', async () => {
  const { createElement: h } = await import('react');
  return {
    StateMessage: ({
      kind,
      title,
      action,
    }: {
      kind: string;
      title: string;
      action?: { label: string; onPress: () => void };
    }) =>
      h(
        'div',
        null,
        h('p', kind === 'error' ? { role: 'alert' } : null, title),
        action === undefined
          ? null
          : h('button', { type: 'button', onClick: () => action.onPress() }, action.label),
      ),
  };
});

vi.mock('@/components/ui/text', async () => {
  const { createElement: h } = await import('react');
  return {
    Text: ({ children, accessibilityRole }: { children?: ReactNode; accessibilityRole?: string }) =>
      h('span', { role: accessibilityRole }, children),
  };
});

vi.mock('@/components/ui/text-field', async () => {
  const { createElement: h } = await import('react');
  return {
    TextField: ({
      value,
      onChangeText,
      accessibilityLabel,
    }: {
      value: string;
      onChangeText: (value: string) => void;
      accessibilityLabel?: string;
    }) =>
      h('input', {
        'aria-label': accessibilityLabel,
        value,
        onChange: (event: { target: { value: string } }) => onChangeText(event.target.value),
      }),
  };
});

const ACTIVE: Connection = {
  id: 'conn-1',
  provider: 'openai',
  label: null,
  status: 'active',
  createdAt: '2026-10-01T00:00:00.000Z',
};

const REVOKED: Connection = { ...ACTIVE, id: 'conn-2', status: 'revoked' };

const container = document.createElement('div');
let root: ReturnType<typeof createRoot> | undefined;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.api.listConnections.mockResolvedValue([ACTIVE]);
  mocks.api.createAi.mockResolvedValue({ id: 'ai-1' });
  document.body.appendChild(container);
});

afterEach(async () => {
  if (root !== undefined) {
    const unmounting = root;
    root = undefined;
    await act(async () => unmounting.unmount());
  }
  container.remove();
});

async function mount(): Promise<void> {
  root = createRoot(container);
  const mounted = root;
  await act(async () => {
    mounted.render(createElement(CreateAiScreen));
  });
}

const waitFor = async (check: () => void): Promise<void> => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      check();
      return;
    } catch {
      await act(async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
      });
    }
  }
  check();
};

const text = (): string => container.textContent ?? '';

function buttonNamed(label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find(
    (button) => button.textContent?.trim() === label,
  );
  if (found === undefined) {
    throw new Error(`no button named ${label}`);
  }
  return found;
}

function field(label: string): HTMLInputElement {
  const found = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (found === null) {
    throw new Error(`no field named ${label}`);
  }
  return found;
}

// React reads the value of a controlled input from its own setter, so the
// native setter is used and an input event is dispatched.
function typeInto(label: string, value: string): void {
  const input = field(label);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function click(button: HTMLButtonElement): void {
  act(() => {
    button.click();
  });
}

describe('CreateAiScreen (ais/new)', () => {
  it('shows the loading state until the connections load', async () => {
    mocks.api.listConnections.mockReturnValue(new Promise(() => {}));
    await mount();
    expect(text()).toContain('Loading…');
  });

  it('lists only the active connections on the provider step', async () => {
    mocks.api.listConnections.mockResolvedValue([ACTIVE, REVOKED]);
    await mount();
    await waitFor(() => expect(text()).toContain('Step 1 of 6'));
    typeInto('Name', 'Dev-1');
    click(buttonNamed('Next'));
    click(buttonNamed('Next'));
    expect(buttonNamed('conn-1')).toBeTruthy();
    expect(
      Array.from(container.querySelectorAll('button')).some((b) => b.textContent === 'conn-2'),
    ).toBe(false);
  });

  it('walks the six steps and creates the AI', async () => {
    await mount();
    await waitFor(() => expect(text()).toContain('Step 1 of 6'));
    expect(buttonNamed('Next').disabled).toBe(true);
    typeInto('Name', 'Dev-1');
    expect(buttonNamed('Next').disabled).toBe(false);

    click(buttonNamed('Next'));
    expect(text()).toContain('Step 2 of 6');
    click(buttonNamed('Next'));
    expect(text()).toContain('Step 3 of 6');
    click(buttonNamed('conn-1'));
    click(buttonNamed('Next'));
    expect(text()).toContain('Step 4 of 6');
    typeInto('Model', 'gpt-4o-mini');
    click(buttonNamed('Next'));
    expect(text()).toContain('Step 5 of 6');
    expect(field('Per day').value).toBe('2');
    expect(field('Per month').value).toBe('20');
    click(buttonNamed('Next'));
    expect(text()).toContain('Step 6 of 6');
    expect(text()).toContain('Dev-1');
    expect(text()).toContain('gpt-4o-mini');

    click(buttonNamed('Create AI'));
    await waitFor(() =>
      expect(mocks.router.replace).toHaveBeenCalledWith({
        pathname: '/ais',
        params: { highlight: 'ai-1' },
      }),
    );
    expect(mocks.api.createAi).toHaveBeenCalledTimes(1);
    expect(mocks.api.createAi).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Dev-1',
        template: 'dev',
        providerConnectionId: 'conn-1',
        model: 'gpt-4o-mini',
        limits: { perDayUsd: 2, perMonthUsd: 20 },
      }),
    );
  });

  it('keeps the wizard open and shows the fixed server message when create fails', async () => {
    mocks.api.createAi.mockRejectedValue(
      new AisApiError(500, 'ai_provisioning_failed', 'raw server text'),
    );
    await mount();
    await waitFor(() => expect(text()).toContain('Step 1 of 6'));
    typeInto('Name', 'Dev-1');
    click(buttonNamed('Next'));
    click(buttonNamed('Next'));
    click(buttonNamed('conn-1'));
    click(buttonNamed('Next'));
    typeInto('Model', 'gpt-4o-mini');
    click(buttonNamed('Next'));
    click(buttonNamed('Next'));
    click(buttonNamed('Create AI'));
    await waitFor(() =>
      expect(text()).toContain(
        "The server couldn't finish. Nothing was left half-created; try again.",
      ),
    );
    expect(text()).not.toContain('raw server text');
    expect(mocks.router.replace).not.toHaveBeenCalled();
    expect(buttonNamed('Create AI').disabled).toBe(false);
  });

  it('shows the unavailable notice when AI management is off on the server', async () => {
    mocks.api.listConnections.mockRejectedValue(new AisApiError(503, 'ais_unavailable', 'off'));
    await mount();
    await waitFor(() => expect(text()).toContain('AI management is not available on this server.'));
    expect(text()).toContain("AI management isn't configured on this server.");
    expect(container.querySelector('input[aria-label="Name"]')).toBeNull();
  });

  it('retries the connections load after a failure', async () => {
    mocks.api.listConnections
      .mockRejectedValueOnce(new AisApiError(500, 'internal', 'Server exploded'))
      .mockResolvedValueOnce([ACTIVE]);
    await mount();
    await waitFor(() => expect(text()).toContain('Server exploded'));
    click(buttonNamed('Retry'));
    await waitFor(() => expect(text()).toContain('Step 1 of 6'));
    expect(mocks.api.listConnections).toHaveBeenCalledTimes(2);
  });
});

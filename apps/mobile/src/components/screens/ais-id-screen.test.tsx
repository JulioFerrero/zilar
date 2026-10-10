// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { act, createElement, type ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import EditAiScreen from '@/app/ais/[id]';
import { AisApiError, type Connection, type PublicAi } from '@/lib/ais-api';
import type { Machine } from '@/lib/machines-api';
import { waitForAct as waitFor } from '@/test/wait';

// The route is rendered for real in jsdom, so its effects, state and save
// actions all run. Only native primitives, the picker components and the API
// hooks are replaced. `react-dom/client` ships no types here, so it is loaded
// through a typed require handle (the `media-sheet.test.tsx` pattern).
const nodeRequire = createRequire(import.meta.url);
const { createRoot } = nodeRequire('react-dom/client') as {
  createRoot: (container: Element) => { render(node: ReactNode): void; unmount(): void };
};

// The hook mocks return the same api object on every render, as the real
// hooks do: the screen's effects depend on those objects.
const mocks = vi.hoisted(() => ({
  router: { back: vi.fn(), push: vi.fn(), replace: vi.fn() },
  aisApi: { listAis: vi.fn(), updateAi: vi.fn() },
  connectionsApi: { listConnections: vi.fn() },
  machinesApi: { listMachines: vi.fn(), setAiMachine: vi.fn() },
  emptyApi: {},
}));

vi.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'ai-1' }),
  useRouter: () => mocks.router,
}));

vi.mock('react-native', () => ({
  KeyboardAvoidingView: 'div',
  Platform: { OS: 'ios' },
  View: 'div',
}));

vi.mock('@/components/ais/require-ais-auth', () => ({
  RequireAisAuth: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('@/components/ais/use-ais-api', () => ({
  useAisApi: () => ({ api: mocks.aisApi, scenario: null }),
}));

vi.mock('@/components/ais/use-tools-api', () => ({
  useToolsApi: () => ({ api: mocks.emptyApi }),
}));

vi.mock('@/components/ais/use-audit-api', () => ({
  useAuditApi: () => ({ api: mocks.emptyApi }),
}));

vi.mock('@/components/ais/use-ai-memory-api', () => ({
  useAiMemoryApi: () => ({ api: mocks.emptyApi }),
}));

vi.mock('@/components/connections/use-connections-api', () => ({
  useConnectionsApi: () => ({ api: mocks.connectionsApi }),
}));

vi.mock('@/components/machines/use-machines-api', () => ({
  useMachinesApi: () => ({ api: mocks.machinesApi }),
}));

vi.mock('@/components/ais/routines-section', () => ({ RoutinesSection: () => null }));
vi.mock('@/components/ais/ai-activity', () => ({ AiActivity: () => null }));
vi.mock('@/components/ais/ai-memory-section', () => ({ AiMemorySection: () => null }));
vi.mock('@/components/ais/tools-section', () => ({ ToolsSection: () => null }));

vi.mock('@/components/ais/screen-shell', async () => {
  const { createElement: h } = await import('react');
  return {
    AisScreenShell: ({
      title,
      footer,
      children,
    }: {
      title: string;
      footer?: ReactNode;
      children?: ReactNode;
    }) => h('div', null, h('h1', null, title), children, footer),
  };
});

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

vi.mock('@/components/ais/machine-picker', async () => {
  const { createElement: h } = await import('react');
  return {
    MachinePicker: ({
      machines,
      onChange,
    }: {
      machines: Machine[];
      onChange: (id: string | null) => void;
    }) =>
      h(
        'div',
        null,
        h('button', { type: 'button', onClick: () => onChange(null) }, 'No machine'),
        machines.map((machine) =>
          h(
            'button',
            { key: machine.id, type: 'button', onClick: () => onChange(machine.id) },
            machine.name,
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

const AI: PublicAi = {
  id: 'ai-1',
  name: 'Dev-1',
  template: 'dev',
  persona: 'Be brief.',
  model: 'gpt-4o',
  jid: 'ai-1@zilar.test',
  status: 'active',
  providerConnectionId: 'conn-1',
  limits: { perDayUsd: 2, perMonthUsd: 20 },
  machineId: null,
  createdAt: '2026-10-01T00:00:00.000Z',
};

const CONN_1: Connection = {
  id: 'conn-1',
  provider: 'openai',
  label: null,
  status: 'active',
  createdAt: '2026-10-01T00:00:00.000Z',
};

const CONN_2: Connection = { ...CONN_1, id: 'conn-2', provider: 'anthropic' };

const LAPTOP = { id: 'm-1', name: 'Laptop' } as Machine;

const container = document.createElement('div');
let root: ReturnType<typeof createRoot> | undefined;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.aisApi.listAis.mockResolvedValue([AI]);
  mocks.aisApi.updateAi.mockResolvedValue(AI);
  mocks.connectionsApi.listConnections.mockResolvedValue([CONN_1, CONN_2]);
  mocks.machinesApi.listMachines.mockResolvedValue([LAPTOP]);
  mocks.machinesApi.setAiMachine.mockResolvedValue('m-1');
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
    mounted.render(createElement(EditAiScreen));
  });
}

// Lets the pending promises of the last action finish, so the next click is
// not dropped by a busy guard.
const settle = async (): Promise<void> => {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  });
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

describe('EditAiScreen (ais/[id])', () => {
  it('shows the loading state until the AI loads', async () => {
    mocks.aisApi.listAis.mockReturnValue(new Promise(() => {}));
    await mount();
    expect(text()).toContain('Loading…');
  });

  it('fills the form from the AI on the server', async () => {
    await mount();
    await waitFor(() => expect(text()).toContain('Edit Dev-1'));
    expect(field('Name').value).toBe('Dev-1');
    expect(field('Persona').value).toBe('Be brief.');
    expect(field('Per day').value).toBe('2');
    expect(field('Per month').value).toBe('20');
    expect(field('Model').value).toBe('gpt-4o');
    expect(buttonNamed('Save').disabled).toBe(false);
  });

  it('says the AI is gone when the list no longer has it', async () => {
    mocks.aisApi.listAis.mockResolvedValue([]);
    await mount();
    await waitFor(() => expect(text()).toContain('That AI no longer exists.'));
    expect(buttonNamed('Retry')).toBeTruthy();
  });

  it('shows the load failure and retries', async () => {
    mocks.aisApi.listAis
      .mockRejectedValueOnce(new AisApiError(500, 'internal', 'Server exploded'))
      .mockResolvedValueOnce([AI]);
    await mount();
    await waitFor(() => expect(text()).toContain('Server exploded'));
    click(buttonNamed('Retry'));
    await waitFor(() => expect(text()).toContain('Edit Dev-1'));
    expect(mocks.aisApi.listAis).toHaveBeenCalledTimes(2);
  });

  it('saves the changed name and goes back', async () => {
    await mount();
    await waitFor(() => expect(text()).toContain('Edit Dev-1'));
    typeInto('Name', 'Dev-2');
    click(buttonNamed('Save'));
    await waitFor(() => expect(mocks.router.back).toHaveBeenCalledTimes(1));
    expect(mocks.aisApi.updateAi).toHaveBeenCalledTimes(1);
    expect(mocks.aisApi.updateAi).toHaveBeenCalledWith('ai-1', { name: 'Dev-2' });
  });

  it('keeps the form and shows the fixed message when the save fails', async () => {
    mocks.aisApi.updateAi.mockRejectedValue(new AisApiError(500, 'ai_update_failed', 'raw text'));
    await mount();
    await waitFor(() => expect(text()).toContain('Edit Dev-1'));
    typeInto('Name', 'Dev-2');
    click(buttonNamed('Save'));
    await waitFor(() =>
      expect(text()).toContain(
        "The server couldn't finish. Nothing was left half-created; try again.",
      ),
    );
    expect(text()).not.toContain('raw text');
    expect(mocks.router.back).not.toHaveBeenCalled();
    expect(field('Name').value).toBe('Dev-2');
    expect(buttonNamed('Save').disabled).toBe(false);
  });

  it('disables Save while the name is blank', async () => {
    await mount();
    await waitFor(() => expect(text()).toContain('Edit Dev-1'));
    typeInto('Name', '   ');
    expect(buttonNamed('Save').disabled).toBe(true);
  });

  it('sends the provider and the default model of the new provider', async () => {
    await mount();
    await waitFor(() => expect(text()).toContain('Edit Dev-1'));
    click(buttonNamed('conn-2'));
    expect(field('Model').value).not.toBe('gpt-4o');
    const model = field('Model').value;
    click(buttonNamed('Save'));
    await waitFor(() => expect(mocks.router.back).toHaveBeenCalledTimes(1));
    expect(mocks.aisApi.updateAi).toHaveBeenCalledWith(
      'ai-1',
      expect.objectContaining({ model, providerConnectionId: 'conn-2' }),
    );
  });

  it('sets the home machine and keeps it when the change fails', async () => {
    await mount();
    await waitFor(() => expect(text()).toContain('Edit Dev-1'));
    click(buttonNamed('Laptop'));
    await waitFor(() => expect(mocks.machinesApi.setAiMachine).toHaveBeenCalledWith('ai-1', 'm-1'));
    await settle();

    mocks.machinesApi.setAiMachine.mockRejectedValueOnce('boom');
    click(buttonNamed('No machine'));
    await waitFor(() => expect(text()).toContain('Could not update the home machine.'));
    expect(text()).not.toContain('boom');
    expect(mocks.machinesApi.setAiMachine).toHaveBeenLastCalledWith('ai-1', null);
  });
});

// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { act, createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AisScreen from '@/app/(tabs)/ais';
import { AisApiError, type PublicAi } from '@/lib/ais-api';

// The AIs tab is rendered through `react-dom/client` (jsdom). The AI api is a
// set of spies and the list, sheet and dialog are small stand-ins that expose
// their props as buttons, so each test drives one user action.
const nodeRequire = createRequire(import.meta.url);
const { createRoot } = nodeRequire('react-dom/client') as {
  createRoot: (container: Element) => { render(node: ReactNode): void; unmount(): void };
};

const state = vi.hoisted(() => {
  const api = {
    listAis: vi.fn(),
    createAi: vi.fn(),
    updateAi: vi.fn(),
    deleteAi: vi.fn(),
    listConnections: vi.fn(),
    stopAi: vi.fn(),
    resumeAi: vi.fn(),
  };
  return {
    api,
    push: vi.fn(),
    params: { highlight: undefined as string | undefined },
    sheet: vi.fn<(props: Record<string, unknown>) => ReactNode>(() => null),
    dialog: vi.fn<(props: Record<string, unknown>) => ReactNode>(() => null),
  };
});

vi.mock('expo-router', async () => {
  const { useEffect } = await import('react');
  return {
    useFocusEffect: (effect: () => void | (() => void)) => {
      useEffect(effect, [effect]);
    },
    useRouter: () => ({ push: state.push, back: () => {} }),
    useLocalSearchParams: () => state.params,
  };
});

vi.mock('react-native', async () => {
  const { createElement: h } = await import('react');
  return {
    View: ({ children }: { children?: ReactNode }) => h('div', null, children),
  };
});

vi.mock('lucide-react-native', () => ({
  Plus: () => null,
  Zap: () => null,
}));

vi.mock('@/components/ais/require-ais-auth', async () => {
  const { createElement: h } = await import('react');
  return {
    RequireAisAuth: ({ children }: { children?: ReactNode }) => h('div', null, children),
  };
});

vi.mock('@/components/ais/ai-actions-sheet', () => ({
  AiActionsSheet: state.sheet,
}));

vi.mock('@/components/ais/delete-confirm', () => ({
  DeleteConfirmDialog: state.dialog,
}));

vi.mock('@/components/ais/ai-row', async () => {
  const { createElement: h } = await import('react');
  return {
    AiRow: ({ ai, onPress }: { ai: PublicAi; onPress: () => void }) =>
      h(
        'button',
        { type: 'button', 'data-action': `row:${ai.name}`, onClick: onPress },
        `${ai.name} ${ai.status}`,
      ),
  };
});

vi.mock('@/components/ais/screen-shell', async () => {
  const { createElement: h } = await import('react');
  return {
    AisScreenShell: ({ children, right }: { children?: ReactNode; right?: ReactNode }) =>
      h('div', null, right, children),
  };
});

vi.mock('@/components/ais/use-ais-api', () => ({
  useAisApi: () => ({ api: state.api }),
}));

vi.mock('@/components/ui/button', async () => {
  const { createElement: h } = await import('react');
  return {
    Button: ({ children, onPress }: { children?: ReactNode; onPress: () => void }) =>
      h('button', { type: 'button', 'data-action': 'button', onClick: onPress }, children),
  };
});

vi.mock('@/components/ui/icon-button', async () => {
  const { createElement: h } = await import('react');
  return {
    IconButton: ({ label, onPress }: { label: string; onPress: () => void }) =>
      h('button', { type: 'button', 'data-action': label, onClick: onPress }),
  };
});

vi.mock('@/components/ui/state-message', async () => {
  const { createElement: h } = await import('react');
  return {
    StateMessage: ({
      title,
      hint,
      action,
    }: {
      title: string;
      hint?: string;
      action?: { label: string; onPress: () => void };
    }) =>
      h(
        'div',
        null,
        h('p', null, title),
        hint === undefined ? null : h('p', null, hint),
        action === undefined
          ? null
          : h(
              'button',
              { type: 'button', 'data-action': 'retry', onClick: action.onPress },
              action.label,
            ),
      ),
  };
});

vi.mock('@/components/ui/text', async () => {
  const { createElement: h } = await import('react');
  return {
    Text: ({ children }: { children?: ReactNode }) => h('span', null, children),
  };
});

vi.mock('@/lib/colors', () => ({
  ACCENT: '#fff',
  ICON: '#fff',
}));

vi.mock('@/lib/depth', () => ({
  ACCENT_FOREGROUND: '#000',
}));

let root: { render(node: ReactNode): void; unmount(): void } | undefined;
let container: HTMLDivElement | undefined;

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mount(): Promise<void> {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const node = createElement(AisScreen);
  await act(async () => {
    root?.render(node);
  });
  await settle();
}

function text(): string {
  return container?.textContent ?? '';
}

function hasAction(name: string): boolean {
  return container?.querySelector(`[data-action="${name}"]`) !== null;
}

async function press(name: string): Promise<void> {
  const el = container?.querySelector<HTMLElement>(`[data-action="${name}"]`);
  if (el === null || el === undefined) {
    throw new Error(`no control named ${name}`);
  }
  await act(async () => {
    el.click();
  });
  await settle();
}

function ai(id: string, name: string, status: PublicAi['status'] = 'active'): PublicAi {
  return {
    id,
    name,
    template: 'assistant' as PublicAi['template'],
    persona: '',
    model: 'm',
    jid: `${id}@ais.test`,
    status,
    providerConnectionId: 'conn-1',
    limits: {} as PublicAi['limits'],
    createdAt: '2026-10-01T00:00:00Z',
  };
}

// The sheet and the dialog are only rendered while they are open: the stand-ins
// take the props the screen passes and show the buttons that call them.
state.sheet.mockImplementation((props: Record<string, unknown>) => {
  const open = props['ai'] !== null;
  if (!open) {
    return null;
  }
  return createElement(
    'div',
    null,
    createElement('span', null, props['runError'] === '' ? '' : String(props['runError'])),
    createElement('button', {
      type: 'button',
      'data-action': 'sheet-open-chat',
      onClick: props['onOpenChat'] as () => void,
    }),
    createElement('button', {
      type: 'button',
      'data-action': 'sheet-edit',
      onClick: props['onEdit'] as () => void,
    }),
    createElement('button', {
      type: 'button',
      'data-action': 'sheet-delete',
      onClick: props['onDelete'] as () => void,
    }),
    createElement('button', {
      type: 'button',
      'data-action': 'sheet-stop',
      onClick: () => (props['onToggleRun'] as (next: 'stop') => void)('stop'),
    }),
    createElement('button', {
      type: 'button',
      'data-action': 'sheet-close',
      onClick: props['onClose'] as () => void,
    }),
  );
});

state.dialog.mockImplementation((props: Record<string, unknown>) => {
  const name = props['aiName'];
  if (typeof name !== 'string') {
    return null;
  }
  return createElement(
    'div',
    null,
    createElement('span', null, `Delete ${name}?`),
    createElement('span', null, String(props['error'])),
    createElement('button', {
      type: 'button',
      'data-action': 'confirm-delete',
      onClick: props['onConfirm'] as () => void,
    }),
    createElement('button', {
      type: 'button',
      'data-action': 'cancel-delete',
      onClick: props['onCancel'] as () => void,
    }),
  );
});

afterEach(async () => {
  if (root !== undefined) {
    const current = root;
    await act(async () => {
      current.unmount();
    });
  }
  container?.remove();
  root = undefined;
  container = undefined;
});

beforeEach(() => {
  vi.clearAllMocks();
  state.params.highlight = undefined;
  state.api.listAis.mockResolvedValue([ai('a1', 'Ada'), ai('a2', 'Bo')]);
  state.api.stopAi.mockImplementation((id: string) =>
    Promise.resolve(ai(id, id === 'a1' ? 'Ada' : 'Bo', 'stopped')),
  );
  state.api.deleteAi.mockResolvedValue(undefined);
});

describe('AIs tab', () => {
  it('shows the loading message before the list arrives', async () => {
    state.api.listAis.mockReturnValue(new Promise(() => {}));
    await mount();
    expect(text()).toContain('Loading…');
  });

  it('shows the empty state with a create button when there are no AIs', async () => {
    state.api.listAis.mockResolvedValue([]);
    await mount();
    expect(text()).toContain('You have no AIs yet.');
    expect(hasAction('button')).toBe(true);
  });

  it('lists the AIs with their status and a create button', async () => {
    await mount();
    expect(text()).toContain('Ada active');
    expect(text()).toContain('Bo active');
    expect(hasAction('Create AI')).toBe(true);
  });

  it('shows the server text when the list cannot load and retries on request', async () => {
    state.api.listAis.mockRejectedValueOnce(new AisApiError(503, 'ais_unavailable', 'unavailable'));
    await mount();
    expect(text()).toContain("AI management isn't configured on this server.");
    expect(text()).toContain('AI management is not available on this server.');
    await press('retry');
    expect(state.api.listAis).toHaveBeenCalledTimes(2);
    expect(text()).toContain('Ada active');
  });

  it('keeps the message of a plain error when the list cannot load', async () => {
    state.api.listAis.mockRejectedValueOnce(new Error('boom'));
    await mount();
    expect(text()).toContain('boom');
  });

  it('opens the create screen from the header button', async () => {
    await mount();
    await press('Create AI');
    expect(state.push).toHaveBeenCalledWith('/ais/new');
  });

  it('opens the edit screen for the chosen AI', async () => {
    await mount();
    await press('row:Ada');
    await press('sheet-edit');
    expect(state.push).toHaveBeenCalledWith({ pathname: '/ais/[id]', params: { id: 'a1' } });
  });

  it('swaps the row for the server answer when stop succeeds and closes the sheet', async () => {
    await mount();
    await press('row:Ada');
    await press('sheet-stop');
    expect(state.api.stopAi).toHaveBeenCalledWith('a1');
    expect(text()).toContain('Ada stopped');
    expect(hasAction('sheet-stop')).toBe(false);
  });

  it('keeps the sheet open with the error when stop fails', async () => {
    state.api.stopAi.mockRejectedValueOnce(new AisApiError(500, 'ai_update_failed', 'nope'));
    await mount();
    await press('row:Ada');
    await press('sheet-stop');
    expect(hasAction('sheet-stop')).toBe(true);
    expect(text()).toContain(
      "The server couldn't finish. Nothing was left half-created; try again.",
    );
  });

  it('closes the sheet and reloads the list when stop answers 409', async () => {
    state.api.stopAi.mockRejectedValueOnce(new AisApiError(409, 'not_active', 'changed'));
    await mount();
    await press('row:Ada');
    await press('sheet-stop');
    expect(hasAction('sheet-stop')).toBe(false);
    expect(state.api.listAis).toHaveBeenCalledTimes(2);
  });

  it('removes the AI after a confirmed delete', async () => {
    await mount();
    await press('row:Ada');
    await press('sheet-delete');
    expect(text()).toContain('Delete Ada?');
    await press('confirm-delete');
    expect(state.api.deleteAi).toHaveBeenCalledWith('a1');
    expect(text()).not.toContain('Ada active');
    expect(text()).toContain('Bo active');
  });

  it('keeps the AI and shows the error when delete fails', async () => {
    state.api.deleteAi.mockRejectedValueOnce(new AisApiError(500, 'ai_teardown_failed', 'x'));
    await mount();
    await press('row:Ada');
    await press('sheet-delete');
    await press('confirm-delete');
    expect(text()).toContain(
      "The server couldn't finish. Nothing was left half-created; try again.",
    );
    expect(text()).toContain('Ada active');
  });

  it('cancels a delete without calling the server', async () => {
    await mount();
    await press('row:Ada');
    await press('sheet-delete');
    await press('cancel-delete');
    expect(state.api.deleteAi).not.toHaveBeenCalled();
    expect(text()).not.toContain('Delete Ada?');
  });

  it('sends a stop for a second AI while the first AI is still stopping', async () => {
    state.api.stopAi.mockReturnValueOnce(new Promise(() => {}));
    await mount();
    await press('row:Ada');
    await press('sheet-stop');
    await press('row:Bo');
    await press('sheet-stop');
    expect(state.api.stopAi).toHaveBeenCalledTimes(2);
    expect(state.api.stopAi.mock.calls[0]?.[0]).toBe('a1');
    expect(state.api.stopAi.mock.calls[1]?.[0]).toBe('a2');
  });

  it('drops a second stop on the same AI while it is still stopping', async () => {
    state.api.stopAi.mockReturnValueOnce(new Promise(() => {}));
    await mount();
    await press('row:Ada');
    await press('sheet-stop');
    await press('sheet-stop');
    expect(state.api.stopAi).toHaveBeenCalledTimes(1);
  });
});

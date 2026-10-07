import { createElement, type ReactElement } from 'react';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { StateMessage } from '@/components/ui/state-message';
import { AiMemoryApiError, type AiMemory, type AiMemoryApi } from '@/lib/ai-memory-api';
import { createMockAiMemoryApi } from '@/mock/ai-memory';

import {
  AiMemorySection,
  AiMemorySectionContent,
  MEMORY_CLEAR_FAILED_MESSAGE,
  MEMORY_FORGET_FAILED_MESSAGE,
  MEMORY_LOAD_FAILED_MESSAGE,
  clearAiMemory,
  removeFact,
  requestForgetFact,
  type AiMemorySectionActions,
  type AiMemorySectionState,
} from './ai-memory-section';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Modal: 'Modal',
  Pressable: 'Pressable',
  View: 'View',
}));

vi.mock('nativewind', () => ({
  useColorScheme: () => ({ colorScheme: 'light' }),
}));

vi.mock('lucide-react-native', () => ({
  Brain: 'Brain',
  CircleAlert: 'CircleAlert',
  Inbox: 'Inbox',
  Trash2: 'Trash2',
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
}));

vi.mock('@/components/ui/button', () => ({
  Button: 'Button',
}));

const CHAT = 'ai-a-1@zilar.test';
const AI = 'a-1';
const NAME = 'Dev-1';

const seeded: AiMemory = {
  facts: [
    { id: 'fact-1', text: 'Julio prefers short answers.' },
    { id: 'fact-2', text: 'The launch is on Friday.' },
  ],
  lines: [
    '#0-15 Summary: the team agreed on the launch plan and pricing.',
    '#16 2026-10-01 Julio: Let us keep the pricing simple.',
  ],
  canChange: true,
};

function fakeApi(): {
  api: AiMemoryApi;
  getMemory: ReturnType<typeof vi.fn>;
  forgetFact: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
} {
  let memory: AiMemory = {
    facts: [...seeded.facts],
    lines: [...seeded.lines],
    canChange: seeded.canChange,
  };
  const getMemory = vi.fn(async (_chat: string, _aiId: string): Promise<AiMemory> => ({
    facts: [...memory.facts],
    lines: [...memory.lines],
    canChange: memory.canChange,
  }));
  const forgetFact = vi.fn(async (_chat: string, _aiId: string, factId: string): Promise<void> => {
    memory = { ...memory, facts: memory.facts.filter((fact) => fact.id !== factId) };
  });
  const clear = vi.fn(async (_chat: string, _aiId: string): Promise<void> => {
    memory = { ...memory, facts: [], lines: [] };
  });
  return { api: { getMemory, forgetFact, clear }, getMemory, forgetFact, clear };
}

type SpyActions = {
  onShow: Mock<() => void>;
  onHide: Mock<() => void>;
  onRetry: Mock<() => void>;
  onForget: Mock<(factId: string) => void>;
  onAskClear: Mock<() => void>;
  onCancelClear: Mock<() => void>;
  onConfirmClear: Mock<() => void>;
};

function actions(): SpyActions {
  return {
    onShow: vi.fn<() => void>(),
    onHide: vi.fn<() => void>(),
    onRetry: vi.fn<() => void>(),
    onForget: vi.fn<(factId: string) => void>(),
    onAskClear: vi.fn<() => void>(),
    onCancelClear: vi.fn<() => void>(),
    onConfirmClear: vi.fn<() => void>(),
  };
}

function state(overrides: Partial<AiMemorySectionState> = {}): AiMemorySectionState {
  return {
    open: true,
    status: 'ready',
    memory: seeded,
    forgetError: '',
    forgettingId: null,
    clearError: '',
    confirmingClear: false,
    ...overrides,
  };
}

function tree(s: AiMemorySectionState, a: AiMemorySectionActions): ReactElement {
  return AiMemorySectionContent({ state: s, aiName: NAME, actions: a }) as unknown as ReactElement;
}

function html(s: AiMemorySectionState, a: AiMemorySectionActions): string {
  return renderToStaticMarkup(tree(s, a));
}

/** Finds the first element of `type` in the (expanded) render tree. */
function findByType(
  node: unknown,
  type: unknown,
): ReactElement<Record<string, unknown>> | undefined {
  let found: ReactElement<Record<string, unknown>> | undefined;
  const visit = (current: unknown): void => {
    if (found !== undefined || current === null || current === undefined) return;
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    if (typeof current === 'object' && 'type' in current) {
      const element = current as ReactElement<Record<string, unknown>> & { type: unknown };
      if (element.type === type) {
        found = element;
        return;
      }
      visit((element.props as { children?: unknown }).children);
    }
  };
  visit(node);
  return found;
}

/** The `onPress` of the first element labelled `label`, like a tap would fire. */
function pressByLabel(node: unknown, label: string): (() => void) | undefined {
  let found: (() => void) | undefined;
  const visit = (current: unknown): void => {
    if (found !== undefined || current === null || current === undefined) return;
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    if (typeof current === 'object' && 'props' in current) {
      const props = (current as { props: Record<string, unknown> }).props;
      if (props['accessibilityLabel'] === label && typeof props['onPress'] === 'function') {
        found = props['onPress'] as () => void;
        return;
      }
      visit(props['children']);
    }
  };
  visit(node);
  return found;
}

/** Every element's props labelled `label`, in tree order. */
function propsByLabel(node: unknown, label: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const visit = (current: unknown): void => {
    if (current === null || current === undefined) return;
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    if (typeof current === 'object' && 'props' in current) {
      const props = (current as { props: Record<string, unknown> }).props;
      if (props['accessibilityLabel'] === label) {
        found.push(props);
      }
      visit(props['children']);
    }
  };
  visit(node);
  return found;
}

describe('AiMemorySection', () => {
  it('makes no request until Show memory is pressed', () => {
    const { api, getMemory } = fakeApi();
    const markup = renderToStaticMarkup(
      createElement(AiMemorySection, { api, chat: CHAT, aiId: AI, aiName: NAME }),
    );

    expect(getMemory).not.toHaveBeenCalled();
    expect(markup).toContain('Show memory');
    expect(markup).toContain(`What ${NAME} remembers from this chat.`);
    expect(markup).not.toContain('Pinned facts');
  });

  it('opens the memory from Show memory', () => {
    const a = actions();
    const onShow = pressByLabel(tree(state({ open: false }), a), 'Show memory');
    onShow?.();
    expect(a.onShow).toHaveBeenCalledTimes(1);
  });
});

describe('AiMemorySectionContent', () => {
  it('shows the facts and strips the cover tokens from the lines', () => {
    const markup = html(state(), actions());

    expect(markup).toContain('Julio prefers short answers.');
    expect(markup).toContain('The launch is on Friday.');
    expect(markup).toContain('Summary: the team agreed on the launch plan and pricing.');
    expect(markup).toContain('2026-10-01 Julio: Let us keep the pricing simple.');
    expect(markup).not.toContain('#0-15 Summary');
    expect(markup).not.toContain('#16 2026-10-01');
  });

  it('wires Forget to the fact id', () => {
    const a = actions();
    const onForget = pressByLabel(tree(state(), a), 'Forget this fact');
    onForget?.();
    expect(a.onForget).toHaveBeenCalledWith('fact-1');
  });

  it('disables the pending fact while a forget is in flight', () => {
    const buttons = propsByLabel(
      tree(state({ forgettingId: 'fact-1' }), actions()),
      'Forget this fact',
    );

    expect(buttons).toHaveLength(2);
    expect(buttons[0]?.['disabled']).toBe(true);
    expect(buttons[1]?.['disabled']).toBe(false);
  });

  it('hides Forget and Clear when canChange is false', () => {
    const a = actions();
    const t = tree(state({ memory: { ...seeded, canChange: false } }), a);

    expect(pressByLabel(t, 'Forget this fact')).toBeUndefined();
    expect(pressByLabel(t, 'Clear memory')).toBeUndefined();
  });

  it('shows the empty sentences when there is no memory', () => {
    const markup = html(state({ memory: { facts: [], lines: [], canChange: true } }), actions());

    expect(markup).toContain('Nothing pinned yet.');
    expect(markup).toContain('Nothing older than the recent messages yet.');
  });

  it('shows the fixed error line with a Retry wired to reload', () => {
    const a = actions();
    const t = tree(state({ status: 'error', memory: null }), a);

    expect(renderToStaticMarkup(t)).toContain(MEMORY_LOAD_FAILED_MESSAGE);
    const message = findByType(t, StateMessage);
    const action = message?.props['action'] as { label: string; onPress: () => void };
    expect(action.label).toBe('Retry');
    action.onPress();
    expect(a.onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows the inline alert when forgetting fails', () => {
    const markup = html(state({ forgetError: MEMORY_FORGET_FAILED_MESSAGE }), actions());

    expect(markup).toContain(MEMORY_FORGET_FAILED_MESSAGE);
    expect(markup).toContain('Julio prefers short answers.');
  });

  it('shows the inline alert when clearing fails', () => {
    expect(html(state({ clearError: MEMORY_CLEAR_FAILED_MESSAGE }), actions())).toContain(
      MEMORY_CLEAR_FAILED_MESSAGE,
    );
  });

  it('asks before clearing: Cancel closes, Clear confirms', () => {
    const a = actions();
    const dialog = findByType(tree(state({ confirmingClear: true }), a), ConfirmDialog);

    expect(dialog).toBeDefined();
    const props = dialog?.props ?? {};
    expect(props['title']).toBe('Clear memory?');
    expect(props['message']).toBe(
      `${NAME} forgets the pinned facts and the summaries of this chat. The messages stay, and it still reads the recent ones.`,
    );
    expect(props['confirmLabel']).toBe('Clear');

    (props['onConfirm'] as () => void)();
    expect(a.onConfirmClear).toHaveBeenCalledTimes(1);
    expect(a.onCancelClear).not.toHaveBeenCalled();

    (props['onCancel'] as () => void)();
    expect(a.onCancelClear).toHaveBeenCalledTimes(1);
  });

  it('hides the dialog until Clear memory is pressed', () => {
    const a = actions();
    const t = tree(state(), a);
    expect(findByType(t, ConfirmDialog)).toBeUndefined();

    pressByLabel(t, 'Clear memory')?.();
    expect(a.onAskClear).toHaveBeenCalledTimes(1);
  });
});

describe('removeFact', () => {
  it('removes one fact and keeps the others', () => {
    const next = removeFact(seeded, 'fact-1');

    expect(next.facts.map((fact) => fact.id)).toEqual(['fact-2']);
    expect(next.lines).toEqual(seeded.lines);
    expect(html(state({ memory: next }), actions())).not.toContain('Julio prefers short answers.');
  });

  it('is harmless when the same id is removed twice', () => {
    const twice = removeFact(removeFact(seeded, 'fact-1'), 'fact-1');

    expect(twice.facts.map((fact) => fact.id)).toEqual(['fact-2']);
  });
});

describe('requestForgetFact', () => {
  it('calls forgetFact with the fact and resolves', async () => {
    const { api, forgetFact } = fakeApi();

    await expect(requestForgetFact(api, CHAT, AI, 'fact-1')).resolves.toBeUndefined();
    expect(forgetFact).toHaveBeenCalledWith(CHAT, AI, 'fact-1');
  });

  it('treats a 404 as success', async () => {
    const api: AiMemoryApi = {
      getMemory: async () => seeded,
      forgetFact: async () => {
        throw new AiMemoryApiError(404, 'not_found', 'Already gone');
      },
      clear: async () => undefined,
    };

    await expect(requestForgetFact(api, CHAT, AI, 'fact-1')).resolves.toBeUndefined();
  });

  it('rethrows any other failure', async () => {
    const api: AiMemoryApi = {
      getMemory: async () => seeded,
      forgetFact: async () => {
        throw new AiMemoryApiError(500, 'boom', 'no');
      },
      clear: async () => undefined,
    };

    await expect(requestForgetFact(api, CHAT, AI, 'fact-1')).rejects.toMatchObject({ status: 500 });
  });
});

describe('clearAiMemory', () => {
  it('clears then reloads', async () => {
    const { api, clear, getMemory } = fakeApi();

    const next = await clearAiMemory(api, CHAT, AI);

    expect(clear).toHaveBeenCalledWith(CHAT, AI);
    expect(getMemory).toHaveBeenCalledWith(CHAT, AI);
    expect(next.facts).toEqual([]);
  });
});

describe('createMockAiMemoryApi', () => {
  it('serves the seeded memory and forgets and clears like the server', async () => {
    const api = createMockAiMemoryApi();

    const first = await api.getMemory(CHAT, AI);
    expect(first.facts.map((fact) => fact.id)).toEqual(['fact-1', 'fact-2']);
    expect(first.lines).toHaveLength(3);
    expect(first.canChange).toBe(true);

    await api.forgetFact(CHAT, AI, 'fact-1');
    expect((await api.getMemory(CHAT, AI)).facts.map((fact) => fact.id)).toEqual(['fact-2']);

    await api.clear(CHAT, AI);
    expect(await api.getMemory(CHAT, AI)).toEqual({ facts: [], lines: [], canChange: true });
  });
});

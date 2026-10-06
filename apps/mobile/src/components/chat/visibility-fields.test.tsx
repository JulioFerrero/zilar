import { describe, expect, it, vi } from 'vitest';

import { createErrorText, publicCreateError, VisibilityFields } from './visibility-fields';
import { GroupsApiError } from '@/lib/groups-api';
import { visibilityReasonText } from './visibility-sheet';

// The fields import `react-native` (Pressable/TextInput), so it is stubbed
// like `new-group-sheet.test.tsx`: Node only, no simulator.
// The reason text comes from the real `visibility-sheet` helper (imported
// above), so the "reason sentence" assertions verify the shared lines, not
// a hand copy. `react-native` and `react-native-safe-area-context` are
// stubbed so the real module never parses the native/safe-area layers.
vi.mock('react-native', () => ({
  Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options['ios'] },
  Pressable: 'Pressable',
  TextInput: 'TextInput',
  View: 'View',
}));

vi.mock('react-native-reanimated', () => ({
  useReducedMotion: () => false,
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
  TextClassContext: { Provider: 'TextClassContextProvider' },
}));

vi.mock('@/lib/depth', () => ({
  KEY_PRIMARY_PRESSED_SHADOW: {},
  pressStyle: () => ({}),
  primaryKey: {},
}));

// The reason text comes from the real `visibility-sheet`, which renders
// through the kit `BottomSheet` (T-0315); stub the shell so these tests
// never load its hooks. Same pattern as `pins-sheet.test.tsx`.
vi.mock('@/components/ui/bottom-sheet', () => ({
  BottomSheet: ({ title, children }: { title?: string; children?: unknown }) => ({
    type: 'BottomSheet',
    props: { children: [title, children] },
  }),
}));

vi.mock('nativewind', () => ({
  useColorScheme: () => ({ colorScheme: 'dark' }),
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

interface TestElement {
  type: unknown;
  props: { children?: unknown; [key: string]: unknown };
}

function collect(node: unknown, out: TestElement[] = []): TestElement[] {
  if (Array.isArray(node)) {
    for (const child of node) {
      collect(child, out);
    }
    return out;
  }
  if (node === null || node === undefined || typeof node !== 'object') {
    return out;
  }
  const element = node as { type?: unknown; props?: { children?: unknown } };
  if (element.props === undefined) {
    return out;
  }
  if (typeof element.type === 'function') {
    const Component = element.type as (props: unknown) => unknown;
    return collect(Component(element.props), out);
  }
  out.push(element as TestElement);
  collect(element.props.children, out);
  return out;
}

function textOf(node: unknown): string {
  if (node === null || node === undefined) {
    return '';
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(textOf).join('');
  }
  if (typeof node === 'object' && 'props' in (node as TestElement)) {
    const element = node as TestElement;
    if (typeof element.type === 'function') {
      const Component = element.type as (props: unknown) => unknown;
      return textOf(Component(element.props));
    }
    return textOf(element.props.children);
  }
  return '';
}

function fields(
  overrides: {
    kind?: 'group' | 'channel';
    visibility?: 'private' | 'public';
    onVisibility?: (next: 'private' | 'public') => void;
    handle?: string;
    onHandle?: (next: string) => void;
    check?: { available: boolean; reason?: string | undefined } | null;
    checking?: boolean;
  } = {},
): TestElement[] {
  return collect(
    VisibilityFields({
      kind: 'group',
      visibility: 'private',
      onVisibility: () => {},
      handle: '',
      onHandle: () => {},
      check: null,
      checking: false,
      ...overrides,
    }),
  );
}

describe('VisibilityFields (T-0228)', () => {
  it('reads the group lines for Private and Public', () => {
    expect(textOf(fields({ kind: 'group', visibility: 'private' }))).toContain(
      'Only invited people can join this group.',
    );
    expect(textOf(fields({ kind: 'group', visibility: 'public' }))).toContain(
      'Anyone can find and join this group.',
    );
  });

  it('reads the channel lines for Private and Public', () => {
    expect(textOf(fields({ kind: 'channel', visibility: 'private' }))).toContain(
      'Only invited people can join this channel.',
    );
    expect(textOf(fields({ kind: 'channel', visibility: 'public' }))).toContain(
      'Anyone can find and join this channel.',
    );
  });

  it('shows the handle field only on Public', () => {
    const privateInputs = fields({ visibility: 'private' }).filter(
      (element) => element.type === 'TextInput',
    );
    expect(privateInputs).toHaveLength(0);
    const publicElements = fields({ visibility: 'public' });
    const publicInputs = publicElements.filter((element) => element.type === 'TextInput');
    expect(publicInputs).toHaveLength(1);
    expect(publicInputs[0]?.props.placeholder).toBe('hiking_club');
    expect(publicInputs[0]?.props.accessibilityLabel).toBe('Group handle');
    expect(publicInputs[0]?.props.maxLength).toBe(32);
    expect(publicInputs[0]?.props.autoCapitalize).toBe('none');
  });

  it('reads the available sentence for a free handle', () => {
    expect(
      textOf(
        fields({
          visibility: 'public',
          handle: 'hiking_club',
          check: { available: true },
        }),
      ),
    ).toContain('@hiking_club is available');
  });

  it('reads the reason sentence for a taken handle', () => {
    expect(
      textOf(
        fields({
          visibility: 'public',
          handle: 'taken',
          check: { available: false, reason: 'taken' },
        }),
      ),
    ).toContain(visibilityReasonText('taken'));
  });

  it('fires the check once per handle, not on every re-render (T-0228 finding 1)', async () => {
    // The hook runs on a minimal stub of React's hook surface (useState /
    // useEffect with dep comparison / useRef, no renderer, no new
    // dependency): after the result lands, the sheet re-renders with a
    // fresh inline `check` closure. Under the old deps (`check` in the dep
    // list) that re-render re-armed the debounce and the request re-fired
    // forever; now the effect only re-runs on visibility/handle, so the
    // second 300 ms window stays quiet.
    vi.useFakeTimers();
    try {
      const sameDeps = (a: unknown[] | undefined, b: unknown[]): boolean =>
        a !== undefined &&
        a.length === b.length &&
        a.every((value, index) => Object.is(value, b[index]));
      const states: unknown[] = [];
      const slots: Array<{ deps: unknown[] | undefined; cleanup?: () => void }> = [];
      const refs: Array<{ current: unknown }> = [];
      let stateCursor = 0;
      let effectCursor = 0;
      let refCursor = 0;
      const react = {
        useState: (initial: unknown) => {
          const index = stateCursor++;
          if (states.length <= index) {
            states.push(initial);
          }
          const slot = index;
          return [
            states[slot],
            (next: unknown) => {
              states[slot] = next;
            },
          ];
        },
        useEffect: (effect: () => void | (() => void), deps?: unknown[]) => {
          const index = effectCursor++;
          const slot = slots[index] ?? { deps: undefined };
          slots[index] = slot;
          if (deps === undefined || !sameDeps(slot.deps, deps)) {
            slot.cleanup?.();
            const cleanup = effect();
            slot.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
            slot.deps = deps;
          }
        },
        useRef: (initial: unknown) => {
          const index = refCursor++;
          if (refs.length <= index) {
            refs.push({ current: initial });
          }
          return refs[index] as { current: unknown };
        },
      };
      vi.doMock('react', () => ({ default: react, ...react }));
      vi.resetModules();
      const { useHandleCheck } = await import('./visibility-fields');
      const render = (check: (value: string) => Promise<{ available: boolean }>) => {
        stateCursor = 0;
        effectCursor = 0;
        refCursor = 0;
        return useHandleCheck('public', 'hiking_club', check);
      };

      let calls = 0;
      const check = async () => {
        calls += 1;
        return { available: true };
      };
      render(check);
      await vi.advanceTimersByTimeAsync(300);
      expect(calls).toBe(1);
      // The result's setState re-renders the sheet with a fresh closure.
      render(async () => {
        calls += 1;
        return { available: true };
      });
      await vi.advanceTimersByTimeAsync(1000);
      expect(calls).toBe(1);
    } finally {
      vi.useRealTimers();
      vi.doUnmock('react');
      vi.resetModules();
    }
  });
});

describe('publicCreateError (T-0228)', () => {
  it('lets private creates through', () => {
    expect(publicCreateError('private', '', null, 'group')).toBeUndefined();
    expect(publicCreateError('private', '', null, 'channel')).toBeUndefined();
  });

  it('names the missing handle per kind', () => {
    expect(publicCreateError('public', '   ', null, 'group')).toBe(
      'Choose a handle for the public group.',
    );
    expect(publicCreateError('public', '', null, 'channel')).toBe(
      'Choose a handle for the public channel.',
    );
  });

  it('repeats the check reason sentence', () => {
    expect(
      publicCreateError('public', 'taken', { available: false, reason: 'taken' }, 'group'),
    ).toBe(visibilityReasonText('taken'));
  });

  it('lets an available handle through', () => {
    expect(
      publicCreateError('public', 'hiking_club', { available: true }, 'channel'),
    ).toBeUndefined();
    expect(publicCreateError('public', 'hiking_club', null, 'channel')).toBeUndefined();
  });
});

describe('createErrorText (T-0228)', () => {
  it('maps the handle codes to their sentences', () => {
    expect(createErrorText(new GroupsApiError(400, 'handle_invalid', 'bad'), 'group')).toContain(
      '3–32 characters',
    );
    expect(createErrorText(new GroupsApiError(409, 'handle_reserved', 'x'), 'channel')).toBe(
      'That handle is reserved. Try another.',
    );
    expect(createErrorText(new GroupsApiError(409, 'handle_taken', 'x'), 'group')).toBe(
      'That handle was just taken. Try another.',
    );
    expect(createErrorText(new GroupsApiError(429, 'rate_limited', 'x'), 'channel')).toBe(
      'Too many tries — wait a little and try again.',
    );
  });

  it('falls back per kind, never server text', () => {
    expect(createErrorText(new GroupsApiError(500, 'boom', 'raw server text'), 'group')).toBe(
      'Could not create the group. Try again.',
    );
    expect(createErrorText(new Error('raw server text'), 'channel')).toBe(
      'Could not create the channel. Try again.',
    );
  });
});

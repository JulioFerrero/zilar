import { describe, expect, it, vi } from 'vitest';

import { NewTopicSheet, type NewTopicInput } from './new-topic-sheet';
import type { GroupAi, GroupMember } from '@/lib/chat-api';

// `NewTopicSheet` is stateful (`useState`), so the test stubs `react`'s
// `useState` with a fixed value per call: name '', kind 'chat', visibility
// 'public' (overridden per test), then selectedMembers [], selectedAis []
// and localError ''. The setters are no-ops; the assertions only read the
// rendered tree. This keeps the node-only pattern of `pins-sheet.test.tsx`
// (no renderer in the mobile repo).
const visibilityOverride = { current: 'public' as string };

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      if (initial === 'public' || initial === 'private') {
        return [visibilityOverride.current, () => {}];
      }
      return [initial, () => {}];
    },
  };
});

vi.mock('react-native', () => ({
  Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options['ios'] },
  Pressable: 'Pressable',
  View: 'View',
}));

vi.mock('@/components/ui/use-key-press', () => ({
  useKeyPress: () => ({ pressed: false, reduceMotion: false, setPressed: () => {} }),
}));

vi.mock('../ui/text', () => ({
  Text: 'Text',
  TextClassContext: { Provider: 'TextClassContextProvider' },
}));

vi.mock('@/lib/depth', () => ({
  KEY_PRIMARY_PRESSED_SHADOW: {},
  pressStyle: () => ({}),
  primaryKey: {},
}));

vi.mock('../ui/text-field', () => ({
  TextField: 'TextField',
}));

vi.mock('../ui/checkbox', () => ({
  Checkbox: 'Checkbox',
}));

vi.mock('./ai-badge', () => ({
  AiBadge: 'AiBadge',
}));

vi.mock('./avatar', () => ({
  Avatar: 'Avatar',
}));

vi.mock('@/lib/utils', () => ({
  cn: (...parts: unknown[]) => parts.filter(Boolean).join(' '),
}));

// `NewTopicSheet` renders through the kit `BottomSheet`, which owns hooks
// (`useSafeAreaInsets`, `useKeyboardHeight`) that cannot run in this
// function-call walk. Stub it as a pass-through that keeps its props so the
// tests can assert on the passed `title`/`closeLabel`; the real shell is
// covered by `bottom-sheet.test.tsx`.
vi.mock('../ui/bottom-sheet', () => ({
  BottomSheet: (props: { title?: string; children?: unknown }) => ({
    type: 'BottomSheet',
    props,
  }),
}));

interface TestElement {
  type: unknown;
  props: {
    children?: unknown;
    accessibilityLabel?: string;
    onPress?: () => void;
    title?: string;
    closeLabel?: string;
  };
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

function member(userId: string, name: string): GroupMember {
  return { userId, name, role: 'member', roles: [] };
}

function ai(aiId: string, name: string): GroupAi {
  return { aiId, jid: `${aiId}@zilar`, name, ownerId: 'me' };
}

const MEMBERS: GroupMember[] = [
  member('me', 'You'),
  member('ana', 'Ana'),
  member('ben', 'Ben'),
  member('cid', 'Cid'),
  member('dan', 'Dan'),
  member('eli', 'Eli'),
];

const BASE = {
  visible: true,
  groupTitle: 'Dev team',
  members: MEMBERS,
  myAis: [ai('ai-1', 'Helper'), ai('ai-2', 'Reviewer')],
  meUserId: 'me',
  busy: false,
  error: '',
  onCreate: (_input: NewTopicInput) => {},
  onClose: () => {},
};

describe('NewTopicSheet', () => {
  it('renders through BottomSheet with the title "New topic"', () => {
    visibilityOverride.current = 'public';
    const elements = collect(NewTopicSheet(BASE));
    const sheet = elements.find((element) => element.type === 'BottomSheet');
    expect(sheet).toBeDefined();
    expect(sheet?.props.title).toBe('New topic');
    expect(sheet?.props.closeLabel).toBe('Close new topic');
    expect(
      elements.some((element) => element.type === 'Text' && textOf(element) === 'New topic'),
    ).toBe(false);
    expect(textOf(elements)).toContain('Dev team');
  });

  it('keeps the Create button reachable with 6 members in private mode', () => {
    visibilityOverride.current = 'private';
    const onCreate = vi.fn();
    const elements = collect(NewTopicSheet({ ...BASE, onCreate }));
    for (const person of ['Ana', 'Ben', 'Cid', 'Dan', 'Eli']) {
      expect(textOf(elements)).toContain(person);
    }
    expect(textOf(elements)).toContain('Helper');
    const create = elements.find((element) => element.props.accessibilityLabel === 'Create topic');
    expect(create).toBeDefined();
    create?.props.onPress?.();
    expect(onCreate).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from 'vitest';

import { NewMessageSheet } from './new-message-sheet';

// The sheet is stateless, so it is called as a plain function with
// `react-native` stubbed (same pattern as `invite-links-sheet.test.tsx`):
// Node only, no simulator, no new dependency.
vi.mock('react-native', () => ({
  Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options['ios'] },
  Pressable: 'Pressable',
  View: 'View',
}));

vi.mock('react-native-reanimated', () => ({
  useReducedMotion: () => false,
}));

vi.mock('@/components/ui/use-key-press', () => ({
  useKeyPress: () => ({ pressed: false, reduceMotion: false, setPressed: () => {} }),
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

interface TestElement {
  type: unknown;
  props: { children?: unknown; onPress?: () => void; [key: string]: unknown };
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

function sheet(overrides: Partial<Parameters<typeof NewMessageSheet>[0]> = {}) {
  return NewMessageSheet({ onInvite: () => {}, onClose: () => {}, ...overrides });
}

function press(elements: TestElement[], label: string): void {
  const button = elements.find((element) => element.props.accessibilityLabel === label);
  expect(button).toBeDefined();
  const onPress = (button as TestElement).props.onPress;
  expect(typeof onPress).toBe('function');
  (onPress as () => void)();
}

describe('NewMessageSheet', () => {
  it('shows the web sentence, not Coming soon', () => {
    const all = textOf(collect(sheet()));
    expect(all).toContain('New message');
    expect(all).toContain(
      'Invite a friend to start a conversation, or type their @username in the search bar above.',
    );
    expect(all).not.toContain('Coming soon');
  });

  it('Invite a friend calls onInvite', () => {
    const calls: string[] = [];
    press(collect(sheet({ onInvite: () => calls.push('invite') })), 'Invite a friend');
    expect(calls).toEqual(['invite']);
  });

  it('Close calls onClose', () => {
    const calls: string[] = [];
    press(collect(sheet({ onClose: () => calls.push('close') })), 'Close');
    expect(calls).toEqual(['close']);
  });
});

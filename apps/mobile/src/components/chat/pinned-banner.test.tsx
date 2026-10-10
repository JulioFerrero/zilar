import { describe, expect, it, vi } from 'vitest';

import { PinnedBanner, type BannerPin } from './pinned-banner';

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

vi.mock('lucide-react-native', () => ({
  Pin: 'Pin',
}));

interface TestElement {
  type: unknown;
  props: { children?: unknown; accessibilityLabel?: string; onPress?: () => void };
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

function pin(overrides: Partial<BannerPin> = {}): BannerPin {
  return {
    id: 'pin-1',
    messageId: 'ana-11',
    senderName: 'You',
    text: 'Booked for 21:00 ✅',
    kind: 'text',
    ...overrides,
  };
}

const BASE = {
  pinsError: undefined as string | undefined,
  index: 0,
  jumpError: '',
  onCycle: () => {},
  onTapPin: () => {},
  onOpenList: () => {},
  onDismissError: () => {},
};

describe('PinnedBanner', () => {
  it('renders nothing without pins or errors', () => {
    expect(PinnedBanner({ ...BASE, pins: [] })).toBeNull();
  });

  it('shows the latest pin with its sender and text', () => {
    const elements = collect(PinnedBanner({ ...BASE, pins: [pin()] }));
    expect(textOf(elements)).toContain('You: ');
    expect(textOf(elements)).toContain('Booked for 21:00 ✅');
    const jump = elements.find(
      (element) => element.props.accessibilityLabel === 'Jump to pinned message from You',
    );
    expect(jump).toBeDefined();
  });

  it('labels an attachment pin by its kind and cycles several pins', () => {
    const tapped: BannerPin[] = [];
    const cycled: number[] = [];
    const rows = [
      pin({ id: 'pin-1', senderName: 'You', text: 'first' }),
      pin({ id: 'pin-2', senderName: 'Marta', text: '', kind: 'image' }),
    ];
    const first = collect(
      PinnedBanner({ ...BASE, pins: rows, onTapPin: (row) => tapped.push(row) }),
    );
    expect(textOf(first)).toContain('first');
    expect(textOf(first)).toContain('1 of 2');

    const second = collect(
      PinnedBanner({
        ...BASE,
        pins: rows,
        index: 1,
        onTapPin: (row) => tapped.push(row),
        onCycle: () => cycled.push(1),
      }),
    );
    expect(textOf(second)).toContain('Photo');
    expect(textOf(second)).toContain('2 of 2');
    expect(textOf(second)).toContain('2 pins');

    const cycle = second.find(
      (element) => element.props.accessibilityLabel === 'Cycle pins, 2 of 2',
    );
    cycle?.props.onPress?.();
    expect(cycled).toEqual([1]);

    const jump = second.find(
      (element) => element.props.accessibilityLabel === 'Jump to pinned message from Marta',
    );
    jump?.props.onPress?.();
    expect(tapped.map((row) => row.id)).toEqual(['pin-2']);
  });

  it('opens the list sheet and shows the inline errors', () => {
    let opened = 0;
    let dismissed = 0;
    const elements = collect(
      PinnedBanner({
        ...BASE,
        pins: [pin()],
        jumpError: 'Message not found',
        pinsError: 'Could not load pins. Try again.',
        onOpenList: () => {
          opened += 1;
        },
        onDismissError: () => {
          dismissed += 1;
        },
      }),
    );
    expect(textOf(elements)).toContain('Message not found');
    expect(textOf(elements)).toContain('Could not load pins. Try again.');
    const list = elements.find(
      (element) => element.props.accessibilityLabel === 'Show pinned message',
    );
    list?.props.onPress?.();
    expect(opened).toBe(1);
    const dismiss = elements.find(
      (element) => element.props.accessibilityLabel === 'Dismiss pins error',
    );
    dismiss?.props.onPress?.();
    expect(dismissed).toBe(1);
  });
});

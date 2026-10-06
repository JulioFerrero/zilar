import { describe, expect, it, vi } from 'vitest';

import { PinsSheet, type SheetPin } from './pins-sheet';

vi.mock('react-native', () => ({
  Modal: 'Modal',
  Pressable: 'Pressable',
  View: 'View',
}));

vi.mock('../ui/text', () => ({
  Text: 'Text',
}));

// `PinsSheet` renders through the kit `BottomSheet`, which owns hooks
// (`useSafeAreaInsets`, `useKeyboardHeight`) that cannot run in this
// function-call walk. Stub it as a pass-through that keeps the title and the
// rows visible to `collect`/`textOf`; the real shell is covered by
// `bottom-sheet.test.tsx`.
vi.mock('../ui/bottom-sheet', () => ({
  BottomSheet: ({ title, children }: { title?: string; children?: unknown }) => ({
    type: 'BottomSheet',
    props: { children: [title, children] },
  }),
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

function pin(overrides: Partial<SheetPin> = {}): SheetPin {
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
  open: true,
  canUnpin: true,
  unpinningId: null as string | null,
  error: '',
  onUnpin: () => {},
  onJump: () => {},
  onClose: () => {},
};

describe('PinsSheet', () => {
  it('lists every pin with jump and unpin', () => {
    const jumped: SheetPin[] = [];
    const unpinned: SheetPin[] = [];
    const rows = [pin(), pin({ id: 'pin-2', senderName: 'Ana', text: 'second' })];
    const elements = collect(
      PinsSheet({
        ...BASE,
        pins: rows,
        onJump: (row) => jumped.push(row),
        onUnpin: (row) => unpinned.push(row),
      }),
    );
    expect(textOf(elements)).toContain('Pinned messages (2)');
    expect(textOf(elements)).toContain('Booked for 21:00 ✅');
    expect(textOf(elements)).toContain('second');

    const jump = elements.find(
      (element) => element.props.accessibilityLabel === 'Jump to pinned message from Ana',
    );
    jump?.props.onPress?.();
    expect(jumped.map((row) => row.id)).toEqual(['pin-2']);

    const unpin = elements.find(
      (element) => element.props.accessibilityLabel === 'Unpin message from Ana',
    );
    unpin?.props.onPress?.();
    expect(unpinned.map((row) => row.id)).toEqual(['pin-2']);
  });

  it('hides unpin for plain members and disables the row in flight', () => {
    const member = collect(PinsSheet({ ...BASE, pins: [pin()], canUnpin: false }));
    expect(
      member.some((element) => element.props.accessibilityLabel === 'Unpin message from You'),
    ).toBe(false);

    const busy = collect(PinsSheet({ ...BASE, pins: [pin()], unpinningId: 'pin-1' }));
    expect(textOf(busy)).toContain('…');
  });

  it('says empty and shows the unpin error', () => {
    const elements = collect(PinsSheet({ ...BASE, pins: [], error: 'Could not unpin.' }));
    expect(textOf(elements)).toContain('No pinned messages.');
    expect(textOf(elements)).toContain('Could not unpin.');
  });
});

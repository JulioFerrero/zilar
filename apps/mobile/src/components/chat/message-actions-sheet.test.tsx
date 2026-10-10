import { describe, expect, it, vi } from 'vitest';

import { MessageActionsSheet } from './message-actions-sheet';

vi.mock('react-native', () => ({
  Modal: 'Modal',
  Pressable: 'Pressable',
  View: 'View',
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
}));

vi.mock('@/components/ui/confirm-dialog', () => ({
  ConfirmDialog: 'ConfirmDialog',
}));

vi.mock('lucide-react-native', () => ({
  Copy: 'Copy',
  Forward: 'Forward',
  ListChecks: 'ListChecks',
  Pencil: 'Pencil',
  Pin: 'Pin',
  PinOff: 'PinOff',
  Reply: 'Reply',
  Trash2: 'Trash2',
}));

vi.mock('@/lib/colors', () => ({
  MUTED_FOREGROUND: '#888888',
}));

vi.mock('@/lib/utils', () => ({
  cn: (...parts: unknown[]) => parts.filter(Boolean).join(' '),
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

function labels(elements: TestElement[]): (string | undefined)[] {
  return elements
    .filter((element) => element.type === 'Pressable')
    .map((element) => element.props.accessibilityLabel);
}

const BASE = {
  visible: true,
  canCopy: true,
  canEdit: false,
  canDelete: true,
  myReactions: [],
  onReply: () => {},
  onEdit: () => {},
  onCopy: () => {},
  onDelete: () => {},
  confirmOpen: false,
  onCloseConfirm: () => {},
  onConfirmDelete: () => {},
  onReact: () => {},
  onClose: () => {},
};

describe('MessageActionsSheet forward row', () => {
  it('shows Forward message when canForward is true', () => {
    const elements = collect(
      MessageActionsSheet({ ...BASE, canForward: true, onForward: () => {} }),
    );
    expect(labels(elements)).toContain('Forward message');
  });

  it('hides Forward message when canForward is false or absent', () => {
    expect(labels(collect(MessageActionsSheet({ ...BASE, canForward: false })))).not.toContain(
      'Forward message',
    );
    expect(labels(collect(MessageActionsSheet({ ...BASE })))).not.toContain('Forward message');
  });
});

function findPressable(elements: TestElement[], label: string): TestElement | undefined {
  return elements.find(
    (element) => element.type === 'Pressable' && element.props.accessibilityLabel === label,
  );
}

describe('MessageActionsSheet select row', () => {
  it('shows Select when canForward and onSelect are set, and calls it', () => {
    const onSelect = vi.fn();
    const elements = collect(
      MessageActionsSheet({ ...BASE, canForward: true, onForward: () => {}, onSelect }),
    );
    const select = findPressable(elements, 'Select messages');
    expect(select).toBeDefined();
    select?.props.onPress?.();
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('hides Select without onSelect', () => {
    expect(
      labels(collect(MessageActionsSheet({ ...BASE, canForward: true, onForward: () => {} }))),
    ).not.toContain('Select messages');
  });

  it('hides Select when canForward is false', () => {
    expect(
      labels(collect(MessageActionsSheet({ ...BASE, canForward: false, onSelect: () => {} }))),
    ).not.toContain('Select messages');
  });
});
